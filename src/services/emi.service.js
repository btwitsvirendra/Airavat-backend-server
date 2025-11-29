// =============================================================================
// AIRAVAT B2B MARKETPLACE - EMI SERVICE
// Split payments over time with installment management
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { eventEmitter } = require('./eventEmitter.service');

/**
 * EMI Configuration
 */
const EMI_CONFIG = {
  tenureOptions: [3, 6, 9, 12, 18, 24], // months
  defaultInterestRate: 12, // Annual percentage
  processingFeeRate: 1.5, // Percentage
  lateFeeRate: 2, // Percentage per month
  gracePeriodDays: 5, // Days after due date before late fee
  minEMIAmount: 1000, // Minimum order value for EMI
  maxEMIAmount: 10000000, // Maximum order value for EMI
};

class EMIService {
  // ===========================================================================
  // EMI PLAN MANAGEMENT
  // ===========================================================================

  /**
   * Get available EMI plans for an amount
   */
  async getAvailablePlans(amount, options = {}) {
    const { partnerId } = options;

    if (amount < EMI_CONFIG.minEMIAmount) {
      return {
        eligible: false,
        reason: `Minimum order value for EMI is ₹${EMI_CONFIG.minEMIAmount}`,
        plans: [],
      };
    }

    if (amount > EMI_CONFIG.maxEMIAmount) {
      return {
        eligible: false,
        reason: `Maximum order value for EMI is ₹${EMI_CONFIG.maxEMIAmount}`,
        plans: [],
      };
    }

    const where = {
      isActive: true,
      minAmount: { lte: amount },
      maxAmount: { gte: amount },
    };

    if (partnerId) {
      where.partnerId = partnerId;
    }

    const plans = await prisma.eMIPlan.findMany({
      where,
      orderBy: { tenureMonths: 'asc' },
    });

    // Calculate EMI details for each plan
    const plansWithDetails = plans.map((plan) => {
      const calculation = this.calculateEMI(
        amount,
        plan.tenureMonths,
        parseFloat(plan.interestRate),
        parseFloat(plan.processingFee)
      );

      return {
        ...plan,
        calculation,
      };
    });

    // If no plans from database, generate default plans
    if (plansWithDetails.length === 0) {
      const defaultPlans = EMI_CONFIG.tenureOptions.map((tenure) => {
        const calculation = this.calculateEMI(
          amount,
          tenure,
          EMI_CONFIG.defaultInterestRate,
          EMI_CONFIG.processingFeeRate
        );

        return {
          id: `default-${tenure}`,
          name: `${tenure} Month EMI`,
          tenureMonths: tenure,
          interestRate: EMI_CONFIG.defaultInterestRate,
          processingFee: EMI_CONFIG.processingFeeRate,
          calculation,
        };
      });

      return {
        eligible: true,
        plans: defaultPlans,
      };
    }

    return {
      eligible: true,
      plans: plansWithDetails,
    };
  }

  /**
   * Calculate EMI amount and schedule
   */
  calculateEMI(principal, tenureMonths, annualInterestRate, processingFeeRate = 0) {
    const monthlyInterestRate = annualInterestRate / 12 / 100;
    const processingFee = (principal * processingFeeRate) / 100;

    // EMI formula: P * r * (1 + r)^n / ((1 + r)^n - 1)
    let emi;
    if (monthlyInterestRate === 0) {
      emi = principal / tenureMonths;
    } else {
      const factor = Math.pow(1 + monthlyInterestRate, tenureMonths);
      emi = (principal * monthlyInterestRate * factor) / (factor - 1);
    }

    emi = Math.round(emi * 100) / 100; // Round to 2 decimals

    const totalAmount = emi * tenureMonths + processingFee;
    const totalInterest = totalAmount - principal - processingFee;

    // Generate amortization schedule
    const schedule = this.generateAmortizationSchedule(
      principal,
      emi,
      monthlyInterestRate,
      tenureMonths
    );

    return {
      principalAmount: principal,
      interestRate: annualInterestRate,
      tenureMonths,
      emiAmount: emi,
      processingFee,
      totalInterest: Math.round(totalInterest * 100) / 100,
      totalAmount: Math.round(totalAmount * 100) / 100,
      effectiveInterestRate: Math.round(((totalAmount - principal) / principal / tenureMonths * 12) * 10000) / 100,
      schedule,
    };
  }

