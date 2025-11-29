// =============================================================================
// AIRAVAT B2B MARKETPLACE - WALLET SERVICE TESTS
// =============================================================================

const walletService = require('../../services/wallet.service');
const { prisma } = require('../../config/database');

// Mock dependencies
jest.mock('../../config/database', () => ({
  prisma: {
    wallet: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    walletTransaction: {
      create: jest.fn(),
      findMany: jest.fn(),
      findUnique: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock('../../config/redis', () => ({
  cache: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
  },
}));

describe('Wallet Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createWallet', () => {
    it('should create a new wallet with default settings', async () => {
      const userId = 'user_123';
      const mockWallet = {
        id: 'wallet_123',
        userId,
        currency: 'INR',
        balance: 0,
        lockedBalance: 0,
        dailyLimit: 100000,
        monthlyLimit: 1000000,
        status: 'ACTIVE',
      };

      prisma.wallet.findFirst.mockResolvedValue(null);
      prisma.wallet.create.mockResolvedValue(mockWallet);

      const result = await walletService.createWallet(userId, {});

      expect(prisma.wallet.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId,
          currency: 'INR',
          balance: 0,
          status: 'ACTIVE',
        }),
      });
      expect(result.id).toBe('wallet_123');
    });

    it('should throw error if wallet already exists', async () => {
      const userId = 'user_123';
      const existingWallet = { id: 'wallet_existing', userId };

      prisma.wallet.findFirst.mockResolvedValue(existingWallet);

      await expect(walletService.createWallet(userId, {}))
        .rejects.toThrow('Wallet already exists');
    });
  });

  describe('getBalance', () => {
    it('should return wallet balance', async () => {
      const mockWallet = {
        id: 'wallet_123',
        balance: 10000,
        lockedBalance: 2000,
        currency: 'INR',
        currencyBalances: [],
      };

      prisma.wallet.findUnique.mockResolvedValue(mockWallet);

      const result = await walletService.getBalance('wallet_123');

      expect(result.balance).toBe(10000);
      expect(result.lockedBalance).toBe(2000);
      expect(result.availableBalance).toBe(8000);
    });

    it('should throw error if wallet not found', async () => {
      prisma.wallet.findUnique.mockResolvedValue(null);

      await expect(walletService.getBalance('nonexistent'))
        .rejects.toThrow('Wallet not found');
    });
  });

  describe('credit', () => {
    it('should credit wallet and record transaction', async () => {
      const mockWallet = {
        id: 'wallet_123',
        balance: 5000,
        lockedBalance: 0,
        currency: 'INR',
        status: 'ACTIVE',
      };

      const updatedWallet = { ...mockWallet, balance: 6000 };

      prisma.wallet.findUnique.mockResolvedValue(mockWallet);
      prisma.wallet.update.mockResolvedValue(updatedWallet);
      prisma.walletTransaction.create.mockResolvedValue({
        id: 'txn_123',
        type: 'CREDIT',
        amount: 1000,
      });

      const result = await walletService.credit('wallet_123', 1000, {
        description: 'Test credit',
      });

      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet_123' },
        data: { balance: { increment: 1000 } },
      });
      expect(result.transaction.type).toBe('CREDIT');
    });

    it('should throw error if wallet is suspended', async () => {
      const mockWallet = {
        id: 'wallet_123',
        status: 'SUSPENDED',
      };

      prisma.wallet.findUnique.mockResolvedValue(mockWallet);

      await expect(walletService.credit('wallet_123', 1000, {}))
        .rejects.toThrow('Wallet is not active');
    });
  });

  describe('debit', () => {
    it('should debit wallet if sufficient balance', async () => {
      const mockWallet = {
        id: 'wallet_123',
        balance: 5000,
        lockedBalance: 0,
        currency: 'INR',
        status: 'ACTIVE',
        dailyLimit: 100000,
        monthlyLimit: 1000000,
        userId: 'user_123',
      };

      prisma.wallet.findUnique.mockResolvedValue(mockWallet);
      prisma.wallet.update.mockResolvedValue({ ...mockWallet, balance: 4000 });
      prisma.walletTransaction.create.mockResolvedValue({
        id: 'txn_123',
        type: 'DEBIT',
        amount: 1000,
      });
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const result = await walletService.debit('wallet_123', 1000, {
        description: 'Test debit',
      });

      expect(result.transaction.type).toBe('DEBIT');
    });

    it('should throw error if insufficient balance', async () => {
      const mockWallet = {
        id: 'wallet_123',
        balance: 500,
        lockedBalance: 0,
        status: 'ACTIVE',
      };

      prisma.wallet.findUnique.mockResolvedValue(mockWallet);

      await expect(walletService.debit('wallet_123', 1000, {}))
        .rejects.toThrow('Insufficient balance');
    });
  });

  describe('transfer', () => {
    it('should transfer between wallets', async () => {
      const fromWallet = {
        id: 'wallet_from',
        balance: 5000,
        lockedBalance: 0,
        currency: 'INR',
        status: 'ACTIVE',
        dailyLimit: 100000,
        monthlyLimit: 1000000,
        userId: 'user_1',
      };

      const toWallet = {
        id: 'wallet_to',
        balance: 2000,
        lockedBalance: 0,
        currency: 'INR',
        status: 'ACTIVE',
        userId: 'user_2',
      };

      prisma.wallet.findUnique
        .mockResolvedValueOnce(fromWallet)
        .mockResolvedValueOnce(toWallet);

      prisma.wallet.update.mockResolvedValue({});
      prisma.walletTransaction.create.mockResolvedValue({ id: 'txn_123' });
      prisma.walletTransaction.aggregate.mockResolvedValue({ _sum: { amount: 0 } });

      const result = await walletService.transfer('wallet_from', 'wallet_to', 1000, {});

      expect(result.success).toBe(true);
    });

    it('should throw error if currencies mismatch', async () => {
      const fromWallet = { id: 'wallet_from', currency: 'INR', status: 'ACTIVE' };
      const toWallet = { id: 'wallet_to', currency: 'USD', status: 'ACTIVE' };

      prisma.wallet.findUnique
        .mockResolvedValueOnce(fromWallet)
        .mockResolvedValueOnce(toWallet);

      await expect(walletService.transfer('wallet_from', 'wallet_to', 1000, {}))
        .rejects.toThrow('Currency mismatch');
    });
  });

  describe('holdAmount', () => {
    it('should hold amount from available balance', async () => {
      const mockWallet = {
        id: 'wallet_123',
        balance: 5000,
        lockedBalance: 0,
        status: 'ACTIVE',
      };

      prisma.wallet.findUnique.mockResolvedValue(mockWallet);
      prisma.wallet.update.mockResolvedValue({ ...mockWallet, lockedBalance: 1000 });
      prisma.walletTransaction.create.mockResolvedValue({ id: 'hold_123' });

      const result = await walletService.holdAmount('wallet_123', 1000, {});

      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet_123' },
        data: { lockedBalance: { increment: 1000 } },
      });
      expect(result.success).toBe(true);
    });
  });

  describe('setPin', () => {
    it('should set wallet PIN', async () => {
      const mockWallet = {
        id: 'wallet_123',
        userId: 'user_123',
        pin: null,
      };

      prisma.wallet.findUnique.mockResolvedValue(mockWallet);
      prisma.wallet.update.mockResolvedValue({ ...mockWallet, pin: 'hashed_pin' });

      await walletService.setPin('wallet_123', '1234', 'user_123');

      expect(prisma.wallet.update).toHaveBeenCalledWith({
        where: { id: 'wallet_123' },
        data: expect.objectContaining({
          pin: expect.any(String),
          pinAttempts: 0,
        }),
      });
    });

    it('should throw error for invalid PIN format', async () => {
      await expect(walletService.setPin('wallet_123', '12', 'user_123'))
        .rejects.toThrow('PIN must be 4-6 digits');
    });
  });

  describe('getTransactions', () => {
    it('should return paginated transactions', async () => {
      const mockTransactions = [
        { id: 'txn_1', type: 'CREDIT', amount: 1000 },
        { id: 'txn_2', type: 'DEBIT', amount: 500 },
      ];

      prisma.walletTransaction.findMany.mockResolvedValue(mockTransactions);
      prisma.walletTransaction.count.mockResolvedValue(10);

      const result = await walletService.getTransactions('wallet_123', {
        page: 1,
        limit: 10,
      });

      expect(result.transactions).toHaveLength(2);
      expect(result.pagination.total).toBe(10);
    });
  });
});
