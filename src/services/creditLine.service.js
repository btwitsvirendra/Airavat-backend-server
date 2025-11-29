// =============================================================================
// AIRAVAT B2B MARKETPLACE - CREDIT LINE SERVICE
// Business Credit with scoring, limits, and real-time updates
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const { NotFoundError, BadRequestError, ForbiddenError, ConflictError } = require('../utils/errors');
const { generateId, formatCurrency } = require('../utils/helpers');
const { emitToBusiness } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const CREDIT_STATUS = { PENDING: 'PENDING', UNDER_REVIEW: 'UNDER_REVIEW', ACTIVE: 'ACTIVE', REJECTED: 'REJECTED', SUSPENDED: 'SUSPENDED', CLOSED: 'CLOSED' };
const TRANSACTION_TYPE = { USAGE: 'USAGE', PAYMENT: 'PAYMENT', INTEREST: 'INTEREST', FEE: 'FEE' };
const SCORE_THRESHOLDS = { EXCELLENT: 800, GOOD: 700, FAIR: 600, POOR: 500 };
const INTEREST_RATES = { EXCELLENT: 12, GOOD: 15, FAIR: 18, POOR: 21, DEFAULT: 24 };
const CREDIT_LIMITS = { EXCELLENT: 10, GOOD: 5, FAIR: 2, POOR: 1, DEFAULT: 0.5 };
const CACHE_TTL = { CREDIT_LINE: 300 };

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const getScoreTier = (score) => {
  if (score >= SCORE_THRESHOLDS.EXCELLENT) return 'EXCELLENT';
  if (score >= SCORE_THRESHOLDS.GOOD) return 'GOOD';
  if (score >= SCORE_THRESHOLDS.FAIR) return 'FAIR';
  if (score >= SCORE_THRESHOLDS.POOR) return 'POOR';
  return 'DEFAULT';
};

const getInterestRate = (score) => INTEREST_RATES[getScoreTier(score)];
const getMaxCreditLimit = (score) => CREDIT_LIMITS[getScoreTier(score)] * 100000;

const generateTransactionId = (prefix = 'CRD') => {
  return `${prefix}-${Date.now().toString(36).toUpperCase()}-${generateId().substring(0, 6).toUpperCase()}`;
};

// =============================================================================
// CREDIT SCORE CALCULATION
// =============================================================================

const calculateCreditScore = async (business) => {
  let score = 500;

  const businessAge = (Date.now() - new Date(business.createdAt).getTime()) / (1000 * 60 * 60 * 24 * 365);
  score += Math.min(Math.round(businessAge * 20), 100);

  if (business.verificationStatus === 'VERIFIED') score += 50;

  const completedOrders = await prisma.order.findMany({
    where: { OR: [{ buyerId: business.id }, { sellerId: business.id }], status: { in: ['COMPLETED', 'DELIVERED'] } },
    select: { totalAmount: true },
  });

  const totalOrderValue = completedOrders.reduce((sum, o) => sum + parseFloat(o.totalAmount), 0);
  score += Math.min(Math.round(totalOrderValue / 10000), 150);
  score += Math.min(completedOrders.length * 5, 50);

  if (business.gstNumber) score += 30;
  if (business.trustScore) score += Math.round((business.trustScore / 100) * 50);

  const latePayments = await prisma.order.count({ where: { buyerId: business.id, paymentStatus: 'OVERDUE' } });
  score -= latePayments * 20;

  return Math.min(Math.max(Math.round(score), 300), 900);
};

// =============================================================================
// CREDIT APPLICATION
// =============================================================================

const applyForCredit = async (businessId, userId, applicationData) => {
  const existing = await prisma.creditLine.findFirst({
    where: { businessId, status: { in: [CREDIT_STATUS.ACTIVE, CREDIT_STATUS.PENDING, CREDIT_STATUS.UNDER_REVIEW] } },
  });

  if (existing) {
    if (existing.status === CREDIT_STATUS.ACTIVE) throw new ConflictError('You already have an active credit line');
    throw new ConflictError('You have a pending credit application');
  }

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new NotFoundError('Business');
  if (business.verificationStatus !== 'VERIFIED') throw new ForbiddenError('Business verification required');

  const creditScore = await calculateCreditScore(business);
  const maxEligible = getMaxCreditLimit(creditScore);
  const eligibleAmount = Math.min(applicationData.requestedAmount, maxEligible);
  const interestRate = getInterestRate(creditScore);

  const creditLine = await prisma.creditLine.create({
    data: {
      businessId, requestedAmount: applicationData.requestedAmount, availableCredit: 0, usedCredit: 0,
      creditScore, interestRate, status: CREDIT_STATUS.PENDING,
      applicationData: { ...applicationData, appliedBy: userId, appliedAt: new Date(), eligibleAmount, scoreTier: getScoreTier(creditScore) },
    },
  });

  logger.info('Credit application submitted', { creditLineId: creditLine.id, businessId, creditScore, eligibleAmount });
  emitToBusiness(businessId, 'credit:application_submitted', { creditLineId: creditLine.id, status: CREDIT_STATUS.PENDING });

  return { application: creditLine, creditScore, scoreTier: getScoreTier(creditScore), eligibleAmount, interestRate };
};

