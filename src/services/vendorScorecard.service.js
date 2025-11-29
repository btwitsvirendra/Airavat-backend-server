// =============================================================================
// AIRAVAT B2B MARKETPLACE - VENDOR SCORECARD SERVICE
// Comprehensive vendor performance tracking and scoring
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
} = require('../utils/errors');

// =============================================================================
// CONSTANTS
// =============================================================================

const SCORE_WEIGHTS = {
  quality: 0.25,
  delivery: 0.25,
  communication: 0.15,
  pricing: 0.20,
  compliance: 0.15,
};

const SCORE_THRESHOLDS = {
  EXCELLENT: 90,
  GOOD: 75,
  AVERAGE: 60,
  POOR: 40,
};

const BADGES = {
  TOP_RATED: { name: 'Top Rated', icon: '⭐', minScore: 90 },
  FAST_SHIPPER: { name: 'Fast Shipper', icon: '🚀', minDeliveryScore: 90 },
  TRUSTED_PARTNER: { name: 'Trusted Partner', icon: '🤝', minOrders: 100 },
  QUALITY_ASSURED: { name: 'Quality Assured', icon: '✓', minQualityScore: 95 },
  RESPONSIVE: { name: 'Responsive', icon: '💬', minCommunicationScore: 90 },
};

const CACHE_TTL = { SCORECARD: 600, LEADERBOARD: 300 };

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const getScorecardCacheKey = (vendorId) => `scorecard:${vendorId}`;

const invalidateScorecardCache = async (vendorId) => {
  await cache.del(getScorecardCacheKey(vendorId));
};

const calculateOverallScore = (scores) => {
  let total = 0;
  let weightSum = 0;

  for (const [key, weight] of Object.entries(SCORE_WEIGHTS)) {
    if (scores[key] !== undefined && scores[key] !== null) {
      total += parseFloat(scores[key]) * weight;
      weightSum += weight;
    }
  }

  return weightSum > 0 ? (total / weightSum).toFixed(2) : 0;
};

const getRating = (score) => {
  if (score >= SCORE_THRESHOLDS.EXCELLENT) return 'EXCELLENT';
  if (score >= SCORE_THRESHOLDS.GOOD) return 'GOOD';
  if (score >= SCORE_THRESHOLDS.AVERAGE) return 'AVERAGE';
  if (score >= SCORE_THRESHOLDS.POOR) return 'POOR';
  return 'CRITICAL';
};

const calculateBadges = (scorecard) => {
  const badges = [];

  if (parseFloat(scorecard.overallScore) >= BADGES.TOP_RATED.minScore) {
    badges.push(BADGES.TOP_RATED);
  }
  if (parseFloat(scorecard.deliveryScore) >= BADGES.FAST_SHIPPER.minDeliveryScore) {
    badges.push(BADGES.FAST_SHIPPER);
  }
  if (scorecard.completedOrders >= BADGES.TRUSTED_PARTNER.minOrders) {
    badges.push(BADGES.TRUSTED_PARTNER);
  }
  if (parseFloat(scorecard.qualityScore) >= BADGES.QUALITY_ASSURED.minQualityScore) {
    badges.push(BADGES.QUALITY_ASSURED);
  }
  if (parseFloat(scorecard.communicationScore) >= BADGES.RESPONSIVE.minCommunicationScore) {
    badges.push(BADGES.RESPONSIVE);
  }

  return badges;
};

// =============================================================================
// SCORECARD MANAGEMENT
// =============================================================================

/**
 * Get or create vendor scorecard
 */
const getOrCreateScorecard = async (vendorId) => {
  const cacheKey = getScorecardCacheKey(vendorId);
  let scorecard = await cache.get(cacheKey);

  if (scorecard) return scorecard;

  scorecard = await prisma.vendorScorecard.findUnique({
    where: { vendorId },
    include: {
      vendor: { select: { id: true, businessName: true, logo: true } },
    },
  });

  if (!scorecard) {
    scorecard = await prisma.vendorScorecard.create({
      data: {
        vendorId,
        overallScore: 0,
        qualityScore: 0,
        deliveryScore: 0,
        communicationScore: 0,
        pricingScore: 0,
        complianceScore: 0,
      },
      include: {
        vendor: { select: { id: true, businessName: true, logo: true } },
      },
    });
  }

  await cache.set(cacheKey, scorecard, CACHE_TTL.SCORECARD);

  return scorecard;
};

