// =============================================================================
// AIRAVAT B2B MARKETPLACE - REFERRAL SERVICE
// Business referral program with rewards and tracking
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
  ConflictError,
} = require('../utils/errors');
const { generateId, formatCurrency } = require('../utils/helpers');
const { emitToBusiness } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const REFERRAL_STATUS = {
  PENDING: 'PENDING',
  SIGNED_UP: 'SIGNED_UP',
  QUALIFIED: 'QUALIFIED',
  REWARDED: 'REWARDED',
  EXPIRED: 'EXPIRED',
  INVALID: 'INVALID',
};

const REFERRAL_REWARD = {
  REFERRER: 5000, // ₹5000 for referrer
  REFERRED: 2500, // ₹2500 for new user
  QUALIFYING_ORDER_AMOUNT: 10000, // Minimum order to qualify
};

const REFERRAL_EXPIRY_DAYS = 30;
const CACHE_TTL = { REFERRAL: 300 };

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const generateReferralCode = () => {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 8; i++) {
    code += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return code;
};

const getReferralCacheKey = (code) => `referral:${code}`;

// =============================================================================
// REFERRAL MANAGEMENT
// =============================================================================

/**
 * Get or create referral code for user
 */
const getMyReferralCode = async (userId, businessId) => {
  // Check if user already has a referral entry as referrer
  let existingCode = await prisma.referral.findFirst({
    where: { referrerId: userId },
    select: { referralCode: true },
  });

  if (existingCode) {
    return existingCode.referralCode;
  }

  // Generate new unique code
  let code;
  let isUnique = false;
  while (!isUnique) {
    code = generateReferralCode();
    const existing = await prisma.referral.findUnique({
      where: { referralCode: code },
    });
    if (!existing) isUnique = true;
  }

  // Store the code (will be used when someone signs up)
  await cache.set(`referral:user:${userId}`, { code, businessId }, 365 * 24 * 60 * 60);

  logger.info('Referral code generated', { userId, code });

  return code;
};

/**
 * Create referral invite
 */
const createReferral = async (referrerId, referrerBusinessId, referredEmail) => {
  // Check if email already referred
  const existing = await prisma.referral.findFirst({
    where: {
      referredEmail,
      status: { notIn: [REFERRAL_STATUS.EXPIRED, REFERRAL_STATUS.INVALID] },
    },
  });

  if (existing) {
    throw new ConflictError('Email already referred');
  }

  // Check if email already registered
  const existingUser = await prisma.user.findFirst({
    where: { email: referredEmail },
  });

  if (existingUser) {
    throw new BadRequestError('User already exists on platform');
  }

  // Generate unique referral code
  let referralCode;
  let isUnique = false;
  while (!isUnique) {
    referralCode = generateReferralCode();
    const existing = await prisma.referral.findUnique({
      where: { referralCode },
    });
    if (!existing) isUnique = true;
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + REFERRAL_EXPIRY_DAYS);

  const referral = await prisma.referral.create({
    data: {
      referrerId,
      referrerBusinessId,
      referredEmail,
      referralCode,
      status: REFERRAL_STATUS.PENDING,
      referrerReward: REFERRAL_REWARD.REFERRER,
      referredReward: REFERRAL_REWARD.REFERRED,
      expiresAt,
    },
    include: {
      referrer: { select: { id: true, firstName: true, lastName: true } },
      referrerBusiness: { select: { id: true, businessName: true } },
    },
  });

  // Send referral email (would integrate with email service)
  // await emailService.sendReferralInvite(referredEmail, { code: referralCode, referrerName });

  logger.info('Referral created', { referralId: referral.id, referrerId, referredEmail });

  return {
    ...referral,
    shareLink: `${process.env.FRONTEND_URL}/register?ref=${referralCode}`,
  };
};

/**
 * Validate referral code
 */
