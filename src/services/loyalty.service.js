// =============================================================================
// AIRAVAT B2B MARKETPLACE - LOYALTY PROGRAM SERVICE
// Points, tiers, rewards, and gamification for B2B buyers
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
} = require('../utils/errors');
const { formatCurrency } = require('../utils/helpers');
const { emitToBusiness } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const LOYALTY_TIERS = {
  BRONZE: { name: 'Bronze', minPoints: 0, multiplier: 1.0, color: '#CD7F32' },
  SILVER: { name: 'Silver', minPoints: 5000, multiplier: 1.25, color: '#C0C0C0' },
  GOLD: { name: 'Gold', minPoints: 20000, multiplier: 1.5, color: '#FFD700' },
  PLATINUM: { name: 'Platinum', minPoints: 50000, multiplier: 2.0, color: '#E5E4E2' },
  DIAMOND: { name: 'Diamond', minPoints: 100000, multiplier: 2.5, color: '#B9F2FF' },
};

const EVENT_TYPE = {
  EARN_PURCHASE: 'EARN_PURCHASE',
  EARN_BONUS: 'EARN_BONUS',
  EARN_REFERRAL: 'EARN_REFERRAL',
  EARN_REVIEW: 'EARN_REVIEW',
  EARN_BIRTHDAY: 'EARN_BIRTHDAY',
  EARN_ANNIVERSARY: 'EARN_ANNIVERSARY',
  REDEEM: 'REDEEM',
  EXPIRE: 'EXPIRE',
  ADJUST: 'ADJUST',
  TIER_UPGRADE: 'TIER_UPGRADE',
  TIER_DOWNGRADE: 'TIER_DOWNGRADE',
};

const POINTS_CONFIG = {
  PER_RUPEE: 1, // 1 point per ₹1 spent
  POINT_VALUE: 0.25, // ₹0.25 per point
  MIN_REDEMPTION: 500, // Minimum 500 points to redeem
  MAX_REDEMPTION_PERCENT: 20, // Max 20% of order value
  EXPIRY_MONTHS: 12, // Points expire after 12 months
  REVIEW_POINTS: 50,
  REFERRAL_POINTS: 500,
};

const CACHE_TTL = { LOYALTY: 300 };

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const getLoyaltyCacheKey = (userId) => `loyalty:${userId}`;

const invalidateLoyaltyCache = async (userId) => {
  await cache.del(getLoyaltyCacheKey(userId));
};

const calculateTier = (lifetimePoints) => {
  if (lifetimePoints >= LOYALTY_TIERS.DIAMOND.minPoints) return 'DIAMOND';
  if (lifetimePoints >= LOYALTY_TIERS.PLATINUM.minPoints) return 'PLATINUM';
  if (lifetimePoints >= LOYALTY_TIERS.GOLD.minPoints) return 'GOLD';
  if (lifetimePoints >= LOYALTY_TIERS.SILVER.minPoints) return 'SILVER';
  return 'BRONZE';
};

const getNextTier = (currentTier) => {
  const tiers = ['BRONZE', 'SILVER', 'GOLD', 'PLATINUM', 'DIAMOND'];
  const currentIndex = tiers.indexOf(currentTier);
  return currentIndex < tiers.length - 1 ? tiers[currentIndex + 1] : null;
};

// =============================================================================
// LOYALTY MANAGEMENT
// =============================================================================

/**
 * Get or create user loyalty account
 */
