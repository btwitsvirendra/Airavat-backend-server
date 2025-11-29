// =============================================================================
// AIRAVAT B2B MARKETPLACE - TRADE ASSURANCE SERVICE
// Buyer protection and escrow-like payment security for B2B transactions
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} = require('../utils/errors');
const { generateId, formatCurrency } = require('../utils/helpers');
const { emitToBusiness } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const ASSURANCE_STATUS = {
  PENDING: 'PENDING',
  ACTIVE: 'ACTIVE',
  CLAIMED: 'CLAIMED',
  RESOLVED: 'RESOLVED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
};

const COVERAGE_TYPE = {
  STANDARD: 'STANDARD',
  EXTENDED: 'EXTENDED',
  PREMIUM: 'PREMIUM',
  CUSTOM: 'CUSTOM',
};

const CLAIM_STATUS = {
  FILED: 'FILED',
  UNDER_REVIEW: 'UNDER_REVIEW',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  PAID: 'PAID',
  DISPUTED: 'DISPUTED',
};

const PREMIUM_RATES = {
  STANDARD: 0.005, // 0.5%
  EXTENDED: 0.01, // 1%
  PREMIUM: 0.02, // 2%
};

const COVERAGE_TERMS = {
  STANDARD: {
    validityDays: 30,
    maxClaimPercent: 80,
    coverageIncludes: ['Non-delivery', 'Damaged goods'],
  },
  EXTENDED: {
    validityDays: 60,
    maxClaimPercent: 90,
    coverageIncludes: ['Non-delivery', 'Damaged goods', 'Quality issues', 'Specification mismatch'],
  },
  PREMIUM: {
    validityDays: 90,
    maxClaimPercent: 100,
    coverageIncludes: ['Non-delivery', 'Damaged goods', 'Quality issues', 'Specification mismatch', 'Late delivery', 'Partial delivery'],
  },
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const generateClaimId = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = generateId().substring(0, 6).toUpperCase();
  return `CLM-${timestamp}-${random}`;
};

// =============================================================================
// TRADE ASSURANCE MANAGEMENT
// =============================================================================

/**
 * Calculate premium for trade assurance
 */
const calculatePremium = async (orderAmount, coverageType = COVERAGE_TYPE.STANDARD) => {
  const rate = PREMIUM_RATES[coverageType] || PREMIUM_RATES.STANDARD;
  const premiumAmount = parseFloat(orderAmount) * rate;
  const coverageAmount = parseFloat(orderAmount) * (COVERAGE_TERMS[coverageType]?.maxClaimPercent / 100 || 0.8);

  return {
    premiumAmount,
    formattedPremium: formatCurrency(premiumAmount),
    premiumRate: rate * 100,
    coverageAmount,
    formattedCoverage: formatCurrency(coverageAmount),
    coverageDetails: COVERAGE_TERMS[coverageType],
  };
};

/**
 * Create trade assurance for order
 */
const createAssurance = async (orderId, buyerId, sellerId, data) => {
  const { orderAmount, coverageType = COVERAGE_TYPE.STANDARD } = data;

  // Check if assurance already exists
  const existing = await prisma.tradeAssurance.findUnique({
    where: { orderId },
  });

  if (existing) {
    throw new BadRequestError('Trade assurance already exists for this order');
  }

  const rate = PREMIUM_RATES[coverageType] || PREMIUM_RATES.STANDARD;
  const premiumAmount = parseFloat(orderAmount) * rate;
  const coverageAmount = parseFloat(orderAmount) * (COVERAGE_TERMS[coverageType].maxClaimPercent / 100);

  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + COVERAGE_TERMS[coverageType].validityDays);

  const assurance = await prisma.tradeAssurance.create({
    data: {
      orderId,
      buyerId,
      sellerId,
      coverageAmount,
      premiumAmount,
      premiumRate: rate,
      status: ASSURANCE_STATUS.PENDING,
      coverageType,
      terms: COVERAGE_TERMS[coverageType],
      validUntil,
    },
    include: {
      order: { select: { id: true, orderNumber: true } },
      buyer: { select: { id: true, businessName: true } },
      seller: { select: { id: true, businessName: true } },
    },
  });

  logger.info('Trade assurance created', {
    assuranceId: assurance.id,
    orderId,
    coverageAmount,
    premiumAmount,
  });

  return assurance;
};

/**
 * Activate assurance (after payment confirmed)
 */