const validateReferralCode = async (code) => {
  const referral = await prisma.referral.findUnique({
    where: { referralCode: code },
    include: {
      referrerBusiness: { select: { id: true, businessName: true } },
    },
  });

  if (!referral) {
    throw new NotFoundError('Referral code');
  }

  if (referral.status !== REFERRAL_STATUS.PENDING) {
    throw new BadRequestError('Referral code already used or expired');
  }

  if (referral.expiresAt && new Date() > referral.expiresAt) {
    await prisma.referral.update({
      where: { id: referral.id },
      data: { status: REFERRAL_STATUS.EXPIRED },
    });
    throw new BadRequestError('Referral code expired');
  }

  return {
    valid: true,
    referrerBusiness: referral.referrerBusiness.businessName,
    reward: formatCurrency(REFERRAL_REWARD.REFERRED),
  };
};

/**
 * Process referral on signup
 */
const processReferralSignup = async (referralCode, newUserId, newBusinessId) => {
  const referral = await prisma.referral.findUnique({
    where: { referralCode },
  });

  if (!referral || referral.status !== REFERRAL_STATUS.PENDING) {
    return null;
  }

  const updated = await prisma.referral.update({
    where: { id: referral.id },
    data: {
      status: REFERRAL_STATUS.SIGNED_UP,
      referredUserId: newUserId,
      referredBusinessId: newBusinessId,
      signedUpAt: new Date(),
    },
  });

  // Notify referrer
  emitToBusiness(referral.referrerBusinessId, 'referral:signup', {
    referralId: referral.id,
    message: 'Your referral has signed up!',
  });

  logger.info('Referral signup processed', {
    referralId: referral.id,
    newUserId,
    newBusinessId,
  });

  return updated;
};

/**
 * Check and process referral qualification
 */
const processReferralQualification = async (businessId, orderId, orderAmount) => {
  // Find referral for this business
  const referral = await prisma.referral.findFirst({
    where: {
      referredBusinessId: businessId,
      status: REFERRAL_STATUS.SIGNED_UP,
    },
  });

  if (!referral) {
    return null;
  }

  if (parseFloat(orderAmount) < REFERRAL_REWARD.QUALIFYING_ORDER_AMOUNT) {
    return null;
  }

  const updated = await prisma.referral.update({
    where: { id: referral.id },
    data: {
      status: REFERRAL_STATUS.QUALIFIED,
      qualifiedAt: new Date(),
      qualifyingOrderId: orderId,
      qualifyingOrderValue: orderAmount,
    },
  });

  // Notify referrer
  emitToBusiness(referral.referrerBusinessId, 'referral:qualified', {
    referralId: referral.id,
    message: 'Your referral has qualified! Reward pending.',
  });

  logger.info('Referral qualified', { referralId: referral.id, orderId, orderAmount });

  return updated;
};

/**
 * Process referral rewards
 */
const processRewards = async () => {
  const qualifiedReferrals = await prisma.referral.findMany({
    where: { status: REFERRAL_STATUS.QUALIFIED },
    include: {
      referrerBusiness: { select: { id: true } },
      referredBusiness: { select: { id: true } },
    },
  });

  let processed = 0;

  for (const referral of qualifiedReferrals) {
    try {
      // Credit referrer wallet
      await prisma.walletTransaction.create({
        data: {
          wallet: { connect: { businessId: referral.referrerBusinessId } },
          transactionId: `REF-${referral.id}-REFERRER`,
          type: 'CREDIT',
          amount: referral.referrerReward,
          description: 'Referral reward',
          category: 'CASHBACK',
          status: 'COMPLETED',
          referenceType: 'referral',
          referenceId: referral.id,
        },
      }).catch(() => {/* Wallet may not exist */});

      // Credit referred wallet
      await prisma.walletTransaction.create({
        data: {
          wallet: { connect: { businessId: referral.referredBusinessId } },
          transactionId: `REF-${referral.id}-REFERRED`,
          type: 'CREDIT',
          amount: referral.referredReward,
          description: 'Welcome referral bonus',
          category: 'CASHBACK',
          status: 'COMPLETED',
          referenceType: 'referral',
          referenceId: referral.id,
        },
      }).catch(() => {/* Wallet may not exist */});

      await prisma.referral.update({
        where: { id: referral.id },
        data: {
          status: REFERRAL_STATUS.REWARDED,
          rewardedAt: new Date(),
        },
      });

      // Notify both parties
      emitToBusiness(referral.referrerBusinessId, 'referral:rewarded', {
        amount: referral.referrerReward,
        message: `You received ${formatCurrency(referral.referrerReward)} referral reward!`,
      });

      emitToBusiness(referral.referredBusinessId, 'referral:rewarded', {
        amount: referral.referredReward,
        message: `You received ${formatCurrency(referral.referredReward)} welcome bonus!`,
      });

      processed++;
    } catch (err) {
      logger.error('Failed to process referral reward', { referralId: referral.id, error: err.message });
    }
  }

  logger.info('Referral rewards processed', { processed });

  return { processed };
};