const getOrCreateLoyalty = async (userId, businessId) => {
  const cacheKey = getLoyaltyCacheKey(userId);
  let loyalty = await cache.get(cacheKey);

  if (loyalty) return loyalty;

  // Find default loyalty program
  let program = await prisma.loyaltyProgram.findFirst({
    where: { isActive: true },
  });

  if (!program) {
    // Create default program
    program = await prisma.loyaltyProgram.create({
      data: {
        name: 'Airavat Rewards',
        description: 'Earn points on every purchase',
        isActive: true,
        pointsPerSpend: POINTS_CONFIG.PER_RUPEE,
        pointValue: POINTS_CONFIG.POINT_VALUE,
        minRedemption: POINTS_CONFIG.MIN_REDEMPTION,
        maxRedemptionPercent: POINTS_CONFIG.MAX_REDEMPTION_PERCENT,
        tiers: LOYALTY_TIERS,
      },
    });
  }

  loyalty = await prisma.userLoyalty.findFirst({
    where: { userId, programId: program.id },
    include: { program: true },
  });

  if (!loyalty) {
    loyalty = await prisma.userLoyalty.create({
      data: {
        userId,
        businessId,
        programId: program.id,
        points: 0,
        lifetimePoints: 0,
        tier: 'BRONZE',
      },
      include: { program: true },
    });

    logger.info('Loyalty account created', { userId, businessId });
  }

  await cache.set(cacheKey, loyalty, CACHE_TTL.LOYALTY);

  return loyalty;
};

/**
 * Get loyalty dashboard
 */
const getLoyaltyDashboard = async (userId, businessId) => {
  const loyalty = await getOrCreateLoyalty(userId, businessId);

  const tierInfo = LOYALTY_TIERS[loyalty.tier];
  const nextTier = getNextTier(loyalty.tier);
  const nextTierInfo = nextTier ? LOYALTY_TIERS[nextTier] : null;
  const pointsToNextTier = nextTierInfo ? nextTierInfo.minPoints - loyalty.lifetimePoints : 0;

  // Get recent events
  const recentEvents = await prisma.loyaltyEvent.findMany({
    where: { userLoyaltyId: loyalty.id },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  // Get points expiring soon
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);

  const expiringPoints = await prisma.loyaltyEvent.aggregate({
    where: {
      userLoyaltyId: loyalty.id,
      type: { startsWith: 'EARN' },
      expiresAt: { lte: thirtyDaysFromNow, gt: new Date() },
    },
    _sum: { points: true },
  });

  return {
    points: loyalty.points,
    lifetimePoints: loyalty.lifetimePoints,
    pointsValue: formatCurrency(loyalty.points * POINTS_CONFIG.POINT_VALUE),
    tier: loyalty.tier,
    tierInfo: {
      ...tierInfo,
      multiplier: `${tierInfo.multiplier}x`,
    },
    nextTier: nextTierInfo ? {
      name: nextTierInfo.name,
      pointsRequired: nextTierInfo.minPoints,
      pointsToGo: pointsToNextTier,
      progress: ((loyalty.lifetimePoints / nextTierInfo.minPoints) * 100).toFixed(1),
    } : null,
    recentEvents,
    expiringPoints: expiringPoints._sum.points || 0,
    minRedemption: POINTS_CONFIG.MIN_REDEMPTION,
  };
};

/**
 * Earn points from purchase
 */
const earnPointsFromPurchase = async (userId, businessId, orderId, orderAmount) => {
  const loyalty = await getOrCreateLoyalty(userId, businessId);
  const tierMultiplier = LOYALTY_TIERS[loyalty.tier].multiplier;

  const basePoints = Math.floor(parseFloat(orderAmount) * POINTS_CONFIG.PER_RUPEE);
  const bonusPoints = Math.floor(basePoints * (tierMultiplier - 1));
  const totalPoints = basePoints + bonusPoints;

  // Calculate expiry
  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + POINTS_CONFIG.EXPIRY_MONTHS);

  // Create event
  await prisma.loyaltyEvent.create({
    data: {
      userLoyaltyId: loyalty.id,
      type: EVENT_TYPE.EARN_PURCHASE,
      points: totalPoints,
      description: `Earned from order - Base: ${basePoints}, Bonus: ${bonusPoints} (${tierMultiplier}x)`,
      referenceType: 'order',
      referenceId: orderId,
      expiresAt,
    },
  });

  // Update loyalty
  const newLifetimePoints = loyalty.lifetimePoints + totalPoints;
  const newTier = calculateTier(newLifetimePoints);
  const tierChanged = newTier !== loyalty.tier;

  const updated = await prisma.userLoyalty.update({
    where: { id: loyalty.id },
    data: {
      points: { increment: totalPoints },
      lifetimePoints: { increment: totalPoints },
      tier: newTier,
      lastActivityAt: new Date(),
    },
  });

  await invalidateLoyaltyCache(userId);

  // Handle tier upgrade
  if (tierChanged) {
    await prisma.loyaltyEvent.create({
      data: {
        userLoyaltyId: loyalty.id,
        type: EVENT_TYPE.TIER_UPGRADE,
        points: 0,
        description: `Upgraded from ${loyalty.tier} to ${newTier}`,
      },
    });

    emitToBusiness(businessId, 'loyalty:tier_upgrade', {
      newTier,
      tierInfo: LOYALTY_TIERS[newTier],
    });
  }

  // Notify
  emitToBusiness(businessId, 'loyalty:points_earned', {
    points: totalPoints,
    newBalance: updated.points,
    tier: newTier,
  });

  logger.info('Points earned from purchase', {
    userId,
    orderId,
    points: totalPoints,
    tierChanged,
  });

  return { pointsEarned: totalPoints, newBalance: updated.points, tierUpgrade: tierChanged ? newTier : null };
};

