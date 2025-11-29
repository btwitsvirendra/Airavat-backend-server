// =============================================================================
// AIRAVAT B2B MARKETPLACE - COMMISSION ENGINE SERVICE
// Handles platform commissions, fees, and revenue calculations
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError, BadRequestError, NotFoundError } = require('../utils/errors');
const Decimal = require('decimal.js');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Default commission rates by category
 */
const DEFAULT_COMMISSION_RATES = {
  ELECTRONICS: 5.0,
  MACHINERY: 4.0,
  TEXTILES: 6.0,
  CHEMICALS: 4.5,
  FOOD_BEVERAGES: 8.0,
  CONSTRUCTION: 3.5,
  AUTOMOTIVE: 4.0,
  PHARMACEUTICALS: 5.5,
  AGRICULTURE: 7.0,
  PACKAGING: 5.0,
  DEFAULT: 5.0,
};

/**
 * Commission tiers based on GMV
 */
const COMMISSION_TIERS = {
  STARTER: { minGMV: 0, maxGMV: 100000, discount: 0 },
  BRONZE: { minGMV: 100001, maxGMV: 500000, discount: 0.5 },
  SILVER: { minGMV: 500001, maxGMV: 2000000, discount: 1.0 },
  GOLD: { minGMV: 2000001, maxGMV: 10000000, discount: 1.5 },
  PLATINUM: { minGMV: 10000001, maxGMV: Infinity, discount: 2.0 },
};

/**
 * Platform fee types
 */
const FEE_TYPES = {
  COMMISSION: 'Transaction Commission',
  PAYMENT_PROCESSING: 'Payment Processing Fee',
  ESCROW: 'Escrow Service Fee',
  LOGISTICS: 'Logistics Handling Fee',
  INSURANCE: 'Trade Insurance Fee',
  PREMIUM_LISTING: 'Premium Listing Fee',
  LEAD_GENERATION: 'Lead Generation Fee',
  SUBSCRIPTION: 'Subscription Fee',
};

/**
 * Payment processing fees
 */
const PAYMENT_FEES = {
  UPI: 0.0,
  DEBIT_CARD: 0.9,
  CREDIT_CARD: 1.8,
  NET_BANKING: 1.2,
  WALLET: 1.5,
  CREDIT_LINE: 0.5,
  ESCROW: 1.0,
};

// =============================================================================
// COMMISSION CALCULATION
// =============================================================================

/**
 * Calculate commission for an order
 * @param {Object} order - Order object
 * @param {Object} options - Calculation options
 * @returns {Promise<Object>} Commission breakdown
 */
exports.calculateOrderCommission = async (order, options = {}) => {
  try {
    const { applyDiscount = true, includePaymentFee = true } = options;

    // Get seller's business details
    const seller = await prisma.business.findUnique({
      where: { id: order.sellerId },
      include: {
        subscription: true,
        commissionOverride: true,
      },
    });

    if (!seller) {
      throw new NotFoundError('Seller not found');
    }

    // Get category for the order (from first item)
    const orderItem = await prisma.orderItem.findFirst({
      where: { orderId: order.id },
      include: {
        product: {
          include: { category: true },
        },
      },
    });

    const categoryCode = orderItem?.product?.category?.code || 'DEFAULT';
    const orderAmount = new Decimal(order.subtotal);

    // Calculate base commission rate
    let commissionRate = await getCommissionRate(seller.id, categoryCode);

    // Apply tier discount if eligible
    if (applyDiscount) {
      const tierDiscount = await calculateTierDiscount(seller.id);
      commissionRate = Math.max(0, commissionRate - tierDiscount);
    }

    // Calculate commission amount
    const commissionAmount = orderAmount.times(commissionRate).dividedBy(100);

    // Calculate payment processing fee
    let paymentFee = new Decimal(0);
    if (includePaymentFee && order.paymentMethod) {
      const paymentFeeRate = PAYMENT_FEES[order.paymentMethod] || PAYMENT_FEES.NET_BANKING;
      paymentFee = orderAmount.times(paymentFeeRate).dividedBy(100);
    }

    // Calculate GST on commission (18%)
    const gstRate = 18;
    const commissionGst = commissionAmount.times(gstRate).dividedBy(100);
    const paymentFeeGst = paymentFee.times(gstRate).dividedBy(100);

    // Total platform fees
    const totalFees = commissionAmount.plus(commissionGst).plus(paymentFee).plus(paymentFeeGst);

    // Seller payout amount
    const sellerPayout = orderAmount.minus(totalFees);

    const breakdown = {
      orderId: order.id,
      orderAmount: orderAmount.toFixed(2),
      currency: order.currency || 'INR',
      
      // Commission
      commissionRate: commissionRate.toFixed(2),
      commissionAmount: commissionAmount.toFixed(2),
      commissionGst: commissionGst.toFixed(2),
      
      // Payment processing
      paymentMethod: order.paymentMethod,
      paymentFeeRate: PAYMENT_FEES[order.paymentMethod] || 0,
      paymentFee: paymentFee.toFixed(2),
      paymentFeeGst: paymentFeeGst.toFixed(2),
      
      // Totals
      totalPlatformFees: totalFees.toFixed(2),
      sellerPayout: sellerPayout.toFixed(2),
      
      // Metadata
      categoryCode,
      tierDiscount: applyDiscount ? await calculateTierDiscount(seller.id) : 0,
      calculatedAt: new Date().toISOString(),
    };

    logger.debug('Commission calculated', { orderId: order.id, breakdown });

    return breakdown;
  } catch (error) {
    logger.error('Calculate commission error', { error: error.message, orderId: order.id });
    throw error;
  }
};

