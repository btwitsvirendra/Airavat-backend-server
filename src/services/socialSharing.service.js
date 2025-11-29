// =============================================================================
// AIRAVAT B2B MARKETPLACE - SOCIAL SHARING SERVICE
// Service for sharing products, businesses, and content to social platforms
// =============================================================================

const crypto = require('crypto');
const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  baseUrl: process.env.APP_URL || 'https://airavat.com',
  shortLinkDomain: process.env.SHORT_LINK_DOMAIN || 'link.airavat.com',
  defaultImage: '/images/og-default.jpg',
};

/**
 * Supported social platforms
 */
const PLATFORMS = {
  FACEBOOK: {
    name: 'Facebook',
    shareUrl: 'https://www.facebook.com/sharer/sharer.php?u=',
    icon: 'facebook',
    color: '#1877F2',
  },
  TWITTER: {
    name: 'Twitter/X',
    shareUrl: 'https://twitter.com/intent/tweet?url=',
    icon: 'twitter',
    color: '#1DA1F2',
  },
  LINKEDIN: {
    name: 'LinkedIn',
    shareUrl: 'https://www.linkedin.com/sharing/share-offsite/?url=',
    icon: 'linkedin',
    color: '#0A66C2',
  },
  WHATSAPP: {
    name: 'WhatsApp',
    shareUrl: 'https://api.whatsapp.com/send?text=',
    icon: 'whatsapp',
    color: '#25D366',
  },
  TELEGRAM: {
    name: 'Telegram',
    shareUrl: 'https://t.me/share/url?url=',
    icon: 'telegram',
    color: '#0088CC',
  },
  EMAIL: {
    name: 'Email',
    shareUrl: 'mailto:?subject=',
    icon: 'mail',
    color: '#EA4335',
  },
  COPY: {
    name: 'Copy Link',
    icon: 'link',
    color: '#607D8B',
  },
};

// =============================================================================
// SHARE LINK GENERATION
// =============================================================================

/**
 * Generate share links for a product
 * @param {string} productId - Product ID
 * @param {Object} options - Share options
 * @returns {Promise<Object>} Share links and metadata
 */
exports.getProductShareLinks = async (productId, options = {}) => {
  try {
    const { userId = null, source = 'direct' } = options;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        business: { select: { id: true, businessName: true } },
        category: { select: { id: true, name: true } },
      },
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    // Generate tracking URL
    const shareUrl = await createTrackingUrl('product', productId, userId, source);

    // Create share content
    const shareContent = {
      title: product.name,
      description: truncateText(product.description, 150),
      image: product.images?.[0] || `${CONFIG.baseUrl}${CONFIG.defaultImage}`,
      url: shareUrl,
      hashtags: ['B2B', 'Airavat', product.category?.name?.replace(/\s+/g, '')].filter(Boolean),
    };

    // Generate platform-specific share URLs
    const links = generatePlatformLinks(shareContent);

    // Log share request
    await logShareRequest('product', productId, userId, source);

    return {
      content: shareContent,
      links,
      ogTags: generateOGTags(shareContent),
    };
  } catch (error) {
    logger.error('Get product share links error', { error: error.message, productId });
    throw error;
  }
};

/**
 * Generate share links for a business
 * @param {string} businessId - Business ID
 * @param {Object} options - Share options
 * @returns {Promise<Object>} Share links and metadata
 */
exports.getBusinessShareLinks = async (businessId, options = {}) => {
  try {
    const { userId = null, source = 'direct' } = options;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: {
        _count: { select: { products: true, reviews: true } },
      },
    });

    if (!business) {
      throw new AppError('Business not found', 404);
    }

    const shareUrl = await createTrackingUrl('business', businessId, userId, source);

    const shareContent = {
      title: business.businessName,
      description: truncateText(business.description, 150) || 
        `Check out ${business.businessName} on Airavat B2B Marketplace`,
      image: business.logo || `${CONFIG.baseUrl}${CONFIG.defaultImage}`,
      url: shareUrl,
      hashtags: ['B2B', 'Airavat', 'Business'],
    };

    const links = generatePlatformLinks(shareContent);

    await logShareRequest('business', businessId, userId, source);

    return {
      content: shareContent,
      links,
      ogTags: generateOGTags(shareContent),
    };
  } catch (error) {
    logger.error('Get business share links error', { error: error.message, businessId });
    throw error;
  }
};

/**
 * Generate share links for an RFQ
 * @param {string} rfqId - RFQ ID
 * @param {Object} options - Share options
 * @returns {Promise<Object>} Share links and metadata
 */
