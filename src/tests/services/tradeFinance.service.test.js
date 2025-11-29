// =============================================================================
// AIRAVAT B2B MARKETPLACE - TRADE FINANCE SERVICE TESTS
// =============================================================================

const tradeFinanceService = require('../../services/tradeFinance.service');
const { prisma } = require('../../config/database');

// Mock dependencies
jest.mock('../../config/database', () => ({
  prisma: {
    letterOfCredit: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    lCAmendment: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    lCPresentation: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
    },
    lCDocument: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
    },
    business: {
      findUnique: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

describe('Trade Finance Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('createLC', () => {
    it('should create a new letter of credit', async () => {
      const mockLC = {
        id: 'lc_123',
        lcNumber: 'LC2411-00001',
        applicantId: 'business_123',
        beneficiaryId: 'business_456',
        type: 'IRREVOCABLE',
        amount: 1000000,
        currency: 'INR',
        status: 'DRAFT',
      };

      prisma.letterOfCredit.count.mockResolvedValue(0);
      prisma.letterOfCredit.create.mockResolvedValue(mockLC);

      const result = await tradeFinanceService.createLC('business_123', {
        beneficiaryId: 'business_456',
        type: 'IRREVOCABLE',
        amount: 1000000,
        currency: 'INR',
        issuingBank: 'State Bank of India',
        issuingBankSwift: 'SBININBB',
        goodsDescription: 'Industrial machinery',
        expiryDate: new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      });

      expect(result.lcNumber).toMatch(/^LC\d{4}-\d{5}$/);
      expect(result.status).toBe('DRAFT');
      expect(prisma.letterOfCredit.create).toHaveBeenCalled();
    });

    it('should include tolerance and payment terms', async () => {
      const mockLC = {
        id: 'lc_123',
        tolerance: 5,
        paymentTerms: 'USANCE',
        usanceDays: 60,
      };

      prisma.letterOfCredit.count.mockResolvedValue(0);
      prisma.letterOfCredit.create.mockResolvedValue(mockLC);

      const result = await tradeFinanceService.createLC('business_123', {
        beneficiaryId: 'business_456',
        amount: 500000,
        tolerance: 5,
        paymentTerms: 'USANCE',
        usanceDays: 60,
        issuingBank: 'HDFC Bank',
        goodsDescription: 'Textiles',
        expiryDate: new Date(Date.now() + 60 * 24 * 60 * 60 * 1000),
      });

      expect(result.tolerance).toBe(5);
      expect(result.paymentTerms).toBe('USANCE');
      expect(result.usanceDays).toBe(60);
    });
  });

  describe('submitLC', () => {
    it('should submit draft LC for issuance', async () => {
      const mockLC = {
        id: 'lc_123',
        status: 'DRAFT',
        applicantId: 'business_123',
      };

      prisma.letterOfCredit.findUnique.mockResolvedValue(mockLC);
      prisma.letterOfCredit.update.mockResolvedValue({
        ...mockLC,
        status: 'SUBMITTED',
      });

      const result = await tradeFinanceService.submitLC('lc_123', 'business_123');

      expect(result.status).toBe('SUBMITTED');
    });

    it('should throw error if LC not in draft status', async () => {
      prisma.letterOfCredit.findUnique.mockResolvedValue({
        id: 'lc_123',
        status: 'ISSUED',
        applicantId: 'business_123',
      });

      await expect(tradeFinanceService.submitLC('lc_123', 'business_123'))
        .rejects.toThrow('LC can only be submitted from draft status');
    });

    it('should throw error if not applicant', async () => {
      prisma.letterOfCredit.findUnique.mockResolvedValue({
        id: 'lc_123',
        status: 'DRAFT',
        applicantId: 'business_456',
      });

      await expect(tradeFinanceService.submitLC('lc_123', 'business_123'))
        .rejects.toThrow('Only applicant can submit LC');
    });
  });

  describe('issueLC', () => {
    it('should issue submitted LC', async () => {
      const mockLC = {
        id: 'lc_123',
        status: 'SUBMITTED',
      };

      prisma.letterOfCredit.findUnique.mockResolvedValue(mockLC);
      prisma.letterOfCredit.update.mockResolvedValue({
        ...mockLC,
        status: 'ISSUED',
        issuedAt: new Date(),
      });

      const result = await tradeFinanceService.issueLC('lc_123', 'admin_123');

      expect(result.status).toBe('ISSUED');
      expect(result.issuedAt).toBeDefined();
    });
  });

  describe('adviseLC', () => {
    it('should advise issued LC to beneficiary', async () => {
      const mockLC = {
        id: 'lc_123',
        status: 'ISSUED',
      };

      prisma.letterOfCredit.findUnique.mockResolvedValue(mockLC);
      prisma.letterOfCredit.update.mockResolvedValue({
        ...mockLC,
        status: 'ADVISED',
        advisedAt: new Date(),
      });

      const result = await tradeFinanceService.adviseLC('lc_123', 'admin_123', {
        advisingBank: 'ICICI Bank',
      });

      expect(result.status).toBe('ADVISED');
    });
  });

  describe('confirmLC', () => {
    it('should add confirmation to advised LC', async () => {
      const mockLC = {
        id: 'lc_123',
        status: 'ADVISED',
        type: 'IRREVOCABLE',
      };

      prisma.letterOfCredit.findUnique.mockResolvedValue(mockLC);
      prisma.letterOfCredit.update.mockResolvedValue({
        ...mockLC,
        status: 'CONFIRMED',
        confirmedAt: new Date(),
        confirmingBank: 'Axis Bank',
      });

      const result = await tradeFinanceService.confirmLC('lc_123', 'admin_123', {
        confirmingBank: 'Axis Bank',
      });

      expect(result.status).toBe('CONFIRMED');
      expect(result.confirmingBank).toBe('Axis Bank');
    });
  });

  describe('requestAmendment', () => {
    it('should create amendment request', async () => {
      const mockLC = {
        id: 'lc_123',
        status: 'ISSUED',
        applicantId: 'business_123',
      };

      const mockAmendment = {
        id: 'amend_123',
        lcId: 'lc_123',
        amendmentNumber: 1,
        status: 'REQUESTED',
      };

      prisma.letterOfCredit.findUnique.mockResolvedValue(mockLC);
      prisma.lCAmendment.count.mockResolvedValue(0);
      prisma.lCAmendment.create.mockResolvedValue(mockAmendment);

      const result = await tradeFinanceService.requestAmendment('lc_123', 'business_123', {
        description: 'Extend expiry date',
        changes: { expiryDate: '2024-12-31' },
      });

      expect(result.amendmentNumber).toBe(1);
      expect(result.status).toBe('REQUESTED');
    });

    it('should increment amendment number', async () => {
      const mockLC = {
        id: 'lc_123',
        status: 'ISSUED',
        applicantId: 'business_123',
      };

      prisma.letterOfCredit.findUnique.mockResolvedValue(mockLC);
      prisma.lCAmendment.count.mockResolvedValue(2);
      prisma.lCAmendment.create.mockResolvedValue({
        id: 'amend_123',
        amendmentNumber: 3,
      });

      const result = await tradeFinanceService.requestAmendment('lc_123', 'business_123', {
        description: 'Increase amount',
        changes: { amount: 1500000 },
      });

      expect(result.amendmentNumber).toBe(3);
    });
  });

  describe('approveAmendment', () => {
    it('should approve pending amendment', async () => {
      const mockAmendment = {
        id: 'amend_123',
        lcId: 'lc_123',
        status: 'REQUESTED',
        changes: { amount: 1500000 },
      };

      prisma.lCAmendment.findUnique.mockResolvedValue(mockAmendment);
      prisma.lCAmendment.update.mockResolvedValue({
        ...mockAmendment,
        status: 'APPROVED',
      });
      prisma.letterOfCredit.update.mockResolvedValue({
        id: 'lc_123',
        amount: 1500000,
      });

      const result = await tradeFinanceService.approveAmendment('amend_123', 'admin_123');

      expect(result.status).toBe('APPROVED');
      expect(prisma.letterOfCredit.update).toHaveBeenCalled();
    });
  });

  describe('presentDocuments', () => {
    it('should create document presentation', async () => {
      const mockLC = {
        id: 'lc_123',
        status: 'ADVISED',
        beneficiaryId: 'business_456',
        requiredDocuments: ['BILL_OF_LADING', 'COMMERCIAL_INVOICE'],
      };

      const mockPresentation = {
        id: 'pres_123',
        lcId: 'lc_123',
        presentationNumber: 1,
        status: 'PENDING',
      };

      prisma.letterOfCredit.findUnique.mockResolvedValue(mockLC);
      prisma.lCPresentation.count.mockResolvedValue(0);
      prisma.lCPresentation.create.mockResolvedValue(mockPresentation);
      prisma.lCDocument.create.mockResolvedValue({});

      const result = await tradeFinanceService.presentDocuments('lc_123', 'business_456', {
        documents: [
          { type: 'BILL_OF_LADING', documentNumber: 'BL001', fileUrl: 'http://...' },
          { type: 'COMMERCIAL_INVOICE', documentNumber: 'INV001', fileUrl: 'http://...' },
        ],
      });

      expect(result.presentationNumber).toBe(1);
      expect(result.status).toBe('PENDING');
    });
  });

  describe('examineDocuments', () => {
    it('should mark presentation as compliant', async () => {
      const mockPresentation = {
        id: 'pres_123',
        lcId: 'lc_123',
        status: 'UNDER_EXAMINATION',
      };

      prisma.lCPresentation.findUnique.mockResolvedValue(mockPresentation);
      prisma.lCPresentation.update.mockResolvedValue({
        ...mockPresentation,
        status: 'COMPLIANT',
      });

      const result = await tradeFinanceService.examineDocuments('pres_123', 'admin_123', {
        status: 'COMPLIANT',
      });

      expect(result.status).toBe('COMPLIANT');
    });

    it('should mark presentation as discrepant with reasons', async () => {
      const mockPresentation = {
        id: 'pres_123',
        lcId: 'lc_123',
        status: 'UNDER_EXAMINATION',
      };

      prisma.lCPresentation.findUnique.mockResolvedValue(mockPresentation);
      prisma.lCPresentation.update.mockResolvedValue({
        ...mockPresentation,
        status: 'DISCREPANT',
        discrepancies: ['Late shipment', 'Missing certificate'],
      });

      const result = await tradeFinanceService.examineDocuments('pres_123', 'admin_123', {
        status: 'DISCREPANT',
        discrepancies: ['Late shipment', 'Missing certificate'],
      });

      expect(result.status).toBe('DISCREPANT');
      expect(result.discrepancies).toContain('Late shipment');
    });
  });

  describe('processPayment', () => {
    it('should process LC payment', async () => {
      const mockLC = {
        id: 'lc_123',
        status: 'CONFIRMED',
        amount: 1000000,
        paidAmount: 0,
      };

      prisma.letterOfCredit.findUnique.mockResolvedValue(mockLC);
      prisma.letterOfCredit.update.mockResolvedValue({
        ...mockLC,
        status: 'PAID',
        paidAmount: 1000000,
        paidAt: new Date(),
      });

      const result = await tradeFinanceService.processPayment('lc_123', 'admin_123', {
        amount: 1000000,
        paymentRef: 'PAY_123',
      });

      expect(result.status).toBe('PAID');
      expect(result.paidAmount).toBe(1000000);
    });

    it('should handle partial payment', async () => {
      const mockLC = {
        id: 'lc_123',
        status: 'CONFIRMED',
        amount: 1000000,
        paidAmount: 0,
      };

      prisma.letterOfCredit.findUnique.mockResolvedValue(mockLC);
      prisma.letterOfCredit.update.mockResolvedValue({
        ...mockLC,
        paidAmount: 500000,
      });

      const result = await tradeFinanceService.processPayment('lc_123', 'admin_123', {
        amount: 500000,
        paymentRef: 'PAY_123',
      });

      expect(result.paidAmount).toBe(500000);
    });
  });

  describe('getApplicantLCs', () => {
    it('should return LCs for applicant with pagination', async () => {
      const mockLCs = [
        { id: 'lc_1', lcNumber: 'LC2411-00001', amount: 1000000 },
        { id: 'lc_2', lcNumber: 'LC2411-00002', amount: 500000 },
      ];

      prisma.letterOfCredit.findMany.mockResolvedValue(mockLCs);
      prisma.letterOfCredit.count.mockResolvedValue(2);

      const result = await tradeFinanceService.getApplicantLCs('business_123', {
        page: 1,
        limit: 10,
      });

      expect(result.lcs).toHaveLength(2);
      expect(result.pagination.total).toBe(2);
    });

    it('should filter by status', async () => {
      prisma.letterOfCredit.findMany.mockResolvedValue([
        { id: 'lc_1', status: 'ACTIVE' },
      ]);
      prisma.letterOfCredit.count.mockResolvedValue(1);

      await tradeFinanceService.getApplicantLCs('business_123', {
        status: 'ACTIVE',
      });

      expect(prisma.letterOfCredit.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: 'ACTIVE',
          }),
        })
      );
    });
  });

  describe('getLCSummary', () => {
    it('should return LC summary for business', async () => {
      const mockLCs = [
        { id: 'lc_1', amount: 1000000, status: 'ISSUED' },
        { id: 'lc_2', amount: 500000, status: 'PAID' },
        { id: 'lc_3', amount: 750000, status: 'ISSUED' },
      ];

      prisma.letterOfCredit.findMany.mockResolvedValue(mockLCs);

      const result = await tradeFinanceService.getLCSummary('business_123');

      expect(result.totalLCs).toBe(3);
      expect(result.totalValue).toBe(2250000);
      expect(result.byStatus.ISSUED).toBeDefined();
      expect(result.byStatus.PAID).toBeDefined();
    });
  });

  describe('checkLCExpirations', () => {
    it('should mark expired LCs', async () => {
      prisma.letterOfCredit.updateMany.mockResolvedValue({ count: 3 });

      const result = await tradeFinanceService.checkLCExpirations();

      expect(prisma.letterOfCredit.updateMany).toHaveBeenCalledWith({
        where: {
          status: { notIn: ['EXPIRED', 'PAID', 'CANCELLED'] },
          expiryDate: { lt: expect.any(Date) },
        },
        data: { status: 'EXPIRED' },
      });
      expect(result.expired).toBe(3);
    });

    it('should return LCs expiring soon', async () => {
      const expiringLCs = [
        { id: 'lc_1', lcNumber: 'LC001', expiryDate: new Date() },
      ];

      prisma.letterOfCredit.updateMany.mockResolvedValue({ count: 0 });
      prisma.letterOfCredit.findMany.mockResolvedValue(expiringLCs);

      const result = await tradeFinanceService.checkLCExpirations();

      expect(result.expiringSoon).toHaveLength(1);
    });
  });
});