  /**
   * Generate amortization schedule
   */
  generateAmortizationSchedule(principal, emi, monthlyRate, tenure) {
    const schedule = [];
    let balance = principal;

    for (let i = 1; i <= tenure; i++) {
      const interestComponent = balance * monthlyRate;
      const principalComponent = emi - interestComponent;
      balance -= principalComponent;

      schedule.push({
        installmentNumber: i,
        emiAmount: Math.round(emi * 100) / 100,
        principalComponent: Math.round(principalComponent * 100) / 100,
        interestComponent: Math.round(interestComponent * 100) / 100,
        remainingPrincipal: Math.max(0, Math.round(balance * 100) / 100),
      });
    }

    return schedule;
  }

  // ===========================================================================
  // EMI ORDER MANAGEMENT
  // ===========================================================================

  /**
   * Create EMI order
   */
  async createEMIOrder(orderId, emiPlanId, userId, options = {}) {
    const { bankName, accountLast4 } = options;

    // Get order details
    const order = await prisma.order.findUnique({
      where: { id: orderId },
    });

    if (!order) throw new Error('Order not found');
    if (order.buyerId !== userId) throw new Error('Unauthorized');

    // Get EMI plan
    let emiPlan;
    if (emiPlanId.startsWith('default-')) {
      // Default plan
      const tenure = parseInt(emiPlanId.split('-')[1]);
      emiPlan = {
        tenureMonths: tenure,
        interestRate: EMI_CONFIG.defaultInterestRate,
        processingFee: EMI_CONFIG.processingFeeRate,
      };
    } else {
      emiPlan = await prisma.eMIPlan.findUnique({
        where: { id: emiPlanId },
      });
      if (!emiPlan) throw new Error('EMI plan not found');
    }

    const principalAmount = parseFloat(order.totalAmount);
    const calculation = this.calculateEMI(
      principalAmount,
      emiPlan.tenureMonths,
      parseFloat(emiPlan.interestRate),
      parseFloat(emiPlan.processingFee)
    );

    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + emiPlan.tenureMonths);

    // Create EMI order
    const emiOrder = await prisma.eMIOrder.create({
      data: {
        orderId,
        userId,
        emiPlanId: emiPlanId.startsWith('default-') ? null : emiPlanId,
        principalAmount: calculation.principalAmount,
        interestAmount: calculation.totalInterest,
        processingFee: calculation.processingFee,
        totalAmount: calculation.totalAmount,
        emiAmount: calculation.emiAmount,
        tenureMonths: emiPlan.tenureMonths,
        startDate,
        endDate,
        remainingAmount: calculation.totalAmount,
        status: 'PENDING_APPROVAL',
        bankName,
        accountLast4,
      },
    });

    // Create installments
    const installments = calculation.schedule.map((inst, index) => {
      const dueDate = new Date(startDate);
      dueDate.setMonth(dueDate.getMonth() + index + 1);

      return {
        emiOrderId: emiOrder.id,
        installmentNumber: inst.installmentNumber,
        dueDate,
        amount: inst.emiAmount,
        principalComponent: inst.principalComponent,
        interestComponent: inst.interestComponent,
        status: 'PENDING',
      };
    });

    await prisma.eMIInstallment.createMany({
      data: installments,
    });

    logger.info('EMI order created', {
      emiOrderId: emiOrder.id,
      orderId,
      tenureMonths: emiPlan.tenureMonths,
      totalAmount: calculation.totalAmount,
    });

