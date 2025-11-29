// =============================================================================
// AIRAVAT B2B MARKETPLACE - ADVERTISING SERVICE
// Handles sponsored listings, PPC campaigns, and promotional placements
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError, BadRequestError, NotFoundError } = require('../utils/errors');
const Decimal = require('decimal.js');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Ad placement types
 */
const AD_PLACEMENTS = {
  SEARCH_TOP: {
    id: 'SEARCH_TOP',
    name: 'Search Results - Top',
    description: 'Top 3 positions in search results',
    baseCpc: 5, // Base cost per click (INR)
    cpmRate: 50, // Cost per 1000 impressions
    maxAds: 3,
    priority: 100,
  },
  SEARCH_SIDEBAR: {
    id: 'SEARCH_SIDEBAR',
    name: 'Search Results - Sidebar',
    description: 'Sidebar positions on search pages',
    baseCpc: 3,
    cpmRate: 30,
    maxAds: 5,
    priority: 80,
  },
  CATEGORY_FEATURED: {
    id: 'CATEGORY_FEATURED',
    name: 'Category Page - Featured',
    description: 'Featured products on category pages',
    baseCpc: 4,
    cpmRate: 40,
    maxAds: 6,
    priority: 90,
  },
  HOMEPAGE_CAROUSEL: {
    id: 'HOMEPAGE_CAROUSEL',
    name: 'Homepage Carousel',
    description: 'Premium homepage banner carousel',
    baseCpc: 10,
    cpmRate: 100,
    maxAds: 5,
    priority: 100,
  },
  HOMEPAGE_PRODUCTS: {
    id: 'HOMEPAGE_PRODUCTS',
    name: 'Homepage - Featured Products',
    description: 'Featured products section on homepage',
    baseCpc: 8,
    cpmRate: 80,
    maxAds: 12,
    priority: 95,
  },
  PRODUCT_PAGE_SIMILAR: {
    id: 'PRODUCT_PAGE_SIMILAR',
    name: 'Product Page - Similar Products',
    description: 'Sponsored similar products section',
    baseCpc: 6,
    cpmRate: 60,
    maxAds: 4,
    priority: 85,
  },
  CHECKOUT_UPSELL: {
    id: 'CHECKOUT_UPSELL',
    name: 'Checkout - Upsell',
    description: 'Product recommendations at checkout',
    baseCpc: 7,
    cpmRate: 70,
    maxAds: 3,
    priority: 90,
  },
  SELLER_BADGE: {
    id: 'SELLER_BADGE',
    name: 'Featured Seller Badge',
    description: 'Featured seller highlighting',
    baseCpc: 2,
    cpmRate: 20,
    maxAds: 10,
    priority: 70,
  },
};

/**
 * Campaign status
 */
