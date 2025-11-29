// =============================================================================
// AIRAVAT B2B MARKETPLACE - WALLET SERVICE
// Business Wallet with Redis caching and real-time updates
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const config = require('../config');
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

const WALLET_STATUS = {
  ACTIVE: 'ACTIVE',
  FROZEN: 'FROZEN',
  SUSPENDED: 'SUSPENDED',
};

const TRANSACTION_STATUS = {
  PENDING: 'PENDING',
  PROCESSING: 'PROCESSING',
  COMPLETED: 'COMPLETED',
  FAILED: 'FAILED',
  CANCELLED: 'CANCELLED',
};

const TRANSACTION_TYPE = {
  CREDIT: 'CREDIT',
  DEBIT: 'DEBIT',
};

const TRANSACTION_CATEGORY = {
  DEPOSIT: 'DEPOSIT',
  WITHDRAWAL: 'WITHDRAWAL',
  PAYMENT: 'PAYMENT',
  REFUND: 'REFUND',
  TRANSFER: 'TRANSFER',
  CASHBACK: 'CASHBACK',
  FEE: 'FEE',
};

const CACHE_TTL = { WALLET: 300, STATS: 600 };
const MIN_DEPOSIT = 100;
const MIN_WITHDRAWAL = 500;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const generateTransactionId = (prefix = 'TXN') => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = generateId().substring(0, 8).toUpperCase();
  return `${prefix}-${timestamp}-${random}`;
};

const getWalletCacheKey = (businessId) => `wallet:${businessId}`;

const invalidateWalletCache = async (businessId) => {
  await cache.del(getWalletCacheKey(businessId));
};

// =============================================================================
// WALLET MANAGEMENT
// =============================================================================

const getOrCreateWallet = async (businessId) => {
  const cacheKey = getWalletCacheKey(businessId);
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  let wallet = await prisma.wallet.findUnique({ where: { businessId } });

  if (!wallet) {
    wallet = await prisma.wallet.create({
      data: { businessId, balance: 0, holdBalance: 0, currency: 'INR', status: WALLET_STATUS.ACTIVE },
    });
    logger.info(`Wallet created for business: ${businessId}`, { walletId: wallet.id });
  }

  await cache.set(cacheKey, wallet, CACHE_TTL.WALLET);
  return wallet;
};

const getWalletDetails = async (businessId) => {
  const wallet = await getOrCreateWallet(businessId);

  if (wallet.status !== WALLET_STATUS.ACTIVE) {
    throw new ForbiddenError(`Wallet is ${wallet.status.toLowerCase()}`);
  }

  const [recentTransactions, stats] = await Promise.all([
    prisma.walletTransaction.findMany({
      where: { walletId: wallet.id },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
    getWalletStats(wallet.id),
  ]);

  const availableBalance = parseFloat(wallet.balance) - parseFloat(wallet.holdBalance);

  return {
    ...wallet,
    availableBalance,
    formattedBalance: formatCurrency(wallet.balance),
    formattedAvailable: formatCurrency(availableBalance),
    recentTransactions,
    stats,
  };
};

const getWalletStats = async (walletId) => {
  const now = new Date();
  const thisMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [totalDeposits, totalWithdrawals, monthlyDeposits] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: { walletId, type: TRANSACTION_TYPE.CREDIT, status: TRANSACTION_STATUS.COMPLETED },
      _sum: { amount: true },
    }),
    prisma.walletTransaction.aggregate({
      where: { walletId, type: TRANSACTION_TYPE.DEBIT, status: TRANSACTION_STATUS.COMPLETED },
      _sum: { amount: true },
    }),
    prisma.walletTransaction.aggregate({
      where: { walletId, type: TRANSACTION_TYPE.CREDIT, status: TRANSACTION_STATUS.COMPLETED, createdAt: { gte: thisMonth } },
      _sum: { amount: true },
    }),
  ]);

  return {
    totalDeposits: totalDeposits._sum.amount || 0,
    totalWithdrawals: Math.abs(totalWithdrawals._sum.amount || 0),
    monthlyDeposits: monthlyDeposits._sum.amount || 0,
  };
};

// =============================================================================
// DEPOSITS
// =============================================================================

const initiateDeposit = async (businessId, amount, paymentMethod) => {
  if (amount < MIN_DEPOSIT) {
    throw new BadRequestError(`Minimum deposit amount is ${formatCurrency(MIN_DEPOSIT)}`);
  }

  const wallet = await getOrCreateWallet(businessId);
  if (wallet.status !== WALLET_STATUS.ACTIVE) {
    throw new ForbiddenError(`Cannot deposit to ${wallet.status.toLowerCase()} wallet`);
  }

  const transactionId = generateTransactionId('DEP');

  const transaction = await prisma.walletTransaction.create({
    data: {
      walletId: wallet.id,
      transactionId,
      type: TRANSACTION_TYPE.CREDIT,
      amount,
      description: `Wallet deposit via ${paymentMethod}`,
      category: TRANSACTION_CATEGORY.DEPOSIT,
      status: TRANSACTION_STATUS.PENDING,
      metadata: { paymentMethod },
    },
  });

  logger.info('Deposit initiated', { transactionId, businessId, amount, paymentMethod });

  return { transaction, paymentDetails: { amount, currency: 'INR', transactionId } };
};