/**
 * Get vendor scorecard with enriched data
 */
const getScorecard = async (vendorId) => {
  const scorecard = await getOrCreateScorecard(vendorId);

  const badges = calculateBadges(scorecard);
  const rating = getRating(parseFloat(scorecard.overallScore));

  // Get recent history
  const history = await prisma.scorecardHistory.findMany({
    where: { scorecardId: scorecard.id },
    orderBy: { createdAt: 'desc' },
    take: 12,
  });

  // Calculate trends
  const previousPeriod = history[1];
  const trend = previousPeriod
    ? parseFloat(scorecard.overallScore) - parseFloat(previousPeriod.overallScore)
    : 0;

  return {
    ...scorecard,
    rating,
    badges,
    trend: {
      direction: trend > 0 ? 'up' : trend < 0 ? 'down' : 'stable',
      value: Math.abs(trend).toFixed(2),
    },
    history,
    metrics: {
      fulfillmentRate: scorecard.completedOrders > 0
        ? ((scorecard.completedOrders / scorecard.totalOrders) * 100).toFixed(1)
        : 100,
      cancellationRate: scorecard.totalOrders > 0
        ? ((scorecard.cancelledOrders / scorecard.totalOrders) * 100).toFixed(1)
        : 0,
      lateDeliveryRate: scorecard.completedOrders > 0
        ? ((scorecard.lateDeliveries / scorecard.completedOrders) * 100).toFixed(1)
        : 0,
      disputeRate: scorecard.totalOrders > 0
        ? ((scorecard.disputeCount / scorecard.totalOrders) * 100).toFixed(1)
        : 0,
    },
  };
};

/**
 * Update scorecard from order completion
 */
const updateFromOrder = async (vendorId, orderData) => {
  const {
    wasDeliveredLate = false,
    wasDeliveredOnTime = true,
    deliveryTimeHours = null,
    hadQualityIssue = false,
    hadDispute = false,
    wasCancelled = false,
    buyerRating = null,
  } = orderData;

  const scorecard = await getOrCreateScorecard(vendorId);

  const updates = {
    totalOrders: { increment: 1 },
    lastCalculatedAt: new Date(),
  };

  if (wasCancelled) {
    updates.cancelledOrders = { increment: 1 };
  } else {
    updates.completedOrders = { increment: 1 };
  }

  if (wasDeliveredLate) {
    updates.lateDeliveries = { increment: 1 };
  }

  if (hadDispute) {
    updates.disputeCount = { increment: 1 };
  }

  // Update average delivery time
  if (deliveryTimeHours !== null && !wasCancelled) {
    const currentAvg = scorecard.avgDeliveryTime || deliveryTimeHours;
    const newAvg = (currentAvg * scorecard.completedOrders + deliveryTimeHours) / (scorecard.completedOrders + 1);
    updates.avgDeliveryTime = Math.round(newAvg);
  }

  await prisma.vendorScorecard.update({
    where: { vendorId },
    data: updates,
  });

  await invalidateScorecardCache(vendorId);

  logger.info('Scorecard updated from order', { vendorId, orderData });
};

/**
 * Update scorecard from review
 */