/**
 * Get user's referrals
 */
const getMyReferrals = async (userId, options = {}) => {
  const { page = 1, limit = 20, status } = options;
  const skip = (page - 1) * limit;

  const where = { referrerId: userId };
  if (status) where.status = status;

  const [referrals, total] = await Promise.all([
    prisma.referral.findMany({
      where,
      include: {
        referredBusiness: { select: { id: true, businessName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.referral.count({ where }),
  ]);

  return {
    referrals: referrals.map((r) => ({
      ...r,
      formattedReward: formatCurrency(r.referrerReward),
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Get referral statistics
 */
const getReferralStats = async (userId) => {
  const [pending, signedUp, qualified, rewarded, totalEarned] = await Promise.all([
    prisma.referral.count({ where: { referrerId: userId, status: REFERRAL_STATUS.PENDING } }),
    prisma.referral.count({ where: { referrerId: userId, status: REFERRAL_STATUS.SIGNED_UP } }),
    prisma.referral.count({ where: { referrerId: userId, status: REFERRAL_STATUS.QUALIFIED } }),
    prisma.referral.count({ where: { referrerId: userId, status: REFERRAL_STATUS.REWARDED } }),
    prisma.referral.aggregate({
      where: { referrerId: userId, status: REFERRAL_STATUS.REWARDED },
      _sum: { referrerReward: true },
    }),
  ]);

  return {
    pending,
    signedUp,
    qualified,
    rewarded,
    total: pending + signedUp + qualified + rewarded,
    totalEarned: totalEarned._sum.referrerReward || 0,
    formattedEarnings: formatCurrency(totalEarned._sum.referrerReward || 0),
    conversionRate: pending + signedUp + qualified + rewarded > 0
      ? ((rewarded / (pending + signedUp + qualified + rewarded)) * 100).toFixed(1)
      : 0,
  };
};

/**
 * Expire old referrals (scheduled job)
 */
const expireOldReferrals = async () => {
  const now = new Date();

  const result = await prisma.referral.updateMany({
    where: {
      status: REFERRAL_STATUS.PENDING,
      expiresAt: { lt: now },
    },
    data: { status: REFERRAL_STATUS.EXPIRED },
  });

  logger.info('Expired referrals processed', { count: result.count });

  return { expired: result.count };
};

/**
 * Get referral leaderboard
 */
const getReferralLeaderboard = async (limit = 10) => {
  const leaderboard = await prisma.referral.groupBy({
    by: ['referrerId'],
    where: { status: REFERRAL_STATUS.REWARDED },
    _count: { id: true },
    _sum: { referrerReward: true },
    orderBy: { _count: { id: 'desc' } },
    take: limit,
  });

  const userIds = leaderboard.map((l) => l.referrerId);
  const users = await prisma.user.findMany({
    where: { id: { in: userIds } },
    select: { id: true, firstName: true, lastName: true },
  });

  const userMap = new Map(users.map((u) => [u.id, u]));

  return leaderboard.map((l, index) => ({
    rank: index + 1,
    user: userMap.get(l.referrerId),
    referralCount: l._count.id,
    totalEarned: l._sum.referrerReward || 0,
    formattedEarnings: formatCurrency(l._sum.referrerReward || 0),
  }));
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  REFERRAL_STATUS,
  REFERRAL_REWARD,
  getMyReferralCode,
  createReferral,
  validateReferralCode,
  processReferralSignup,
  processReferralQualification,
  processRewards,
  getMyReferrals,
  getReferralStats,
  expireOldReferrals,
  getReferralLeaderboard,
};



