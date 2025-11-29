// =============================================================================
// AIRAVAT B2B MARKETPLACE - CASHBACK SERVICE TESTS
// =============================================================================

const cashbackService = require('../../services/cashback.service');
const { prisma } = require('../../config/database');

// Mock dependencies
jest.mock('../../config/database', () => ({
  prisma: {
    cashbackProgram: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    cashbackReward: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
    },
    userCashbackTier: {
      findUnique: jest.fn(),
      upsert: jest.fn(),
    },
    order: {
      findUnique: jest.fn(),
    },
    user: {
      findUnique: jest.fn(),
    },
    wallet: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock('../../services/wallet.service', () => ({
  credit: jest.fn(),
}));

const walletService = require('../../services/wallet.service');

describe('Cashback Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createProgram', () => {
    it('should create a percentage-based cashback program', async () => {
      const mockProgram = {
        id: 'prog_123',
        name: 'Diwali Cashback',
        type: 'PERCENTAGE',
        value: 10,
        maxCashback: 500,
        minPurchase: 1000,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isActive: true,
      };

      prisma.cashbackProgram.create.mockResolvedValue(mockProgram);

      const result = await cashbackService.createProgram({
        name: 'Diwali Cashback',
        type: 'PERCENTAGE',
        value: 10,
        maxCashback: 500,
        minPurchase: 1000,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });

      expect(result.type).toBe('PERCENTAGE');
      expect(result.value).toBe(10);
      expect(result.isActive).toBe(true);
    });

    it('should create a flat cashback program', async () => {
      const mockProgram = {
        id: 'prog_124',
        name: 'Flat ₹100 Cashback',
        type: 'FLAT',
        value: 100,
        minPurchase: 500,
        isActive: true,
      };

      prisma.cashbackProgram.create.mockResolvedValue(mockProgram);

      const result = await cashbackService.createProgram({
        name: 'Flat ₹100 Cashback',
        type: 'FLAT',
        value: 100,
        minPurchase: 500,
      });

      expect(result.type).toBe('FLAT');
      expect(result.value).toBe(100);
    });

    it('should create a tiered cashback program', async () => {
      const mockProgram = {
        id: 'prog_125',
        type: 'TIERED',
        userTiers: {
          BRONZE: 2,
          SILVER: 3,
          GOLD: 5,
          PLATINUM: 8,
        },
      };

      prisma.cashbackProgram.create.mockResolvedValue(mockProgram);

      const result = await cashbackService.createProgram({
        type: 'TIERED',
        userTiers: {
          BRONZE: 2,
          SILVER: 3,
          GOLD: 5,
          PLATINUM: 8,
        },
      });

      expect(result.type).toBe('TIERED');
      expect(result.userTiers.PLATINUM).toBe(8);
    });
  });

  describe('calculateCashback', () => {
    it('should calculate percentage cashback', async () => {
      const mockProgram = {
        id: 'prog_123',
        type: 'PERCENTAGE',
        value: 10,
        maxCashback: 500,
        minPurchase: 1000,
        isActive: true,
        startDate: new Date(Date.now() - 1000),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      prisma.cashbackProgram.findMany.mockResolvedValue([mockProgram]);

      const result = await cashbackService.calculateCashback('user_123', 5000);

      expect(result.cashbackAmount).toBe(500); // 10% of 5000, capped at 500
      expect(result.programId).toBe('prog_123');
    });

    it('should cap cashback at maxCashback', async () => {
      const mockProgram = {
        id: 'prog_123',
        type: 'PERCENTAGE',
        value: 10,
        maxCashback: 200,
        minPurchase: 1000,
        isActive: true,
        startDate: new Date(Date.now() - 1000),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      prisma.cashbackProgram.findMany.mockResolvedValue([mockProgram]);

      const result = await cashbackService.calculateCashback('user_123', 5000);

      expect(result.cashbackAmount).toBe(200); // Capped at maxCashback
    });

    it('should return 0 if order below minPurchase', async () => {
      const mockProgram = {
        id: 'prog_123',
        type: 'PERCENTAGE',
        value: 10,
        minPurchase: 1000,
        isActive: true,
        startDate: new Date(Date.now() - 1000),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      prisma.cashbackProgram.findMany.mockResolvedValue([mockProgram]);

      const result = await cashbackService.calculateCashback('user_123', 500);

      expect(result.cashbackAmount).toBe(0);
    });

    it('should apply tiered cashback based on user tier', async () => {
      const mockProgram = {
        id: 'prog_123',
        type: 'TIERED',
        userTiers: {
          BRONZE: 2,
          SILVER: 3,
          GOLD: 5,
          PLATINUM: 8,
        },
        maxCashback: 1000,
        minPurchase: 500,
        isActive: true,
        startDate: new Date(Date.now() - 1000),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      prisma.cashbackProgram.findMany.mockResolvedValue([mockProgram]);
      prisma.userCashbackTier.findUnique.mockResolvedValue({ tier: 'GOLD' });

      const result = await cashbackService.calculateCashback('user_123', 10000);

      expect(result.cashbackAmount).toBe(500); // 5% for GOLD tier
    });

    it('should apply flat cashback', async () => {
      const mockProgram = {
        id: 'prog_123',
        type: 'FLAT',
        value: 100,
        minPurchase: 500,
        isActive: true,
        startDate: new Date(Date.now() - 1000),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      prisma.cashbackProgram.findMany.mockResolvedValue([mockProgram]);

      const result = await cashbackService.calculateCashback('user_123', 1000);

      expect(result.cashbackAmount).toBe(100);
    });
  });

  describe('awardCashback', () => {
    it('should create cashback reward for order', async () => {
      const mockOrder = {
        id: 'order_123',
        userId: 'user_123',
        totalAmount: 5000,
        status: 'DELIVERED',
      };

      const mockProgram = {
        id: 'prog_123',
        type: 'PERCENTAGE',
        value: 10,
        maxCashback: 500,
        minPurchase: 1000,
        isActive: true,
        totalBudget: 100000,
        usedBudget: 0,
        maxUsagePerUser: 5,
        startDate: new Date(Date.now() - 1000),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      const mockReward = {
        id: 'reward_123',
        userId: 'user_123',
        programId: 'prog_123',
        orderId: 'order_123',
        orderAmount: 5000,
        cashbackAmount: 500,
        status: 'PENDING',
        expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.cashbackProgram.findMany.mockResolvedValue([mockProgram]);
      prisma.cashbackReward.findFirst.mockResolvedValue(null); // No existing reward
      prisma.cashbackReward.count.mockResolvedValue(0); // User hasn't used max
      prisma.cashbackReward.create.mockResolvedValue(mockReward);
      prisma.cashbackProgram.update.mockResolvedValue(mockProgram);

      const result = await cashbackService.awardCashback('order_123');

      expect(result.cashbackAmount).toBe(500);
      expect(result.status).toBe('PENDING');
    });

    it('should skip if cashback already awarded', async () => {
      const mockOrder = {
        id: 'order_123',
        userId: 'user_123',
        totalAmount: 5000,
        status: 'DELIVERED',
      };

      prisma.order.findUnique.mockResolvedValue(mockOrder);
      prisma.cashbackReward.findFirst.mockResolvedValue({
        id: 'existing_reward',
      });

      await expect(cashbackService.awardCashback('order_123'))
        .rejects.toThrow('Cashback already awarded for this order');
    });

    it('should respect max usage per user', async () => {
      const mockProgram = {
        id: 'prog_123',
        maxUsagePerUser: 3,
        isActive: true,
        startDate: new Date(Date.now() - 1000),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      };

      prisma.order.findUnique.mockResolvedValue({
        id: 'order_123',
        userId: 'user_123',
        totalAmount: 5000,
        status: 'DELIVERED',
      });
      prisma.cashbackReward.findFirst.mockResolvedValue(null);
      prisma.cashbackProgram.findMany.mockResolvedValue([mockProgram]);
      prisma.cashbackReward.count.mockResolvedValue(3); // Max reached

      const result = await cashbackService.awardCashback('order_123');

      expect(result.cashbackAmount).toBe(0);
    });
  });

  describe('creditCashback', () => {
    it('should credit pending cashback to wallet', async () => {
      const mockReward = {
        id: 'reward_123',
        userId: 'user_123',
        cashbackAmount: 500,
        status: 'PENDING',
      };

      prisma.cashbackReward.findUnique.mockResolvedValue(mockReward);
      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      walletService.credit.mockResolvedValue({});
      prisma.cashbackReward.update.mockResolvedValue({
        ...mockReward,
        status: 'CREDITED',
        creditedAt: new Date(),
      });

      const result = await cashbackService.creditCashback('reward_123');

      expect(result.status).toBe('CREDITED');
      expect(walletService.credit).toHaveBeenCalledWith(
        'wallet_123',
        500,
        'INR',
        'CASHBACK',
        'reward_123',
        expect.any(String)
      );
    });

    it('should throw error if reward not pending', async () => {
      prisma.cashbackReward.findUnique.mockResolvedValue({
        id: 'reward_123',
        status: 'CREDITED',
      });

      await expect(cashbackService.creditCashback('reward_123'))
        .rejects.toThrow('Reward is not in pending status');
    });
  });

  describe('getUserCashbackSummary', () => {
    it('should return user cashback summary', async () => {
      prisma.cashbackReward.aggregate.mockResolvedValueOnce({
        _sum: { cashbackAmount: 2500 },
      }).mockResolvedValueOnce({
        _sum: { cashbackAmount: 2000 },
      }).mockResolvedValueOnce({
        _sum: { cashbackAmount: 500 },
      });

      prisma.cashbackReward.count.mockResolvedValueOnce(10); // total
      prisma.userCashbackTier.findUnique.mockResolvedValue({
        tier: 'SILVER',
        totalSpend: 50000,
        totalCashback: 2500,
      });

      const result = await cashbackService.getUserCashbackSummary('user_123');

      expect(result.totalEarned).toBe(2500);
      expect(result.totalCredited).toBe(2000);
      expect(result.pendingAmount).toBe(500);
      expect(result.tier).toBe('SILVER');
    });
  });

  describe('updateUserTier', () => {
    it('should upgrade user tier based on spend', async () => {
      prisma.cashbackReward.aggregate.mockResolvedValue({
        _sum: { orderAmount: 150000 },
      });

      prisma.userCashbackTier.upsert.mockResolvedValue({
        userId: 'user_123',
        tier: 'GOLD',
        totalSpend: 150000,
      });

      const result = await cashbackService.updateUserTier('user_123');

      expect(result.tier).toBe('GOLD');
    });

    it('should assign BRONZE for new users', async () => {
      prisma.cashbackReward.aggregate.mockResolvedValue({
        _sum: { orderAmount: null },
      });

      prisma.userCashbackTier.upsert.mockResolvedValue({
        userId: 'user_123',
        tier: 'BRONZE',
        totalSpend: 0,
      });

      const result = await cashbackService.updateUserTier('user_123');

      expect(result.tier).toBe('BRONZE');
    });

    it('should assign PLATINUM for high spenders', async () => {
      prisma.cashbackReward.aggregate.mockResolvedValue({
        _sum: { orderAmount: 1000000 },
      });

      prisma.userCashbackTier.upsert.mockResolvedValue({
        userId: 'user_123',
        tier: 'PLATINUM',
        totalSpend: 1000000,
      });

      const result = await cashbackService.updateUserTier('user_123');

      expect(result.tier).toBe('PLATINUM');
    });
  });

  describe('expireOldRewards', () => {
    it('should expire rewards past expiry date', async () => {
      prisma.cashbackReward.updateMany.mockResolvedValue({ count: 5 });

      const result = await cashbackService.expireOldRewards();

      expect(prisma.cashbackReward.updateMany).toHaveBeenCalledWith({
        where: {
          status: 'PENDING',
          expiryDate: { lt: expect.any(Date) },
        },
        data: {
          status: 'EXPIRED',
          expiredAt: expect.any(Date),
        },
      });
      expect(result).toBe(5);
    });
  });

  describe('getActivePrograms', () => {
    it('should return active programs', async () => {
      const mockPrograms = [
        {
          id: 'prog_1',
          name: 'Program 1',
          isActive: true,
          startDate: new Date(Date.now() - 1000),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
        {
          id: 'prog_2',
          name: 'Program 2',
          isActive: true,
          startDate: new Date(Date.now() - 1000),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      ];

      prisma.cashbackProgram.findMany.mockResolvedValue(mockPrograms);

      const result = await cashbackService.getActivePrograms();

      expect(result).toHaveLength(2);
    });

    it('should filter by category if provided', async () => {
      prisma.cashbackProgram.findMany.mockResolvedValue([]);

      await cashbackService.getActivePrograms({ category: 'ELECTRONICS' });

      expect(prisma.cashbackProgram.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            applicableCategories: { has: 'ELECTRONICS' },
          }),
        })
      );
    });
  });
});