const CAMPAIGN_STATUS = {
  DRAFT: 'Draft',
  PENDING_REVIEW: 'Pending Review',
  ACTIVE: 'Active',
  PAUSED: 'Paused',
  COMPLETED: 'Completed',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

/**
 * Bidding strategies
 */
const BIDDING_STRATEGIES = {
  MANUAL_CPC: 'Manual CPC',
  AUTO_CPC: 'Automatic CPC',
  TARGET_ROAS: 'Target ROAS',
  MAXIMIZE_CLICKS: 'Maximize Clicks',
  MAXIMIZE_IMPRESSIONS: 'Maximize Impressions',
};

// =============================================================================
// CAMPAIGN MANAGEMENT
// =============================================================================

/**
 * Create an advertising campaign
 * @param {string} businessId - Advertiser business ID
 * @param {Object} data - Campaign data
 * @returns {Promise<Object>} Created campaign
 */
exports.createCampaign = async (businessId, data) => {
  try {
    const {
      name,
      type = 'SPONSORED_PRODUCT',
      objective = 'CLICKS',
      placements = ['SEARCH_TOP'],
      targetingCriteria = {},
      budget,
      dailyBudget,
      biddingStrategy = 'MANUAL_CPC',
      bidAmount,
      startDate,
      endDate,
      productIds = [],
      categoryIds = [],
      keywords = [],
    } = data;

    // Validate placements
    for (const placement of placements) {
      if (!AD_PLACEMENTS[placement]) {
        throw new BadRequestError(`Invalid placement: ${placement}`);
      }
    }

    // Validate budget
    if (budget < 500) {
      throw new BadRequestError('Minimum campaign budget is ₹500');
    }

    if (dailyBudget && dailyBudget < 50) {
      throw new BadRequestError('Minimum daily budget is ₹50');
    }

    // Validate dates
    const start = new Date(startDate);
    const end = endDate ? new Date(endDate) : null;

    if (start < new Date()) {
      throw new BadRequestError('Start date must be in the future');
    }

    if (end && end <= start) {
      throw new BadRequestError('End date must be after start date');
    }

    // Get minimum bid for selected placements
    const minBid = Math.max(...placements.map((p) => AD_PLACEMENTS[p].baseCpc));
    if (bidAmount && bidAmount < minBid) {
      throw new BadRequestError(`Minimum bid for selected placements is ₹${minBid}`);
    }

    // Generate campaign ID
    const campaignNumber = generateCampaignNumber();

    const campaign = await prisma.adCampaign.create({
      data: {
        campaignNumber,
        businessId,
        name,
        type,
        objective,
        placements,
        targetingCriteria,
        budget,
        dailyBudget: dailyBudget || budget,
        spentAmount: 0,
        biddingStrategy,
        bidAmount: bidAmount || minBid,
        startDate: start,
        endDate: end,
        status: 'DRAFT',
        // Create ad groups for products
        adGroups: productIds.length > 0 ? {
          create: {
            name: 'Default Ad Group',
            productIds,
            categoryIds,
            keywords,
            status: 'ACTIVE',
            bidModifier: 1.0,
          },
        } : undefined,
      },
      include: {
        adGroups: true,
        business: {
          select: { businessName: true },
        },
      },
    });

    logger.info('Ad campaign created', { campaignNumber, businessId });

    return campaign;
  } catch (error) {
    logger.error('Create campaign error', { error: error.message, businessId });
    throw error;
  }
};

/**
 * Update campaign
 * @param {string} campaignId - Campaign ID
 * @param {string} businessId - Business ID
 * @param {Object} updates - Updates
 * @returns {Promise<Object>} Updated campaign
 */
exports.updateCampaign = async (campaignId, businessId, updates) => {
  const campaign = await prisma.adCampaign.findFirst({
    where: { id: campaignId, businessId },
  });

  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }

  if (campaign.status === 'COMPLETED' || campaign.status === 'CANCELLED') {
    throw new BadRequestError('Cannot update completed or cancelled campaigns');
  }

  const allowedUpdates = ['name', 'budget', 'dailyBudget', 'bidAmount', 'endDate', 'targetingCriteria'];
  const updateData = {};

  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      updateData[key] = updates[key];
    }
  }

  const updated = await prisma.adCampaign.update({
    where: { id: campaignId },
    data: updateData,
  });

  logger.info('Campaign updated', { campaignId, updates: Object.keys(updateData) });

  return updated;
};

/**
 * Submit campaign for review
 * @param {string} campaignId - Campaign ID
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Updated campaign
 */
exports.submitForReview = async (campaignId, businessId) => {
  const campaign = await prisma.adCampaign.findFirst({
    where: { id: campaignId, businessId },
    include: { adGroups: true },
  });

  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }

  if (campaign.status !== 'DRAFT') {
    throw new BadRequestError('Only draft campaigns can be submitted');
  }

  if (!campaign.adGroups || campaign.adGroups.length === 0) {
    throw new BadRequestError('Campaign must have at least one ad group');
  }

  const updated = await prisma.adCampaign.update({
    where: { id: campaignId },
    data: {
      status: 'PENDING_REVIEW',
      submittedAt: new Date(),
    },
  });

  logger.info('Campaign submitted for review', { campaignId });

  return updated;
};

