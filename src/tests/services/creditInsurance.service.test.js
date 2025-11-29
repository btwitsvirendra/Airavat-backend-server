// =============================================================================
// AIRAVAT B2B MARKETPLACE - CREDIT INSURANCE SERVICE TESTS
// =============================================================================

const creditInsuranceService = require('../../services/creditInsurance.service');
const { prisma } = require('../../config/database');

// Mock dependencies
jest.mock('../../config/database', () => ({
  prisma: {
    creditInsurancePolicy: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    insuredBuyer: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
    },
    insuranceClaim: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findFirst: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    business: {
      findUnique: jest.fn(),
    },
    order: {
      aggregate: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock('../../services/wallet.service', () => ({
  credit: jest.fn(),
}));

describe('Credit Insurance Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getQuote', () => {
    it('should calculate quote for whole turnover coverage', async () => {
      const mockBusiness = {
        id: 'business_123',
        trustScore: 80,
      };

      prisma.business.findUnique.mockResolvedValue(mockBusiness);
      prisma.order.aggregate.mockResolvedValue({
        _sum: { totalAmount: 1000000 },
        _count: 50,
      });
      prisma.order.count
        .mockResolvedValueOnce(50) // total orders
        .mockResolvedValueOnce(48); // on-time orders

      const result = await creditInsuranceService.getQuote('business_123', {
        coverageType: 'WHOLE_TURNOVER',
        coverageLimit: 5000000,
        validityMonths: 12,
      });

      expect(result.premiumRate).toBeGreaterThan(0);
      expect(result.premiumAmount).toBeGreaterThan(0);
      expect(result.coverageLimit).toBe(5000000);
      expect(result.terms).toBeDefined();
    });

    it('should apply higher rate for specific buyers coverage', async () => {
      const mockBusiness = { id: 'business_123', trustScore: 70 };

      prisma.business.findUnique.mockResolvedValue(mockBusiness);
      prisma.order.aggregate.mockResolvedValue({ _sum: { totalAmount: 500000 }, _count: 20 });
      prisma.order.count.mockResolvedValue(20);

      const wholeTurnoverQuote = await creditInsuranceService.getQuote('business_123', {
        coverageType: 'WHOLE_TURNOVER',
        coverageLimit: 1000000,
      });

      const specificBuyersQuote = await creditInsuranceService.getQuote('business_123', {
        coverageType: 'SPECIFIC_BUYERS',
        coverageLimit: 1000000,
      });

      expect(specificBuyersQuote.premiumRate).toBeGreaterThan(wholeTurnoverQuote.premiumRate);
    });

    it('should throw error if business not found', async () => {
      prisma.business.findUnique.mockResolvedValue(null);

      await expect(creditInsuranceService.getQuote('invalid_business', {}))
        .rejects.toThrow('Business not found');
    });
  });

  describe('assessBuyerRisk', () => {
    it('should return grade A for excellent payment history', async () => {
      const mockBusiness = {
        id: 'buyer_123',
        trustScore: 90,
      };

      prisma.business.findUnique.mockResolvedValue(mockBusiness);
      prisma.order.aggregate.mockResolvedValue({
        _sum: { totalAmount: 2000000 },
        _count: 100,
      });
      prisma.order.count
        .mockResolvedValueOnce(100) // total orders
        .mockResolvedValueOnce(98); // on-time payments

      const result = await creditInsuranceService.assessBuyerRisk('buyer_123');

      expect(result.riskGrade).toBe('A');
      expect(result.maxCoveragePercent).toBe(100);
    });

    it('should return grade D for poor payment history', async () => {
      const mockBusiness = {
        id: 'buyer_123',
        trustScore: 40,
      };

      prisma.business.findUnique.mockResolvedValue(mockBusiness);
      prisma.order.aggregate.mockResolvedValue({
        _sum: { totalAmount: 100000 },
        _count: 10,
      });
      prisma.order.count
        .mockResolvedValueOnce(10) // total orders
        .mockResolvedValueOnce(5); // on-time payments (50%)

      const result = await creditInsuranceService.assessBuyerRisk('buyer_123');

      expect(result.riskGrade).toBe('D');
      expect(result.maxCoveragePercent).toBe(40);
    });
  });

  describe('createPolicy', () => {
    it('should create policy with generated number', async () => {
      const mockPolicy = {
        id: 'policy_123',
        policyNumber: 'CIP2411-00001',
        businessId: 'business_123',
        status: 'PENDING',
        coverageType: 'WHOLE_TURNOVER',
        coverageLimit: 5000000,
      };

      prisma.creditInsurancePolicy.count.mockResolvedValue(0);
      prisma.creditInsurancePolicy.create.mockResolvedValue(mockPolicy);

      const result = await creditInsuranceService.createPolicy('business_123', {
        coverageType: 'WHOLE_TURNOVER',
        coverageLimit: 5000000,
        premiumAmount: 7500,
        validityMonths: 12,
      });

      expect(result.policyNumber).toMatch(/^CIP\d{4}-\d{5}$/);
      expect(result.status).toBe('PENDING');
    });

    it('should create policy with covered buyers for specific coverage', async () => {
      const mockPolicy = {
        id: 'policy_123',
        policyNumber: 'CIP2411-00001',
        coverageType: 'SPECIFIC_BUYERS',
      };

      prisma.creditInsurancePolicy.count.mockResolvedValue(0);
      prisma.creditInsurancePolicy.create.mockResolvedValue(mockPolicy);
      prisma.insuredBuyer.create.mockResolvedValue({});
      prisma.business.findUnique.mockResolvedValue({ id: 'buyer_1', trustScore: 75 });
      prisma.order.aggregate.mockResolvedValue({ _sum: { totalAmount: 100000 }, _count: 10 });
      prisma.order.count.mockResolvedValue(10);

      const result = await creditInsuranceService.createPolicy('business_123', {
        coverageType: 'SPECIFIC_BUYERS',
        coverageLimit: 1000000,
        buyers: [
          { buyerBusinessId: 'buyer_1', creditLimit: 200000 },
        ],
      });

      expect(prisma.insuredBuyer.create).toHaveBeenCalled();
    });
  });

  describe('activatePolicy', () => {
    it('should activate pending policy after payment', async () => {
      const mockPolicy = {
        id: 'policy_123',
        status: 'PENDING',
        startDate: new Date(),
      };

      prisma.creditInsurancePolicy.findUnique.mockResolvedValue(mockPolicy);
      prisma.creditInsurancePolicy.update.mockResolvedValue({
        ...mockPolicy,
        status: 'ACTIVE',
      });

      const result = await creditInsuranceService.activatePolicy('policy_123', {
        paymentRef: 'PAY_123',
        paymentDate: new Date(),
      });

      expect(result.status).toBe('ACTIVE');
    });

    it('should throw error if policy not pending', async () => {
      prisma.creditInsurancePolicy.findUnique.mockResolvedValue({
        id: 'policy_123',
        status: 'ACTIVE',
      });

      await expect(creditInsuranceService.activatePolicy('policy_123', {}))
        .rejects.toThrow('Policy is not pending activation');
    });
  });

  describe('checkClaimEligibility', () => {
    it('should return eligible for valid claim', async () => {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - 100); // 100 days overdue

      const mockPolicy = {
        id: 'policy_123',
        status: 'ACTIVE',
        startDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        coverageLimit: 1000000,
        usedCoverage: 200000,
        deductiblePercent: 10,
        insuredBuyers: [
          {
            buyerBusinessId: 'buyer_123',
            creditLimit: 300000,
            usedLimit: 50000,
            status: 'ACTIVE',
          },
        ],
      };

      prisma.creditInsurancePolicy.findUnique.mockResolvedValue(mockPolicy);
      prisma.insuranceClaim.findFirst.mockResolvedValue(null);

      const result = await creditInsuranceService.checkClaimEligibility('policy_123', {
        buyerBusinessId: 'buyer_123',
        invoiceId: 'inv_123',
        invoiceAmount: 100000,
        invoiceDueDate: dueDate,
      });

      expect(result.eligible).toBe(true);
      expect(result.deductible).toBe(10000);
      expect(result.payableAmount).toBe(90000);
    });

    it('should return ineligible if waiting period not met', async () => {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - 30); // Only 30 days overdue

      const mockPolicy = {
        id: 'policy_123',
        status: 'ACTIVE',
        startDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        insuredBuyers: [{ buyerBusinessId: 'buyer_123', status: 'ACTIVE' }],
      };

      prisma.creditInsurancePolicy.findUnique.mockResolvedValue(mockPolicy);

      const result = await creditInsuranceService.checkClaimEligibility('policy_123', {
        buyerBusinessId: 'buyer_123',
        invoiceId: 'inv_123',
        invoiceAmount: 100000,
        invoiceDueDate: dueDate,
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('waiting period');
    });

    it('should return ineligible if duplicate claim exists', async () => {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - 100);

      const mockPolicy = {
        id: 'policy_123',
        status: 'ACTIVE',
        startDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        insuredBuyers: [{ buyerBusinessId: 'buyer_123', status: 'ACTIVE' }],
      };

      prisma.creditInsurancePolicy.findUnique.mockResolvedValue(mockPolicy);
      prisma.insuranceClaim.findFirst.mockResolvedValue({
        id: 'existing_claim',
        invoiceId: 'inv_123',
      });

      const result = await creditInsuranceService.checkClaimEligibility('policy_123', {
        buyerBusinessId: 'buyer_123',
        invoiceId: 'inv_123',
        invoiceAmount: 100000,
        invoiceDueDate: dueDate,
      });

      expect(result.eligible).toBe(false);
      expect(result.reason).toContain('already exists');
    });
  });

  describe('fileClaim', () => {
    it('should create claim with generated number', async () => {
      const dueDate = new Date();
      dueDate.setDate(dueDate.getDate() - 100);

      const mockPolicy = {
        id: 'policy_123',
        status: 'ACTIVE',
        startDate: new Date(Date.now() - 180 * 24 * 60 * 60 * 1000),
        endDate: new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
        coverageLimit: 1000000,
        usedCoverage: 0,
        deductiblePercent: 10,
        insuredBuyers: [
          {
            id: 'insured_buyer_1',
            buyerBusinessId: 'buyer_123',
            creditLimit: 300000,
            usedLimit: 0,
            status: 'ACTIVE',
          },
        ],
      };

      const mockClaim = {
        id: 'claim_123',
        claimNumber: 'CLM2411-00001',
        status: 'SUBMITTED',
        invoiceAmount: 100000,
        claimAmount: 90000,
      };

      prisma.creditInsurancePolicy.findUnique.mockResolvedValue(mockPolicy);
      prisma.insuranceClaim.findFirst.mockResolvedValue(null);
      prisma.insuranceClaim.count.mockResolvedValue(0);
      prisma.insuranceClaim.create.mockResolvedValue(mockClaim);
      prisma.creditInsurancePolicy.update.mockResolvedValue({});
      prisma.insuredBuyer.update.mockResolvedValue({});

      const result = await creditInsuranceService.fileClaim('policy_123', {
        buyerBusinessId: 'buyer_123',
        invoiceId: 'inv_123',
        invoiceNumber: 'INV-001',
        invoiceAmount: 100000,
        invoiceDueDate: dueDate,
      });

      expect(result.claimNumber).toMatch(/^CLM\d{4}-\d{5}$/);
      expect(result.status).toBe('SUBMITTED');
      expect(result.claimAmount).toBe(90000);
    });
  });

  describe('approveClaim', () => {
    it('should approve claim under review', async () => {
      const mockClaim = {
        id: 'claim_123',
        status: 'UNDER_REVIEW',
        policyId: 'policy_123',
      };

      prisma.insuranceClaim.findUnique.mockResolvedValue(mockClaim);
      prisma.insuranceClaim.update.mockResolvedValue({
        ...mockClaim,
        status: 'APPROVED',
      });

      const result = await creditInsuranceService.approveClaim('claim_123', 'admin_123');

      expect(result.status).toBe('APPROVED');
    });
  });

  describe('settleClaim', () => {
    it('should settle approved claim and credit wallet', async () => {
      const mockClaim = {
        id: 'claim_123',
        status: 'APPROVED',
        policyId: 'policy_123',
        claimAmount: 90000,
        policy: {
          businessId: 'business_123',
          business: {
            wallet: { id: 'wallet_123' },
          },
        },
      };

      prisma.insuranceClaim.findUnique.mockResolvedValue(mockClaim);
      prisma.insuranceClaim.update.mockResolvedValue({
        ...mockClaim,
        status: 'SETTLED',
        settlementAmount: 90000,
      });

      const walletService = require('../../services/wallet.service');
      walletService.credit.mockResolvedValue({});

      const result = await creditInsuranceService.settleClaim('claim_123', {
        settlementAmount: 90000,
        settlementRef: 'SETTLE_123',
      });

      expect(result.status).toBe('SETTLED');
      expect(walletService.credit).toHaveBeenCalledWith(
        'wallet_123',
        90000,
        expect.any(Object)
      );
    });
  });

  describe('getPolicySummary', () => {
    it('should return comprehensive policy summary', async () => {
      const mockPolicy = {
        id: 'policy_123',
        policyNumber: 'CIP2411-00001',
        coverageLimit: 1000000,
        usedCoverage: 200000,
        premiumAmount: 15000,
        status: 'ACTIVE',
        insuredBuyers: [
          { id: 'buyer_1', creditLimit: 300000, usedLimit: 100000, status: 'ACTIVE' },
          { id: 'buyer_2', creditLimit: 200000, usedLimit: 50000, status: 'ACTIVE' },
        ],
      };

      prisma.creditInsurancePolicy.findUnique.mockResolvedValue(mockPolicy);
      prisma.insuranceClaim.aggregate.mockResolvedValue({
        _sum: { claimAmount: 150000, settlementAmount: 135000 },
      });
      prisma.insuranceClaim.count
        .mockResolvedValueOnce(3) // submitted
        .mockResolvedValueOnce(1) // under review
        .mockResolvedValueOnce(1) // approved
        .mockResolvedValueOnce(0) // rejected
        .mockResolvedValueOnce(1); // settled

      const result = await creditInsuranceService.getPolicySummary('policy_123');

      expect(result.coverageUtilization).toBe(20); // 200000/1000000 * 100
      expect(result.claims.total).toBe(6);
      expect(result.buyers.total).toBe(2);
    });
  });
});