/**
 * Get commission rate for a seller and category
 * @param {string} sellerId - Seller business ID
 * @param {string} categoryCode - Category code
 * @returns {Promise<number>} Commission rate
 */
async function getCommissionRate(sellerId, categoryCode) {
  // Check for seller-specific override
  const override = await prisma.commissionOverride.findFirst({
    where: {
      businessId: sellerId,
      categoryCode,
      isActive: true,
      OR: [
        { validUntil: null },
        { validUntil: { gte: new Date() } },
      ],
    },
  });

  if (override) {
    return parseFloat(override.rate);
  }

  // Check for category-specific rate
  const categoryRate = await prisma.commissionRate.findFirst({
    where: {
      categoryCode,
      isActive: true,
    },
  });

  if (categoryRate) {
    return parseFloat(categoryRate.rate);
  }

  // Return default rate
  return DEFAULT_COMMISSION_RATES[categoryCode] || DEFAULT_COMMISSION_RATES.DEFAULT;
}

/**
 * Calculate tier discount based on seller's GMV
 * @param {string} sellerId - Seller business ID
 * @returns {Promise<number>} Tier discount percentage
 */
async function calculateTierDiscount(sellerId) {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const gmvResult = await prisma.order.aggregate({
    where: {
      sellerId,
      status: { in: ['DELIVERED', 'COMPLETED'] },
      createdAt: { gte: thirtyDaysAgo },
    },
    _sum: { subtotal: true },
  });

  const monthlyGMV = parseFloat(gmvResult._sum.subtotal || 0);

  for (const [tier, config] of Object.entries(COMMISSION_TIERS)) {
    if (monthlyGMV >= config.minGMV && monthlyGMV <= config.maxGMV) {
      return config.discount;
    }
  }

  return 0;
}

// =============================================================================
// COMMISSION RECORDS
// =============================================================================

/**
 * Record commission for a completed order
 * @param {string} orderId - Order ID
 * @returns {Promise<Object>} Commission record
 */
exports.recordCommission = async (orderId) => {
  try {
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        seller: true,
        buyer: true,
      },
    });

    if (!order) {
      throw new NotFoundError('Order not found');
    }

    // Check if commission already recorded
    const existing = await prisma.commissionRecord.findUnique({
      where: { orderId },
    });

    if (existing) {
      return existing;
    }

    // Calculate commission
    const breakdown = await exports.calculateOrderCommission(order);

    // Create commission record
    const record = await prisma.commissionRecord.create({
      data: {
        orderId,
        sellerId: order.sellerId,
        buyerId: order.buyerId,
        orderAmount: parseFloat(breakdown.orderAmount),
        commissionRate: parseFloat(breakdown.commissionRate),
        commissionAmount: parseFloat(breakdown.commissionAmount),
        commissionGst: parseFloat(breakdown.commissionGst),
        paymentFee: parseFloat(breakdown.paymentFee),
        paymentFeeGst: parseFloat(breakdown.paymentFeeGst),
        totalPlatformFees: parseFloat(breakdown.totalPlatformFees),
        sellerPayout: parseFloat(breakdown.sellerPayout),
        currency: breakdown.currency,
        status: 'PENDING',
        metadata: {
          categoryCode: breakdown.categoryCode,
          tierDiscount: breakdown.tierDiscount,
          paymentMethod: breakdown.paymentMethod,
        },
      },
    });

    logger.info('Commission recorded', { orderId, recordId: record.id });

    return record;
  } catch (error) {
    logger.error('Record commission error', { error: error.message, orderId });
    throw error;
  }
};