/**
 * Approve/reject campaign (Admin)
 * @param {string} campaignId - Campaign ID
 * @param {string} adminId - Admin user ID
 * @param {Object} decision - Approval decision
 * @returns {Promise<Object>} Updated campaign
 */
exports.reviewCampaign = async (campaignId, adminId, decision) => {
  const { approved, rejectionReason } = decision;

  const campaign = await prisma.adCampaign.findUnique({
    where: { id: campaignId },
  });

  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }

  if (campaign.status !== 'PENDING_REVIEW') {
    throw new BadRequestError('Campaign is not pending review');
  }

  const updated = await prisma.adCampaign.update({
    where: { id: campaignId },
    data: {
      status: approved ? 'ACTIVE' : 'REJECTED',
      reviewedBy: adminId,
      reviewedAt: new Date(),
      rejectionReason: approved ? null : rejectionReason,
    },
  });

  logger.info('Campaign reviewed', { campaignId, approved, adminId });

  return updated;
};

/**
 * Pause/resume campaign
 * @param {string} campaignId - Campaign ID
 * @param {string} businessId - Business ID
 * @param {boolean} pause - Pause or resume
 * @returns {Promise<Object>} Updated campaign
 */
exports.toggleCampaignStatus = async (campaignId, businessId, pause) => {
  const campaign = await prisma.adCampaign.findFirst({
    where: { id: campaignId, businessId },
  });

  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }

  if (!['ACTIVE', 'PAUSED'].includes(campaign.status)) {
    throw new BadRequestError('Can only pause/resume active campaigns');
  }

  const updated = await prisma.adCampaign.update({
    where: { id: campaignId },
    data: {
      status: pause ? 'PAUSED' : 'ACTIVE',
      pausedAt: pause ? new Date() : null,
    },
  });

  logger.info(`Campaign ${pause ? 'paused' : 'resumed'}`, { campaignId });

  return updated;
};

/**
 * Get campaigns for a business
 * @param {string} businessId - Business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Campaigns
 */
exports.getCampaigns = async (businessId, options = {}) => {
  const { page = 1, limit = 20, status = null } = options;
  const skip = (page - 1) * limit;

  const where = { businessId };
  if (status) where.status = status;

  const [campaigns, total, summary] = await Promise.all([
    prisma.adCampaign.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { adGroups: true } },
      },
    }),
    prisma.adCampaign.count({ where }),
    prisma.adCampaign.aggregate({
      where: { businessId, status: 'ACTIVE' },
      _sum: { budget: true, spentAmount: true },
      _count: true,
    }),
  ]);

  return {
    campaigns,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    summary: {
      activeCampaigns: summary._count || 0,
      totalBudget: summary._sum.budget || 0,
      totalSpent: summary._sum.spentAmount || 0,
    },
  };
};

// =============================================================================
// AD SERVING
// =============================================================================

/**
 * Get ads for a placement
 * @param {string} placement - Placement type
 * @param {Object} context - Request context (category, search query, etc.)
 * @returns {Promise<Object[]>} Ads to display
 */
