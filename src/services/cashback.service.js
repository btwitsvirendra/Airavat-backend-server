// =============================================================================
// AIRAVAT B2B MARKETPLACE - CASHBACK SERVICE
// Loyalty cashback program for buyers
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const { eventEmitter } = require('./eventEmitter.service');

/**
 * Cashback Configuration
 */
const CASHBACK_CONFIG = {
  defaultCashbackRate: 1, // 1% default
  maxCashbackRate: 10, // 10% maximum
  minOrderAmount: 500, // Minimum order for cashback
  defaultExpiry: 90, // Days until cashback expires
  approvalDelayDays: 7, // Days after order delivery to approve
  cachePrefix: 'cashback:',
  cacheTTL: 3600, // 1 hour
};

class CashbackService {
  // ===========================================================================
  // CASHBACK PROGRAM MANAGEMENT
  // ===========================================================================

  /**
   * Create cashback program
   */
  async createProgram(programData) {
    const {
      name,
      description,
      type,
      value,
      maxCashback,
      minPurchase,
      startDate,
      endDate,
      applicableCategories = [],
      applicableSellers = [],
      applicableProducts = [],
      userTiers = [],
      maxUsagePerUser,
      totalBudget,
    } = programData;

    // Validate value
    if (type === 'PERCENTAGE' && value > CASHBACK_CONFIG.maxCashbackRate) {
      throw new Error(`Maximum cashback rate is ${CASHBACK_CONFIG.maxCashbackRate}%`);
    }

    const program = await prisma.cashbackProgram.create({
      data: {
        name,
        description,
        type,
        value,
        maxCashback,
        minPurchase: minPurchase || CASHBACK_CONFIG.minOrderAmount,
        startDate: new Date(startDate),
        endDate: new Date(endDate),
        applicableCategories,
        applicableSellers,
        applicableProducts,
        userTiers,
        maxUsagePerUser,
        totalBudget,
        usedBudget: 0,
        isActive: true,
      },
    });

    logger.info('Cashback program created', {
      programId: program.id,
      name,
      type,
      value,
    });

    return program;
  }

  /**
   * Update cashback program
   */
  async updateProgram(programId, updates) {
    const program = await prisma.cashbackProgram.update({
      where: { id: programId },
      data: updates,
    });

    // Clear cache
    await this.clearProgramCache(programId);

    logger.info('Cashback program updated', { programId });

    return program;
  }

  /**
   * Deactivate program
   */
  async deactivateProgram(programId) {
    const program = await prisma.cashbackProgram.update({
      where: { id: programId },
      data: { isActive: false },
    });

    await this.clearProgramCache(programId);

    logger.info('Cashback program deactivated', { programId });

    return program;
  }

  /**
   * Get program by ID
   */
  async getProgram(programId) {
    const cacheKey = `${CASHBACK_CONFIG.cachePrefix}program:${programId}`;
    
    const cached = await cache.get(cacheKey);
    if (cached) return JSON.parse(cached);

    const program = await prisma.cashbackProgram.findUnique({
      where: { id: programId },
    });

    if (program) {
      await cache.set(cacheKey, JSON.stringify(program), CASHBACK_CONFIG.cacheTTL);
    }

    return program;
  }

