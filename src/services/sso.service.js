// =============================================================================
// AIRAVAT B2B MARKETPLACE - SSO SERVICE
// Single Sign-On for Enterprise (SAML, Azure AD, Okta)
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError, BadRequestError, NotFoundError } = require('../utils/errors');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const config = require('../config');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Supported SSO providers
 */
const SSO_PROVIDERS = {
  SAML: {
    id: 'saml',
    name: 'SAML 2.0',
    description: 'Generic SAML 2.0 Identity Provider',
    configFields: ['entityId', 'ssoUrl', 'certificate', 'logoutUrl'],
  },
  AZURE_AD: {
    id: 'azure_ad',
    name: 'Azure Active Directory',
    description: 'Microsoft Azure AD / Entra ID',
    configFields: ['tenantId', 'clientId', 'clientSecret'],
  },
  OKTA: {
    id: 'okta',
    name: 'Okta',
    description: 'Okta Identity Provider',
    configFields: ['domain', 'clientId', 'clientSecret'],
  },
  GOOGLE: {
    id: 'google',
    name: 'Google Workspace',
    description: 'Google Workspace SSO',
    configFields: ['clientId', 'clientSecret', 'hostedDomain'],
  },
};

/**
 * SSO session states
 */
const SSO_STATES = {
  INITIATED: 'initiated',
  PENDING: 'pending',
  COMPLETED: 'completed',
  FAILED: 'failed',
  EXPIRED: 'expired',
};

// =============================================================================
// SSO CONFIGURATION
// =============================================================================

/**
 * Configure SSO for a tenant
 * @param {string} tenantId - Tenant ID
 * @param {Object} config - SSO configuration
 * @returns {Promise<Object>} SSO configuration
 */
exports.configureSso = async (tenantId, ssoConfig) => {
  try {
    const { provider, config: providerConfig, enabled = true, enforced = false } = ssoConfig;

    if (!SSO_PROVIDERS[provider.toUpperCase()]) {
      throw new BadRequestError(`Unsupported SSO provider: ${provider}`);
    }

    const providerInfo = SSO_PROVIDERS[provider.toUpperCase()];

    // Validate required fields
    for (const field of providerInfo.configFields) {
      if (!providerConfig[field]) {
        throw new BadRequestError(`Missing required field: ${field}`);
      }
    }

    // Encrypt sensitive data
    const encryptedConfig = encryptConfig(providerConfig);

    const sso = await prisma.ssoConfiguration.upsert({
      where: { tenantId },
      update: {
        provider: providerInfo.id,
        providerName: providerInfo.name,
        config: encryptedConfig,
        enabled,
        enforced,
        updatedAt: new Date(),
      },
      create: {
        tenantId,
        provider: providerInfo.id,
        providerName: providerInfo.name,
        config: encryptedConfig,
        enabled,
        enforced,
        acsUrl: generateAcsUrl(tenantId),
        entityId: generateEntityId(tenantId),
        metadataUrl: generateMetadataUrl(tenantId),
      },
    });

    logger.info('SSO configured', { tenantId, provider: providerInfo.id });

    return {
      id: sso.id,
      provider: sso.providerName,
      enabled: sso.enabled,
      enforced: sso.enforced,
      acsUrl: sso.acsUrl,
      entityId: sso.entityId,
      metadataUrl: sso.metadataUrl,
    };
  } catch (error) {
    logger.error('Configure SSO error', { error: error.message, tenantId });
    throw error;
  }
};

/**
 * Get SSO configuration
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} SSO configuration
 */
exports.getSsoConfig = async (tenantId) => {
  const sso = await prisma.ssoConfiguration.findUnique({
    where: { tenantId },
  });

  if (!sso) {
    return { configured: false };
  }

  return {
    configured: true,
    provider: sso.providerName,
    enabled: sso.enabled,
    enforced: sso.enforced,
    acsUrl: sso.acsUrl,
    entityId: sso.entityId,
    metadataUrl: sso.metadataUrl,
    createdAt: sso.createdAt,
  };
};

/**
 * Disable SSO
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<void>}
 */
exports.disableSso = async (tenantId) => {
  await prisma.ssoConfiguration.update({
    where: { tenantId },
    data: { enabled: false },
  });

  logger.info('SSO disabled', { tenantId });
};

// =============================================================================
// SSO FLOW
// =============================================================================

/**
 * Initiate SSO login
 * @param {string} tenantId - Tenant ID
 * @param {string} returnUrl - Return URL after login
 * @returns {Promise<Object>} SSO initiation result
 */
exports.initiateSsoLogin = async (tenantId, returnUrl = '/') => {
  const sso = await prisma.ssoConfiguration.findUnique({
    where: { tenantId },
  });

  if (!sso || !sso.enabled) {
    throw new BadRequestError('SSO not configured or disabled');
  }

  // Generate state token
  const state = generateStateToken();

  // Store SSO session
  await prisma.ssoSession.create({
    data: {
      tenantId,
      state,
      returnUrl,
      status: SSO_STATES.INITIATED,
      expiresAt: new Date(Date.now() + 10 * 60 * 1000), // 10 minutes
    },
  });

  // Generate redirect URL based on provider
  const redirectUrl = await generateRedirectUrl(sso, state);

  return {
    redirectUrl,
    state,
  };
};