    return this.getEMIOrder(emiOrder.id);
  }

  /**
   * Get EMI order with details
   */
  async getEMIOrder(emiOrderId) {
    return prisma.eMIOrder.findUnique({
      where: { id: emiOrderId },
      include: {
        order: true,
        emiPlan: true,
        installments: {
          orderBy: { installmentNumber: 'asc' },
        },
      },
    });
  }

  /**
   * Get user's EMI orders
   */
  async getUserEMIOrders(userId, options = {}) {
    const { status, page = 1, limit = 10 } = options;

    const where = { userId };
    if (status) where.status = status;

    const [orders, total] = await Promise.all([
      prisma.eMIOrder.findMany({
        where,
        include: {
          order: {
            select: {
              id: true,
              orderNumber: true,
              totalAmount: true,
            },
          },
          installments: {
            where: { status: { in: ['PENDING', 'OVERDUE'] } },
            take: 1,
            orderBy: { dueDate: 'asc' },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.eMIOrder.count({ where }),
    ]);

    return {
      orders,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Approve EMI order
   */
  async approveEMIOrder(emiOrderId, approvedBy) {
    const emiOrder = await prisma.eMIOrder.update({
      where: { id: emiOrderId },
      data: { status: 'ACTIVE' },
    });

    // Update order payment status
    await prisma.order.update({
      where: { id: emiOrder.orderId },
      data: {
        paymentStatus: 'EMI_ACTIVE',
        paymentMethod: 'EMI',
      },
    });

    logger.info('EMI order approved', { emiOrderId, approvedBy });

    eventEmitter.emit('emi.approved', { emiOrderId, orderId: emiOrder.orderId });

    return emiOrder;
  }

  /**
   * Reject EMI order
   */
  async rejectEMIOrder(emiOrderId, reason, rejectedBy) {
    const emiOrder = await prisma.eMIOrder.update({
      where: { id: emiOrderId },
      data: {
        status: 'CANCELLED',
        // Store rejection reason in metadata or separate field
      },
    });

    logger.info('EMI order rejected', { emiOrderId, reason, rejectedBy });

    return emiOrder;
  }

  // ===========================================================================
  // INSTALLMENT MANAGEMENT
  // ===========================================================================

  /**
   * Get installment details
   */
  async getInstallment(installmentId) {
    return prisma.eMIInstallment.findUnique({
      where: { id: installmentId },
      include: {
        emiOrder: true,
      },
    });
  }

  /**
   * Get upcoming installments
   */
  async getUpcomingInstallments(userId, days = 7) {
    const dueDate = new Date();
    dueDate.setDate(dueDate.getDate() + days);

    return prisma.eMIInstallment.findMany({
      where: {
        emiOrder: { userId },
        status: 'PENDING',
        dueDate: { lte: dueDate },
      },
      include: {
        emiOrder: {
          include: {
            order: {
              select: { orderNumber: true },
            },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  /**
   * Get overdue installments
   */
  async getOverdueInstallments(userId) {
    return prisma.eMIInstallment.findMany({
      where: {
        emiOrder: { userId },
        status: 'OVERDUE',
      },
      include: {
        emiOrder: {
          include: {
            order: {
              select: { orderNumber: true },
            },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    });
  }

  /**
   * Pay installment
   */
  async payInstallment(installmentId, paymentDetails) {
    const { paymentId, transactionRef, amount, includeLateFee = true } = paymentDetails;

    const installment = await this.getInstallment(installmentId);
    if (!installment) throw new Error('Installment not found');
    if (installment.status === 'PAID') throw new Error('Installment already paid');

    const totalDue = parseFloat(installment.amount) + 
      (includeLateFee ? parseFloat(installment.lateFee || 0) : 0);

    if (amount < totalDue) {
      // Partial payment
      const paidAmount = amount;
      const remainingAmount = totalDue - amount;

      await prisma.eMIInstallment.update({
        where: { id: installmentId },
        data: {
          status: 'PARTIALLY_PAID',
          paidAmount,
          paidDate: new Date(),
          paymentId,
          transactionRef,
        },
      });

      return {
        status: 'PARTIALLY_PAID',
        paidAmount,
        remainingAmount,
      };
    }

    // Full payment
    const result = await prisma.$transaction(async (tx) => {
      const updatedInstallment = await tx.eMIInstallment.update({
        where: { id: installmentId },
        data: {
          status: 'PAID',
          paidAmount: totalDue,
          paidDate: new Date(),
          paymentId,
          transactionRef,
        },
      });

      // Update EMI order
      const emiOrder = await tx.eMIOrder.update({
        where: { id: installment.emiOrderId },
        data: {
          paidInstallments: { increment: 1 },
          paidAmount: { increment: totalDue },
          remainingAmount: { decrement: totalDue },
        },
      });

      // Check if all installments paid
      const pendingInstallments = await tx.eMIInstallment.count({
        where: {
          emiOrderId: installment.emiOrderId,
          status: { not: 'PAID' },
        },
      });

      if (pendingInstallments === 0) {
        await tx.eMIOrder.update({
          where: { id: installment.emiOrderId },
          data: { status: 'COMPLETED' },
        });

        await tx.order.update({
          where: { id: emiOrder.orderId },
          data: { paymentStatus: 'PAID' },
        });
      }

      return { installment: updatedInstallment, emiOrder };
    });

    logger.info('Installment paid', {
      installmentId,
      emiOrderId: installment.emiOrderId,
      amount: totalDue,
    });

    eventEmitter.emit('emi.installment_paid', {
      installmentId,
      emiOrderId: installment.emiOrderId,
    });

    return {
      status: 'PAID',
      paidAmount: totalDue,
      ...result,
    };
  }

  /**
   * Mark installments as overdue
   */
  async markOverdueInstallments() {
    const today = new Date();
    const gracePeriodEnd = new Date();
    gracePeriodEnd.setDate(gracePeriodEnd.getDate() - EMI_CONFIG.gracePeriodDays);

    const overdueInstallments = await prisma.eMIInstallment.findMany({
      where: {
        status: 'PENDING',
        dueDate: { lt: gracePeriodEnd },
      },
    });

    for (const installment of overdueInstallments) {
      // Calculate late fee
      const daysOverdue = Math.floor((today - installment.dueDate) / (1000 * 60 * 60 * 24));
      const monthsOverdue = Math.ceil(daysOverdue / 30);
      const lateFee = (parseFloat(installment.amount) * EMI_CONFIG.lateFeeRate * monthsOverdue) / 100;

      await prisma.eMIInstallment.update({
        where: { id: installment.id },
        data: {
          status: 'OVERDUE',
          lateFee,
        },
      });

      logger.warn('Installment marked overdue', {
        installmentId: installment.id,
        daysOverdue,
        lateFee,
      });
    }

    return overdueInstallments.length;
  }

  /**
   * Waive late fee
   */
  async waiveLateFee(installmentId, waivedBy, reason) {
    const installment = await prisma.eMIInstallment.update({
      where: { id: installmentId },
      data: { lateFee: 0 },
    });

    logger.info('Late fee waived', {
      installmentId,
      waivedBy,
      reason,
    });

    return installment;
  }

  // ===========================================================================
  // FORECLOSURE
  // ===========================================================================

  /**
   * Calculate foreclosure amount
   */
  async calculateForeclosureAmount(emiOrderId) {
    const emiOrder = await this.getEMIOrder(emiOrderId);
    if (!emiOrder) throw new Error('EMI order not found');
    if (emiOrder.status !== 'ACTIVE') throw new Error('EMI is not active');

    const pendingInstallments = emiOrder.installments.filter(
      (i) => i.status !== 'PAID'
    );

    // Total pending principal
    const pendingPrincipal = pendingInstallments.reduce(
      (sum, i) => sum + parseFloat(i.principalComponent),
      0
    );

    // Foreclosure discount (waive future interest)
    const pendingInterest = pendingInstallments.reduce(
      (sum, i) => sum + parseFloat(i.interestComponent),
      0
    );

    // Foreclosure fee (typically 2-4% of pending principal)
    const foreclosureFeeRate = 3; // 3%
    const foreclosureFee = (pendingPrincipal * foreclosureFeeRate) / 100;

    // Total late fees
    const lateFees = pendingInstallments.reduce(
      (sum, i) => sum + parseFloat(i.lateFee || 0),
      0
    );

    const totalForeclosureAmount = pendingPrincipal + foreclosureFee + lateFees;

    return {
      pendingInstallments: pendingInstallments.length,
      pendingPrincipal,
      pendingInterest,
      interestWaiver: pendingInterest, // Interest waived on foreclosure
      foreclosureFee,
      lateFees,
      totalForeclosureAmount: Math.round(totalForeclosureAmount * 100) / 100,
      savings: Math.round((pendingInterest - foreclosureFee) * 100) / 100,
    };
  }

  /**
   * Foreclose EMI
   */
  async foreclose(emiOrderId, paymentDetails, userId) {
    const { paymentId, transactionRef } = paymentDetails;

    const emiOrder = await this.getEMIOrder(emiOrderId);
    if (!emiOrder) throw new Error('EMI order not found');
    if (emiOrder.userId !== userId) throw new Error('Unauthorized');
    if (emiOrder.status !== 'ACTIVE') throw new Error('EMI is not active');

    const foreclosureDetails = await this.calculateForeclosureAmount(emiOrderId);

    const result = await prisma.$transaction(async (tx) => {
      // Mark all pending installments as paid
      await tx.eMIInstallment.updateMany({
        where: {
          emiOrderId,
          status: { not: 'PAID' },
        },
        data: {
          status: 'PAID',
          paidDate: new Date(),
        },
      });

      // Update EMI order
      const updatedEMIOrder = await tx.eMIOrder.update({
        where: { id: emiOrderId },
        data: {
          status: 'FORECLOSED',
          paidAmount: emiOrder.totalAmount,
          remainingAmount: 0,
        },
      });

      // Update order
      await tx.order.update({
        where: { id: emiOrder.orderId },
        data: { paymentStatus: 'PAID' },
      });

      return updatedEMIOrder;
    });

    logger.info('EMI foreclosed', {
      emiOrderId,
      foreclosureAmount: foreclosureDetails.totalForeclosureAmount,
    });

    eventEmitter.emit('emi.foreclosed', { emiOrderId });

    return {
      emiOrder: result,
      foreclosureDetails,
    };
  }

  // ===========================================================================
  // REPORTS & ANALYTICS
  // ===========================================================================

  /**
   * Get EMI summary for user
   */
  async getUserEMISummary(userId) {
    const [active, completed, overdue, totalPaid, totalOutstanding] = await Promise.all([
      prisma.eMIOrder.count({
        where: { userId, status: 'ACTIVE' },
      }),
      prisma.eMIOrder.count({
        where: { userId, status: 'COMPLETED' },
      }),
      prisma.eMIInstallment.count({
        where: {
          emiOrder: { userId },
          status: 'OVERDUE',
        },
      }),
      prisma.eMIOrder.aggregate({
        where: { userId },
        _sum: { paidAmount: true },
      }),
      prisma.eMIOrder.aggregate({
        where: { userId, status: 'ACTIVE' },
        _sum: { remainingAmount: true },
      }),
    ]);

    return {
      activeEMIs: active,
      completedEMIs: completed,
      overdueInstallments: overdue,
      totalPaid: parseFloat(totalPaid._sum.paidAmount || 0),
      totalOutstanding: parseFloat(totalOutstanding._sum.remainingAmount || 0),
    };
  }

  /**
   * Get EMI collection report
   */
  async getCollectionReport(startDate, endDate) {
    const where = {
      paidDate: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
      status: 'PAID',
    };

    const collections = await prisma.eMIInstallment.aggregate({
      where,
      _sum: { paidAmount: true },
      _count: true,
    });

    const overdueCollections = await prisma.eMIInstallment.aggregate({
      where: {
        ...where,
        lateFee: { gt: 0 },
      },
      _sum: { lateFee: true },
    });

    return {
      period: { startDate, endDate },
      totalCollected: parseFloat(collections._sum.paidAmount || 0),
      installmentsPaid: collections._count,
      lateFeeCollected: parseFloat(overdueCollections._sum.lateFee || 0),
    };
  }
}

module.exports = new EMIService();