const updateFromReview = async (vendorId, reviewData) => {
  const { rating, qualityRating, communicationRating, deliveryRating } = reviewData;

  const scorecard = await getOrCreateScorecard(vendorId);

  // Get all reviews for vendor
  const reviews = await prisma.review.findMany({
    where: {
      product: { sellerId: vendorId },
    },
    select: { rating: true },
  });

  const avgRating = reviews.length > 0
    ? reviews.reduce((sum, r) => sum + r.rating, 0) / reviews.length
    : rating;

  // Convert 5-star rating to 100-point scale
  const qualityScore = (qualityRating || avgRating) * 20;
  const communicationScore = (communicationRating || avgRating) * 20;
  const deliveryScore = (deliveryRating || avgRating) * 20;

  // Blend with existing scores (weighted average)
  const blendFactor = 0.1; // 10% weight for new review
  const newQuality = scorecard.qualityScore * (1 - blendFactor) + qualityScore * blendFactor;
  const newComm = scorecard.communicationScore * (1 - blendFactor) + communicationScore * blendFactor;
  const newDelivery = scorecard.deliveryScore * (1 - blendFactor) + deliveryScore * blendFactor;

  const overallScore = calculateOverallScore({
    quality: newQuality,
    delivery: newDelivery,
    communication: newComm,
    pricing: scorecard.pricingScore,
    compliance: scorecard.complianceScore,
  });

  await prisma.vendorScorecard.update({
    where: { vendorId },
    data: {
      qualityScore: newQuality,
      communicationScore: newComm,
      deliveryScore: newDelivery,
      overallScore,
      lastCalculatedAt: new Date(),
    },
  });

  await invalidateScorecardCache(vendorId);

  logger.info('Scorecard updated from review', { vendorId, newOverallScore: overallScore });
};

/**
 * Recalculate full scorecard
 */
const recalculateScorecard = async (vendorId) => {
  const scorecard = await getOrCreateScorecard(vendorId);

  // Get order stats
  const orderStats = await prisma.order.groupBy({
    by: ['status'],
    where: { sellerId: vendorId },
    _count: true,
  });

  const totalOrders = orderStats.reduce((sum, s) => sum + s._count, 0);
  const completedOrders = orderStats.find((s) => s.status === 'DELIVERED')?._count || 0;
  const cancelledOrders = orderStats.find((s) => s.status === 'CANCELLED')?._count || 0;

  // Get review stats
  const reviewStats = await prisma.review.aggregate({
    where: { product: { sellerId: vendorId } },
    _avg: { rating: true },
    _count: true,
  });

  // Calculate scores
  const qualityScore = (reviewStats._avg.rating || 3) * 20;

  const fulfillmentRate = totalOrders > 0 ? (completedOrders / totalOrders) : 1;
  const deliveryScore = fulfillmentRate * 100;

  // Get response time (from chat/messages if available)
  const avgResponseTime = scorecard.avgResponseTime || 30; // Default 30 mins
  const communicationScore = Math.max(0, 100 - (avgResponseTime / 60) * 10);

  // Pricing score based on repeat buyers
  const repeatBuyers = await prisma.order.groupBy({
    by: ['buyerId'],
    where: { sellerId: vendorId },
    _count: true,
    having: { buyerId: { _count: { gt: 1 } } },
  });
  const repeatBuyerRate = completedOrders > 0 ? (repeatBuyers.length / completedOrders) : 0;
  const pricingScore = Math.min(100, repeatBuyerRate * 200);

  // Compliance score (based on disputes)
  const disputes = await prisma.order.count({
    where: { sellerId: vendorId, status: 'DISPUTED' },
  });
  const disputeRate = totalOrders > 0 ? (disputes / totalOrders) : 0;
  const complianceScore = Math.max(0, 100 - disputeRate * 500);

  const overallScore = calculateOverallScore({
    quality: qualityScore,
    delivery: deliveryScore,
    communication: communicationScore,
    pricing: pricingScore,
    compliance: complianceScore,
  });

  const badges = calculateBadges({
    overallScore,
    qualityScore,
    deliveryScore,
    communicationScore,
    completedOrders,
  });

  await prisma.vendorScorecard.update({
    where: { vendorId },
    data: {
      overallScore,
      qualityScore,
      deliveryScore,
      communicationScore,
      pricingScore,
      complianceScore,
      totalOrders,
      completedOrders,
      cancelledOrders,
      disputeCount: disputes,
      repeatBuyerRate: repeatBuyerRate * 100,
      badges,
      lastCalculatedAt: new Date(),
    },
  });

  await invalidateScorecardCache(vendorId);

  logger.info('Scorecard recalculated', { vendorId, overallScore });

  return getScorecard(vendorId);
};

/**
 * Save scorecard history (scheduled - monthly)
 */
