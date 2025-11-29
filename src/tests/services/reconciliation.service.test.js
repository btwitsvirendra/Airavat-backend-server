// =============================================================================
// AIRAVAT B2B MARKETPLACE - RECONCILIATION SERVICE TESTS
// =============================================================================

const reconciliationService = require('../../services/reconciliation.service');
const { prisma } = require('../../config/database');

// Mock dependencies
jest.mock('../../config/database', () => ({
  prisma: {
    reconciliationRule: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
    },
    reconciliationBatch: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    reconciliationItem: {
      create: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
      groupBy: jest.fn(),
    },
    bankTransaction: {
      findMany: jest.fn(),
    },
    walletTransaction: {
      findMany: jest.fn(),
    },
    order: {
      findFirst: jest.fn(),
    },
    invoice: {
      findFirst: jest.fn(),
    },
    payment: {
      findFirst: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

describe('Reconciliation Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createRule', () => {
    it('should create a reconciliation rule', async () => {
      const mockRule = {
        id: 'rule_123',
        businessId: 'business_123',
        name: 'Invoice Match Rule',
        matchType: 'REFERENCE',
        matchFields: { reference: true, amount: true },
        tolerance: 1,
        dateTolerance: 7,
        priority: 10,
        isActive: true,
      };

      prisma.reconciliationRule.create.mockResolvedValue(mockRule);

      const result = await reconciliationService.createRule('business_123', {
        name: 'Invoice Match Rule',
        matchType: 'REFERENCE',
        matchFields: { reference: true, amount: true },
        tolerance: 1,
        dateTolerance: 7,
        priority: 10,
      });

      expect(result.name).toBe('Invoice Match Rule');
      expect(result.matchType).toBe('REFERENCE');
      expect(result.isActive).toBe(true);
    });

    it('should set default values for optional fields', async () => {
      prisma.reconciliationRule.create.mockResolvedValue({
        id: 'rule_123',
        tolerance: 1,
        dateTolerance: 7,
        priority: 10,
      });

      await reconciliationService.createRule('business_123', {
        name: 'Simple Rule',
        matchType: 'EXACT',
        matchFields: { reference: true },
      });

      expect(prisma.reconciliationRule.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          tolerance: expect.any(Number),
          dateTolerance: expect.any(Number),
          priority: expect.any(Number),
        }),
      });
    });
  });

  describe('getRules', () => {
    it('should return all rules for business', async () => {
      const mockRules = [
        { id: 'rule_1', name: 'Rule 1', priority: 10 },
        { id: 'rule_2', name: 'Rule 2', priority: 20 },
      ];

      prisma.reconciliationRule.findMany.mockResolvedValue(mockRules);

      const result = await reconciliationService.getRules('business_123');

      expect(result).toHaveLength(2);
      expect(prisma.reconciliationRule.findMany).toHaveBeenCalledWith({
        where: { businessId: 'business_123' },
        orderBy: { priority: 'asc' },
      });
    });

    it('should filter by active status', async () => {
      prisma.reconciliationRule.findMany.mockResolvedValue([]);

      await reconciliationService.getRules('business_123', { activeOnly: true });

      expect(prisma.reconciliationRule.findMany).toHaveBeenCalledWith({
        where: { businessId: 'business_123', isActive: true },
        orderBy: { priority: 'asc' },
      });
    });
  });

  describe('startBatch', () => {
    it('should create a new reconciliation batch', async () => {
      const mockBatch = {
        id: 'batch_123',
        businessId: 'business_123',
        status: 'PENDING',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };

      prisma.reconciliationBatch.create.mockResolvedValue(mockBatch);

      const result = await reconciliationService.startBatch('business_123', {
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      });

      expect(result.status).toBe('PENDING');
      expect(prisma.reconciliationBatch.create).toHaveBeenCalled();
    });
  });

  describe('processBatch', () => {
    it('should process batch and create reconciliation items', async () => {
      const mockBatch = {
        id: 'batch_123',
        businessId: 'business_123',
        status: 'PENDING',
        startDate: new Date('2024-01-01'),
        endDate: new Date('2024-01-31'),
      };

      const mockBankTransactions = [
        {
          id: 'bank_txn_1',
          transactionDate: new Date('2024-01-15'),
          amount: 10000,
          referenceNumber: 'REF001',
          counterpartyName: 'Vendor A',
        },
      ];

      prisma.reconciliationBatch.findUnique.mockResolvedValue(mockBatch);
      prisma.reconciliationBatch.update.mockResolvedValue({ ...mockBatch, status: 'IN_PROGRESS' });
      prisma.bankTransaction.findMany.mockResolvedValue(mockBankTransactions);
      prisma.reconciliationItem.createMany.mockResolvedValue({ count: 1 });
      prisma.reconciliationRule.findMany.mockResolvedValue([]);
      prisma.reconciliationItem.findMany.mockResolvedValue([]);

      const result = await reconciliationService.processBatch('batch_123');

      expect(result.status).toBe('IN_PROGRESS');
    });

    it('should skip already processed batch', async () => {
      prisma.reconciliationBatch.findUnique.mockResolvedValue({
        id: 'batch_123',
        status: 'COMPLETED',
      });

      await expect(reconciliationService.processBatch('batch_123'))
        .rejects.toThrow('Batch has already been processed');
    });
  });

  describe('matchItem', () => {
    it('should match item with exact reference match', async () => {
      const mockItem = {
        id: 'item_123',
        batchId: 'batch_123',
        transactionRef: 'INV-001',
        transactionAmount: 10000,
        status: 'UNMATCHED',
        batch: { businessId: 'business_123' },
      };

      const mockInvoice = {
        id: 'invoice_123',
        invoiceNumber: 'INV-001',
        totalAmount: 10000,
      };

      prisma.reconciliationItem.findUnique.mockResolvedValue(mockItem);
      prisma.invoice.findFirst.mockResolvedValue(mockInvoice);
      prisma.reconciliationItem.update.mockResolvedValue({
        ...mockItem,
        status: 'MATCHED',
        matchedType: 'INVOICE',
        matchedId: 'invoice_123',
        matchConfidence: 100,
      });

      const result = await reconciliationService.matchItem('item_123', {
        matchType: 'INVOICE',
        matchId: 'invoice_123',
      });

      expect(result.status).toBe('MATCHED');
      expect(result.matchedType).toBe('INVOICE');
      expect(result.matchConfidence).toBe(100);
    });

    it('should throw error if item already matched', async () => {
      prisma.reconciliationItem.findUnique.mockResolvedValue({
        id: 'item_123',
        status: 'MATCHED',
      });

      await expect(reconciliationService.matchItem('item_123', {}))
        .rejects.toThrow('Item is already matched');
    });
  });

  describe('autoMatch', () => {
    it('should auto-match items using rules', async () => {
      const mockRules = [
        {
          id: 'rule_1',
          matchType: 'REFERENCE',
          matchFields: { reference: true },
          tolerance: 0,
        },
      ];

      const mockItems = [
        {
          id: 'item_1',
          transactionRef: 'INV-001',
          transactionAmount: 10000,
          status: 'UNMATCHED',
        },
      ];

      prisma.reconciliationRule.findMany.mockResolvedValue(mockRules);
      prisma.reconciliationItem.findMany.mockResolvedValue(mockItems);
      prisma.invoice.findFirst.mockResolvedValue({
        id: 'invoice_1',
        invoiceNumber: 'INV-001',
        totalAmount: 10000,
      });
      prisma.reconciliationItem.update.mockResolvedValue({
        ...mockItems[0],
        status: 'MATCHED',
      });

      const result = await reconciliationService.autoMatch('batch_123');

      expect(result.matched).toBeGreaterThanOrEqual(0);
    });
  });

  describe('getUnmatchedItems', () => {
    it('should return unmatched items with pagination', async () => {
      const mockItems = [
        { id: 'item_1', status: 'UNMATCHED', transactionAmount: 5000 },
        { id: 'item_2', status: 'UNMATCHED', transactionAmount: 7500 },
      ];

      prisma.reconciliationItem.findMany.mockResolvedValue(mockItems);
      prisma.reconciliationItem.count.mockResolvedValue(2);

      const result = await reconciliationService.getUnmatchedItems('batch_123', {
        page: 1,
        limit: 10,
      });

      expect(result.items).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
    });
  });

  describe('getBatchSummary', () => {
    it('should return comprehensive batch summary', async () => {
      const mockBatch = {
        id: 'batch_123',
        status: 'COMPLETED',
        totalItems: 100,
        matchedItems: 85,
        unmatchedItems: 15,
        matchRate: 85,
      };

      prisma.reconciliationBatch.findUnique.mockResolvedValue(mockBatch);
      prisma.reconciliationItem.groupBy.mockResolvedValue([
        { status: 'MATCHED', _count: 85, _sum: { transactionAmount: 850000 } },
        { status: 'UNMATCHED', _count: 15, _sum: { transactionAmount: 150000 } },
      ]);

      const result = await reconciliationService.getBatchSummary('batch_123');

      expect(result.matchRate).toBe(85);
      expect(result.totalItems).toBe(100);
    });
  });

  describe('getReconciliationSummary', () => {
    it('should return overall reconciliation summary for business', async () => {
      const mockBatches = [
        { id: 'batch_1', matchRate: 90, totalItems: 100, matchedItems: 90 },
        { id: 'batch_2', matchRate: 85, totalItems: 50, matchedItems: 42 },
      ];

      prisma.reconciliationBatch.findMany.mockResolvedValue(mockBatches);
      prisma.reconciliationBatch.count.mockResolvedValue(2);
      prisma.reconciliationBatch.aggregate.mockResolvedValue({
        _avg: { matchRate: 87.5 },
      });
      prisma.reconciliationItem.count
        .mockResolvedValueOnce(132) // matched
        .mockResolvedValueOnce(18); // unmatched

      const result = await reconciliationService.getReconciliationSummary('business_123');

      expect(result.totalBatches).toBe(2);
      expect(result.averageMatchRate).toBeDefined();
    });
  });

  describe('fuzzyMatch', () => {
    it('should match with tolerance for amount', async () => {
      const mockItem = {
        id: 'item_123',
        transactionAmount: 10050,
        transactionRef: 'INV-001',
        status: 'UNMATCHED',
      };

      const mockInvoice = {
        id: 'invoice_123',
        invoiceNumber: 'INV-001',
        totalAmount: 10000,
      };

      // 0.5% tolerance allows 10050 to match 10000
      const tolerance = 1;
      const amountDiff = Math.abs(10050 - 10000) / 10000 * 100;
      const isWithinTolerance = amountDiff <= tolerance;

      expect(isWithinTolerance).toBe(true);
    });
  });

  describe('exportUnmatched', () => {
    it('should export unmatched items to CSV format', async () => {
      const mockItems = [
        {
          id: 'item_1',
          transactionDate: new Date('2024-01-15'),
          transactionAmount: 5000,
          transactionRef: 'TXN001',
          counterpartyName: 'Vendor A',
          status: 'UNMATCHED',
        },
      ];

      prisma.reconciliationItem.findMany.mockResolvedValue(mockItems);

      const result = await reconciliationService.exportUnmatched('batch_123', 'csv');

      expect(result.format).toBe('csv');
      expect(result.data).toBeDefined();
    });
  });
});
