// =============================================================================
// AIRAVAT B2B MARKETPLACE - VIRTUAL CARD SERVICE TESTS
// =============================================================================

const virtualCardService = require('../../services/virtualCard.service');
const { prisma } = require('../../config/database');

// Mock dependencies
jest.mock('../../config/database', () => ({
  prisma: {
    virtualCard: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    cardTransaction: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      aggregate: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    wallet: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock('crypto', () => ({
  randomBytes: jest.fn(() => ({
    toString: jest.fn(() => 'random123'),
  })),
  createHash: jest.fn(() => ({
    update: jest.fn(() => ({
      digest: jest.fn(() => 'hashed_value'),
    })),
  })),
}));

describe('Virtual Card Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createCard', () => {
    it('should create a new virtual card', async () => {
      const mockWallet = {
        id: 'wallet_123',
        balance: 100000,
        status: 'ACTIVE',
      };

      const mockCard = {
        id: 'card_123',
        cardNumber: '4000XXXXXXXX1234',
        last4: '1234',
        status: 'ACTIVE',
        cardLimit: 50000,
        spentAmount: 0,
        currency: 'INR',
      };

      prisma.wallet.findUnique.mockResolvedValue(mockWallet);
      prisma.virtualCard.count.mockResolvedValue(2);
      prisma.virtualCard.create.mockResolvedValue(mockCard);

      const result = await virtualCardService.createCard('user_123', {
        cardholderName: 'John Doe',
        cardLimit: 50000,
        currency: 'INR',
      });

      expect(result.last4).toBe('1234');
      expect(result.status).toBe('ACTIVE');
      expect(prisma.virtualCard.create).toHaveBeenCalled();
    });

    it('should throw error if max cards reached', async () => {
      prisma.wallet.findUnique.mockResolvedValue({ id: 'wallet_123' });
      prisma.virtualCard.count.mockResolvedValue(10); // Max limit

      await expect(virtualCardService.createCard('user_123', {
        cardholderName: 'John Doe',
        cardLimit: 50000,
      })).rejects.toThrow('Maximum card limit reached');
    });

    it('should throw error if card limit exceeds wallet balance', async () => {
      prisma.wallet.findUnique.mockResolvedValue({
        id: 'wallet_123',
        balance: 10000,
      });
      prisma.virtualCard.count.mockResolvedValue(0);

      await expect(virtualCardService.createCard('user_123', {
        cardholderName: 'John Doe',
        cardLimit: 50000,
      })).rejects.toThrow('Insufficient wallet balance');
    });
  });

  describe('getCardDetails', () => {
    it('should return masked card details by default', async () => {
      const mockCard = {
        id: 'card_123',
        cardNumber: '4000123456781234',
        cvv: '123',
        last4: '1234',
        status: 'ACTIVE',
        userId: 'user_123',
      };

      prisma.virtualCard.findUnique.mockResolvedValue(mockCard);

      const result = await virtualCardService.getCardDetails('card_123', 'user_123', false);

      expect(result.cardNumber).toBe('4000XXXXXXXX1234');
      expect(result.cvv).toBeUndefined();
    });

    it('should return full card details when requested', async () => {
      const mockCard = {
        id: 'card_123',
        cardNumber: '4000123456781234',
        cvv: '123',
        last4: '1234',
        status: 'ACTIVE',
        userId: 'user_123',
      };

      prisma.virtualCard.findUnique.mockResolvedValue(mockCard);

      const result = await virtualCardService.getCardDetails('card_123', 'user_123', true);

      expect(result.cardNumber).toBe('4000123456781234');
      expect(result.cvv).toBe('123');
    });

    it('should throw error if card belongs to different user', async () => {
      prisma.virtualCard.findUnique.mockResolvedValue({
        id: 'card_123',
        userId: 'other_user',
      });

      await expect(virtualCardService.getCardDetails('card_123', 'user_123'))
        .rejects.toThrow('Card not found');
    });
  });

  describe('authorizeTransaction', () => {
    it('should authorize valid transaction', async () => {
      const mockCard = {
        id: 'card_123',
        cardToken: 'token_123',
        status: 'ACTIVE',
        cardLimit: 100000,
        spentAmount: 20000,
        dailyLimit: 50000,
        singleTxnLimit: 25000,
        allowOnline: true,
        allowInternational: true,
        allowedCategories: [],
        blockedMerchants: [],
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        wallet: {
          id: 'wallet_123',
          balance: 200000,
        },
      };

      prisma.virtualCard.findFirst.mockResolvedValue(mockCard);
      prisma.cardTransaction.aggregate.mockResolvedValue({ _sum: { amount: 10000 } });

      const result = await virtualCardService.authorizeTransaction('token_123', {
        amount: 15000,
        currency: 'INR',
        merchantName: 'Test Store',
        merchantCategory: 'RETAIL',
      });

      expect(result.authorized).toBe(true);
      expect(result.authorizationCode).toBeDefined();
    });

    it('should decline if card is locked', async () => {
      prisma.virtualCard.findFirst.mockResolvedValue({
        id: 'card_123',
        status: 'LOCKED',
      });

      const result = await virtualCardService.authorizeTransaction('token_123', {
        amount: 1000,
      });

      expect(result.authorized).toBe(false);
      expect(result.reason).toBe('CARD_LOCKED');
    });

    it('should decline if exceeds single transaction limit', async () => {
      const mockCard = {
        id: 'card_123',
        status: 'ACTIVE',
        singleTxnLimit: 10000,
        cardLimit: 100000,
        spentAmount: 0,
        dailyLimit: 50000,
        allowOnline: true,
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        wallet: { balance: 100000 },
      };

      prisma.virtualCard.findFirst.mockResolvedValue(mockCard);
      prisma.cardTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const result = await virtualCardService.authorizeTransaction('token_123', {
        amount: 15000, // Exceeds 10000 limit
      });

      expect(result.authorized).toBe(false);
      expect(result.reason).toBe('EXCEEDS_SINGLE_TXN_LIMIT');
    });

    it('should decline if exceeds daily limit', async () => {
      const mockCard = {
        id: 'card_123',
        status: 'ACTIVE',
        singleTxnLimit: 50000,
        cardLimit: 100000,
        spentAmount: 0,
        dailyLimit: 20000,
        allowOnline: true,
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        wallet: { balance: 100000 },
      };

      prisma.virtualCard.findFirst.mockResolvedValue(mockCard);
      prisma.cardTransaction.aggregate.mockResolvedValue({ _sum: { amount: 15000 } });

      const result = await virtualCardService.authorizeTransaction('token_123', {
        amount: 10000, // Would total 25000, exceeding 20000 daily limit
      });

      expect(result.authorized).toBe(false);
      expect(result.reason).toBe('EXCEEDS_DAILY_LIMIT');
    });

    it('should decline blocked merchant', async () => {
      const mockCard = {
        id: 'card_123',
        status: 'ACTIVE',
        singleTxnLimit: 50000,
        cardLimit: 100000,
        spentAmount: 0,
        dailyLimit: 50000,
        allowOnline: true,
        blockedMerchants: ['BLOCKED_MERCHANT'],
        validUntil: new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
        wallet: { balance: 100000 },
      };

      prisma.virtualCard.findFirst.mockResolvedValue(mockCard);
      prisma.cardTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const result = await virtualCardService.authorizeTransaction('token_123', {
        amount: 1000,
        merchantId: 'BLOCKED_MERCHANT',
      });

      expect(result.authorized).toBe(false);
      expect(result.reason).toBe('MERCHANT_BLOCKED');
    });
  });

  describe('settleTransaction', () => {
    it('should settle authorized transaction', async () => {
      const mockTransaction = {
        id: 'txn_123',
        cardId: 'card_123',
        amount: 5000,
        status: 'AUTHORIZED',
        card: {
          id: 'card_123',
          walletId: 'wallet_123',
        },
      };

      prisma.cardTransaction.findUnique.mockResolvedValue(mockTransaction);
      prisma.cardTransaction.update.mockResolvedValue({
        ...mockTransaction,
        status: 'SETTLED',
      });
      prisma.virtualCard.update.mockResolvedValue({});
      prisma.wallet.update.mockResolvedValue({});

      const result = await virtualCardService.settleTransaction('txn_123', 5000);

      expect(result.status).toBe('SETTLED');
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet_123' },
        data: { balance: { decrement: 5000 } },
      });
    });

    it('should handle partial settlement', async () => {
      const mockTransaction = {
        id: 'txn_123',
        cardId: 'card_123',
        amount: 5000,
        status: 'AUTHORIZED',
        card: {
          id: 'card_123',
          walletId: 'wallet_123',
        },
      };

      prisma.cardTransaction.findUnique.mockResolvedValue(mockTransaction);
      prisma.cardTransaction.update.mockResolvedValue({
        ...mockTransaction,
        status: 'SETTLED',
        settledAmount: 4000,
      });
      prisma.virtualCard.update.mockResolvedValue({});
      prisma.wallet.update.mockResolvedValue({});

      const result = await virtualCardService.settleTransaction('txn_123', 4000);

      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet_123' },
        data: { balance: { decrement: 4000 } },
      });
    });
  });

  describe('reverseTransaction', () => {
    it('should reverse settled transaction', async () => {
      const mockTransaction = {
        id: 'txn_123',
        cardId: 'card_123',
        amount: 5000,
        settledAmount: 5000,
        status: 'SETTLED',
        card: {
          id: 'card_123',
          walletId: 'wallet_123',
          spentAmount: 10000,
        },
      };

      prisma.cardTransaction.findUnique.mockResolvedValue(mockTransaction);
      prisma.cardTransaction.update.mockResolvedValue({
        ...mockTransaction,
        status: 'REVERSED',
      });
      prisma.virtualCard.update.mockResolvedValue({});
      prisma.wallet.update.mockResolvedValue({});

      const result = await virtualCardService.reverseTransaction('txn_123', 'Merchant refund');

      expect(result.status).toBe('REVERSED');
      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet_123' },
        data: { balance: { increment: 5000 } },
      });
    });
  });

  describe('lockCard', () => {
    it('should lock active card', async () => {
      const mockCard = {
        id: 'card_123',
        userId: 'user_123',
        status: 'ACTIVE',
      };

      prisma.virtualCard.findUnique.mockResolvedValue(mockCard);
      prisma.virtualCard.update.mockResolvedValue({
        ...mockCard,
        status: 'LOCKED',
      });

      const result = await virtualCardService.lockCard('card_123', 'user_123', 'Lost card');

      expect(result.status).toBe('LOCKED');
    });
  });

  describe('unlockCard', () => {
    it('should unlock locked card', async () => {
      const mockCard = {
        id: 'card_123',
        userId: 'user_123',
        status: 'LOCKED',
      };

      prisma.virtualCard.findUnique.mockResolvedValue(mockCard);
      prisma.virtualCard.update.mockResolvedValue({
        ...mockCard,
        status: 'ACTIVE',
      });

      const result = await virtualCardService.unlockCard('card_123', 'user_123');

      expect(result.status).toBe('ACTIVE');
    });
  });

  describe('getSpendingSummary', () => {
    it('should return spending breakdown by category', async () => {
      const mockCard = {
        id: 'card_123',
        userId: 'user_123',
        cardLimit: 100000,
        spentAmount: 35000,
      };

      prisma.virtualCard.findUnique.mockResolvedValue(mockCard);
      prisma.cardTransaction.groupBy.mockResolvedValue([
        { merchantCategory: 'RETAIL', _sum: { amount: 15000 }, _count: 5 },
        { merchantCategory: 'FOOD', _sum: { amount: 10000 }, _count: 8 },
        { merchantCategory: 'TRAVEL', _sum: { amount: 10000 }, _count: 2 },
      ]);
      prisma.cardTransaction.aggregate.mockResolvedValue({
        _sum: { amount: 35000 },
        _count: 15,
      });

      const result = await virtualCardService.getSpendingSummary('card_123', 'user_123', {
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(),
      });

      expect(result.totalSpent).toBe(35000);
      expect(result.transactionCount).toBe(15);
      expect(result.categoryBreakdown).toHaveLength(3);
      expect(result.remainingLimit).toBe(65000);
    });
  });

  describe('expireOldCards', () => {
    it('should expire cards past valid date', async () => {
      prisma.virtualCard.updateMany.mockResolvedValue({ count: 5 });

      const result = await virtualCardService.expireOldCards();

      expect(prisma.virtualCard.updateMany).toHaveBeenCalledWith({
        where: {
          status: { in: ['ACTIVE', 'LOCKED'] },
          validUntil: { lt: expect.any(Date) },
        },
        data: { status: 'EXPIRED' },
      });
      expect(result).toBe(5);
    });
  });
});