const completeDeposit = async (transactionId, paymentDetails) => {
  const transaction = await prisma.walletTransaction.findUnique({
    where: { transactionId },
    include: { wallet: true },
  });

  if (!transaction) throw new NotFoundError('Transaction');
  if (transaction.status !== TRANSACTION_STATUS.PENDING) {
    throw new BadRequestError('Transaction already processed');
  }

  const [updatedTransaction, updatedWallet] = await prisma.$transaction([
    prisma.walletTransaction.update({
      where: { id: transaction.id },
      data: { status: TRANSACTION_STATUS.COMPLETED, metadata: { ...transaction.metadata, paymentDetails } },
    }),
    prisma.wallet.update({
      where: { id: transaction.walletId },
      data: { balance: { increment: transaction.amount } },
    }),
  ]);

  await invalidateWalletCache(transaction.wallet.businessId);

  emitToBusiness(transaction.wallet.businessId, 'wallet:updated', {
    type: 'deposit', amount: transaction.amount, newBalance: updatedWallet.balance,
  });

  logger.info('Deposit completed', { transactionId, amount: transaction.amount, newBalance: updatedWallet.balance });

  return { success: true, amount: transaction.amount, newBalance: updatedWallet.balance };
};

// =============================================================================
// WITHDRAWALS
// =============================================================================

const requestWithdrawal = async (businessId, amount, bankDetails) => {
  if (amount < MIN_WITHDRAWAL) {
    throw new BadRequestError(`Minimum withdrawal amount is ${formatCurrency(MIN_WITHDRAWAL)}`);
  }

  const wallet = await getOrCreateWallet(businessId);
  if (wallet.status !== WALLET_STATUS.ACTIVE) {
    throw new ForbiddenError(`Cannot withdraw from ${wallet.status.toLowerCase()} wallet`);
  }

  const availableBalance = parseFloat(wallet.balance) - parseFloat(wallet.holdBalance);
  if (amount > availableBalance) {
    throw new BadRequestError(`Insufficient balance. Available: ${formatCurrency(availableBalance)}`);
  }

  const transactionId = generateTransactionId('WTH');

  const [transaction] = await prisma.$transaction([
    prisma.walletTransaction.create({
      data: {
        walletId: wallet.id,
        transactionId,
        type: TRANSACTION_TYPE.DEBIT,
        amount: -amount,
        description: 'Withdrawal to bank account',
        category: TRANSACTION_CATEGORY.WITHDRAWAL,
        status: TRANSACTION_STATUS.PENDING,
        metadata: { bankDetails: { accountNumber: bankDetails.accountNumber?.slice(-4), ifsc: bankDetails.ifsc } },
      },
    }),
    prisma.wallet.update({ where: { id: wallet.id }, data: { holdBalance: { increment: amount } } }),
  ]);

  await invalidateWalletCache(businessId);
  emitToBusiness(businessId, 'wallet:withdrawal_requested', { transactionId, amount });

  logger.info('Withdrawal requested', { transactionId, businessId, amount });
  return transaction;
};

// =============================================================================
// PAYMENTS
// =============================================================================

const payFromWallet = async (businessId, orderId, amount) => {
  const wallet = await getOrCreateWallet(businessId);
  if (wallet.status !== WALLET_STATUS.ACTIVE) throw new ForbiddenError('Wallet is not active');

  const availableBalance = parseFloat(wallet.balance) - parseFloat(wallet.holdBalance);
  if (amount > availableBalance) {
    throw new BadRequestError(`Insufficient wallet balance. Available: ${formatCurrency(availableBalance)}`);
  }

  const transactionId = generateTransactionId('PAY');

  await prisma.$transaction([
    prisma.walletTransaction.create({
      data: {
        walletId: wallet.id, transactionId, type: TRANSACTION_TYPE.DEBIT, amount: -amount,
        description: 'Payment for order', category: TRANSACTION_CATEGORY.PAYMENT,
        status: TRANSACTION_STATUS.COMPLETED, referenceType: 'order', referenceId: orderId,
      },
    }),
    prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { decrement: amount } } }),
  ]);

  await invalidateWalletCache(businessId);
  logger.info('Wallet payment completed', { transactionId, orderId, amount });
  return { success: true, transactionId };
};

const refundToWallet = async (businessId, orderId, amount, reason) => {
  const wallet = await getOrCreateWallet(businessId);
  const transactionId = generateTransactionId('REF');

  await prisma.$transaction([
    prisma.walletTransaction.create({
      data: {
        walletId: wallet.id, transactionId, type: TRANSACTION_TYPE.CREDIT, amount,
        description: `Refund: ${reason}`, category: TRANSACTION_CATEGORY.REFUND,
        status: TRANSACTION_STATUS.COMPLETED, referenceType: 'order', referenceId: orderId,
      },
    }),
    prisma.wallet.update({ where: { id: wallet.id }, data: { balance: { increment: amount } } }),
  ]);

  await invalidateWalletCache(businessId);
  emitToBusiness(businessId, 'wallet:refund', { transactionId, amount, orderId });
  logger.info('Refund processed', { transactionId, orderId, amount, reason });
  return { success: true, transactionId };
};

// =============================================================================
// TRANSACTIONS
// =============================================================================

const getTransactions = async (businessId, options = {}) => {
  const wallet = await getOrCreateWallet(businessId);
  const { page = 1, limit = 20, type, category, status } = options;
  const skip = (page - 1) * limit;

  const where = { walletId: wallet.id };
  if (type) where.type = type;
  if (category) where.category = category;
  if (status) where.status = status;

  const [transactions, total] = await Promise.all([
    prisma.walletTransaction.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.walletTransaction.count({ where }),
  ]);

  return {
    transactions: transactions.map((t) => ({ ...t, formattedAmount: formatCurrency(Math.abs(t.amount)) })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit), hasMore: page * limit < total },
  };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  WALLET_STATUS, TRANSACTION_STATUS, TRANSACTION_TYPE, TRANSACTION_CATEGORY,
  getOrCreateWallet, getWalletDetails, getWalletStats,
  initiateDeposit, completeDeposit, requestWithdrawal,
  payFromWallet, refundToWallet, getTransactions,
};