/**
 * Earn bonus points
 */
const earnBonusPoints = async (userId, businessId, points, reason, type = EVENT_TYPE.EARN_BONUS) => {
  const loyalty = await getOrCreateLoyalty(userId, businessId);

  const expiresAt = new Date();
  expiresAt.setMonth(expiresAt.getMonth() + POINTS_CONFIG.EXPIRY_MONTHS);

  await prisma.loyaltyEvent.create({
    data: {
      userLoyaltyId: loyalty.id,
      type,
      points,
      description: reason,
      expiresAt,
    },
  });

  const updated = await prisma.userLoyalty.update({
    where: { id: loyalty.id },
    data: {
      points: { increment: points },
      lifetimePoints: { increment: points },
      lastActivityAt: new Date(),
    },
  });

  await invalidateLoyaltyCache(userId);

  emitToBusiness(businessId, 'loyalty:points_earned', {
    points,
    reason,
    newBalance: updated.points,
  });

  logger.info('Bonus points earned', { userId, points, reason });

  return { pointsEarned: points, newBalance: updated.points };
};

/**
 * Redeem points
 */
const redeemPoints = async (userId, businessId, points, orderId = null) => {
  const loyalty = await getOrCreateLoyalty(userId, businessId);

  if (points < POINTS_CONFIG.MIN_REDEMPTION) {
    throw new BadRequestError(`Minimum redemption is ${POINTS_CONFIG.MIN_REDEMPTION} points`);
  }

  if (points > loyalty.points) {
    throw new BadRequestError(`Insufficient points. Available: ${loyalty.points}`);
  }

  const redeemValue = points * POINTS_CONFIG.POINT_VALUE;

  await prisma.loyaltyEvent.create({
    data: {
      userLoyaltyId: loyalty.id,
      type: EVENT_TYPE.REDEEM,
      points: -points,
      description: `Redeemed for ${formatCurrency(redeemValue)}`,
      referenceType: orderId ? 'order' : null,
      referenceId: orderId,
    },
  });

  const updated = await prisma.userLoyalty.update({
    where: { id: loyalty.id },
    data: {
      points: { decrement: points },
      lastActivityAt: new Date(),
    },
  });

  await invalidateLoyaltyCache(userId);

  logger.info('Points redeemed', { userId, points, value: redeemValue, orderId });

  return {
    pointsRedeemed: points,
    discountValue: redeemValue,
    formattedDiscount: formatCurrency(redeemValue),
    remainingPoints: updated.points,
  };
};

/**
 * Calculate redemption for order
 */