exports.getAdsForPlacement = async (placement, context = {}) => {
  try {
    const placementConfig = AD_PLACEMENTS[placement];
    if (!placementConfig) {
      return [];
    }

    const { categoryId, searchQuery, productId, userId } = context;

    // Find active campaigns with this placement
    const now = new Date();
    const campaigns = await prisma.adCampaign.findMany({
      where: {
        status: 'ACTIVE',
        placements: { has: placement },
        startDate: { lte: now },
        OR: [
          { endDate: null },
          { endDate: { gte: now } },
        ],
        // Has remaining budget
        spentAmount: { lt: prisma.raw('budget') },
      },
      include: {
        adGroups: {
          where: { status: 'ACTIVE' },
          include: {
            products: {
              where: { status: 'ACTIVE' },
              include: {
                variants: { where: { isDefault: true } },
                business: { select: { businessName: true, verificationStatus: true } },
              },
            },
          },
        },
        business: {
          select: { businessName: true },
        },
      },
    });

    // Score and rank ads
    const scoredAds = [];

    for (const campaign of campaigns) {
      for (const adGroup of campaign.adGroups) {
        // Apply targeting filters
        if (categoryId && adGroup.categoryIds?.length > 0) {
          if (!adGroup.categoryIds.includes(categoryId)) continue;
        }

        if (searchQuery && adGroup.keywords?.length > 0) {
          const queryLower = searchQuery.toLowerCase();
          const hasMatch = adGroup.keywords.some((kw) => 
            queryLower.includes(kw.toLowerCase())
          );
          if (!hasMatch) continue;
        }

        for (const product of adGroup.products || []) {
          // Calculate ad score (bid * quality score * relevance)
          const qualityScore = calculateQualityScore(product);
          const relevanceScore = calculateRelevanceScore(product, context);
          const bidModifier = adGroup.bidModifier || 1.0;
          const effectiveBid = campaign.bidAmount * bidModifier;
          
          const adScore = effectiveBid * qualityScore * relevanceScore;

          scoredAds.push({
            campaignId: campaign.id,
            adGroupId: adGroup.id,
            productId: product.id,
            product,
            businessId: campaign.businessId,
            businessName: campaign.business.businessName,
            effectiveBid,
            adScore,
            qualityScore,
            relevanceScore,
            placement,
          });
        }
      }
    }

    // Sort by ad score and take top N
    scoredAds.sort((a, b) => b.adScore - a.adScore);
    const selectedAds = scoredAds.slice(0, placementConfig.maxAds);

    // Record impressions
    for (const ad of selectedAds) {
      await recordImpression(ad, userId);
    }

    // Format for response
    return selectedAds.map((ad) => ({
      id: ad.productId,
      type: 'sponsored',
      product: ad.product,
      businessName: ad.businessName,
      position: selectedAds.indexOf(ad) + 1,
    }));
  } catch (error) {
    logger.error('Get ads error', { error: error.message, placement });
    return [];
  }
};

/**
 * Record ad click
 * @param {string} productId - Product ID
 * @param {string} placement - Placement type
 * @param {Object} context - Click context
 * @returns {Promise<void>}
 */
exports.recordClick = async (productId, placement, context = {}) => {
  try {
    const { userId, sessionId, source } = context;

    // Find the campaign/ad group for this product
    const adGroup = await prisma.adGroup.findFirst({
      where: {
        productIds: { has: productId },
        status: 'ACTIVE',
        campaign: {
          status: 'ACTIVE',
          placements: { has: placement },
        },
      },
      include: {
        campaign: true,
      },
    });

    if (!adGroup) return;

    const campaign = adGroup.campaign;
    const placementConfig = AD_PLACEMENTS[placement];
    const cpc = campaign.bidAmount * (adGroup.bidModifier || 1.0);

    // Create click record
    await prisma.adClick.create({
      data: {
        campaignId: campaign.id,
        adGroupId: adGroup.id,
        productId,
        placement,
        cpc,
        userId,
        sessionId,
        source,
        metadata: context,
      },
    });

    // Update campaign spend
    await prisma.adCampaign.update({
      where: { id: campaign.id },
      data: {
        spentAmount: { increment: cpc },
        clicks: { increment: 1 },
      },
    });

    // Check budget exhaustion
    const updatedCampaign = await prisma.adCampaign.findUnique({
      where: { id: campaign.id },
    });

    if (updatedCampaign.spentAmount >= updatedCampaign.budget) {
      await prisma.adCampaign.update({
        where: { id: campaign.id },
        data: { status: 'COMPLETED' },
      });
      logger.info('Campaign budget exhausted', { campaignId: campaign.id });
    }

    logger.debug('Click recorded', { campaignId: campaign.id, productId, cpc });
  } catch (error) {
    logger.error('Record click error', { error: error.message, productId });
  }
};