// =============================================================================
// CREDIT LINE MANAGEMENT
// =============================================================================

const getCreditLine = async (businessId) => {
  const cacheKey = `credit:${businessId}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const creditLine = await prisma.creditLine.findFirst({ where: { businessId, status: CREDIT_STATUS.ACTIVE } });
  if (!creditLine) return null;

  const recentTransactions = await prisma.creditTransaction.findMany({
    where: { creditLineId: creditLine.id }, orderBy: { createdAt: 'desc' }, take: 10,
  });

  const result = {
    ...creditLine,
    utilizationPercent: ((parseFloat(creditLine.usedCredit) / parseFloat(creditLine.creditLimit)) * 100).toFixed(1),
    formattedLimit: formatCurrency(creditLine.creditLimit),
    formattedUsed: formatCurrency(creditLine.usedCredit),
    formattedAvailable: formatCurrency(creditLine.availableCredit),
    recentTransactions,
  };

  await cache.set(cacheKey, result, CACHE_TTL.CREDIT_LINE);
  return result;
};

// =============================================================================
// CREDIT USAGE
// =============================================================================

const useCredit = async (businessId, orderId, amount) => {
  const creditLine = await prisma.creditLine.findFirst({ where: { businessId, status: CREDIT_STATUS.ACTIVE } });
  if (!creditLine) throw new NotFoundError('Active credit line');
  if (amount > parseFloat(creditLine.availableCredit)) {
    throw new BadRequestError(`Insufficient credit. Available: ${formatCurrency(creditLine.availableCredit)}`);
  }

  const transactionId = generateTransactionId('USE');

  await prisma.$transaction([
    prisma.creditTransaction.create({
      data: {
        creditLineId: creditLine.id, transactionId, type: TRANSACTION_TYPE.USAGE, amount,
        description: 'Credit used for order', referenceType: 'order', referenceId: orderId,
        balanceAfter: parseFloat(creditLine.availableCredit) - amount,
      },
    }),
    prisma.creditLine.update({
      where: { id: creditLine.id },
      data: { usedCredit: { increment: amount }, availableCredit: { decrement: amount } },
    }),
  ]);

  await cache.del(`credit:${businessId}`);
  logger.info('Credit used', { transactionId, businessId, orderId, amount });
  return { success: true, transactionId };
};

const makePayment = async (businessId, amount, paymentMethod) => {
  const creditLine = await prisma.creditLine.findFirst({ where: { businessId, status: CREDIT_STATUS.ACTIVE } });
  if (!creditLine) throw new NotFoundError('Active credit line');
  if (amount > parseFloat(creditLine.usedCredit)) throw new BadRequestError('Payment amount exceeds outstanding balance');

  const transactionId = generateTransactionId('PMT');

  const [transaction, updatedCreditLine] = await prisma.$transaction([
    prisma.creditTransaction.create({
      data: {
        creditLineId: creditLine.id, transactionId, type: TRANSACTION_TYPE.PAYMENT, amount: -amount,
        description: `Credit payment via ${paymentMethod}`,
        balanceAfter: parseFloat(creditLine.availableCredit) + amount, metadata: { paymentMethod },
      },
    }),
    prisma.creditLine.update({
      where: { id: creditLine.id },
      data: { usedCredit: { decrement: amount }, availableCredit: { increment: amount } },
    }),
  ]);

  await cache.del(`credit:${businessId}`);
  emitToBusiness(businessId, 'credit:payment_received', { transactionId, amount, newAvailable: updatedCreditLine.availableCredit });
  logger.info('Credit payment received', { transactionId, businessId, amount, paymentMethod });

  return { success: true, transactionId, newAvailable: updatedCreditLine.availableCredit, formattedNewAvailable: formatCurrency(updatedCreditLine.availableCredit) };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  CREDIT_STATUS, TRANSACTION_TYPE, SCORE_THRESHOLDS,
  calculateCreditScore, getScoreTier, getInterestRate, getMaxCreditLimit,
  applyForCredit, getCreditLine, useCredit, makePayment,
};
