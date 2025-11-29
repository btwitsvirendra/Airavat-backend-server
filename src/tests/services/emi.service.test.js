// =============================================================================
// AIRAVAT B2B MARKETPLACE - EMI SERVICE TESTS
// =============================================================================

const emiService = require('../../services/emi.service');
const { prisma } = require('../../config/database');

// Mock dependencies
jest.mock('../../config/database', () => ({
  prisma: {
    eMIPlan: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    eMIOrder: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      aggregate: jest.fn(),
    },
    eMIInstallment: {
      create: jest.fn(),
      createMany: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      updateMany: jest.fn(),
      count: jest.fn(),
    },
    order: {
      update: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

describe('EMI Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('calculateEMI', () => {
    it('should calculate EMI correctly', () => {
      const result = emiService.calculateEMI(100000, 12, 12, 1.5);

      expect(result.emiAmount).toBeGreaterThan(0);
      expect(result.totalAmount).toBeGreaterThan(100000);
      expect(result.totalInterest).toBeGreaterThan(0);
      expect(result.amortizationSchedule).toHaveLength(12);
    });

    it('should calculate EMI for 0% interest', () => {
      const result = emiService.calculateEMI(120000, 12, 0, 0);

      expect(result.emiAmount).toBe(10000);
      expect(result.totalInterest).toBe(0);
    });

    it('should include processing fee in total', () => {
      const result = emiService.calculateEMI(100000, 12, 12, 2);

      expect(result.processingFee).toBe(2000);
      expect(result.totalAmount).toBeGreaterThan(result.principalAmount + result.totalInterest);
    });
  });

  describe('getAvailablePlans', () => {
    it('should return eligible EMI plans', async () => {
      const mockPlans = [
        {
          id: 'plan_1',
          name: '3 Month EMI',
          tenureMonths: 3,
          interestRate: 12,
          processingFee: 1.5,
          minAmount: 1000,
          maxAmount: 1000000,
          isActive: true,
        },
        {
          id: 'plan_2',
          name: '6 Month EMI',
          tenureMonths: 6,
          interestRate: 10,
          processingFee: 1,
          minAmount: 5000,
          maxAmount: 500000,
          isActive: true,
        },
      ];

      prisma.eMIPlan.findMany.mockResolvedValue(mockPlans);

      const result = await emiService.getAvailablePlans(50000, {});

      expect(result).toHaveLength(2);
      expect(result[0].emiDetails).toBeDefined();
      expect(result[0].emiDetails.emiAmount).toBeGreaterThan(0);
    });

    it('should filter out plans below minimum amount', async () => {
      const mockPlans = [
        {
          id: 'plan_1',
          tenureMonths: 3,
          interestRate: 12,
          processingFee: 1.5,
          minAmount: 10000,
          maxAmount: 1000000,
          isActive: true,
        },
      ];

      prisma.eMIPlan.findMany.mockResolvedValue(mockPlans);

      const result = await emiService.getAvailablePlans(5000, {});

      expect(result).toHaveLength(0);
    });
  });

  describe('createEMIOrder', () => {
    it('should create EMI order with installments', async () => {
      const mockPlan = {
        id: 'plan_1',
        tenureMonths: 3,
        interestRate: 12,
        processingFee: 1.5,
      };

      const mockOrder = {
        id: 'order_123',
        totalAmount: 30000,
      };

      const mockEMIOrder = {
        id: 'emi_order_123',
        orderId: 'order_123',
        userId: 'user_123',
        principalAmount: 30000,
        tenureMonths: 3,
        status: 'PENDING_APPROVAL',
      };

      prisma.eMIPlan.findUnique.mockResolvedValue(mockPlan);
      prisma.eMIOrder.create.mockResolvedValue(mockEMIOrder);
      prisma.eMIInstallment.createMany.mockResolvedValue({ count: 3 });

      const result = await emiService.createEMIOrder('order_123', 'plan_1', 'user_123', {
        orderAmount: 30000,
      });

      expect(prisma.eMIOrder.create).toHaveBeenCalled();
      expect(prisma.eMIInstallment.createMany).toHaveBeenCalled();
      expect(result.id).toBe('emi_order_123');
    });

    it('should throw error if plan not found', async () => {
      prisma.eMIPlan.findUnique.mockResolvedValue(null);

      await expect(emiService.createEMIOrder('order_123', 'invalid_plan', 'user_123', {}))
        .rejects.toThrow('EMI plan not found');
    });
  });

  describe('approveEMIOrder', () => {
    it('should approve pending EMI order', async () => {
      const mockEMIOrder = {
        id: 'emi_order_123',
        orderId: 'order_123',
        status: 'PENDING_APPROVAL',
      };

      prisma.eMIOrder.findUnique.mockResolvedValue(mockEMIOrder);
      prisma.eMIOrder.update.mockResolvedValue({ ...mockEMIOrder, status: 'ACTIVE' });
      prisma.order.update.mockResolvedValue({});

      const result = await emiService.approveEMIOrder('emi_order_123', 'admin_123');

      expect(prisma.eMIOrder.update).toHaveBeenCalledWith({
        where: { id: 'emi_order_123' },
        data: expect.objectContaining({
          status: 'ACTIVE',
        }),
      });
      expect(result.status).toBe('ACTIVE');
    });

    it('should throw error if EMI order not pending', async () => {
      const mockEMIOrder = {
        id: 'emi_order_123',
        status: 'ACTIVE',
      };

      prisma.eMIOrder.findUnique.mockResolvedValue(mockEMIOrder);

      await expect(emiService.approveEMIOrder('emi_order_123', 'admin_123'))
        .rejects.toThrow('EMI order is not pending approval');
    });
  });

  describe('payInstallment', () => {
    it('should pay installment and update EMI order', async () => {
      const mockInstallment = {
        id: 'installment_1',
        emiOrderId: 'emi_order_123',
        amount: 10000,
        status: 'PENDING',
        lateFee: 0,
      };

      const mockEMIOrder = {
        id: 'emi_order_123',
        tenureMonths: 3,
        paidInstallments: 0,
        paidAmount: 0,
        remainingAmount: 30000,
      };

      prisma.eMIInstallment.findUnique.mockResolvedValue(mockInstallment);
      prisma.eMIOrder.findUnique.mockResolvedValue(mockEMIOrder);
      prisma.eMIInstallment.update.mockResolvedValue({ ...mockInstallment, status: 'PAID' });
      prisma.eMIOrder.update.mockResolvedValue({});

      const result = await emiService.payInstallment('installment_1', {
        paymentId: 'pay_123',
        transactionRef: 'TXN123',
      });

      expect(prisma.eMIInstallment.update).toHaveBeenCalledWith({
        where: { id: 'installment_1' },
        data: expect.objectContaining({
          status: 'PAID',
          paidDate: expect.any(Date),
        }),
      });
    });

    it('should include late fee in payment', async () => {
      const mockInstallment = {
        id: 'installment_1',
        emiOrderId: 'emi_order_123',
        amount: 10000,
        status: 'OVERDUE',
        lateFee: 200,
      };

      prisma.eMIInstallment.findUnique.mockResolvedValue(mockInstallment);
      prisma.eMIOrder.findUnique.mockResolvedValue({
        id: 'emi_order_123',
        tenureMonths: 3,
        paidInstallments: 0,
        paidAmount: 0,
        remainingAmount: 30000,
      });
      prisma.eMIInstallment.update.mockResolvedValue({ ...mockInstallment, status: 'PAID' });
      prisma.eMIOrder.update.mockResolvedValue({});

      const result = await emiService.payInstallment('installment_1', {
        paymentId: 'pay_123',
        amount: 10200,
      });

      expect(result.success).toBe(true);
    });
  });

  describe('calculateForeclosureAmount', () => {
    it('should calculate foreclosure amount correctly', async () => {
      const mockEMIOrder = {
        id: 'emi_order_123',
        principalAmount: 100000,
        paidAmount: 30000,
        remainingAmount: 70000,
        status: 'ACTIVE',
        installments: [
          { status: 'PAID', amount: 10000, principalComponent: 8000, lateFee: 0 },
          { status: 'PAID', amount: 10000, principalComponent: 8000, lateFee: 0 },
          { status: 'PAID', amount: 10000, principalComponent: 8000, lateFee: 0 },
          { status: 'PENDING', amount: 10000, principalComponent: 8500, lateFee: 0 },
          { status: 'PENDING', amount: 10000, principalComponent: 8500, lateFee: 0 },
        ],
      };

      prisma.eMIOrder.findUnique.mockResolvedValue(mockEMIOrder);

      const result = await emiService.calculateForeclosureAmount('emi_order_123');

      expect(result.pendingPrincipal).toBeGreaterThan(0);
      expect(result.foreclosureFee).toBeGreaterThan(0);
      expect(result.totalForeclosureAmount).toBeGreaterThan(result.pendingPrincipal);
    });
  });

  describe('getUpcomingInstallments', () => {
    it('should return installments due within specified days', async () => {
      const mockInstallments = [
        { id: 'inst_1', dueDate: new Date(), amount: 10000, status: 'PENDING' },
        { id: 'inst_2', dueDate: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000), amount: 10000, status: 'PENDING' },
      ];

      prisma.eMIInstallment.findMany.mockResolvedValue(mockInstallments);

      const result = await emiService.getUpcomingInstallments('user_123', 7);

      expect(result).toHaveLength(2);
    });
  });

  describe('markOverdueInstallments', () => {
    it('should mark overdue installments and apply late fee', async () => {
      prisma.eMIInstallment.updateMany.mockResolvedValue({ count: 5 });
      prisma.eMIInstallment.findMany.mockResolvedValue([
        { id: 'inst_1', amount: 10000, dueDate: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
      ]);
      prisma.eMIInstallment.update.mockResolvedValue({});

      const result = await emiService.markOverdueInstallments();

      expect(prisma.eMIInstallment.updateMany).toHaveBeenCalled();
      expect(result.markedOverdue).toBeDefined();
    });
  });

  describe('getUserEMISummary', () => {
    it('should return user EMI summary', async () => {
      prisma.eMIOrder.aggregate.mockResolvedValue({
        _count: 5,
        _sum: { paidAmount: 50000, remainingAmount: 100000 },
      });
      prisma.eMIOrder.count
        .mockResolvedValueOnce(2) // active
        .mockResolvedValueOnce(3) // completed
        .mockResolvedValueOnce(0); // defaulted

      const result = await emiService.getUserEMISummary('user_123');

      expect(result.activeEMIs).toBe(2);
      expect(result.completedEMIs).toBe(3);
      expect(result.totalPaid).toBe(50000);
    });
  });
});