/**
 * Record conversion (purchase from ad)
 * @param {string} orderId - Order ID
 * @returns {Promise<void>}
 */
exports.recordConversion = async (orderId) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: true,
      },
    });

    if (!order) return;

    // Find clicks within attribution window (30 days)
    const attributionWindow = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    for (const item of order.items) {
      const click = await prisma.adClick.findFirst({
        where: {
          productId: item.productId,
          userId: order.buyerId,
          createdAt: { gte: attributionWindow },
          converted: false,
        },
        orderBy: { createdAt: 'desc' },
      });

      if (click) {
        await prisma.adClick.update({
          where: { id: click.id },
          data: {
            converted: true,
            conversionValue: parseFloat(item.totalPrice),
            orderId,
            convertedAt: new Date(),
          },
        });

        // Update campaign conversions
        await prisma.adCampaign.update({
          where: { id: click.campaignId },
          data: {
            conversions: { increment: 1 },
            conversionValue: { increment: parseFloat(item.totalPrice) },
          },
        });

        logger.debug('Conversion recorded', { 
          campaignId: click.campaignId, 
          orderId, 
          value: item.totalPrice,
        });
      }
    }
  } catch (error) {
    logger.error('Record conversion error', { error: error.message, orderId });
  }
};

// =============================================================================
// CAMPAIGN ANALYTICS
// =============================================================================

/**
 * Get campaign performance
 * @param {string} campaignId - Campaign ID
 * @param {string} businessId - Business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Performance data
 */