  /**
   * Get active programs
   */
  async getActivePrograms(filters = {}) {
    const { categoryId, sellerId, productId, userTier, page = 1, limit = 10 } = filters;

    const now = new Date();

    const where = {
      isActive: true,
      startDate: { lte: now },
      endDate: { gte: now },
    };

    // Apply filters
    if (categoryId) {
      where.OR = [
        { applicableCategories: { isEmpty: true } },
        { applicableCategories: { has: categoryId } },
      ];
    }

    if (sellerId) {
      where.OR = [
        ...(where.OR || []),
        { applicableSellers: { isEmpty: true } },
        { applicableSellers: { has: sellerId } },
      ];
    }

    if (userTier) {
      where.OR = [
        ...(where.OR || []),
        { userTiers: { isEmpty: true } },
        { userTiers: { has: userTier } },
      ];
    }

    const [programs, total] = await Promise.all([
      prisma.cashbackProgram.findMany({
        where,
        orderBy: { value: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.cashbackProgram.count({ where }),
    ]);

    return {
      programs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // ===========================================================================
  // CASHBACK CALCULATION
  // ===========================================================================

  /**
   * Calculate cashback for an order
   */
  async calculateCashback(userId, orderDetails) {
    const { orderAmount, categoryId, sellerId, products } = orderDetails;

    // Check minimum order amount
    if (orderAmount < CASHBACK_CONFIG.minOrderAmount) {
      return {
        eligible: false,
        reason: `Minimum order amount is ₹${CASHBACK_CONFIG.minOrderAmount}`,
        cashbackAmount: 0,
      };
    }

    // Get user tier
    const userTier = await this.getUserTier(userId);

    // Find applicable programs
    const now = new Date();
    const applicablePrograms = await prisma.cashbackProgram.findMany({
      where: {
        isActive: true,
        startDate: { lte: now },
        endDate: { gte: now },
        minPurchase: { lte: orderAmount },
        OR: [
          { totalBudget: null },
          { totalBudget: { gt: prisma.cashbackProgram.fields.usedBudget } },
        ],
      },
    });

    let bestProgram = null;
    let maxCashback = 0;

    for (const program of applicablePrograms) {
      // Check category eligibility
      if (program.applicableCategories.length > 0 && 
          !program.applicableCategories.includes(categoryId)) {
        continue;
      }

      // Check seller eligibility
      if (program.applicableSellers.length > 0 && 
          !program.applicableSellers.includes(sellerId)) {
        continue;
      }

      // Check user tier eligibility
      if (program.userTiers.length > 0 && 
          !program.userTiers.includes(userTier)) {
        continue;
      }

      // Check usage limit
      if (program.maxUsagePerUser) {
        const userUsage = await prisma.cashbackReward.count({
          where: {
            userId,
            programId: program.id,
            status: { not: 'CANCELLED' },
          },
        });

        if (userUsage >= program.maxUsagePerUser) {
          continue;
        }
      }

      // Calculate cashback amount
      let cashbackAmount;
      if (program.type === 'PERCENTAGE') {
        cashbackAmount = (orderAmount * parseFloat(program.value)) / 100;
      } else if (program.type === 'FIXED') {
        cashbackAmount = parseFloat(program.value);
      } else if (program.type === 'TIERED') {
        // Tiered cashback based on order amount
        cashbackAmount = this.calculateTieredCashback(orderAmount, program);
      }

      // Apply max cap
      if (program.maxCashback && cashbackAmount > parseFloat(program.maxCashback)) {
        cashbackAmount = parseFloat(program.maxCashback);
      }

      // Check budget
      if (program.totalBudget) {
        const remainingBudget = parseFloat(program.totalBudget) - parseFloat(program.usedBudget);
        if (cashbackAmount > remainingBudget) {
          cashbackAmount = remainingBudget;
        }
      }

      if (cashbackAmount > maxCashback) {
        maxCashback = cashbackAmount;
        bestProgram = program;
      }
    }

    if (!bestProgram) {
      // Apply default cashback if no program matches
      maxCashback = (orderAmount * CASHBACK_CONFIG.defaultCashbackRate) / 100;
      
      return {
        eligible: true,
        program: null,
        cashbackAmount: Math.round(maxCashback * 100) / 100,
        isDefault: true,
      };
    }

    return {
      eligible: true,
      program: {
        id: bestProgram.id,
        name: bestProgram.name,
        type: bestProgram.type,
        value: parseFloat(bestProgram.value),
      },
      cashbackAmount: Math.round(maxCashback * 100) / 100,
      isDefault: false,
    };
  }

  /**
   * Calculate tiered cashback
   */
  calculateTieredCashback(orderAmount, program) {
    // Tiered structure stored in program.metadata or derived from value
    const tiers = [
      { min: 0, max: 5000, rate: 1 },
      { min: 5000, max: 20000, rate: 2 },
      { min: 20000, max: 50000, rate: 3 },
      { min: 50000, max: Infinity, rate: 5 },
    ];

    for (const tier of tiers) {
      if (orderAmount >= tier.min && orderAmount < tier.max) {
        return (orderAmount * tier.rate) / 100;
      }
    }

    return 0;
  }

  // ===========================================================================
  // CASHBACK REWARDS
  // ===========================================================================

  /**
   * Create cashback reward (called after order)
   */
  async createReward(userId, orderId, programId = null) {
    // Get order details
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: {
          include: { product: true },
        },
      },
    });

    if (!order) throw new Error('Order not found');
    if (order.buyerId !== userId) throw new Error('Unauthorized');

    // Check if reward already exists
    const existingReward = await prisma.cashbackReward.findFirst({
      where: { userId, orderId },
    });

    if (existingReward) {
      throw new Error('Cashback reward already created for this order');
    }

    // Calculate cashback
    const calculation = await this.calculateCashback(userId, {
      orderAmount: parseFloat(order.totalAmount),
      categoryId: order.items[0]?.product?.categoryId,
      sellerId: order.sellerId,
      products: order.items.map(i => i.productId),
    });

    if (!calculation.eligible || calculation.cashbackAmount === 0) {
      return null;
    }

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + CASHBACK_CONFIG.defaultExpiry);

    const reward = await prisma.cashbackReward.create({
      data: {
        userId,
        programId: calculation.program?.id || null,
        orderId,
        orderAmount: order.totalAmount,
        cashbackAmount: calculation.cashbackAmount,
        status: 'PENDING',
        expiresAt,
      },
    });

    // Update program used budget
    if (calculation.program?.id) {
      await prisma.cashbackProgram.update({
        where: { id: calculation.program.id },
        data: {
          usedBudget: { increment: calculation.cashbackAmount },
        },
      });
    }

    logger.info('Cashback reward created', {
      rewardId: reward.id,
      userId,
      orderId,
      cashbackAmount: calculation.cashbackAmount,
    });

    return reward;
  }

  /**
   * Approve cashback reward (after order delivered)
   */
  async approveReward(rewardId) {
    const reward = await prisma.cashbackReward.findUnique({
      where: { id: rewardId },
    });

    if (!reward) throw new Error('Reward not found');
    if (reward.status !== 'PENDING') throw new Error('Reward is not pending');

    // Check if order is delivered
    const order = await prisma.order.findUnique({
      where: { id: reward.orderId },
    });

    if (order.status !== 'DELIVERED') {
      throw new Error('Order must be delivered to approve cashback');
    }

    const updatedReward = await prisma.cashbackReward.update({
      where: { id: rewardId },
      data: { status: 'APPROVED' },
    });

    logger.info('Cashback reward approved', { rewardId });

    return updatedReward;
  }

  /**
   * Credit cashback to wallet
   */
  async creditReward(rewardId) {
    const reward = await prisma.cashbackReward.findUnique({
      where: { id: rewardId },
    });

    if (!reward) throw new Error('Reward not found');
    if (reward.status !== 'APPROVED') throw new Error('Reward must be approved first');
    if (reward.expiresAt && reward.expiresAt < new Date()) {
      await prisma.cashbackReward.update({
        where: { id: rewardId },
        data: { status: 'EXPIRED' },
      });
      throw new Error('Reward has expired');
    }

    // Get user wallet
    const walletService = require('./wallet.service');
    const wallet = await walletService.getUserWallet(reward.userId);

    if (!wallet) {
      // Create wallet if doesn't exist
      const user = await prisma.user.findUnique({ where: { id: reward.userId } });
      await walletService.createWallet(reward.userId);
    }

    const userWallet = await walletService.getUserWallet(reward.userId);

    // Credit to wallet
    await walletService.credit(userWallet.id, parseFloat(reward.cashbackAmount), {
      referenceType: 'CASHBACK',
      referenceId: rewardId,
      description: `Cashback for order`,
    });

    const updatedReward = await prisma.cashbackReward.update({
      where: { id: rewardId },
      data: {
        status: 'CREDITED',
        walletId: userWallet.id,
        creditedAt: new Date(),
      },
    });

    logger.info('Cashback credited to wallet', {
      rewardId,
      userId: reward.userId,
      amount: reward.cashbackAmount,
    });

    eventEmitter.emit('cashback.credited', {
      userId: reward.userId,
      rewardId,
      amount: reward.cashbackAmount,
    });

    return updatedReward;
  }

  /**
   * Cancel cashback reward
   */
  async cancelReward(rewardId, reason) {
    const reward = await prisma.cashbackReward.findUnique({
      where: { id: rewardId },
    });

    if (!reward) throw new Error('Reward not found');
    if (reward.status === 'CREDITED') {
      throw new Error('Cannot cancel credited reward');
    }

    // Restore program budget
    if (reward.programId) {
      await prisma.cashbackProgram.update({
        where: { id: reward.programId },
        data: {
          usedBudget: { decrement: reward.cashbackAmount },
        },
      });
    }

    const updatedReward = await prisma.cashbackReward.update({
      where: { id: rewardId },
      data: { status: 'CANCELLED' },
    });

    logger.info('Cashback reward cancelled', { rewardId, reason });

    return updatedReward;
  }

  /**
   * Process pending rewards (scheduled job)
   */
  async processPendingRewards() {
    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - CASHBACK_CONFIG.approvalDelayDays);

    // Find rewards for delivered orders past the delay period
    const pendingRewards = await prisma.cashbackReward.findMany({
      where: {
        status: 'PENDING',
        createdAt: { lte: cutoffDate },
      },
      include: {
        order: true,
      },
    });

    let approved = 0;
    let cancelled = 0;

    for (const reward of pendingRewards) {
      if (reward.order?.status === 'DELIVERED') {
        await this.approveReward(reward.id);
        await this.creditReward(reward.id);
        approved++;
      } else if (['CANCELLED', 'REFUNDED'].includes(reward.order?.status)) {
        await this.cancelReward(reward.id, 'Order cancelled/refunded');
        cancelled++;
      }
    }

    logger.info('Processed pending cashback rewards', { approved, cancelled });

    return { approved, cancelled };
  }

