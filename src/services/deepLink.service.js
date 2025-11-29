// =============================================================================
// AIRAVAT B2B MARKETPLACE - DEEP LINKING SERVICE
// Service for generating and resolving deep links for app navigation
// =============================================================================

const crypto = require('crypto');
const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  appScheme: process.env.APP_SCHEME || 'airavat',
  webDomain: process.env.APP_DOMAIN || 'airavat.com',
  linkPrefix: process.env.DEEP_LINK_PREFIX || 'https://link.airavat.com',
  shortCodeLength: 8,
  defaultExpiry: 30 * 24 * 60 * 60 * 1000, // 30 days
};

/**
 * Supported deep link types
 */
const LINK_TYPES = {
  PRODUCT: 'product',
  CATEGORY: 'category',
  BUSINESS: 'business',
  ORDER: 'order',
  RFQ: 'rfq',
  AUCTION: 'auction',
  PROMOTION: 'promotion',
  REFERRAL: 'referral',
  PROFILE: 'profile',
  CHAT: 'chat',
  SEARCH: 'search',
  COLLECTION: 'collection',
};

// =============================================================================
// GENERATE DEEP LINKS
// =============================================================================

/**
 * Generate a deep link for any entity
 * @param {string} type - Entity type (product, category, etc.)
 * @param {Object} params - Link parameters
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Generated deep link data
 */
exports.generateDeepLink = async (type, params, options = {}) => {
  try {
    if (!LINK_TYPES[type.toUpperCase()]) {
      throw new AppError(`Invalid link type: ${type}`, 400);
    }

    const {
      expiresIn = CONFIG.defaultExpiry,
      campaign = null,
      source = null,
      userId = null,
    } = options;

    // Generate unique short code
    const shortCode = generateShortCode();

    // Build app-specific URL
    const appLink = buildAppLink(type, params);

    // Build web fallback URL
    const webLink = buildWebLink(type, params);

    // Store the deep link
    const deepLink = await prisma.deepLink.create({
      data: {
        shortCode,
        type: type.toUpperCase(),
        targetId: params.id || null,
        params: params,
        appLink,
        webLink,
        campaign,
        source,
        createdBy: userId,
        expiresAt: new Date(Date.now() + expiresIn),
      },
    });

    logger.info('Deep link generated', { shortCode, type, targetId: params.id });

    return {
      shortCode,
      shortLink: `${CONFIG.linkPrefix}/${shortCode}`,
      appLink,
      webLink,
      universalLink: `https://${CONFIG.webDomain}/l/${shortCode}`,
      expiresAt: deepLink.expiresAt,
    };
  } catch (error) {
    logger.error('Generate deep link error', { error: error.message, type, params });
    throw error;
  }
};

/**
 * Generate product deep link
 * @param {string} productId - Product ID
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Deep link data
 */
exports.generateProductLink = async (productId, options = {}) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, slug: true, name: true },
  });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  return exports.generateDeepLink('PRODUCT', {
    id: product.id,
    slug: product.slug,
    name: product.name,
    ...options.params,
  }, options);
};

/**
 * Generate referral deep link
 * @param {string} userId - Referrer user ID
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Referral deep link
 */
exports.generateReferralLink = async (userId, options = {}) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, referralCode: true },
  });

  if (!user) {
    throw new AppError('User not found', 404);
  }

  let referralCode = user.referralCode;

  // Generate referral code if not exists
  if (!referralCode) {
    referralCode = generateReferralCode();
    await prisma.user.update({
      where: { id: userId },
      data: { referralCode },
    });
  }

  return exports.generateDeepLink('REFERRAL', {
    code: referralCode,
    referrerId: userId,
  }, {
    ...options,
    source: 'referral',
    userId,
  });
};

/**
 * Generate promotional deep link
 * @param {string} promotionId - Promotion ID
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Promotional deep link
 */
exports.generatePromotionalLink = async (promotionId, options = {}) => {
  return exports.generateDeepLink('PROMOTION', {
    id: promotionId,
    ...options.params,
  }, {
    ...options,
    source: 'promotion',
  });
};

// =============================================================================
// RESOLVE DEEP LINKS
// =============================================================================

/**
 * Resolve a short code to its target
 * @param {string} shortCode - Short code to resolve
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Resolved link data
 */