/**
 * Get commission records for a seller
 * @param {string} sellerId - Seller business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Commission records with pagination
 */
exports.getSellerCommissions = async (sellerId, options = {}) => {
  const { page = 1, limit = 20, status = null, startDate = null, endDate = null } = options;
  const skip = (page - 1) * limit;

  const where = { sellerId };
  if (status) where.status = status;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const [records, total, summary] = await Promise.all([
    prisma.commissionRecord.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        order: {
          select: { orderNumber: true, status: true },
        },
      },
    }),
    prisma.commissionRecord.count({ where }),
    prisma.commissionRecord.aggregate({
      where,
      _sum: {
        orderAmount: true,
        commissionAmount: true,
        totalPlatformFees: true,
        sellerPayout: true,
      },
    }),
  ]);

  return {
    records,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    summary: {
      totalOrderAmount: summary._sum.orderAmount || 0,
      totalCommission: summary._sum.commissionAmount || 0,
      totalPlatformFees: summary._sum.totalPlatformFees || 0,
      totalPayout: summary._sum.sellerPayout || 0,
    },
  };
};

// =============================================================================
// SELLER PAYOUTS
// =============================================================================

/**
 * Calculate pending payout for a seller
 * @param {string} sellerId - Seller business ID
 * @returns {Promise<Object>} Payout summary
 */
exports.calculatePendingPayout = async (sellerId) => {
  // Get all unpaid commission records
  const pendingRecords = await prisma.commissionRecord.findMany({
    where: {
      sellerId,
      status: 'PENDING',
      order: {
        status: { in: ['DELIVERED', 'COMPLETED'] },
      },
    },
    include: {
      order: {
        select: { orderNumber: true, deliveredAt: true },
      },
    },
  });

  // Calculate settlement eligibility (T+7 days after delivery)
  const now = new Date();
  const settlementDelay = 7 * 24 * 60 * 60 * 1000;

  let eligibleAmount = new Decimal(0);
  let pendingAmount = new Decimal(0);
  const eligibleRecords = [];
  const pendingRecordsDetail = [];

  for (const record of pendingRecords) {
    const deliveredAt = record.order?.deliveredAt;
    const payout = new Decimal(record.sellerPayout);

    if (deliveredAt && (now - new Date(deliveredAt)) >= settlementDelay) {
      eligibleAmount = eligibleAmount.plus(payout);
      eligibleRecords.push(record);
    } else {
      pendingAmount = pendingAmount.plus(payout);
      pendingRecordsDetail.push({
        ...record,
        eligibleDate: deliveredAt 
          ? new Date(new Date(deliveredAt).getTime() + settlementDelay)
          : null,
      });
    }
  }

  return {
    sellerId,
    eligibleForPayout: eligibleAmount.toFixed(2),
    eligibleRecordsCount: eligibleRecords.length,
    pendingSettlement: pendingAmount.toFixed(2),
    pendingRecordsCount: pendingRecordsDetail.length,
    totalPending: eligibleAmount.plus(pendingAmount).toFixed(2),
    currency: 'INR',
    nextSettlementDate: getNextSettlementDate(),
  };
};

/**
 * Create a payout request
 * @param {string} sellerId - Seller business ID
 * @param {Object} options - Payout options
 * @returns {Promise<Object>} Payout request
 */
exports.createPayoutRequest = async (sellerId, options = {}) => {
  try {
    const { amount = null, recordIds = [] } = options;

    // Get seller's bank details
    const seller = await prisma.business.findUnique({
      where: { id: sellerId },
      include: { bankDetails: true },
    });

    if (!seller) {
      throw new NotFoundError('Seller not found');
    }

    if (!seller.bankDetails || !seller.bankDetails.isVerified) {
      throw new BadRequestError('Verified bank details required for payout');
    }

    // Get eligible records
    const pendingPayout = await exports.calculatePendingPayout(sellerId);
    
    if (parseFloat(pendingPayout.eligibleForPayout) <= 0) {
      throw new BadRequestError('No eligible amount for payout');
    }

    const payoutAmount = amount 
      ? Math.min(parseFloat(amount), parseFloat(pendingPayout.eligibleForPayout))
      : parseFloat(pendingPayout.eligibleForPayout);

    // Minimum payout threshold
    if (payoutAmount < 100) {
      throw new BadRequestError('Minimum payout amount is ₹100');
    }

    // Generate payout number
    const payoutNumber = generatePayoutNumber();

    // Create payout request
    const payout = await prisma.$transaction(async (tx) => {
      const payoutRequest = await tx.payoutRequest.create({
        data: {
          payoutNumber,
          sellerId,
          amount: payoutAmount,
          currency: 'INR',
          status: 'PENDING',
          bankAccountId: seller.bankDetails.id,
          metadata: {
            accountNumber: maskAccountNumber(seller.bankDetails.accountNumber),
            ifscCode: seller.bankDetails.ifscCode,
            accountHolderName: seller.bankDetails.accountHolderName,
          },
        },
      });

      // Link commission records to payout
      if (recordIds.length > 0) {
        await tx.commissionRecord.updateMany({
          where: {
            id: { in: recordIds },
            sellerId,
            status: 'PENDING',
          },
          data: {
            payoutRequestId: payoutRequest.id,
            status: 'PROCESSING',
          },
        });
      }

      return payoutRequest;
    });

    logger.info('Payout request created', { payoutNumber, sellerId, amount: payoutAmount });

    return payout;
  } catch (error) {
    logger.error('Create payout request error', { error: error.message, sellerId });
    throw error;
  }
};