  /**
   * Expire old rewards (scheduled job)
   */
  async expireOldRewards() {
    const result = await prisma.cashbackReward.updateMany({
      where: {
        status: { in: ['PENDING', 'APPROVED'] },
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });

    if (result.count > 0) {
      logger.info('Expired old cashback rewards', { count: result.count });
    }

    return result.count;
  }

  // ===========================================================================
  // USER QUERIES
  // ===========================================================================

  /**
   * Get user's cashback rewards
   */
  async getUserRewards(userId, options = {}) {
    const { status, page = 1, limit = 10 } = options;

    const where = { userId };
    if (status) where.status = status;

    const [rewards, total] = await Promise.all([
      prisma.cashbackReward.findMany({
        where,
        include: {
          program: {
            select: { name: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.cashbackReward.count({ where }),
    ]);

    return {
      rewards,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get user cashback summary
   */
  async getUserCashbackSummary(userId) {
    const [total, pending, credited, expired] = await Promise.all([
      prisma.cashbackReward.aggregate({
        where: { userId },
        _sum: { cashbackAmount: true },
        _count: true,
      }),
      prisma.cashbackReward.aggregate({
        where: { userId, status: { in: ['PENDING', 'APPROVED'] } },
        _sum: { cashbackAmount: true },
      }),
      prisma.cashbackReward.aggregate({
        where: { userId, status: 'CREDITED' },
        _sum: { cashbackAmount: true },
      }),
      prisma.cashbackReward.aggregate({
        where: { userId, status: 'EXPIRED' },
        _sum: { cashbackAmount: true },
      }),
    ]);

    return {
      totalEarned: parseFloat(total._sum.cashbackAmount || 0),
      totalRewards: total._count,
      pending: parseFloat(pending._sum.cashbackAmount || 0),
      credited: parseFloat(credited._sum.cashbackAmount || 0),
      expired: parseFloat(expired._sum.cashbackAmount || 0),
    };
  }

  /**
   * Get user tier
   */
  async getUserTier(userId) {
    // Calculate tier based on purchase history
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 6);

    const orderStats = await prisma.order.aggregate({
      where: {
        buyerId: userId,
        status: 'DELIVERED',
        createdAt: { gte: sixMonthsAgo },
      },
      _sum: { totalAmount: true },
      _count: true,
    });

    const totalSpent = parseFloat(orderStats._sum.totalAmount || 0);

    if (totalSpent >= 1000000) return 'PLATINUM';
    if (totalSpent >= 500000) return 'GOLD';
    if (totalSpent >= 100000) return 'SILVER';
    return 'BRONZE';
  }

  // ===========================================================================
  // UTILITIES
  // ===========================================================================

  /**
   * Clear program cache
   */
  async clearProgramCache(programId) {
    const cacheKey = `${CASHBACK_CONFIG.cachePrefix}program:${programId}`;
    await cache.del(cacheKey);
  }
}

module.exports = new CashbackService();
