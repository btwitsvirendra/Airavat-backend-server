// =============================================================================
// AIRAVAT B2B MARKETPLACE - BANK INTEGRATION SERVICE TESTS
// =============================================================================

const bankIntegrationService = require('../../services/bankIntegration.service');
const { prisma } = require('../../config/database');

// Mock dependencies
jest.mock('../../config/database', () => ({
  prisma: {
    bankConnection: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    bankTransaction: {
      create: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
      groupBy: jest.fn(),
      deleteMany: jest.fn(),
    },
    business: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock('axios', () => ({
  post: jest.fn(),
  get: jest.fn(),
}));

const axios = require('axios');

describe('Bank Integration Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('connectBank', () => {
    it('should create bank connection with consent URL', async () => {
      const mockBusiness = { id: 'business_123', businessName: 'Test Business' };
      const mockConnection = {
        id: 'conn_123',
        businessId: 'business_123',
        bankName: 'HDFC Bank',
        bankCode: 'HDFC',
        status: 'PENDING',
        consentUrl: 'https://consent.example.com/abc123',
      };

      prisma.business.findUnique.mockResolvedValue(mockBusiness);
      prisma.bankConnection.count.mockResolvedValue(0);
      prisma.bankConnection.create.mockResolvedValue(mockConnection);

      axios.post.mockResolvedValue({
        data: {
          consentId: 'consent_123',
          consentUrl: 'https://consent.example.com/abc123',
        },
      });

      const result = await bankIntegrationService.connectBank('business_123', {
        bankName: 'HDFC Bank',
        bankCode: 'HDFC',
        accountNumber: '1234567890',
        accountType: 'CURRENT',
        provider: 'AA',
      });

      expect(result.consentUrl).toBeDefined();
      expect(result.status).toBe('PENDING');
    });

    it('should throw error if max connections reached', async () => {
      prisma.business.findUnique.mockResolvedValue({ id: 'business_123' });
      prisma.bankConnection.count.mockResolvedValue(10); // Max limit

      await expect(bankIntegrationService.connectBank('business_123', {}))
        .rejects.toThrow('Maximum bank connections reached');
    });

    it('should throw error for duplicate account', async () => {
      prisma.business.findUnique.mockResolvedValue({ id: 'business_123' });
      prisma.bankConnection.count.mockResolvedValue(0);
      prisma.bankConnection.create.mockRejectedValue({
        code: 'P2002', // Prisma unique constraint error
      });

      await expect(bankIntegrationService.connectBank('business_123', {
        bankCode: 'HDFC',
        accountNumber: '1234567890',
      })).rejects.toThrow();
    });
  });

  describe('handleConsentCallback', () => {
    it('should activate connection on successful consent', async () => {
      const mockConnection = {
        id: 'conn_123',
        consentId: 'consent_123',
        status: 'PENDING',
      };

      prisma.bankConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.bankConnection.update.mockResolvedValue({
        ...mockConnection,
        status: 'ACTIVE',
        consentStatus: 'APPROVED',
      });

      const result = await bankIntegrationService.handleConsentCallback(
        'consent_123',
        true,
        null
      );

      expect(result.status).toBe('ACTIVE');
      expect(result.consentStatus).toBe('APPROVED');
    });

    it('should mark connection as failed on rejected consent', async () => {
      const mockConnection = {
        id: 'conn_123',
        consentId: 'consent_123',
        status: 'PENDING',
      };

      prisma.bankConnection.findFirst.mockResolvedValue(mockConnection);
      prisma.bankConnection.update.mockResolvedValue({
        ...mockConnection,
        status: 'INACTIVE',
        consentStatus: 'REJECTED',
      });

      const result = await bankIntegrationService.handleConsentCallback(
        'consent_123',
        false,
        'User rejected'
      );

      expect(result.status).toBe('INACTIVE');
    });
  });

  describe('syncBankTransactions', () => {
    it('should fetch and store new transactions', async () => {
      const mockConnection = {
        id: 'conn_123',
        businessId: 'business_123',
        status: 'ACTIVE',
        consentId: 'consent_123',
        lastSyncAt: new Date(Date.now() - 24 * 60 * 60 * 1000),
      };

      const mockExternalTransactions = [
        {
          id: 'ext_txn_1',
          date: '2024-01-15',
          amount: 10000,
          type: 'CREDIT',
          description: 'Payment received',
        },
        {
          id: 'ext_txn_2',
          date: '2024-01-16',
          amount: 5000,
          type: 'DEBIT',
          description: 'Bill payment',
        },
      ];

      prisma.bankConnection.findUnique.mockResolvedValue(mockConnection);
      axios.get.mockResolvedValue({ data: { transactions: mockExternalTransactions } });
      prisma.bankTransaction.findMany.mockResolvedValue([]);
      prisma.bankTransaction.createMany.mockResolvedValue({ count: 2 });
      prisma.bankConnection.update.mockResolvedValue({
        ...mockConnection,
        lastSyncAt: new Date(),
      });

      const result = await bankIntegrationService.syncBankTransactions('conn_123');

      expect(result.newTransactions).toBe(2);
      expect(prisma.bankTransaction.createMany).toHaveBeenCalled();
    });

    it('should skip already synced transactions', async () => {
      const mockConnection = {
        id: 'conn_123',
        status: 'ACTIVE',
      };

      const mockExternalTransactions = [
        { id: 'ext_txn_1', date: '2024-01-15', amount: 10000, type: 'CREDIT' },
      ];

      const existingTransactions = [
        { externalId: 'ext_txn_1' },
      ];

      prisma.bankConnection.findUnique.mockResolvedValue(mockConnection);
      axios.get.mockResolvedValue({ data: { transactions: mockExternalTransactions } });
      prisma.bankTransaction.findMany.mockResolvedValue(existingTransactions);
      prisma.bankTransaction.createMany.mockResolvedValue({ count: 0 });
      prisma.bankConnection.update.mockResolvedValue(mockConnection);

      const result = await bankIntegrationService.syncBankTransactions('conn_123');

      expect(result.newTransactions).toBe(0);
    });

    it('should throw error if connection not active', async () => {
      prisma.bankConnection.findUnique.mockResolvedValue({
        id: 'conn_123',
        status: 'REVOKED',
      });

      await expect(bankIntegrationService.syncBankTransactions('conn_123'))
        .rejects.toThrow('Bank connection is not active');
    });
  });

  describe('getTransactions', () => {
    it('should return transactions with pagination', async () => {
      const mockTransactions = [
        {
          id: 'txn_1',
          transactionDate: new Date(),
          amount: 10000,
          type: 'CREDIT',
        },
        {
          id: 'txn_2',
          transactionDate: new Date(),
          amount: 5000,
          type: 'DEBIT',
        },
      ];

      prisma.bankConnection.findUnique.mockResolvedValue({
        id: 'conn_123',
        businessId: 'business_123',
      });
      prisma.bankTransaction.findMany.mockResolvedValue(mockTransactions);
      prisma.bankTransaction.count.mockResolvedValue(2);

      const result = await bankIntegrationService.getTransactions(
        'conn_123',
        'business_123',
        { page: 1, limit: 10 }
      );

      expect(result.transactions).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
    });

    it('should filter by date range', async () => {
      prisma.bankConnection.findUnique.mockResolvedValue({
        id: 'conn_123',
        businessId: 'business_123',
      });
      prisma.bankTransaction.findMany.mockResolvedValue([]);
      prisma.bankTransaction.count.mockResolvedValue(0);

      await bankIntegrationService.getTransactions('conn_123', 'business_123', {
        startDate: '2024-01-01',
        endDate: '2024-01-31',
      });

      expect(prisma.bankTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            transactionDate: expect.any(Object),
          }),
        })
      );
    });

    it('should filter by type', async () => {
      prisma.bankConnection.findUnique.mockResolvedValue({
        id: 'conn_123',
        businessId: 'business_123',
      });
      prisma.bankTransaction.findMany.mockResolvedValue([]);
      prisma.bankTransaction.count.mockResolvedValue(0);

      await bankIntegrationService.getTransactions('conn_123', 'business_123', {
        type: 'CREDIT',
      });

      expect(prisma.bankTransaction.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            type: 'CREDIT',
          }),
        })
      );
    });
  });

  describe('getAccountBalance', () => {
    it('should calculate balance from transactions', async () => {
      prisma.bankConnection.findUnique.mockResolvedValue({
        id: 'conn_123',
        businessId: 'business_123',
      });
      prisma.bankTransaction.findMany.mockResolvedValue([
        { balance: 150000, transactionDate: new Date() },
      ]);
      prisma.bankTransaction.aggregate.mockResolvedValue({
        _sum: { amount: 100000 },
      });

      const result = await bankIntegrationService.getAccountBalance('conn_123', 'business_123');

      expect(result.balance).toBeDefined();
    });
  });

  describe('categorizeTransaction', () => {
    it('should categorize salary transaction', async () => {
      const transaction = {
        description: 'SALARY CREDIT FOR DEC',
        amount: 50000,
        type: 'CREDIT',
      };

      const category = await bankIntegrationService.categorizeTransaction(transaction);

      expect(category).toBe('SALARY');
    });

    it('should categorize tax payment', async () => {
      const transaction = {
        description: 'GST PAYMENT Q3',
        amount: 25000,
        type: 'DEBIT',
      };

      const category = await bankIntegrationService.categorizeTransaction(transaction);

      expect(category).toBe('TAX');
    });

    it('should categorize utility payment', async () => {
      const transaction = {
        description: 'ELECTRICITY BILL TATA POWER',
        amount: 5000,
        type: 'DEBIT',
      };

      const category = await bankIntegrationService.categorizeTransaction(transaction);

      expect(category).toBe('UTILITY');
    });

    it('should return OTHER for unknown transaction', async () => {
      const transaction = {
        description: 'MISC TRANSFER',
        amount: 1000,
        type: 'DEBIT',
      };

      const category = await bankIntegrationService.categorizeTransaction(transaction);

      expect(category).toBe('OTHER');
    });
  });

  describe('revokeConsent', () => {
    it('should revoke active connection', async () => {
      const mockConnection = {
        id: 'conn_123',
        businessId: 'business_123',
        status: 'ACTIVE',
        consentId: 'consent_123',
      };

      prisma.bankConnection.findUnique.mockResolvedValue(mockConnection);
      axios.post.mockResolvedValue({ data: { success: true } });
      prisma.bankConnection.update.mockResolvedValue({
        ...mockConnection,
        status: 'REVOKED',
      });

      const result = await bankIntegrationService.revokeConsent('conn_123', 'business_123');

      expect(result.status).toBe('REVOKED');
    });
  });

  describe('syncAllConnections', () => {
    it('should sync all active connections', async () => {
      const mockConnections = [
        { id: 'conn_1', status: 'ACTIVE' },
        { id: 'conn_2', status: 'ACTIVE' },
      ];

      prisma.bankConnection.findMany.mockResolvedValue(mockConnections);
      prisma.bankConnection.findUnique.mockResolvedValue({ id: 'conn_1', status: 'ACTIVE' });
      axios.get.mockResolvedValue({ data: { transactions: [] } });
      prisma.bankTransaction.findMany.mockResolvedValue([]);
      prisma.bankTransaction.createMany.mockResolvedValue({ count: 0 });
      prisma.bankConnection.update.mockResolvedValue({});

      const result = await bankIntegrationService.syncAllConnections();

      expect(result.synced).toBe(2);
    });
  });

  describe('cleanOldTransactions', () => {
    it('should delete old reconciled transactions', async () => {
      prisma.bankTransaction.deleteMany.mockResolvedValue({ count: 100 });

      const result = await bankIntegrationService.cleanOldTransactions(365);

      expect(prisma.bankTransaction.deleteMany).toHaveBeenCalledWith({
        where: {
          isReconciled: true,
          transactionDate: { lt: expect.any(Date) },
        },
      });
      expect(result).toBe(100);
    });
  });

  describe('getStatementPDF', () => {
    it('should generate statement for date range', async () => {
      prisma.bankConnection.findUnique.mockResolvedValue({
        id: 'conn_123',
        businessId: 'business_123',
        bankName: 'HDFC Bank',
        accountNumber: '****7890',
      });
      prisma.bankTransaction.findMany.mockResolvedValue([
        { transactionDate: new Date(), amount: 10000, type: 'CREDIT' },
        { transactionDate: new Date(), amount: 5000, type: 'DEBIT' },
      ]);

      const result = await bankIntegrationService.getStatementPDF(
        'conn_123',
        'business_123',
        {
          startDate: '2024-01-01',
          endDate: '2024-01-31',
        }
      );

      expect(result).toBeDefined();
    });
  });
});