exports.resolveDeepLink = async (shortCode, context = {}) => {
  try {
    const deepLink = await prisma.deepLink.findUnique({
      where: { shortCode },
    });

    if (!deepLink) {
      throw new AppError('Deep link not found', 404);
    }

    if (deepLink.expiresAt && deepLink.expiresAt < new Date()) {
      throw new AppError('Deep link has expired', 410);
    }

    // Increment click count
    await prisma.deepLink.update({
      where: { id: deepLink.id },
      data: { clicks: { increment: 1 } },
    });

    // Log the click
    await logLinkClick(deepLink.id, context);

    // Get target entity details
    const targetDetails = await getTargetDetails(deepLink.type, deepLink.params);

    return {
      type: deepLink.type,
      appLink: deepLink.appLink,
      webLink: deepLink.webLink,
      params: deepLink.params,
      target: targetDetails,
      campaign: deepLink.campaign,
    };
  } catch (error) {
    logger.error('Resolve deep link error', { error: error.message, shortCode });
    throw error;
  }
};

/**
 * Get redirect URL based on user agent
 * @param {string} shortCode - Short code
 * @param {string} userAgent - User agent string
 * @returns {Promise<string>} Redirect URL
 */
exports.getRedirectUrl = async (shortCode, userAgent) => {
  try {
    const resolved = await exports.resolveDeepLink(shortCode, { userAgent });

    // Detect platform
    const isIOS = /iPhone|iPad|iPod/i.test(userAgent);
    const isAndroid = /Android/i.test(userAgent);

    if (isIOS || isAndroid) {
      // Return app link with web fallback
      return resolved.appLink;
    }

    // Desktop - return web link
    return resolved.webLink;
  } catch (error) {
    // Return homepage on error
    return `https://${CONFIG.webDomain}`;
  }
};

// =============================================================================
// LINK ANALYTICS
// =============================================================================

/**
 * Get deep link analytics
 * @param {string} shortCode - Short code
 * @param {string} userId - Owner user ID
 * @returns {Promise<Object>} Analytics data
 */
exports.getLinkAnalytics = async (shortCode, userId) => {
  const deepLink = await prisma.deepLink.findUnique({
    where: { shortCode },
    include: {
      _count: { select: { clicks: true } },
    },
  });

  if (!deepLink) {
    throw new AppError('Deep link not found', 404);
  }

  if (deepLink.createdBy !== userId) {
    throw new AppError('Not authorized to view this link', 403);
  }

  // Get click statistics
  const clickStats = await prisma.deepLinkClick.groupBy({
    by: ['platform', 'country'],
    where: { deepLinkId: deepLink.id },
    _count: true,
  });

  // Get daily clicks
  const dailyClicks = await prisma.$queryRaw`
    SELECT DATE(created_at) as date, COUNT(*) as clicks
    FROM deep_link_clicks
    WHERE deep_link_id = ${deepLink.id}
    GROUP BY DATE(created_at)
    ORDER BY date DESC
    LIMIT 30
  `;

  return {
    shortCode,
    type: deepLink.type,
    totalClicks: deepLink.clicks,
    createdAt: deepLink.createdAt,
    expiresAt: deepLink.expiresAt,
    byPlatform: clickStats.filter((s) => s.platform).reduce((acc, s) => {
      acc[s.platform] = s._count;
      return acc;
    }, {}),
    byCountry: clickStats.filter((s) => s.country).reduce((acc, s) => {
      acc[s.country] = s._count;
      return acc;
    }, {}),
    dailyClicks,
  };
};

/**
 * Get all deep links for a user
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} User's deep links
 */