/**
 * Process a payout (Admin/System)
 * @param {string} payoutId - Payout request ID
 * @param {string} processedBy - Admin user ID
 * @param {Object} result - Processing result
 * @returns {Promise<Object>} Updated payout
 */
exports.processPayout = async (payoutId, processedBy, result) => {
  try {
    const { success, transactionId, failureReason = null } = result;

    const payout = await prisma.payoutRequest.findUnique({
      where: { id: payoutId },
    });

    if (!payout) {
      throw new NotFoundError('Payout request not found');
    }

    if (payout.status !== 'PENDING' && payout.status !== 'PROCESSING') {
      throw new BadRequestError('Payout already processed');
    }

    const updatedPayout = await prisma.$transaction(async (tx) => {
      // Update payout status
      const updated = await tx.payoutRequest.update({
        where: { id: payoutId },
        data: {
          status: success ? 'COMPLETED' : 'FAILED',
          transactionId,
          failureReason,
          processedAt: new Date(),
          processedBy,
        },
      });

      // Update commission records
      await tx.commissionRecord.updateMany({
        where: { payoutRequestId: payoutId },
        data: {
          status: success ? 'PAID' : 'PENDING',
          paidAt: success ? new Date() : null,
        },
      });

      // If failed, unlink records from payout
      if (!success) {
        await tx.commissionRecord.updateMany({
          where: { payoutRequestId: payoutId },
          data: { payoutRequestId: null },
        });
      }

      return updated;
    });

    logger.info('Payout processed', { payoutId, success, transactionId });

    return updatedPayout;
  } catch (error) {
    logger.error('Process payout error', { error: error.message, payoutId });
    throw error;
  }
};

/**
 * Get payout history for a seller
 * @param {string} sellerId - Seller business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Payout history
 */