/**
 * Handle SSO callback
 * @param {string} state - State token
 * @param {Object} assertion - Identity assertion from provider
 * @returns {Promise<Object>} Authentication result
 */
exports.handleSsoCallback = async (state, assertion) => {
  try {
    // Find SSO session
    const session = await prisma.ssoSession.findFirst({
      where: {
        state,
        status: SSO_STATES.INITIATED,
        expiresAt: { gte: new Date() },
      },
    });

    if (!session) {
      throw new BadRequestError('Invalid or expired SSO session');
    }

    // Get SSO config
    const sso = await prisma.ssoConfiguration.findUnique({
      where: { tenantId: session.tenantId },
    });

    if (!sso) {
      throw new NotFoundError('SSO configuration not found');
    }

    // Validate assertion based on provider
    const userInfo = await validateAssertion(sso, assertion);

    // Find or create user
    let user = await prisma.user.findFirst({
      where: {
        OR: [
          { email: userInfo.email },
          { ssoId: userInfo.id, ssoProvider: sso.provider },
        ],
      },
    });

    if (!user) {
      // Auto-provision user
      user = await prisma.user.create({
        data: {
          email: userInfo.email,
          firstName: userInfo.firstName || userInfo.name?.split(' ')[0] || '',
          lastName: userInfo.lastName || userInfo.name?.split(' ').slice(1).join(' ') || '',
          ssoId: userInfo.id,
          ssoProvider: sso.provider,
          emailVerified: true,
          status: 'ACTIVE',
          metadata: {
            provisionedViaSso: true,
            ssoGroups: userInfo.groups || [],
          },
        },
      });

      // Add to tenant
      await prisma.tenantMember.create({
        data: {
          tenantId: session.tenantId,
          userId: user.id,
          role: determineUserRole(userInfo.groups || []),
        },
      });
    } else {
      // Update user info
      await prisma.user.update({
        where: { id: user.id },
        data: {
          ssoId: userInfo.id,
          ssoProvider: sso.provider,
          lastLoginAt: new Date(),
        },
      });
    }

    // Update session
    await prisma.ssoSession.update({
      where: { id: session.id },
      data: {
        status: SSO_STATES.COMPLETED,
        userId: user.id,
        completedAt: new Date(),
      },
    });

    // Generate JWT
    const token = jwt.sign(
      { userId: user.id, tenantId: session.tenantId, sso: true },
      config.jwt.secret,
      { expiresIn: config.jwt.expiresIn }
    );

    logger.info('SSO login successful', { userId: user.id, tenantId: session.tenantId });

    return {
      success: true,
      token,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      returnUrl: session.returnUrl,
    };
  } catch (error) {
    // Update session as failed
    if (state) {
      await prisma.ssoSession.updateMany({
        where: { state },
        data: { status: SSO_STATES.FAILED, error: error.message },
      });
    }

    logger.error('SSO callback error', { error: error.message, state });
    throw error;
  }
};

/**
 * Handle SSO logout
 * @param {string} tenantId - Tenant ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Logout result
 */
exports.handleSsoLogout = async (tenantId, userId) => {
  const sso = await prisma.ssoConfiguration.findUnique({
    where: { tenantId },
  });

  if (!sso || !sso.enabled) {
    return { logoutUrl: null };
  }

  const config = decryptConfig(sso.config);
  const logoutUrl = config.logoutUrl || null;

  // Invalidate all sessions for user
  await prisma.ssoSession.updateMany({
    where: { tenantId, userId },
    data: { status: SSO_STATES.EXPIRED },
  });

  logger.info('SSO logout', { userId, tenantId });

  return { logoutUrl };
};

// =============================================================================
// SAML SPECIFIC
// =============================================================================

/**
 * Get SAML metadata
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<string>} SAML metadata XML
 */
