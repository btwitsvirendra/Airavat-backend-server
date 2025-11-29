// =============================================================================
// AIRAVAT B2B MARKETPLACE - WALLET SERVICE UNIT TESTS
// Comprehensive tests for wallet functionality
// =============================================================================

const WalletService = require('../../src/services/wallet.service');
const { prisma, factories, createAuthenticatedUser } = require('../setup');

// Mock dependencies
jest.mock('../../src/config/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    setex: jest.fn(),
  },
}));

jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('WalletService', () => {
  let testUser;
  let testBusiness;

  beforeAll(async () => {
    // Create test user and business
    testUser = await factories.createUser({ email: 'wallet-test@example.com' });
    testBusiness = await factories.createBusiness(testUser.id);
  });

  afterAll(async () => {
    // Cleanup
    await prisma.walletTransaction.deleteMany({ where: { wallet: { userId: testUser.id } } });
    await prisma.wallet.deleteMany({ where: { userId: testUser.id } });
    await prisma.business.deleteMany({ where: { id: testBusiness.id } });
    await prisma.user.deleteMany({ where: { id: testUser.id } });
  });

  // ===========================================================================
  // WALLET CREATION
  // ===========================================================================

  describe('createWallet', () => {
    it('should create a new wallet for user', async () => {
      const wallet = await WalletService.createWallet(testUser.id);

      expect(wallet).toBeDefined();
      expect(wallet.userId).toBe(testUser.id);
      expect(wallet.balance).toBe(0);
      expect(wallet.currency).toBe('INR');
      expect(wallet.isActive).toBe(true);
    });

    it('should not create duplicate wallet for same user', async () => {
      // Try to create another wallet
      await expect(WalletService.createWallet(testUser.id))
        .rejects.toThrow();
    });

    it('should create wallet with specified currency', async () => {
      const newUser = await factories.createUser();
      const wallet = await WalletService.createWallet(newUser.id, 'USD');

      expect(wallet.currency).toBe('USD');

      // Cleanup
      await prisma.wallet.delete({ where: { id: wallet.id } });
      await prisma.user.delete({ where: { id: newUser.id } });
    });
  });

  // ===========================================================================
  // WALLET BALANCE
  // ===========================================================================

  describe('getWallet', () => {
    it('should return wallet with balance', async () => {
      const wallet = await WalletService.getWallet(testUser.id);

      expect(wallet).toBeDefined();
      expect(wallet).toHaveProperty('balance');
      expect(wallet).toHaveProperty('currency');
      expect(wallet).toHaveProperty('isActive');
    });

    it('should return null for non-existent wallet', async () => {
      const wallet = await WalletService.getWallet('non-existent-id');
      expect(wallet).toBeNull();
    });
  });

  // ===========================================================================
  // CREDIT OPERATIONS
  // ===========================================================================

  describe('creditWallet', () => {
    it('should credit wallet successfully', async () => {
      const amount = 1000;
      const result = await WalletService.creditWallet(
        testUser.id,
        amount,
        'DEPOSIT',
        'Test deposit',
        { source: 'test' }
      );

      expect(result.wallet).toBeDefined();
      expect(result.transaction).toBeDefined();
      expect(result.transaction.amount).toBe(amount);
      expect(result.transaction.type).toBe('CREDIT');
    });

    it('should reject negative amount', async () => {
      await expect(
        WalletService.creditWallet(testUser.id, -100, 'DEPOSIT', 'Invalid')
      ).rejects.toThrow();
    });

    it('should reject zero amount', async () => {
      await expect(
        WalletService.creditWallet(testUser.id, 0, 'DEPOSIT', 'Invalid')
      ).rejects.toThrow();
    });

    it('should increment wallet balance correctly', async () => {
      const walletBefore = await WalletService.getWallet(testUser.id);
      const amount = 500;

      await WalletService.creditWallet(testUser.id, amount, 'DEPOSIT', 'Credit test');

      const walletAfter = await WalletService.getWallet(testUser.id);
      expect(walletAfter.balance).toBe(walletBefore.balance + amount);
    });
  });

  // ===========================================================================
  // DEBIT OPERATIONS
  // ===========================================================================

  describe('debitWallet', () => {
    beforeEach(async () => {
      // Ensure wallet has sufficient balance
      const wallet = await WalletService.getWallet(testUser.id);
      if (wallet.balance < 5000) {
        await WalletService.creditWallet(testUser.id, 5000, 'DEPOSIT', 'Test balance');
      }
    });

    it('should debit wallet successfully', async () => {
      const walletBefore = await WalletService.getWallet(testUser.id);
      const amount = 100;

      const result = await WalletService.debitWallet(
        testUser.id,
        amount,
        'PURCHASE',
        'Test purchase'
      );

      expect(result.wallet).toBeDefined();
      expect(result.transaction).toBeDefined();
      expect(result.transaction.amount).toBe(amount);
      expect(result.transaction.type).toBe('DEBIT');

      const walletAfter = await WalletService.getWallet(testUser.id);
      expect(walletAfter.balance).toBe(walletBefore.balance - amount);
    });

    it('should reject debit exceeding balance', async () => {
      const wallet = await WalletService.getWallet(testUser.id);

      await expect(
        WalletService.debitWallet(testUser.id, wallet.balance + 1000, 'PURCHASE', 'Too much')
      ).rejects.toThrow(/insufficient/i);
    });

    it('should reject negative debit amount', async () => {
      await expect(
        WalletService.debitWallet(testUser.id, -100, 'PURCHASE', 'Invalid')
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // TRANSACTION HISTORY
  // ===========================================================================

  describe('getTransactionHistory', () => {
    it('should return transaction history', async () => {
      const result = await WalletService.getTransactionHistory(testUser.id, {
        page: 1,
        limit: 10,
      });

      expect(result.transactions).toBeDefined();
      expect(Array.isArray(result.transactions)).toBe(true);
      expect(result.pagination).toBeDefined();
    });

    it('should filter by transaction type', async () => {
      const result = await WalletService.getTransactionHistory(testUser.id, {
        type: 'CREDIT',
      });

      result.transactions.forEach((tx) => {
        expect(tx.type).toBe('CREDIT');
      });
    });

    it('should filter by date range', async () => {
      const startDate = new Date();
      startDate.setDate(startDate.getDate() - 7);

      const result = await WalletService.getTransactionHistory(testUser.id, {
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      });

      result.transactions.forEach((tx) => {
        expect(new Date(tx.createdAt) >= startDate).toBe(true);
      });
    });

    it('should paginate correctly', async () => {
      const page1 = await WalletService.getTransactionHistory(testUser.id, {
        page: 1,
        limit: 2,
      });

      const page2 = await WalletService.getTransactionHistory(testUser.id, {
        page: 2,
        limit: 2,
      });

      expect(page1.transactions.length).toBeLessThanOrEqual(2);
      expect(page2.transactions.length).toBeLessThanOrEqual(2);

      if (page1.transactions.length > 0 && page2.transactions.length > 0) {
        expect(page1.transactions[0].id).not.toBe(page2.transactions[0].id);
      }
    });
  });

  // ===========================================================================
  // WALLET TRANSFER
  // ===========================================================================

  describe('transferFunds', () => {
    let recipientUser;

    beforeAll(async () => {
      recipientUser = await factories.createUser({ email: 'recipient@example.com' });
      await WalletService.createWallet(recipientUser.id);
    });

    afterAll(async () => {
      await prisma.walletTransaction.deleteMany({
        where: { wallet: { userId: recipientUser.id } },
      });
      await prisma.wallet.deleteMany({ where: { userId: recipientUser.id } });
      await prisma.user.deleteMany({ where: { id: recipientUser.id } });
    });

    it('should transfer funds between wallets', async () => {
      const amount = 100;

      const senderBefore = await WalletService.getWallet(testUser.id);
      const recipientBefore = await WalletService.getWallet(recipientUser.id);

      const result = await WalletService.transferFunds(
        testUser.id,
        recipientUser.id,
        amount,
        'Test transfer'
      );

      expect(result.success).toBe(true);

      const senderAfter = await WalletService.getWallet(testUser.id);
      const recipientAfter = await WalletService.getWallet(recipientUser.id);

      expect(senderAfter.balance).toBe(senderBefore.balance - amount);
      expect(recipientAfter.balance).toBe(recipientBefore.balance + amount);
    });

    it('should reject transfer to same wallet', async () => {
      await expect(
        WalletService.transferFunds(testUser.id, testUser.id, 100, 'Self transfer')
      ).rejects.toThrow();
    });

    it('should reject transfer with insufficient funds', async () => {
      const wallet = await WalletService.getWallet(testUser.id);

      await expect(
        WalletService.transferFunds(
          testUser.id,
          recipientUser.id,
          wallet.balance + 10000,
          'Too much'
        )
      ).rejects.toThrow(/insufficient/i);
    });
  });

  // ===========================================================================
  // WALLET FREEZE/UNFREEZE
  // ===========================================================================

  describe('freezeWallet / unfreezeWallet', () => {
    let freezeTestUser;

    beforeAll(async () => {
      freezeTestUser = await factories.createUser({ email: 'freeze-test@example.com' });
      await WalletService.createWallet(freezeTestUser.id);
    });

    afterAll(async () => {
      await prisma.walletTransaction.deleteMany({
        where: { wallet: { userId: freezeTestUser.id } },
      });
      await prisma.wallet.deleteMany({ where: { userId: freezeTestUser.id } });
      await prisma.user.deleteMany({ where: { id: freezeTestUser.id } });
    });

    it('should freeze wallet', async () => {
      const result = await WalletService.freezeWallet(freezeTestUser.id, 'Security concern');

      expect(result.isActive).toBe(false);
    });

    it('should prevent transactions on frozen wallet', async () => {
      await expect(
        WalletService.creditWallet(freezeTestUser.id, 100, 'DEPOSIT', 'Test')
      ).rejects.toThrow(/frozen|inactive/i);
    });

    it('should unfreeze wallet', async () => {
      const result = await WalletService.unfreezeWallet(freezeTestUser.id);

      expect(result.isActive).toBe(true);
    });
  });
});