const activateAssurance = async (assuranceId) => {
  const assurance = await prisma.tradeAssurance.findUnique({
    where: { id: assuranceId },
  });

  if (!assurance) {
    throw new NotFoundError('Trade assurance');
  }

  if (assurance.status !== ASSURANCE_STATUS.PENDING) {
    throw new BadRequestError('Assurance cannot be activated');
  }

  const validFrom = new Date();
  const validUntil = new Date();
  validUntil.setDate(validUntil.getDate() + (assurance.terms.validityDays || 30));

  const updated = await prisma.tradeAssurance.update({
    where: { id: assuranceId },
    data: {
      status: ASSURANCE_STATUS.ACTIVE,
      validFrom,
      validUntil,
      activatedAt: validFrom,
    },
  });

  // Notify buyer
  emitToBusiness(assurance.buyerId, 'assurance:activated', {
    assuranceId,
    coverageAmount: formatCurrency(assurance.coverageAmount),
    validUntil,
  });

  logger.info('Trade assurance activated', { assuranceId });

  return updated;
};

/**
 * Get assurance by order
 */
const getAssuranceByOrder = async (orderId, businessId) => {
  const assurance = await prisma.tradeAssurance.findFirst({
    where: {
      orderId,
      OR: [{ buyerId: businessId }, { sellerId: businessId }],
    },
    include: {
      order: { select: { id: true, orderNumber: true, status: true } },
      buyer: { select: { id: true, businessName: true } },
      seller: { select: { id: true, businessName: true } },
    },
  });

  if (!assurance) {
    return null;
  }

  const isBuyer = assurance.buyerId === businessId;
  const now = new Date();
  const isValid = assurance.status === ASSURANCE_STATUS.ACTIVE && now <= new Date(assurance.validUntil);
  const daysRemaining = isValid ? Math.ceil((new Date(assurance.validUntil) - now) / (1000 * 60 * 60 * 24)) : 0;

  return {
    ...assurance,
    isBuyer,
    isValid,
    daysRemaining,
    canFileClaim: isBuyer && isValid && !assurance.claimId,
    formattedCoverage: formatCurrency(assurance.coverageAmount),
    formattedPremium: formatCurrency(assurance.premiumAmount),
  };
};

/**
 * File a claim
 */
const fileClaim = async (assuranceId, buyerId, data) => {
  const { reason, description, evidence, claimAmount } = data;

  const assurance = await prisma.tradeAssurance.findFirst({
    where: { id: assuranceId, buyerId },
  });

  if (!assurance) {
    throw new NotFoundError('Trade assurance');
  }

  if (assurance.status !== ASSURANCE_STATUS.ACTIVE) {
    throw new BadRequestError('Assurance is not active');
  }

  const now = new Date();
  if (now > new Date(assurance.validUntil)) {
    await prisma.tradeAssurance.update({
      where: { id: assuranceId },
      data: { status: ASSURANCE_STATUS.EXPIRED },
    });
    throw new BadRequestError('Assurance coverage has expired');
  }

  if (assurance.claimId) {
    throw new BadRequestError('Claim already filed for this assurance');
  }

  // Validate claim amount
  const maxClaimAmount = parseFloat(assurance.coverageAmount);
  if (parseFloat(claimAmount) > maxClaimAmount) {
    throw new BadRequestError(`Maximum claim amount is ${formatCurrency(maxClaimAmount)}`);
  }

  const claimId = generateClaimId();

  const updated = await prisma.tradeAssurance.update({
    where: { id: assuranceId },
    data: {
      status: ASSURANCE_STATUS.CLAIMED,
      claimId,
      claimStatus: CLAIM_STATUS.FILED,
      claimAmount,
      claimReason: reason,
      claimFiledAt: now,
    },
  });

  // Notify seller
  emitToBusiness(assurance.sellerId, 'assurance:claim_filed', {
    assuranceId,
    claimId,
    claimAmount: formatCurrency(claimAmount),
    reason,
  });

  // TODO: Notify admin for review

  logger.info('Claim filed', {
    assuranceId,
    claimId,
    buyerId,
    claimAmount,
    reason,
  });

  return {
    ...updated,
    claimId,
    message: 'Claim filed successfully. Our team will review within 2-3 business days.',
  };
};

/**
 * Update claim status (admin)
 */
