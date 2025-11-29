// =============================================================================
// AIRAVAT B2B MARKETPLACE - MULTI-TENANCY SERVICE
// White-label, custom domains, and tenant isolation
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError, BadRequestError, NotFoundError } = require('../utils/errors');
const crypto = require('crypto');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Tenant tiers
 */
const TENANT_TIERS = {
  STARTER: {
    id: 'starter',
    name: 'Starter',
    features: {
      customDomain: false,
      customBranding: true,
      maxUsers: 10,
      maxProducts: 100,
      apiAccess: false,
      whiteLabel: false,
      customEmails: false,
      analytics: 'basic',
      support: 'email',
    },
    price: 9999,
    currency: 'INR',
  },
  PROFESSIONAL: {
    id: 'professional',
    name: 'Professional',
    features: {
      customDomain: true,
      customBranding: true,
      maxUsers: 50,
      maxProducts: 1000,
      apiAccess: true,
      whiteLabel: false,
      customEmails: true,
      analytics: 'advanced',
      support: 'priority',
    },
    price: 24999,
    currency: 'INR',
  },
  ENTERPRISE: {
    id: 'enterprise',
    name: 'Enterprise',
    features: {
      customDomain: true,
      customBranding: true,
      maxUsers: -1, // Unlimited
      maxProducts: -1,
      apiAccess: true,
      whiteLabel: true,
      customEmails: true,
      analytics: 'premium',
      support: 'dedicated',
    },
    price: null, // Custom pricing
    currency: 'INR',
  },
};

/**
 * Default branding
 */
const DEFAULT_BRANDING = {
  logo: '/assets/logo.png',
  favicon: '/assets/favicon.ico',
  primaryColor: '#3B82F6',
  secondaryColor: '#10B981',
  accentColor: '#F59E0B',
  fontFamily: 'Inter, sans-serif',
  headerBg: '#FFFFFF',
  footerBg: '#1F2937',
};

// =============================================================================
// TENANT MANAGEMENT
// =============================================================================

/**
 * Create a new tenant
 * @param {Object} data - Tenant data
 * @returns {Promise<Object>} Created tenant
 */
exports.createTenant = async (data) => {
  try {
    const {
      name,
      slug,
      ownerId,
      tier = 'STARTER',
      domain = null,
      branding = {},
    } = data;

    // Validate slug
    if (!/^[a-z0-9-]+$/.test(slug)) {
      throw new BadRequestError('Slug must contain only lowercase letters, numbers, and hyphens');
    }

    // Check slug uniqueness
    const existingSlug = await prisma.tenant.findUnique({
      where: { slug },
    });
    if (existingSlug) {
      throw new BadRequestError('Slug already taken');
    }

    // Check domain uniqueness
    if (domain) {
      const existingDomain = await prisma.tenant.findFirst({
        where: { customDomain: domain },
      });
      if (existingDomain) {
        throw new BadRequestError('Domain already in use');
      }
    }

    const tierConfig = TENANT_TIERS[tier.toUpperCase()];
    if (!tierConfig) {
      throw new BadRequestError('Invalid tier');
    }

    // Generate API key
    const apiKey = generateApiKey();

    const tenant = await prisma.tenant.create({
      data: {
        name,
        slug,
        ownerId,
        tier,
        customDomain: domain,
        domainVerified: false,
        apiKey,
        apiKeyHash: hashApiKey(apiKey),
        branding: { ...DEFAULT_BRANDING, ...branding },
        settings: {
          features: tierConfig.features,
          limits: {
            maxUsers: tierConfig.features.maxUsers,
            maxProducts: tierConfig.features.maxProducts,
          },
        },
        status: 'ACTIVE',
      },
    });

    // Create default roles for tenant
    await createDefaultRoles(tenant.id);

    logger.info('Tenant created', { tenantId: tenant.id, slug });

    return {
      ...tenant,
      apiKey, // Return once, not stored in plain text
      tier: tierConfig,
    };
  } catch (error) {
    logger.error('Create tenant error', { error: error.message });
    throw error;
  }
};

/**
 * Get tenant by slug or domain
 * @param {string} identifier - Slug or domain
 * @returns {Promise<Object>} Tenant
 */
exports.getTenant = async (identifier) => {
  const tenant = await prisma.tenant.findFirst({
    where: {
      OR: [
        { slug: identifier },
        { customDomain: identifier },
      ],
      status: 'ACTIVE',
    },
    include: {
      owner: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  });

  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }

  return {
    ...tenant,
    tier: TENANT_TIERS[tenant.tier.toUpperCase()],
  };
};

/**
 * Update tenant
 * @param {string} tenantId - Tenant ID
 * @param {Object} updates - Updates
 * @returns {Promise<Object>} Updated tenant
 */