exports.getRFQShareLinks = async (rfqId, options = {}) => {
  try {
    const { userId = null, source = 'direct' } = options;

    const rfq = await prisma.rFQ.findUnique({
      where: { id: rfqId },
      include: {
        category: { select: { name: true } },
      },
    });

    if (!rfq) {
      throw new AppError('RFQ not found', 404);
    }

    const shareUrl = await createTrackingUrl('rfq', rfqId, userId, source);

    const shareContent = {
      title: `RFQ: ${rfq.title}`,
      description: `Looking for ${rfq.quantity} ${rfq.unitType} of ${rfq.title}. Submit your quotation now!`,
      image: `${CONFIG.baseUrl}${CONFIG.defaultImage}`,
      url: shareUrl,
      hashtags: ['B2B', 'RFQ', 'Quotation', rfq.category?.name?.replace(/\s+/g, '')].filter(Boolean),
    };

    const links = generatePlatformLinks(shareContent);

    await logShareRequest('rfq', rfqId, userId, source);

    return {
      content: shareContent,
      links,
      ogTags: generateOGTags(shareContent),
    };
  } catch (error) {
    logger.error('Get RFQ share links error', { error: error.message, rfqId });
    throw error;
  }
};

/**
 * Generate custom share links
 * @param {Object} content - Custom content
 * @param {Object} options - Share options
 * @returns {Promise<Object>} Share links
 */
exports.getCustomShareLinks = async (content, options = {}) => {
  try {
    const {
      title,
      description,
      url,
      image = `${CONFIG.baseUrl}${CONFIG.defaultImage}`,
      hashtags = [],
    } = content;

    if (!title || !url) {
      throw new AppError('Title and URL are required', 400);
    }

    const shareContent = {
      title,
      description: description || '',
      image,
      url,
      hashtags,
    };

    const links = generatePlatformLinks(shareContent);

    return {
      content: shareContent,
      links,
      ogTags: generateOGTags(shareContent),
    };
  } catch (error) {
    logger.error('Get custom share links error', { error: error.message });
    throw error;
  }
};

// =============================================================================
// SHARE TRACKING
// =============================================================================

/**
 * Track a share event
 * @param {string} entityType - Type of entity shared
 * @param {string} entityId - Entity ID
 * @param {string} platform - Social platform
 * @param {Object} context - Additional context
 * @returns {Promise<Object>} Tracking result
 */
exports.trackShare = async (entityType, entityId, platform, context = {}) => {
  try {
    const { userId = null, source = 'unknown', referrer = null } = context;

    await prisma.socialShare.create({
      data: {
        entityType,
        entityId,
        platform,
        userId,
        source,
        referrer,
        sharedAt: new Date(),
      },
    });

    // Update share count on entity
    await updateShareCount(entityType, entityId);

    logger.debug('Share tracked', { entityType, entityId, platform, userId });

    return { success: true };
  } catch (error) {
    logger.warn('Track share error', { error: error.message });
    return { success: false };
  }
};

/**
 * Get share analytics for an entity
 * @param {string} entityType - Entity type
 * @param {string} entityId - Entity ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Share analytics
 */
exports.getShareAnalytics = async (entityType, entityId, options = {}) => {
  const { startDate, endDate } = options;

  const where = { entityType, entityId };

  if (startDate) {
    where.sharedAt = { gte: new Date(startDate) };
  }
  if (endDate) {
    where.sharedAt = { ...where.sharedAt, lte: new Date(endDate) };
  }

  const [total, byPlatform, byDay] = await Promise.all([
    prisma.socialShare.count({ where }),
    prisma.socialShare.groupBy({
      by: ['platform'],
      where,
      _count: true,
    }),
    prisma.$queryRaw`
      SELECT DATE(shared_at) as date, COUNT(*) as count
      FROM social_shares
      WHERE entity_type = ${entityType} AND entity_id = ${entityId}
      GROUP BY DATE(shared_at)
      ORDER BY date DESC
      LIMIT 30
    `,
  ]);

  return {
    entityType,
    entityId,
    totalShares: total,
    byPlatform: byPlatform.reduce((acc, p) => {
      acc[p.platform] = p._count;
      return acc;
    }, {}),
    byDay,
  };
};

// =============================================================================
// REFERRAL TRACKING
// =============================================================================

/**
 * Handle referral from social share
 * @param {string} trackingCode - Tracking code from URL
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Referral handling result
 */
exports.handleReferral = async (trackingCode, context = {}) => {
  try {
    const tracking = await prisma.shareTracking.findUnique({
      where: { code: trackingCode },
    });

    if (!tracking) {
      return { valid: false };
    }

    // Log the referral visit
    await prisma.shareReferral.create({
      data: {
        trackingId: tracking.id,
        visitorIp: context.ip,
        userAgent: context.userAgent,
        referrer: context.referrer,
      },
    });

    // Update click count
    await prisma.shareTracking.update({
      where: { id: tracking.id },
      data: { clicks: { increment: 1 } },
    });

    return {
      valid: true,
      entityType: tracking.entityType,
      entityId: tracking.entityId,
      sharedBy: tracking.userId,
    };
  } catch (error) {
    logger.warn('Handle referral error', { error: error.message, trackingCode });
    return { valid: false };
  }
};

// =============================================================================
// SOCIAL PROOF
// =============================================================================

/**
 * Get social proof for an entity
 * @param {string} entityType - Entity type
 * @param {string} entityId - Entity ID
 * @returns {Promise<Object>} Social proof data
 */