const updateClaimStatus = async (assuranceId, newStatus, resolution = null) => {
  const assurance = await prisma.tradeAssurance.findUnique({
    where: { id: assuranceId },
  });

  if (!assurance) {
    throw new NotFoundError('Trade assurance');
  }

  if (!assurance.claimId) {
    throw new BadRequestError('No claim filed');
  }

  const updateData = {
    claimStatus: newStatus,
  };

  if (newStatus === CLAIM_STATUS.APPROVED || newStatus === CLAIM_STATUS.REJECTED) {
    updateData.claimResolvedAt = new Date();
    updateData.resolution = resolution;
  }

  if (newStatus === CLAIM_STATUS.PAID) {
    updateData.status = ASSURANCE_STATUS.RESOLVED;
  }

  const updated = await prisma.tradeAssurance.update({
    where: { id: assuranceId },
    data: updateData,
  });

  // Notify buyer
  emitToBusiness(assurance.buyerId, `claim:${newStatus.toLowerCase()}`, {
    assuranceId,
    claimId: assurance.claimId,
    status: newStatus,
    resolution,
  });

  logger.info('Claim status updated', { assuranceId, newStatus });

  return updated;
};

/**
 * Get buyer's assurances
 */
const getBuyerAssurances = async (buyerId, options = {}) => {
  const { page = 1, limit = 20, status } = options;
  const skip = (page - 1) * limit;

  const where = { buyerId };
  if (status) where.status = status;

  const [assurances, total] = await Promise.all([
    prisma.tradeAssurance.findMany({
      where,
      include: {
        order: { select: { id: true, orderNumber: true } },
        seller: { select: { id: true, businessName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.tradeAssurance.count({ where }),
  ]);

  const enriched = assurances.map((a) => ({
    ...a,
    formattedCoverage: formatCurrency(a.coverageAmount),
    isActive: a.status === ASSURANCE_STATUS.ACTIVE && new Date() <= new Date(a.validUntil),
  }));

  return {
    assurances: enriched,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Get seller's assurances
 */
const getSellerAssurances = async (sellerId, options = {}) => {
  const { page = 1, limit = 20, status, hasClaim } = options;
  const skip = (page - 1) * limit;

  const where = { sellerId };
  if (status) where.status = status;
  if (hasClaim !== undefined) {
    where.claimId = hasClaim ? { not: null } : null;
  }

  const [assurances, total] = await Promise.all([
    prisma.tradeAssurance.findMany({
      where,
      include: {
        order: { select: { id: true, orderNumber: true } },
        buyer: { select: { id: true, businessName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.tradeAssurance.count({ where }),
  ]);

  return {
    assurances,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Expire old assurances (scheduled job)
 */
const expireOldAssurances = async () => {
  const now = new Date();

  const result = await prisma.tradeAssurance.updateMany({
    where: {
      status: ASSURANCE_STATUS.ACTIVE,
      validUntil: { lt: now },
      claimId: null, // No claim filed
    },
    data: { status: ASSURANCE_STATUS.EXPIRED },
  });

  logger.info('Expired assurances processed', { count: result.count });

  return { expired: result.count };
};

/**
 * Get assurance statistics
 */
const getAssuranceStats = async (businessId, isSeller = false) => {
  const where = isSeller ? { sellerId: businessId } : { buyerId: businessId };

  const [active, claimed, resolved, totalCoverage] = await Promise.all([
    prisma.tradeAssurance.count({ where: { ...where, status: ASSURANCE_STATUS.ACTIVE } }),
    prisma.tradeAssurance.count({ where: { ...where, status: ASSURANCE_STATUS.CLAIMED } }),
    prisma.tradeAssurance.count({ where: { ...where, status: ASSURANCE_STATUS.RESOLVED } }),
    prisma.tradeAssurance.aggregate({
      where: { ...where, status: ASSURANCE_STATUS.ACTIVE },
      _sum: { coverageAmount: true },
    }),
  ]);

  return {
    active,
    claimed,
    resolved,
    totalCoverage: totalCoverage._sum.coverageAmount || 0,
    formattedCoverage: formatCurrency(totalCoverage._sum.coverageAmount || 0),
  };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ASSURANCE_STATUS,
  COVERAGE_TYPE,
  CLAIM_STATUS,
  PREMIUM_RATES,
  COVERAGE_TERMS,
  calculatePremium,
  createAssurance,
  activateAssurance,
  getAssuranceByOrder,
  fileClaim,
  updateClaimStatus,
  getBuyerAssurances,
  getSellerAssurances,
  expireOldAssurances,
  getAssuranceStats,
};