exports.getSamlMetadata = async (tenantId) => {
  const sso = await prisma.ssoConfiguration.findUnique({
    where: { tenantId },
  });

  if (!sso || sso.provider !== 'saml') {
    throw new NotFoundError('SAML not configured');
  }

  const metadata = `<?xml version="1.0"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata"
                     entityID="${sso.entityId}">
  <md:SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol"
                      AuthnRequestsSigned="true"
                      WantAssertionsSigned="true">
    <md:NameIDFormat>urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress</md:NameIDFormat>
    <md:AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST"
                                 Location="${sso.acsUrl}"
                                 index="0"/>
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;

  return metadata;
};

// =============================================================================
// DOMAIN VERIFICATION
// =============================================================================

/**
 * Verify domain for SSO
 * @param {string} tenantId - Tenant ID
 * @param {string} domain - Email domain
 * @returns {Promise<Object>} Verification result
 */
exports.verifyDomain = async (tenantId, domain) => {
  // Generate verification token
  const token = `airavat-domain-verify=${crypto.randomBytes(16).toString('hex')}`;

  const verification = await prisma.domainVerification.upsert({
    where: {
      tenantId_domain: { tenantId, domain },
    },
    update: {
      token,
      verified: false,
      updatedAt: new Date(),
    },
    create: {
      tenantId,
      domain,
      token,
      verified: false,
    },
  });

  return {
    domain,
    verificationMethod: 'DNS_TXT',
    record: {
      type: 'TXT',
      name: `_airavat.${domain}`,
      value: token,
    },
    instructions: 'Add this TXT record to your DNS and click verify',
  };
};

/**
 * Check domain verification
 * @param {string} tenantId - Tenant ID
 * @param {string} domain - Domain
 * @returns {Promise<Object>} Verification status
 */
exports.checkDomainVerification = async (tenantId, domain) => {
  const verification = await prisma.domainVerification.findUnique({
    where: {
      tenantId_domain: { tenantId, domain },
    },
  });

  if (!verification) {
    throw new NotFoundError('Domain verification not found');
  }

  // In production, check DNS records
  const dnsVerified = await checkDnsRecord(domain, verification.token);

  if (dnsVerified) {
    await prisma.domainVerification.update({
      where: { id: verification.id },
      data: { verified: true, verifiedAt: new Date() },
    });
  }

  return {
    domain,
    verified: dnsVerified,
    verifiedAt: dnsVerified ? new Date() : null,
  };
};

/**
 * Get verified domains
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object[]>} Verified domains
 */
exports.getVerifiedDomains = async (tenantId) => {
  const domains = await prisma.domainVerification.findMany({
    where: { tenantId, verified: true },
  });

  return domains;
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateStateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function generateAcsUrl(tenantId) {
  const baseUrl = config.app.url || 'https://api.airavat.com';
  return `${baseUrl}/api/v1/sso/${tenantId}/callback`;
}

function generateEntityId(tenantId) {
  const baseUrl = config.app.url || 'https://api.airavat.com';
  return `${baseUrl}/sso/${tenantId}`;
}

function generateMetadataUrl(tenantId) {
  const baseUrl = config.app.url || 'https://api.airavat.com';
  return `${baseUrl}/api/v1/sso/${tenantId}/metadata`;
}

async function generateRedirectUrl(sso, state) {
  const ssoConfig = decryptConfig(sso.config);

  switch (sso.provider) {
    case 'saml':
      return `${ssoConfig.ssoUrl}?SAMLRequest=&RelayState=${state}`;
    case 'azure_ad':
      return `https://login.microsoftonline.com/${ssoConfig.tenantId}/oauth2/v2.0/authorize?client_id=${ssoConfig.clientId}&response_type=code&redirect_uri=${sso.acsUrl}&state=${state}&scope=openid%20email%20profile`;
    case 'okta':
      return `https://${ssoConfig.domain}/oauth2/v1/authorize?client_id=${ssoConfig.clientId}&response_type=code&redirect_uri=${sso.acsUrl}&state=${state}&scope=openid%20email%20profile`;
    case 'google':
      return `https://accounts.google.com/o/oauth2/v2/auth?client_id=${ssoConfig.clientId}&response_type=code&redirect_uri=${sso.acsUrl}&state=${state}&scope=openid%20email%20profile&hd=${ssoConfig.hostedDomain}`;
    default:
      throw new BadRequestError(`Unsupported provider: ${sso.provider}`);
  }
}

async function validateAssertion(sso, assertion) {
  // In production, properly validate SAML assertions or OAuth tokens
  // This is a simplified version
  const { email, id, name, firstName, lastName, groups } = assertion;

  if (!email) {
    throw new BadRequestError('Email is required from identity provider');
  }

  return {
    email,
    id: id || email,
    name,
    firstName,
    lastName,
    groups: groups || [],
  };
}

function determineUserRole(groups) {
  // Map IdP groups to tenant roles
  const groupMapping = {
    admins: 'admin',
    managers: 'manager',
    users: 'member',
  };

  for (const [group, role] of Object.entries(groupMapping)) {
    if (groups.some((g) => g.toLowerCase().includes(group))) {
      return role;
    }
  }

  return 'member';
}

function encryptConfig(ssoConfig) {
  // In production, use proper encryption
  return Buffer.from(JSON.stringify(ssoConfig)).toString('base64');
}

function decryptConfig(encrypted) {
  // In production, use proper decryption
  return JSON.parse(Buffer.from(encrypted, 'base64').toString());
}

async function checkDnsRecord(domain, token) {
  // In production, use DNS library to verify
  return true;
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  SSO_PROVIDERS,
  SSO_STATES,
};