const saveHistoricalSnapshot = async () => {
  const period = new Date().toISOString().slice(0, 7); // YYYY-MM

  const scorecards = await prisma.vendorScorecard.findMany();
  let saved = 0;

  for (const scorecard of scorecards) {
    try {
      await prisma.scorecardHistory.upsert({
        where: {
          scorecardId_period: {
            scorecardId: scorecard.id,
            period,
          },
        },
        create: {
          scorecardId: scorecard.id,
          period,
          overallScore: scorecard.overallScore,
          qualityScore: scorecard.qualityScore,
          deliveryScore: scorecard.deliveryScore,
          communicationScore: scorecard.communicationScore,
          pricingScore: scorecard.pricingScore,
          complianceScore: scorecard.complianceScore,
          orderCount: scorecard.totalOrders,
          metrics: {
            completedOrders: scorecard.completedOrders,
            cancelledOrders: scorecard.cancelledOrders,
            lateDeliveries: scorecard.lateDeliveries,
            disputeCount: scorecard.disputeCount,
          },
        },
        update: {
          overallScore: scorecard.overallScore,
          qualityScore: scorecard.qualityScore,
          deliveryScore: scorecard.deliveryScore,
          communicationScore: scorecard.communicationScore,
          pricingScore: scorecard.pricingScore,
          complianceScore: scorecard.complianceScore,
          orderCount: scorecard.totalOrders,
        },
      });
      saved++;
    } catch (err) {
      logger.error('Failed to save scorecard history', { scorecardId: scorecard.id, error: err.message });
    }
  }

  logger.info('Scorecard history saved', { period, saved });

  return { period, saved };
};

/**
 * Get vendor leaderboard
 */
const getLeaderboard = async (options = {}) => {
  const { category, limit = 20, minOrders = 10 } = options;

  const cacheKey = `leaderboard:${category || 'overall'}`;
  let cached = await cache.get(cacheKey);

  if (cached) return cached;

  const orderBy = category
    ? { [`${category}Score`]: 'desc' }
    : { overallScore: 'desc' };

  const leaderboard = await prisma.vendorScorecard.findMany({
    where: {
      completedOrders: { gte: minOrders },
    },
    include: {
      vendor: { select: { id: true, businessName: true, logo: true } },
    },
    orderBy,
    take: limit,
  });

  const result = leaderboard.map((scorecard, index) => ({
    rank: index + 1,
    vendor: scorecard.vendor,
    overallScore: scorecard.overallScore,
    categoryScore: category ? scorecard[`${category}Score`] : scorecard.overallScore,
    rating: getRating(parseFloat(scorecard.overallScore)),
    badges: calculateBadges(scorecard),
    completedOrders: scorecard.completedOrders,
  }));

  await cache.set(cacheKey, result, CACHE_TTL.LEADERBOARD);

  return result;
};

/**
 * Compare vendors
 */
const compareVendors = async (vendorIds) => {
  if (vendorIds.length < 2 || vendorIds.length > 5) {
    throw new BadRequestError('Compare 2-5 vendors');
  }

  const scorecards = await Promise.all(vendorIds.map((id) => getScorecard(id)));

  return {
    vendors: scorecards,
    comparison: {
      quality: scorecards.map((s) => ({ vendor: s.vendor.businessName, score: s.qualityScore })),
      delivery: scorecards.map((s) => ({ vendor: s.vendor.businessName, score: s.deliveryScore })),
      communication: scorecards.map((s) => ({ vendor: s.vendor.businessName, score: s.communicationScore })),
      pricing: scorecards.map((s) => ({ vendor: s.vendor.businessName, score: s.pricingScore })),
      compliance: scorecards.map((s) => ({ vendor: s.vendor.businessName, score: s.complianceScore })),
    },
  };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  SCORE_WEIGHTS,
  SCORE_THRESHOLDS,
  BADGES,
  getOrCreateScorecard,
  getScorecard,
  updateFromOrder,
  updateFromReview,
  recalculateScorecard,
  saveHistoricalSnapshot,
  getLeaderboard,
  compareVendors,
};