exports.getCampaignPerformance = async (campaignId, businessId, options = {}) => {
  const { startDate, endDate } = options;

  const campaign = await prisma.adCampaign.findFirst({
    where: { id: campaignId, businessId },
  });

  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }

  const dateFilter = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);

  const [impressions, clicks, conversions, dailyStats] = await Promise.all([
    // Impressions
    prisma.adImpression.count({
      where: {
        campaignId,
        ...(Object.keys(dateFilter).length && { createdAt: dateFilter }),
      },
    }),

    // Clicks
    prisma.adClick.aggregate({
      where: {
        campaignId,
        ...(Object.keys(dateFilter).length && { createdAt: dateFilter }),
      },
      _count: true,
      _sum: { cpc: true },
    }),

    // Conversions
    prisma.adClick.aggregate({
      where: {
        campaignId,
        converted: true,
        ...(Object.keys(dateFilter).length && { convertedAt: dateFilter }),
      },
      _count: true,
      _sum: { conversionValue: true },
    }),

    // Daily breakdown
    prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as impressions,
        SUM(CASE WHEN clicked THEN 1 ELSE 0 END) as clicks,
        SUM(cpc) as spend
      FROM ad_impressions
      WHERE campaign_id = ${campaignId}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `,
  ]);

  const totalClicks = clicks._count || 0;
  const totalSpend = clicks._sum.cpc || 0;
  const totalConversions = conversions._count || 0;
  const totalConversionValue = conversions._sum.conversionValue || 0;

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      status: campaign.status,
      budget: campaign.budget,
      spentAmount: campaign.spentAmount,
      remainingBudget: campaign.budget - campaign.spentAmount,
    },
    metrics: {
      impressions,
      clicks: totalClicks,
      ctr: impressions > 0 ? ((totalClicks / impressions) * 100).toFixed(2) : 0,
      avgCpc: totalClicks > 0 ? (totalSpend / totalClicks).toFixed(2) : 0,
      spend: totalSpend.toFixed(2),
      conversions: totalConversions,
      conversionRate: totalClicks > 0 ? ((totalConversions / totalClicks) * 100).toFixed(2) : 0,
      conversionValue: totalConversionValue.toFixed(2),
      roas: totalSpend > 0 ? (totalConversionValue / totalSpend).toFixed(2) : 0,
    },
    dailyStats,
  };
};

/**
 * Get platform advertising revenue
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Revenue data
 */
exports.getAdRevenue = async (options = {}) => {
  const { startDate, endDate } = options;

  const dateFilter = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);

  const [totalRevenue, byPlacement, topAdvertisers, dailyRevenue] = await Promise.all([
    // Total revenue
    prisma.adClick.aggregate({
      where: Object.keys(dateFilter).length ? { createdAt: dateFilter } : undefined,
      _sum: { cpc: true },
      _count: true,
    }),

    // By placement
    prisma.adClick.groupBy({
      by: ['placement'],
      where: Object.keys(dateFilter).length ? { createdAt: dateFilter } : undefined,
      _sum: { cpc: true },
      _count: true,
    }),

    // Top advertisers
    prisma.adCampaign.groupBy({
      by: ['businessId'],
      _sum: { spentAmount: true },
      orderBy: { _sum: { spentAmount: 'desc' } },
      take: 10,
    }),

    // Daily revenue
    prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        SUM(cpc) as revenue,
        COUNT(*) as clicks
      FROM ad_clicks
      WHERE created_at >= ${new Date(startDate || Date.now() - 30 * 24 * 60 * 60 * 1000)}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `,
  ]);

  return {
    summary: {
      totalRevenue: totalRevenue._sum.cpc || 0,
      totalClicks: totalRevenue._count || 0,
      avgCpc: totalRevenue._count > 0 
        ? ((totalRevenue._sum.cpc || 0) / totalRevenue._count).toFixed(2) 
        : 0,
    },
    byPlacement: byPlacement.map((p) => ({
      placement: p.placement,
      placementName: AD_PLACEMENTS[p.placement]?.name || p.placement,
      revenue: p._sum.cpc || 0,
      clicks: p._count || 0,
    })),
    topAdvertisers,
    dailyRevenue,
  };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateCampaignNumber() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `AD${year}${month}-${random}`;
}

function calculateQualityScore(product) {
  let score = 0.5; // Base score

  // Product completeness
  if (product.description?.length > 100) score += 0.1;
  if (product.images?.length >= 3) score += 0.1;
  if (product.specifications) score += 0.1;

  // Business verification
  if (product.business?.verificationStatus === 'VERIFIED') score += 0.1;

  // Historical performance (could be based on CTR, conversion rate)
  score += 0.1; // Placeholder

  return Math.min(1, score);
}

function calculateRelevanceScore(product, context) {
  let score = 0.5; // Base score

  const { searchQuery, categoryId } = context;

  if (searchQuery) {
    const query = searchQuery.toLowerCase();
    if (product.name.toLowerCase().includes(query)) score += 0.3;
    if (product.description?.toLowerCase().includes(query)) score += 0.1;
  }

  if (categoryId && product.categoryId === categoryId) {
    score += 0.2;
  }

  return Math.min(1, score);
}

async function recordImpression(ad, userId) {
  try {
    await prisma.adImpression.create({
      data: {
        campaignId: ad.campaignId,
        adGroupId: ad.adGroupId,
        productId: ad.productId,
        placement: ad.placement,
        userId,
        position: ad.position || 1,
      },
    });

    // Update campaign impressions
    await prisma.adCampaign.update({
      where: { id: ad.campaignId },
      data: { impressions: { increment: 1 } },
    });
  } catch (error) {
    logger.error('Record impression error', { error: error.message });
  }
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  AD_PLACEMENTS,
  CAMPAIGN_STATUS,
  BIDDING_STRATEGIES,
};