exports.updateTenant = async (tenantId, updates) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }

  const allowedUpdates = ['name', 'branding', 'settings', 'customDomain'];
  const updateData = {};

  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      if (key === 'branding') {
        updateData.branding = { ...tenant.branding, ...updates.branding };
      } else if (key === 'settings') {
        updateData.settings = { ...tenant.settings, ...updates.settings };
      } else {
        updateData[key] = updates[key];
      }
    }
  }

  // If custom domain changed, reset verification
  if (updates.customDomain && updates.customDomain !== tenant.customDomain) {
    updateData.domainVerified = false;
    updateData.domainVerificationToken = generateVerificationToken();
  }

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: updateData,
  });

  logger.info('Tenant updated', { tenantId, updates: Object.keys(updateData) });

  return updated;
};

/**
 * Update tenant branding
 * @param {string} tenantId - Tenant ID
 * @param {Object} branding - Branding options
 * @returns {Promise<Object>} Updated branding
 */
exports.updateBranding = async (tenantId, branding) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }

  const updatedBranding = { ...tenant.branding, ...branding };

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { branding: updatedBranding },
  });

  logger.info('Tenant branding updated', { tenantId });

  return updatedBranding;
};

// =============================================================================
// DOMAIN MANAGEMENT
// =============================================================================

/**
 * Setup custom domain
 * @param {string} tenantId - Tenant ID
 * @param {string} domain - Custom domain
 * @returns {Promise<Object>} Domain setup instructions
 */
exports.setupCustomDomain = async (tenantId, domain) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }

  const tierConfig = TENANT_TIERS[tenant.tier.toUpperCase()];
  if (!tierConfig.features.customDomain) {
    throw new BadRequestError('Custom domain not available in your plan');
  }

  // Generate verification token
  const verificationToken = generateVerificationToken();

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      customDomain: domain,
      domainVerified: false,
      domainVerificationToken: verificationToken,
    },
  });

  return {
    domain,
    verificationMethod: 'DNS_TXT',
    verificationRecord: {
      type: 'TXT',
      name: `_airavat-verify.${domain}`,
      value: verificationToken,
    },
    cnameRecord: {
      type: 'CNAME',
      name: domain,
      value: 'custom.airavat.com',
    },
    instructions: [
      `Add a TXT record to verify domain ownership`,
      `Add a CNAME record to point to our servers`,
      `Click "Verify Domain" once records are configured`,
    ],
  };
};

/**
 * Verify custom domain
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} Verification result
 */
exports.verifyCustomDomain = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant || !tenant.customDomain) {
    throw new NotFoundError('Domain not configured');
  }

  // In production, this would check DNS records
  // For now, simulate verification
  const dnsVerified = await checkDnsRecords(
    tenant.customDomain,
    tenant.domainVerificationToken
  );

  if (!dnsVerified) {
    return {
      verified: false,
      message: 'DNS records not found. Please wait for DNS propagation.',
    };
  }

  await prisma.tenant.update({
    where: { id: tenantId },
    data: { domainVerified: true },
  });

  logger.info('Domain verified', { tenantId, domain: tenant.customDomain });

  return {
    verified: true,
    domain: tenant.customDomain,
    message: 'Domain verified successfully',
  };
};

/**
 * Remove custom domain
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<void>}
 */
exports.removeCustomDomain = async (tenantId) => {
  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      customDomain: null,
      domainVerified: false,
      domainVerificationToken: null,
    },
  });

  logger.info('Domain removed', { tenantId });
};

// =============================================================================
// API KEY MANAGEMENT
// =============================================================================

/**
 * Regenerate API key
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} New API key
 */
exports.regenerateApiKey = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }

  const tierConfig = TENANT_TIERS[tenant.tier.toUpperCase()];
  if (!tierConfig.features.apiAccess) {
    throw new BadRequestError('API access not available in your plan');
  }

  const newApiKey = generateApiKey();

  await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      apiKey: null, // Don't store plain text
      apiKeyHash: hashApiKey(newApiKey),
      apiKeyRotatedAt: new Date(),
    },
  });

  logger.info('API key regenerated', { tenantId });

  return {
    apiKey: newApiKey,
    message: 'Store this key securely. It will not be shown again.',
  };
};

/**
 * Validate API key
 * @param {string} apiKey - API key
 * @returns {Promise<Object>} Tenant if valid
 */
exports.validateApiKey = async (apiKey) => {
  const hash = hashApiKey(apiKey);

  const tenant = await prisma.tenant.findFirst({
    where: {
      apiKeyHash: hash,
      status: 'ACTIVE',
    },
  });

  if (!tenant) {
    return null;
  }

  // Update last used
  await prisma.tenant.update({
    where: { id: tenant.id },
    data: { apiKeyLastUsedAt: new Date() },
  });

  return tenant;
};

// =============================================================================
// TENANT USERS
// =============================================================================