exports.getPayoutHistory = async (sellerId, options = {}) => {
  const { page = 1, limit = 20, status = null } = options;
  const skip = (page - 1) * limit;

  const where = { sellerId };
  if (status) where.status = status;

  const [payouts, total, summary] = await Promise.all([
    prisma.payoutRequest.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.payoutRequest.count({ where }),
    prisma.payoutRequest.aggregate({
      where: { sellerId, status: 'COMPLETED' },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  return {
    payouts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    summary: {
      totalPaidOut: summary._sum.amount || 0,
      completedPayouts: summary._count || 0,
    },
  };
};

// =============================================================================
// COMMISSION RATE MANAGEMENT (ADMIN)
// =============================================================================

/**
 * Set commission rate for a category
 * @param {string} categoryCode - Category code
 * @param {number} rate - Commission rate percentage
 * @param {string} setBy - Admin user ID
 * @returns {Promise<Object>} Commission rate
 */
exports.setCategoryCommissionRate = async (categoryCode, rate, setBy) => {
  if (rate < 0 || rate > 50) {
    throw new BadRequestError('Commission rate must be between 0 and 50%');
  }

  const commissionRate = await prisma.commissionRate.upsert({
    where: { categoryCode },
    update: {
      rate,
      updatedBy: setBy,
      updatedAt: new Date(),
    },
    create: {
      categoryCode,
      rate,
      isActive: true,
      createdBy: setBy,
    },
  });

  logger.info('Category commission rate set', { categoryCode, rate, setBy });

  return commissionRate;
};

/**
 * Set seller-specific commission override
 * @param {string} sellerId - Seller business ID
 * @param {Object} override - Override details
 * @param {string} setBy - Admin user ID
 * @returns {Promise<Object>} Commission override
 */
exports.setSellerCommissionOverride = async (sellerId, override, setBy) => {
  const { categoryCode = 'DEFAULT', rate, validUntil = null, reason } = override;

  if (rate < 0 || rate > 50) {
    throw new BadRequestError('Commission rate must be between 0 and 50%');
  }

  const commissionOverride = await prisma.commissionOverride.create({
    data: {
      businessId: sellerId,
      categoryCode,
      rate,
      validUntil: validUntil ? new Date(validUntil) : null,
      reason,
      isActive: true,
      createdBy: setBy,
    },
  });

  logger.info('Seller commission override set', { sellerId, categoryCode, rate, setBy });

  return commissionOverride;
};

/**
 * Get all commission rates
 * @returns {Promise<Object>} Commission rates
 */
exports.getAllCommissionRates = async () => {
  const [categoryRates, sellerOverrides] = await Promise.all([
    prisma.commissionRate.findMany({
      where: { isActive: true },
      orderBy: { categoryCode: 'asc' },
    }),
    prisma.commissionOverride.findMany({
      where: { isActive: true },
      include: {
        business: {
          select: { businessName: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);

  return {
    defaultRates: DEFAULT_COMMISSION_RATES,
    categoryRates,
    sellerOverrides,
    paymentFees: PAYMENT_FEES,
    tiers: COMMISSION_TIERS,
  };
};

// =============================================================================
// PLATFORM REVENUE ANALYTICS
// =============================================================================

/**
 * Get platform revenue analytics
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Revenue analytics
 */
exports.getPlatformRevenue = async (options = {}) => {
  const { startDate, endDate, groupBy = 'day' } = options;

  const dateFilter = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);

  const [
    totalRevenue,
    revenueByType,
    topSellers,
    dailyRevenue,
  ] = await Promise.all([
    // Total revenue
    prisma.commissionRecord.aggregate({
      where: {
        status: { in: ['PENDING', 'PAID'] },
        ...(Object.keys(dateFilter).length && { createdAt: dateFilter }),
      },
      _sum: {
        commissionAmount: true,
        commissionGst: true,
        paymentFee: true,
        paymentFeeGst: true,
        totalPlatformFees: true,
      },
      _count: true,
    }),

    // Revenue by type
    prisma.commissionRecord.groupBy({
      by: ['status'],
      where: {
        ...(Object.keys(dateFilter).length && { createdAt: dateFilter }),
      },
      _sum: {
        totalPlatformFees: true,
      },
      _count: true,
    }),

    // Top revenue-generating sellers
    prisma.commissionRecord.groupBy({
      by: ['sellerId'],
      where: {
        status: { in: ['PENDING', 'PAID'] },
        ...(Object.keys(dateFilter).length && { createdAt: dateFilter }),
      },
      _sum: {
        totalPlatformFees: true,
        orderAmount: true,
      },
      orderBy: {
        _sum: { totalPlatformFees: 'desc' },
      },
      take: 10,
    }),

    // Daily revenue trend
    prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        SUM(total_platform_fees) as revenue,
        COUNT(*) as transactions
      FROM commission_records
      WHERE created_at >= ${new Date(startDate || Date.now() - 30 * 24 * 60 * 60 * 1000)}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `,
  ]);

  return {
    summary: {
      totalCommission: totalRevenue._sum.commissionAmount || 0,
      totalGst: (totalRevenue._sum.commissionGst || 0) + (totalRevenue._sum.paymentFeeGst || 0),
      totalPaymentFees: totalRevenue._sum.paymentFee || 0,
      totalRevenue: totalRevenue._sum.totalPlatformFees || 0,
      totalTransactions: totalRevenue._count || 0,
    },
    byStatus: revenueByType,
    topSellers,
    dailyTrend: dailyRevenue,
  };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generatePayoutNumber() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `PO${year}${month}-${random}`;
}

function maskAccountNumber(accountNumber) {
  if (!accountNumber || accountNumber.length < 4) return '****';
  return '****' + accountNumber.slice(-4);
}

function getNextSettlementDate() {
  const now = new Date();
  // Settlement on every Tuesday and Friday
  const daysUntilTuesday = (2 - now.getDay() + 7) % 7 || 7;
  const daysUntilFriday = (5 - now.getDay() + 7) % 7 || 7;
  const nextDay = Math.min(daysUntilTuesday, daysUntilFriday);
  
  const nextDate = new Date(now);
  nextDate.setDate(nextDate.getDate() + nextDay);
  nextDate.setHours(10, 0, 0, 0);
  
  return nextDate;
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  DEFAULT_COMMISSION_RATES,
  COMMISSION_TIERS,
  FEE_TYPES,
  PAYMENT_FEES,
};