const calculateRedemption = async (userId, businessId, orderAmount) => {
  const loyalty = await getOrCreateLoyalty(userId, businessId);

  const maxRedeemablePercent = POINTS_CONFIG.MAX_REDEMPTION_PERCENT / 100;
  const maxOrderDiscount = parseFloat(orderAmount) * maxRedeemablePercent;
  const maxPointsValue = loyalty.points * POINTS_CONFIG.POINT_VALUE;

  const maxDiscount = Math.min(maxOrderDiscount, maxPointsValue);
  const pointsRequired = Math.ceil(maxDiscount / POINTS_CONFIG.POINT_VALUE);

  return {
    availablePoints: loyalty.points,
    maxDiscount,
    formattedMaxDiscount: formatCurrency(maxDiscount),
    pointsRequired,
    canRedeem: loyalty.points >= POINTS_CONFIG.MIN_REDEMPTION,
    minRedemption: POINTS_CONFIG.MIN_REDEMPTION,
    pointValue: POINTS_CONFIG.POINT_VALUE,
  };
};

/**
 * Get points history
 */
const getPointsHistory = async (userId, options = {}) => {
  const { page = 1, limit = 20, type } = options;
  const skip = (page - 1) * limit;

  const loyalty = await prisma.userLoyalty.findFirst({
    where: { userId },
  });

  if (!loyalty) {
    return { events: [], pagination: { page, limit, total: 0, totalPages: 0 } };
  }

  const where = { userLoyaltyId: loyalty.id };
  if (type) where.type = type;

  const [events, total] = await Promise.all([
    prisma.loyaltyEvent.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.loyaltyEvent.count({ where }),
  ]);

  return {
    events,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Expire old points (scheduled job)
 */
const expireOldPoints = async () => {
  const now = new Date();

  // Find expired events
  const expiredEvents = await prisma.loyaltyEvent.findMany({
    where: {
      type: { startsWith: 'EARN' },
      expiresAt: { lte: now },
      points: { gt: 0 },
    },
    include: {
      userLoyalty: true,
    },
  });

  let totalExpired = 0;

  for (const event of expiredEvents) {
    // Mark as expired
    await prisma.loyaltyEvent.update({
      where: { id: event.id },
      data: { points: 0 },
    });

    // Deduct from user loyalty
    await prisma.userLoyalty.update({
      where: { id: event.userLoyaltyId },
      data: { points: { decrement: event.points } },
    });

    // Create expiry event
    await prisma.loyaltyEvent.create({
      data: {
        userLoyaltyId: event.userLoyaltyId,
        type: EVENT_TYPE.EXPIRE,
        points: -event.points,
        description: `${event.points} points expired`,
      },
    });

    await invalidateLoyaltyCache(event.userLoyalty.userId);
    totalExpired += event.points;
  }

  logger.info('Points expiry processed', { eventsProcessed: expiredEvents.length, totalPointsExpired: totalExpired });

  return { expired: totalExpired };
};

/**
 * Get tier benefits
 */
const getTierBenefits = () => {
  return Object.entries(LOYALTY_TIERS).map(([key, value]) => ({
    tier: key,
    ...value,
    benefits: getBenefitsForTier(key),
  }));
};

const getBenefitsForTier = (tier) => {
  const benefits = {
    BRONZE: [
      'Earn 1 point per ₹1 spent',
      'Access to member-only deals',
    ],
    SILVER: [
      'Earn 1.25x points',
      'Free shipping on orders over ₹5,000',
      'Early access to sales',
    ],
    GOLD: [
      'Earn 1.5x points',
      'Free shipping on all orders',
      'Priority customer support',
      'Extended return window (30 days)',
    ],
    PLATINUM: [
      'Earn 2x points',
      'Free express shipping',
      'Dedicated account manager',
      'Exclusive pricing on bulk orders',
    ],
    DIAMOND: [
      'Earn 2.5x points',
      'Free same-day shipping',
      'VIP customer support',
      'Custom pricing negotiations',
      'Early access to new products',
    ],
  };

  return benefits[tier] || [];
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  LOYALTY_TIERS,
  EVENT_TYPE,
  POINTS_CONFIG,
  getOrCreateLoyalty,
  getLoyaltyDashboard,
  earnPointsFromPurchase,
  earnBonusPoints,
  redeemPoints,
  calculateRedemption,
  getPointsHistory,
  expireOldPoints,
  getTierBenefits,
};