exports.getUserDeepLinks = async (userId, options = {}) => {
  const { page = 1, limit = 20, type = null } = options;
  const skip = (page - 1) * limit;

  const where = { createdBy: userId };
  if (type) where.type = type.toUpperCase();

  const [links, total] = await Promise.all([
    prisma.deepLink.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.deepLink.count({ where }),
  ]);

  return {
    links: links.map((link) => ({
      shortCode: link.shortCode,
      shortLink: `${CONFIG.linkPrefix}/${link.shortCode}`,
      type: link.type,
      clicks: link.clicks,
      createdAt: link.createdAt,
      expiresAt: link.expiresAt,
      campaign: link.campaign,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// =============================================================================
// LINK MANAGEMENT
// =============================================================================

/**
 * Delete a deep link
 * @param {string} shortCode - Short code
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Deletion result
 */
exports.deleteDeepLink = async (shortCode, userId) => {
  const deepLink = await prisma.deepLink.findUnique({
    where: { shortCode },
  });

  if (!deepLink) {
    throw new AppError('Deep link not found', 404);
  }

  if (deepLink.createdBy !== userId) {
    throw new AppError('Not authorized to delete this link', 403);
  }

  await prisma.deepLink.delete({
    where: { id: deepLink.id },
  });

  logger.info('Deep link deleted', { shortCode, userId });

  return { success: true };
};

/**
 * Update deep link expiry
 * @param {string} shortCode - Short code
 * @param {string} userId - User ID
 * @param {Date} newExpiry - New expiry date
 * @returns {Promise<Object>} Updated link
 */
exports.updateExpiry = async (shortCode, userId, newExpiry) => {
  const deepLink = await prisma.deepLink.findUnique({
    where: { shortCode },
  });

  if (!deepLink) {
    throw new AppError('Deep link not found', 404);
  }

  if (deepLink.createdBy !== userId) {
    throw new AppError('Not authorized to update this link', 403);
  }

  const updated = await prisma.deepLink.update({
    where: { id: deepLink.id },
    data: { expiresAt: new Date(newExpiry) },
  });

  return {
    shortCode,
    expiresAt: updated.expiresAt,
  };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate unique short code
 */
function generateShortCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  let code = '';
  const randomBytes = crypto.randomBytes(CONFIG.shortCodeLength);
  for (let i = 0; i < CONFIG.shortCodeLength; i++) {
    code += chars[randomBytes[i] % chars.length];
  }
  return code;
}

/**
 * Generate referral code
 */
function generateReferralCode() {
  return crypto.randomBytes(4).toString('hex').toUpperCase();
}

/**
 * Build app-specific deep link
 */
function buildAppLink(type, params) {
  const typeLower = type.toLowerCase();
  
  switch (typeLower) {
    case 'product':
      return `${CONFIG.appScheme}://product/${params.id || params.slug}`;
    case 'category':
      return `${CONFIG.appScheme}://category/${params.id || params.slug}`;
    case 'business':
      return `${CONFIG.appScheme}://business/${params.id || params.slug}`;
    case 'order':
      return `${CONFIG.appScheme}://order/${params.id}`;
    case 'rfq':
      return `${CONFIG.appScheme}://rfq/${params.id}`;
    case 'auction':
      return `${CONFIG.appScheme}://auction/${params.id}`;
    case 'referral':
      return `${CONFIG.appScheme}://referral?code=${params.code}`;
    case 'promotion':
      return `${CONFIG.appScheme}://promotion/${params.id}`;
    case 'search':
      return `${CONFIG.appScheme}://search?q=${encodeURIComponent(params.query || '')}`;
    default:
      return `${CONFIG.appScheme}://${typeLower}/${params.id || ''}`;
  }
}

/**
 * Build web fallback URL
 */
function buildWebLink(type, params) {
  const baseUrl = `https://${CONFIG.webDomain}`;
  const typeLower = type.toLowerCase();

  switch (typeLower) {
    case 'product':
      return `${baseUrl}/p/${params.slug || params.id}`;
    case 'category':
      return `${baseUrl}/c/${params.slug || params.id}`;
    case 'business':
      return `${baseUrl}/b/${params.slug || params.id}`;
    case 'order':
      return `${baseUrl}/orders/${params.id}`;
    case 'rfq':
      return `${baseUrl}/rfq/${params.id}`;
    case 'auction':
      return `${baseUrl}/auctions/${params.id}`;
    case 'referral':
      return `${baseUrl}/signup?ref=${params.code}`;
    case 'promotion':
      return `${baseUrl}/promo/${params.id}`;
    case 'search':
      return `${baseUrl}/search?q=${encodeURIComponent(params.query || '')}`;
    default:
      return `${baseUrl}/${typeLower}/${params.id || ''}`;
  }
}

/**
 * Get target entity details
 */
async function getTargetDetails(type, params) {
  try {
    switch (type.toUpperCase()) {
      case 'PRODUCT':
        return prisma.product.findUnique({
          where: { id: params.id },
          select: { id: true, name: true, slug: true, images: true },
        });
      case 'CATEGORY':
        return prisma.category.findUnique({
          where: { id: params.id },
          select: { id: true, name: true, slug: true, image: true },
        });
      case 'BUSINESS':
        return prisma.business.findUnique({
          where: { id: params.id },
          select: { id: true, businessName: true, slug: true, logo: true },
        });
      default:
        return params;
    }
  } catch (error) {
    return params;
  }
}

/**
 * Log link click
 */
async function logLinkClick(deepLinkId, context) {
  try {
    await prisma.deepLinkClick.create({
      data: {
        deepLinkId,
        ipAddress: context.ip || null,
        userAgent: context.userAgent || null,
        platform: detectPlatform(context.userAgent),
        country: context.country || null,
        referrer: context.referrer || null,
      },
    });
  } catch (error) {
    logger.warn('Failed to log link click', { error: error.message });
  }
}

/**
 * Detect platform from user agent
 */
function detectPlatform(userAgent) {
  if (!userAgent) return 'unknown';
  if (/iPhone|iPad|iPod/i.test(userAgent)) return 'ios';
  if (/Android/i.test(userAgent)) return 'android';
  if (/Windows/i.test(userAgent)) return 'windows';
  if (/Mac/i.test(userAgent)) return 'macos';
  if (/Linux/i.test(userAgent)) return 'linux';
  return 'other';
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  LINK_TYPES,
  CONFIG,
};



