// =============================================================================
// AIRAVAT B2B MARKETPLACE - INVOICE FACTORING SERVICE TESTS
// =============================================================================

const invoiceFactoringService = require('../../services/invoiceFactoring.service');
const { prisma } = require('../../config/database');

// Mock dependencies
jest.mock('../../config/database', () => ({
  prisma: {
    factoringApplication: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    invoice: {
      findUnique: jest.fn(),
      update: jest.fn(),
    },
    business: {
      findUnique: jest.fn(),
    },
    wallet: {
      findFirst: jest.fn(),
    },
    order: {
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock('../../services/wallet.service', () => ({
  credit: jest.fn(),
  debit: jest.fn(),
}));

const walletService = require('../../services/wallet.service');

describe('Invoice Factoring Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkEligibility', () => {
    it('should return eligible for verified business with good history', async () => {
      const mockBusiness = {
        id: 'business_123',
        isVerified: true,
        trustScore: 75,
        createdAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000), // 6 months ago
      };

      const mockOrders = {
        _count: 20,
        _sum: { totalAmount: 500000 },
      };

      prisma.business.findUnique.mockResolvedValue(mockBusiness);
      prisma.order.aggregate.mockResolvedValue(mockOrders);
      prisma.factoringApplication.count.mockResolvedValue(0); // No defaults

      const result = await invoiceFactoringService.checkEligibility('business_123');

      expect(result.eligible).toBe(true);
      expect(result.maxAdvanceRate).toBeGreaterThan(0);
      expect(result.reasons).toHaveLength(0);
    });

    it('should return ineligible for unverified business', async () => {
      prisma.business.findUnique.mockResolvedValue({
        id: 'business_123',
        isVerified: false,
      });

      const result = await invoiceFactoringService.checkEligibility('business_123');

      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('Business is not verified');
    });

    it('should return ineligible for new business', async () => {
      prisma.business.findUnique.mockResolvedValue({
        id: 'business_123',
        isVerified: true,
        trustScore: 75,
        createdAt: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), // 1 month ago
      });

      const result = await invoiceFactoringService.checkEligibility('business_123');

      expect(result.eligible).toBe(false);
      expect(result.reasons).toContain('Business must be at least 3 months old');
    });

    it('should return lower advance rate for lower trust score', async () => {
      prisma.business.findUnique.mockResolvedValue({
        id: 'business_123',
        isVerified: true,
        trustScore: 50,
        createdAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      });
      prisma.order.aggregate.mockResolvedValue({ _count: 10, _sum: { totalAmount: 100000 } });
      prisma.factoringApplication.count.mockResolvedValue(0);

      const result = await invoiceFactoringService.checkEligibility('business_123');

      expect(result.eligible).toBe(true);
      expect(result.maxAdvanceRate).toBeLessThan(85); // Lower than max
    });
  });

  describe('submitApplication', () => {
    it('should create factoring application', async () => {
      const mockInvoice = {
        id: 'invoice_123',
        invoiceNumber: 'INV-001',
        totalAmount: 100000,
        invoiceDate: new Date(),
        dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        status: 'ISSUED',
        buyerId: 'buyer_123',
        buyer: { businessName: 'Buyer Corp' },
      };

      const mockApplication = {
        id: 'app_123',
        applicationNumber: 'FA2411-00001',
        businessId: 'business_123',
        invoiceId: 'invoice_123',
        invoiceAmount: 100000,
        advanceRate: 80,
        advanceAmount: 80000,
        feeRate: 2,
        feeAmount: 1600,
        status: 'SUBMITTED',
      };

      prisma.business.findUnique.mockResolvedValue({
        id: 'business_123',
        isVerified: true,
        trustScore: 75,
        createdAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      });
      prisma.order.aggregate.mockResolvedValue({ _count: 20, _sum: { totalAmount: 500000 } });
      prisma.factoringApplication.count.mockResolvedValueOnce(0).mockResolvedValueOnce(0);
      prisma.invoice.findUnique.mockResolvedValue(mockInvoice);
      prisma.factoringApplication.findFirst.mockResolvedValue(null);
      prisma.factoringApplication.create.mockResolvedValue(mockApplication);

      const result = await invoiceFactoringService.submitApplication('business_123', {
        invoiceId: 'invoice_123',
        advanceRate: 80,
        isRecourse: true,
      });

      expect(result.applicationNumber).toMatch(/^FA\d{4}-\d{5}$/);
      expect(result.advanceAmount).toBe(80000);
      expect(result.status).toBe('SUBMITTED');
    });

    it('should throw error if invoice already factored', async () => {
      prisma.business.findUnique.mockResolvedValue({
        id: 'business_123',
        isVerified: true,
        trustScore: 75,
        createdAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      });
      prisma.order.aggregate.mockResolvedValue({ _count: 20, _sum: { totalAmount: 500000 } });
      prisma.factoringApplication.count.mockResolvedValue(0);
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'invoice_123',
        status: 'ISSUED',
      });
      prisma.factoringApplication.findFirst.mockResolvedValue({
        id: 'existing_app',
        status: 'APPROVED',
      });

      await expect(invoiceFactoringService.submitApplication('business_123', {
        invoiceId: 'invoice_123',
      })).rejects.toThrow('Invoice already has an active factoring application');
    });

    it('should throw error for paid invoice', async () => {
      prisma.business.findUnique.mockResolvedValue({
        id: 'business_123',
        isVerified: true,
        trustScore: 75,
        createdAt: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
      });
      prisma.order.aggregate.mockResolvedValue({ _count: 20, _sum: { totalAmount: 500000 } });
      prisma.factoringApplication.count.mockResolvedValue(0);
      prisma.invoice.findUnique.mockResolvedValue({
        id: 'invoice_123',
        status: 'PAID',
      });

      await expect(invoiceFactoringService.submitApplication('business_123', {
        invoiceId: 'invoice_123',
      })).rejects.toThrow('Invoice is not eligible for factoring');
    });
  });

  describe('reviewApplication', () => {
    it('should approve application', async () => {
      const mockApplication = {
        id: 'app_123',
        status: 'SUBMITTED',
        businessId: 'business_123',
      };

      prisma.factoringApplication.findUnique.mockResolvedValue(mockApplication);
      prisma.factoringApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'APPROVED',
        reviewedBy: 'admin_123',
        reviewedAt: new Date(),
        approvedBy: 'admin_123',
        approvedAt: new Date(),
      });

      const result = await invoiceFactoringService.reviewApplication(
        'app_123',
        'admin_123',
        'APPROVE'
      );

      expect(result.status).toBe('APPROVED');
    });

    it('should reject application with reason', async () => {
      const mockApplication = {
        id: 'app_123',
        status: 'SUBMITTED',
      };

      prisma.factoringApplication.findUnique.mockResolvedValue(mockApplication);
      prisma.factoringApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'REJECTED',
        rejectionReason: 'High risk buyer',
      });

      const result = await invoiceFactoringService.reviewApplication(
        'app_123',
        'admin_123',
        'REJECT',
        { reason: 'High risk buyer' }
      );

      expect(result.status).toBe('REJECTED');
      expect(result.rejectionReason).toBe('High risk buyer');
    });

    it('should throw error if not in SUBMITTED status', async () => {
      prisma.factoringApplication.findUnique.mockResolvedValue({
        id: 'app_123',
        status: 'DISBURSED',
      });

      await expect(invoiceFactoringService.reviewApplication(
        'app_123',
        'admin_123',
        'APPROVE'
      )).rejects.toThrow('Application is not pending review');
    });
  });

  describe('disburse', () => {
    it('should disburse funds to wallet', async () => {
      const mockApplication = {
        id: 'app_123',
        status: 'APPROVED',
        businessId: 'business_123',
        advanceAmount: 80000,
        invoiceId: 'invoice_123',
      };

      prisma.factoringApplication.findUnique.mockResolvedValue(mockApplication);
      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      walletService.credit.mockResolvedValue({});
      prisma.factoringApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'DISBURSED',
        disbursedAt: new Date(),
        disbursementRef: 'DIS_123',
      });
      prisma.invoice.update.mockResolvedValue({});

      const result = await invoiceFactoringService.disburse('app_123', {
        reference: 'DIS_123',
      });

      expect(result.status).toBe('DISBURSED');
      expect(walletService.credit).toHaveBeenCalledWith(
        'wallet_123',
        80000,
        'INR',
        'FACTORING_DISBURSEMENT',
        'app_123',
        expect.any(String)
      );
    });

    it('should throw error if not approved', async () => {
      prisma.factoringApplication.findUnique.mockResolvedValue({
        id: 'app_123',
        status: 'SUBMITTED',
      });

      await expect(invoiceFactoringService.disburse('app_123', {}))
        .rejects.toThrow('Application is not approved');
    });
  });

  describe('settleApplication', () => {
    it('should settle application when buyer pays', async () => {
      const mockApplication = {
        id: 'app_123',
        status: 'DISBURSED',
        businessId: 'business_123',
        advanceAmount: 80000,
        invoiceAmount: 100000,
        feeAmount: 1600,
      };

      prisma.factoringApplication.findUnique.mockResolvedValue(mockApplication);
      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      walletService.credit.mockResolvedValue({});
      prisma.factoringApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'SETTLED',
        settledAt: new Date(),
        settlementAmount: 100000,
      });

      const result = await invoiceFactoringService.settleApplication('app_123', {
        amountReceived: 100000,
      });

      expect(result.status).toBe('SETTLED');
      // Remaining = invoice - advance - fee = 100000 - 80000 - 1600 = 18400
      expect(walletService.credit).toHaveBeenCalledWith(
        'wallet_123',
        18400,
        'INR',
        'FACTORING_SETTLEMENT',
        'app_123',
        expect.any(String)
      );
    });

    it('should handle partial payment', async () => {
      const mockApplication = {
        id: 'app_123',
        status: 'DISBURSED',
        businessId: 'business_123',
        advanceAmount: 80000,
        invoiceAmount: 100000,
        feeAmount: 1600,
        isRecourse: true,
      };

      prisma.factoringApplication.findUnique.mockResolvedValue(mockApplication);
      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      walletService.debit.mockResolvedValue({});
      prisma.factoringApplication.update.mockResolvedValue({
        ...mockApplication,
        settlementAmount: 70000,
      });

      const result = await invoiceFactoringService.settleApplication('app_123', {
        amountReceived: 70000,
        isPartial: true,
      });

      expect(result.settlementAmount).toBe(70000);
    });
  });

  describe('getApplications', () => {
    it('should return applications with pagination', async () => {
      const mockApplications = [
        { id: 'app_1', applicationNumber: 'FA2411-00001', status: 'APPROVED' },
        { id: 'app_2', applicationNumber: 'FA2411-00002', status: 'DISBURSED' },
      ];

      prisma.factoringApplication.findMany.mockResolvedValue(mockApplications);
      prisma.factoringApplication.count.mockResolvedValue(2);

      const result = await invoiceFactoringService.getApplications('business_123', {
        page: 1,
        limit: 10,
      });

      expect(result.applications).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
    });

    it('should filter by status', async () => {
      prisma.factoringApplication.findMany.mockResolvedValue([]);
      prisma.factoringApplication.count.mockResolvedValue(0);

      await invoiceFactoringService.getApplications('business_123', {
        status: 'DISBURSED',
      });

      expect(prisma.factoringApplication.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'DISBURSED',
          }),
        })
      );
    });
  });

  describe('calculateFee', () => {
    it('should calculate fee based on invoice amount and term', async () => {
      const fee = await invoiceFactoringService.calculateFee(100000, 30, 80);

      expect(fee.feeRate).toBeDefined();
      expect(fee.feeAmount).toBeDefined();
      expect(fee.netAdvance).toBeDefined();
    });

    it('should apply higher rate for longer terms', async () => {
      const shortTerm = await invoiceFactoringService.calculateFee(100000, 30, 80);
      const longTerm = await invoiceFactoringService.calculateFee(100000, 90, 80);

      expect(longTerm.feeRate).toBeGreaterThan(shortTerm.feeRate);
    });
  });

  describe('getPortfolioSummary', () => {
    it('should return portfolio summary', async () => {
      prisma.factoringApplication.aggregate.mockResolvedValue({
        _sum: { invoiceAmount: 1000000, advanceAmount: 800000, feeAmount: 16000 },
        _count: 10,
      });

      prisma.factoringApplication.findMany.mockResolvedValue([
        { status: 'APPROVED', _count: 3 },
        { status: 'DISBURSED', _count: 5 },
        { status: 'SETTLED', _count: 2 },
      ]);

      const result = await invoiceFactoringService.getPortfolioSummary('business_123');

      expect(result.totalInvoiceValue).toBe(1000000);
      expect(result.totalAdvanced).toBe(800000);
      expect(result.totalFees).toBe(16000);
    });
  });

  describe('handleDefault', () => {
    it('should mark application as defaulted for recourse', async () => {
      const mockApplication = {
        id: 'app_123',
        status: 'DISBURSED',
        businessId: 'business_123',
        advanceAmount: 80000,
        isRecourse: true,
        invoiceDueDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000), // 90 days overdue
      };

      prisma.factoringApplication.findUnique.mockResolvedValue(mockApplication);
      prisma.wallet.findFirst.mockResolvedValue({ id: 'wallet_123' });
      walletService.debit.mockResolvedValue({});
      prisma.factoringApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'DEFAULTED',
      });

      const result = await invoiceFactoringService.handleDefault('app_123');

      expect(result.status).toBe('DEFAULTED');
      expect(walletService.debit).toHaveBeenCalled();
    });

    it('should not debit for non-recourse factoring', async () => {
      const mockApplication = {
        id: 'app_123',
        status: 'DISBURSED',
        isRecourse: false,
        invoiceDueDate: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      };

      prisma.factoringApplication.findUnique.mockResolvedValue(mockApplication);
      prisma.factoringApplication.update.mockResolvedValue({
        ...mockApplication,
        status: 'DEFAULTED',
      });

      const result = await invoiceFactoringService.handleDefault('app_123');

      expect(result.status).toBe('DEFAULTED');
      expect(walletService.debit).not.toHaveBeenCalled();
    });
  });
});