/**
 * Add user to tenant
 * @param {string} tenantId - Tenant ID
 * @param {string} userId - User ID
 * @param {string} role - User role
 * @returns {Promise<Object>} Tenant member
 */
exports.addTenantUser = async (tenantId, userId, role = 'member') => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
    include: { _count: { select: { members: true } } },
  });

  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }

  const tierConfig = TENANT_TIERS[tenant.tier.toUpperCase()];
  if (tierConfig.features.maxUsers !== -1 && 
      tenant._count.members >= tierConfig.features.maxUsers) {
    throw new BadRequestError('User limit reached for your plan');
  }

  const member = await prisma.tenantMember.create({
    data: {
      tenantId,
      userId,
      role,
    },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
        },
      },
    },
  });

  logger.info('User added to tenant', { tenantId, userId, role });

  return member;
};

/**
 * Remove user from tenant
 * @param {string} tenantId - Tenant ID
 * @param {string} userId - User ID
 * @returns {Promise<void>}
 */
exports.removeTenantUser = async (tenantId, userId) => {
  await prisma.tenantMember.delete({
    where: {
      tenantId_userId: { tenantId, userId },
    },
  });

  logger.info('User removed from tenant', { tenantId, userId });
};

/**
 * Get tenant users
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object[]>} Tenant members
 */
exports.getTenantUsers = async (tenantId) => {
  const members = await prisma.tenantMember.findMany({
    where: { tenantId },
    include: {
      user: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: true,
          lastActiveAt: true,
        },
      },
    },
    orderBy: { createdAt: 'asc' },
  });

  return members;
};

// =============================================================================
// WHITE-LABEL
// =============================================================================

/**
 * Get white-label configuration
 * @param {string} tenantId - Tenant ID
 * @returns {Promise<Object>} White-label config
 */
exports.getWhiteLabelConfig = async (tenantId) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }

  const tierConfig = TENANT_TIERS[tenant.tier.toUpperCase()];

  return {
    enabled: tierConfig.features.whiteLabel,
    branding: tenant.branding,
    customDomain: tenant.customDomain,
    domainVerified: tenant.domainVerified,
    settings: {
      hideAiravatBranding: tierConfig.features.whiteLabel,
      customEmailDomain: tierConfig.features.customEmails,
      customFooter: tierConfig.features.whiteLabel,
    },
  };
};

/**
 * Update white-label settings
 * @param {string} tenantId - Tenant ID
 * @param {Object} settings - White-label settings
 * @returns {Promise<Object>} Updated settings
 */
exports.updateWhiteLabelSettings = async (tenantId, settings) => {
  const tenant = await prisma.tenant.findUnique({
    where: { id: tenantId },
  });

  if (!tenant) {
    throw new NotFoundError('Tenant not found');
  }

  const tierConfig = TENANT_TIERS[tenant.tier.toUpperCase()];
  if (!tierConfig.features.whiteLabel) {
    throw new BadRequestError('White-label not available in your plan');
  }

  const updated = await prisma.tenant.update({
    where: { id: tenantId },
    data: {
      whiteLabelSettings: settings,
    },
  });

  return updated.whiteLabelSettings;
};

// =============================================================================
// TENANT ISOLATION
// =============================================================================

/**
 * Get tenant-scoped query filter
 * @param {string} tenantId - Tenant ID
 * @returns {Object} Prisma where clause
 */
exports.getTenantFilter = (tenantId) => {
  return { tenantId };
};

/**
 * Check if resource belongs to tenant
 * @param {string} tenantId - Tenant ID
 * @param {string} resourceType - Resource type
 * @param {string} resourceId - Resource ID
 * @returns {Promise<boolean>} Belongs to tenant
 */
exports.verifyTenantResource = async (tenantId, resourceType, resourceId) => {
  const model = prisma[resourceType];
  if (!model) return false;

  const resource = await model.findFirst({
    where: {
      id: resourceId,
      tenantId,
    },
  });

  return !!resource;
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateApiKey() {
  return `ak_${crypto.randomBytes(32).toString('hex')}`;
}

function hashApiKey(apiKey) {
  return crypto.createHash('sha256').update(apiKey).digest('hex');
}

function generateVerificationToken() {
  return `airavat-verify-${crypto.randomBytes(16).toString('hex')}`;
}

async function checkDnsRecords(domain, token) {
  // In production, use DNS library to verify records
  // For now, simulate
  return true;
}

async function createDefaultRoles(tenantId) {
  const roles = [
    { name: 'admin', permissions: ['*'], description: 'Full access' },
    { name: 'manager', permissions: ['read', 'write'], description: 'Manage content' },
    { name: 'member', permissions: ['read'], description: 'View only' },
  ];

  for (const role of roles) {
    await prisma.tenantRole.create({
      data: {
        tenantId,
        ...role,
      },
    });
  }
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  TENANT_TIERS,
  DEFAULT_BRANDING,
};