exports.getSocialProof = async (entityType, entityId) => {
  const [shareCount, recentShares] = await Promise.all([
    prisma.socialShare.count({
      where: { entityType, entityId },
    }),
    prisma.socialShare.findMany({
      where: { entityType, entityId },
      orderBy: { sharedAt: 'desc' },
      take: 5,
      include: {
        user: {
          select: { id: true, firstName: true, avatar: true },
        },
      },
    }),
  ]);

  return {
    shareCount,
    recentSharers: recentShares
      .filter((s) => s.user)
      .map((s) => ({
        name: s.user.firstName,
        avatar: s.user.avatar,
        platform: s.platform,
        sharedAt: s.sharedAt,
      })),
    popularPlatforms: await getPopularPlatforms(entityType, entityId),
  };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Create tracking URL for share
 */
async function createTrackingUrl(entityType, entityId, userId, source) {
  const trackingCode = crypto.randomBytes(6).toString('hex');

  await prisma.shareTracking.create({
    data: {
      code: trackingCode,
      entityType,
      entityId,
      userId,
      source,
    },
  });

  // Build base URL based on entity type
  let baseUrl;
  switch (entityType) {
    case 'product':
      const product = await prisma.product.findUnique({
        where: { id: entityId },
        select: { slug: true },
      });
      baseUrl = `${CONFIG.baseUrl}/p/${product?.slug || entityId}`;
      break;
    case 'business':
      const business = await prisma.business.findUnique({
        where: { id: entityId },
        select: { slug: true },
      });
      baseUrl = `${CONFIG.baseUrl}/b/${business?.slug || entityId}`;
      break;
    case 'rfq':
      baseUrl = `${CONFIG.baseUrl}/rfq/${entityId}`;
      break;
    default:
      baseUrl = `${CONFIG.baseUrl}/${entityType}/${entityId}`;
  }

  return `${baseUrl}?ref=${trackingCode}`;
}

/**
 * Generate platform-specific share URLs
 */
function generatePlatformLinks(content) {
  const { title, description, url, hashtags } = content;
  const encodedUrl = encodeURIComponent(url);
  const encodedTitle = encodeURIComponent(title);
  const encodedDesc = encodeURIComponent(description);
  const hashtagString = hashtags.map((h) => `#${h}`).join(' ');

  return {
    facebook: `${PLATFORMS.FACEBOOK.shareUrl}${encodedUrl}`,
    twitter: `${PLATFORMS.TWITTER.shareUrl}${encodedUrl}&text=${encodedTitle}${hashtags.length ? `&hashtags=${hashtags.join(',')}` : ''}`,
    linkedin: `${PLATFORMS.LINKEDIN.shareUrl}${encodedUrl}`,
    whatsapp: `${PLATFORMS.WHATSAPP.shareUrl}${encodedTitle}%20${encodedUrl}`,
    telegram: `${PLATFORMS.TELEGRAM.shareUrl}${encodedUrl}&text=${encodedTitle}`,
    email: `mailto:?subject=${encodedTitle}&body=${encodedDesc}%0A%0A${encodedUrl}`,
    copy: url,
  };
}

/**
 * Generate Open Graph tags
 */
function generateOGTags(content) {
  return {
    'og:title': content.title,
    'og:description': content.description,
    'og:image': content.image,
    'og:url': content.url,
    'og:type': 'website',
    'og:site_name': 'Airavat B2B Marketplace',
    'twitter:card': 'summary_large_image',
    'twitter:title': content.title,
    'twitter:description': content.description,
    'twitter:image': content.image,
  };
}

/**
 * Truncate text to specified length
 */
function truncateText(text, maxLength) {
  if (!text) return '';
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + '...';
}

/**
 * Log share request
 */
async function logShareRequest(entityType, entityId, userId, source) {
  try {
    await prisma.shareRequest.create({
      data: {
        entityType,
        entityId,
        userId,
        source,
        requestedAt: new Date(),
      },
    });
  } catch (error) {
    logger.warn('Log share request error', { error: error.message });
  }
}

/**
 * Update share count on entity
 */
async function updateShareCount(entityType, entityId) {
  try {
    switch (entityType) {
      case 'product':
        await prisma.product.update({
          where: { id: entityId },
          data: { shareCount: { increment: 1 } },
        });
        break;
      case 'business':
        await prisma.business.update({
          where: { id: entityId },
          data: { shareCount: { increment: 1 } },
        });
        break;
    }
  } catch (error) {
    // Non-critical error
  }
}

/**
 * Get popular platforms for an entity
 */
async function getPopularPlatforms(entityType, entityId) {
  const platforms = await prisma.socialShare.groupBy({
    by: ['platform'],
    where: { entityType, entityId },
    _count: true,
    orderBy: { _count: { platform: 'desc' } },
    take: 3,
  });

  return platforms.map((p) => ({
    platform: p.platform,
    count: p._count,
    info: PLATFORMS[p.platform],
  }));
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  PLATFORMS,
};



