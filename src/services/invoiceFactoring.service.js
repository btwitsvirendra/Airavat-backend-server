// =============================================================================
// AIRAVAT B2B MARKETPLACE - INVOICE FACTORING SERVICE
// Sell invoices for immediate cash flow
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { eventEmitter } = require('./eventEmitter.service');

/**
 * Invoice Factoring Configuration
 */
const FACTORING_CONFIG = {
  minInvoiceAmount: 10000,
  maxInvoiceAmount: 10000000,
  defaultAdvanceRate: 85, // 85% of invoice value
  defaultDiscountRate: 2.5, // 2.5% fee
  maxTenorDays: 90, // Maximum invoice due date
  minTenorDays: 7, // Minimum days to due date
  autoApprovalLimit: 100000, // Auto-approve below this
  applicationPrefix: 'FACT',
};

class InvoiceFactoringService {
  // ===========================================================================
  // ELIGIBILITY CHECK
  // ===========================================================================

  /**
   * Check if invoice is eligible for factoring
   */
  async checkEligibility(businessId, invoiceDetails) {
    const {
      invoiceAmount,
      invoiceDate,
      invoiceDueDate,
      buyerBusinessId,
    } = invoiceDetails;

    const issues = [];

    // Amount check
    if (invoiceAmount < FACTORING_CONFIG.minInvoiceAmount) {
      issues.push(`Minimum invoice amount is ₹${FACTORING_CONFIG.minInvoiceAmount}`);
    }

    if (invoiceAmount > FACTORING_CONFIG.maxInvoiceAmount) {
      issues.push(`Maximum invoice amount is ₹${FACTORING_CONFIG.maxInvoiceAmount}`);
    }

    // Tenor check
    const today = new Date();
    const dueDate = new Date(invoiceDueDate);
    const daysToMaturity = Math.ceil((dueDate - today) / (1000 * 60 * 60 * 24));

    if (daysToMaturity < FACTORING_CONFIG.minTenorDays) {
      issues.push(`Invoice due date must be at least ${FACTORING_CONFIG.minTenorDays} days away`);
    }

    if (daysToMaturity > FACTORING_CONFIG.maxTenorDays) {
      issues.push(`Invoice due date must be within ${FACTORING_CONFIG.maxTenorDays} days`);
    }

    // Business verification
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: {
        id: true,
        verificationStatus: true,
        trustScore: true,
      },
    });

    if (!business) {
      issues.push('Business not found');
    } else if (business.verificationStatus !== 'VERIFIED') {
      issues.push('Business must be verified for factoring');
    }

    // Buyer verification
    if (buyerBusinessId) {
      const buyerBusiness = await prisma.business.findUnique({
        where: { id: buyerBusinessId },
        select: {
          id: true,
          verificationStatus: true,
          trustScore: true,
        },
      });

      if (!buyerBusiness) {
        issues.push('Buyer business not found');
      } else if (buyerBusiness.verificationStatus !== 'VERIFIED') {
        issues.push('Buyer business must be verified');
      }
    }

    // Check for existing factoring application for this invoice
    const existingApplication = await prisma.factoringApplication.findFirst({
      where: {
        businessId,
        invoiceNumber: invoiceDetails.invoiceNumber,
        status: { notIn: ['REJECTED', 'CANCELLED', 'SETTLED'] },
      },
    });

    if (existingApplication) {
      issues.push('Factoring application already exists for this invoice');
    }

    // Check business factoring limit
    const activeFactoring = await prisma.factoringApplication.aggregate({
      where: {
        businessId,
        status: { in: ['APPROVED', 'DISBURSED'] },
      },
      _sum: { advanceAmount: true },
    });

    const activeFactoringAmount = parseFloat(activeFactoring._sum.advanceAmount || 0);
    const factoringLimit = 5000000; // Could be from business profile

    if (activeFactoringAmount + invoiceAmount > factoringLimit) {
      issues.push(`Factoring limit exceeded. Available: ₹${factoringLimit - activeFactoringAmount}`);
    }

    if (issues.length > 0) {
      return {
        eligible: false,
        issues,
      };
    }

    // Calculate indicative terms
    const advanceRate = await this.getAdvanceRate(businessId, buyerBusinessId);
    const discountRate = await this.getDiscountRate(businessId, buyerBusinessId, daysToMaturity);

    const advanceAmount = (invoiceAmount * advanceRate) / 100;
    const feeAmount = (invoiceAmount * discountRate * daysToMaturity) / (365 * 100);

    return {
      eligible: true,
      indicativeTerms: {
        advanceRate,
        discountRate,
        advanceAmount: Math.round(advanceAmount * 100) / 100,
        feeAmount: Math.round(feeAmount * 100) / 100,
        netAdvance: Math.round((advanceAmount - feeAmount) * 100) / 100,
        daysToMaturity,
        holdbackAmount: Math.round((invoiceAmount - advanceAmount) * 100) / 100,
      },
    };
  }

  /**
   * Get advance rate based on risk factors
   */
  async getAdvanceRate(sellerBusinessId, buyerBusinessId) {
    // Base rate
    let advanceRate = FACTORING_CONFIG.defaultAdvanceRate;

    // Get seller trust score
    const seller = await prisma.business.findUnique({
      where: { id: sellerBusinessId },
      select: { trustScore: true },
    });

    if (seller?.trustScore > 80) {
      advanceRate += 3; // Better rate for high trust score
    } else if (seller?.trustScore < 60) {
      advanceRate -= 5; // Lower rate for low trust score
    }

    // Get buyer trust score
    if (buyerBusinessId) {
      const buyer = await prisma.business.findUnique({
        where: { id: buyerBusinessId },
        select: { trustScore: true },
      });

      if (buyer?.trustScore > 80) {
        advanceRate += 2;
      } else if (buyer?.trustScore < 60) {
        advanceRate -= 3;
      }
    }

    return Math.min(95, Math.max(70, advanceRate));
  }

  /**
   * Get discount rate based on risk factors
   */
  async getDiscountRate(sellerBusinessId, buyerBusinessId, tenor) {
    let discountRate = FACTORING_CONFIG.defaultDiscountRate;

    // Adjust based on tenor
    if (tenor > 60) {
      discountRate += 0.5;
    } else if (tenor < 30) {
      discountRate -= 0.3;
    }

    // Adjust based on buyer history
    if (buyerBusinessId) {
      const paymentHistory = await prisma.order.aggregate({
        where: {
          buyerId: buyerBusinessId,
          paymentStatus: 'PAID',
        },
        _count: true,
      });

      if (paymentHistory._count > 20) {
        discountRate -= 0.5; // Good payment history
      }
    }

    return Math.max(1, Math.min(5, discountRate));
  }

  // ===========================================================================
  // APPLICATION MANAGEMENT
  // ===========================================================================

  /**
   * Submit factoring application
   */
  async submitApplication(businessId, applicationData) {
    const {
      invoiceId,
      invoiceNumber,
      invoiceAmount,
      invoiceDate,
      invoiceDueDate,
      buyerBusinessId,
      buyerName,
      isRecourse = true,
      documents,
    } = applicationData;

    // Check eligibility first
    const eligibility = await this.checkEligibility(businessId, {
      invoiceAmount,
      invoiceDate,
      invoiceDueDate,
      invoiceNumber,
      buyerBusinessId,
    });

    if (!eligibility.eligible) {
      throw new Error(`Not eligible: ${eligibility.issues.join(', ')}`);
    }

    const { indicativeTerms } = eligibility;

    // Generate application number
    const applicationNumber = await this.generateApplicationNumber();

    const application = await prisma.factoringApplication.create({
      data: {
        businessId,
        applicationNumber,
        invoiceId,
        invoiceNumber,
        invoiceAmount,
        invoiceDate: new Date(invoiceDate),
        invoiceDueDate: new Date(invoiceDueDate),
        buyerBusinessId,
        buyerName,
        advanceRate: indicativeTerms.advanceRate,
        discountRate: indicativeTerms.discountRate,
        advanceAmount: indicativeTerms.advanceAmount,
        feeAmount: indicativeTerms.feeAmount,
        isRecourse,
        status: 'PENDING',
        documents,
      },
    });

    logger.info('Factoring application submitted', {
      applicationId: application.id,
      applicationNumber,
      businessId,
      invoiceAmount,
    });

    eventEmitter.emit('factoring.application_submitted', {
      applicationId: application.id,
      businessId,
    });

    // Auto-approve if below threshold
    if (invoiceAmount <= FACTORING_CONFIG.autoApprovalLimit) {
      await this.approveApplication(application.id, 'SYSTEM', 'Auto-approved');
    }

    return application;
  }

  /**
   * Generate application number
   */
  async generateApplicationNumber() {
    const date = new Date();
    const prefix = FACTORING_CONFIG.applicationPrefix;
    const datePart = date.toISOString().slice(0, 10).replace(/-/g, '');

    const count = await prisma.factoringApplication.count({
      where: {
        applicationNumber: { startsWith: `${prefix}${datePart}` },
      },
    });

    return `${prefix}${datePart}${String(count + 1).padStart(4, '0')}`;
  }

  /**
   * Get application by ID
   */
  async getApplication(applicationId) {
    return prisma.factoringApplication.findUnique({
      where: { id: applicationId },
      include: {
        business: {
          select: {
            id: true,
            businessName: true,
            gstin: true,
          },
        },
      },
    });
  }

  /**
   * Get applications for business
   */
  async getBusinessApplications(businessId, options = {}) {
    const { status, page = 1, limit = 10 } = options;

    const where = { businessId };
    if (status) where.status = status;

    const [applications, total] = await Promise.all([
      prisma.factoringApplication.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.factoringApplication.count({ where }),
    ]);

    return {
      applications,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Approve application
   */
  async approveApplication(applicationId, approvedBy, notes = '') {
    const application = await this.getApplication(applicationId);
    if (!application) throw new Error('Application not found');
    if (application.status !== 'PENDING' && application.status !== 'UNDER_REVIEW') {
      throw new Error(`Cannot approve application in ${application.status} status`);
    }

    const updatedApplication = await prisma.factoringApplication.update({
      where: { id: applicationId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        approvedBy,
      },
    });

    logger.info('Factoring application approved', {
      applicationId,
      approvedBy,
    });

    eventEmitter.emit('factoring.application_approved', {
      applicationId,
      businessId: application.businessId,
    });

    return updatedApplication;
  }

  /**
   * Reject application
   */
  async rejectApplication(applicationId, rejectedBy, reason) {
    const application = await this.getApplication(applicationId);
    if (!application) throw new Error('Application not found');

    const updatedApplication = await prisma.factoringApplication.update({
      where: { id: applicationId },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
      },
    });

    logger.info('Factoring application rejected', {
      applicationId,
      rejectedBy,
      reason,
    });

    return updatedApplication;
  }

  // ===========================================================================
  // DISBURSEMENT
  // ===========================================================================

  /**
   * Disburse funds
   */
  async disburse(applicationId, disbursementDetails) {
    const { bankAccountId, disbursementRef } = disbursementDetails;

    const application = await this.getApplication(applicationId);
    if (!application) throw new Error('Application not found');
    if (application.status !== 'APPROVED') {
      throw new Error('Application must be approved before disbursement');
    }

    // Get business bank account
    const bankAccount = await prisma.bankAccount.findFirst({
      where: {
        businessId: application.businessId,
        id: bankAccountId,
        isVerified: true,
      },
    });

    if (!bankAccount) {
      throw new Error('Verified bank account not found');
    }

    const netDisbursement = parseFloat(application.advanceAmount) - parseFloat(application.feeAmount);

    // In production, initiate actual bank transfer here
    // For now, we'll simulate the disbursement

    const updatedApplication = await prisma.factoringApplication.update({
      where: { id: applicationId },
      data: {
        status: 'DISBURSED',
        disbursedAt: new Date(),
        disbursementRef,
      },
    });

    // Credit to business wallet (optional)
    try {
      const walletService = require('./wallet.service');
      const wallet = await walletService.getUserWallet(application.business.userId);
      
      if (wallet) {
        await walletService.credit(wallet.id, netDisbursement, {
          referenceType: 'FACTORING',
          referenceId: applicationId,
          description: `Factoring advance for invoice ${application.invoiceNumber}`,
        });
      }
    } catch (error) {
      logger.warn('Failed to credit wallet', { applicationId, error: error.message });
    }

    logger.info('Factoring funds disbursed', {
      applicationId,
      amount: netDisbursement,
      disbursementRef,
    });

    eventEmitter.emit('factoring.disbursed', {
      applicationId,
      amount: netDisbursement,
    });

    return updatedApplication;
  }

  // ===========================================================================
  // SETTLEMENT
  // ===========================================================================

  /**
   * Record settlement (when buyer pays)
   */
  async recordSettlement(applicationId, settlementDetails) {
    const { settlementAmount, settlementRef, settlementDate } = settlementDetails;

    const application = await this.getApplication(applicationId);
    if (!application) throw new Error('Application not found');
    if (application.status !== 'DISBURSED') {
      throw new Error('Application must be disbursed before settlement');
    }

    const holdbackAmount = parseFloat(application.invoiceAmount) - parseFloat(application.advanceAmount);
    const expectedSettlement = parseFloat(application.invoiceAmount);

    let finalSettlement;
    let status = 'SETTLED';

    if (settlementAmount >= expectedSettlement) {
      // Full settlement - release holdback to seller
      finalSettlement = holdbackAmount;
    } else if (settlementAmount > 0) {
      // Partial settlement
      const shortfall = expectedSettlement - settlementAmount;
      finalSettlement = Math.max(0, holdbackAmount - shortfall);

      if (application.isRecourse && shortfall > holdbackAmount) {
        // With recourse - seller owes the difference
        status = 'SETTLED'; // But need to recover from seller
      }
    } else {
      // No payment - buyer defaulted
      status = 'DEFAULTED';
      finalSettlement = 0;

      if (application.isRecourse) {
        // With recourse - recover from seller
        // This would trigger recovery process
      }
    }

    const updatedApplication = await prisma.factoringApplication.update({
      where: { id: applicationId },
      data: {
        status,
        settledAt: new Date(settlementDate || new Date()),
        settlementAmount: finalSettlement,
      },
    });

    // Release holdback to seller if applicable
    if (finalSettlement > 0) {
      try {
        const walletService = require('./wallet.service');
        const business = await prisma.business.findUnique({
          where: { id: application.businessId },
          select: { userId: true },
        });
        
        const wallet = await walletService.getUserWallet(business.userId);
        
        if (wallet) {
          await walletService.credit(wallet.id, finalSettlement, {
            referenceType: 'FACTORING_HOLDBACK',
            referenceId: applicationId,
            description: `Holdback release for invoice ${application.invoiceNumber}`,
          });
        }
      } catch (error) {
        logger.warn('Failed to release holdback', { applicationId, error: error.message });
      }
    }

    logger.info('Factoring settled', {
      applicationId,
      settlementAmount,
      holdbackReleased: finalSettlement,
      status,
    });

    return updatedApplication;
  }

  /**
   * Handle buyer default
   */
  async handleDefault(applicationId) {
    const application = await this.getApplication(applicationId);
    if (!application) throw new Error('Application not found');

    if (application.isRecourse) {
      // With recourse - initiate recovery from seller
      await prisma.factoringApplication.update({
        where: { id: applicationId },
        data: { status: 'DEFAULTED' },
      });

      // Create recovery request
      // This would typically integrate with credit recovery system

      logger.warn('Factoring default - recovery initiated', {
        applicationId,
        businessId: application.businessId,
        amount: application.advanceAmount,
      });
    } else {
      // Without recourse - factor absorbs the loss
      await prisma.factoringApplication.update({
        where: { id: applicationId },
        data: { status: 'DEFAULTED' },
      });

      logger.warn('Factoring default - non-recourse loss', {
        applicationId,
        amount: application.advanceAmount,
      });
    }

    eventEmitter.emit('factoring.defaulted', { applicationId });

    return application;
  }

  // ===========================================================================
  // REPORTS & ANALYTICS
  // ===========================================================================

  /**
   * Get factoring summary for business
   */
  async getBusinessFactoringSummary(businessId) {
    const [
      totalApplications,
      approvedApplications,
      activeFactoring,
      totalDisbursed,
      totalSettled,
    ] = await Promise.all([
      prisma.factoringApplication.count({ where: { businessId } }),
      prisma.factoringApplication.count({
        where: { businessId, status: { in: ['APPROVED', 'DISBURSED', 'SETTLED'] } },
      }),
      prisma.factoringApplication.aggregate({
        where: { businessId, status: 'DISBURSED' },
        _sum: { advanceAmount: true },
        _count: true,
      }),
      prisma.factoringApplication.aggregate({
        where: { businessId, status: { in: ['DISBURSED', 'SETTLED'] } },
        _sum: { advanceAmount: true },
      }),
      prisma.factoringApplication.aggregate({
        where: { businessId, status: 'SETTLED' },
        _sum: { settlementAmount: true },
      }),
    ]);

    return {
      totalApplications,
      approvedApplications,
      approvalRate: totalApplications > 0 
        ? Math.round((approvedApplications / totalApplications) * 100) 
        : 0,
      activeFactoringCount: activeFactoring._count,
      activeFactoringAmount: parseFloat(activeFactoring._sum.advanceAmount || 0),
      totalDisbursed: parseFloat(totalDisbursed._sum.advanceAmount || 0),
      totalSettled: parseFloat(totalSettled._sum.settlementAmount || 0),
    };
  }

  /**
   * Get factoring report
   */
  async getFactoringReport(startDate, endDate) {
    const where = {
      createdAt: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    };

    const [applications, disbursed, settled, defaults] = await Promise.all([
      prisma.factoringApplication.aggregate({
        where,
        _sum: { invoiceAmount: true },
        _count: true,
      }),
      prisma.factoringApplication.aggregate({
        where: { ...where, status: { in: ['DISBURSED', 'SETTLED'] } },
        _sum: { advanceAmount: true, feeAmount: true },
        _count: true,
      }),
      prisma.factoringApplication.aggregate({
        where: { ...where, status: 'SETTLED' },
        _sum: { settlementAmount: true },
        _count: true,
      }),
      prisma.factoringApplication.count({
        where: { ...where, status: 'DEFAULTED' },
      }),
    ]);

    return {
      period: { startDate, endDate },
      applications: {
        count: applications._count,
        totalInvoiceValue: parseFloat(applications._sum.invoiceAmount || 0),
      },
      disbursements: {
        count: disbursed._count,
        totalAdvanced: parseFloat(disbursed._sum.advanceAmount || 0),
        totalFees: parseFloat(disbursed._sum.feeAmount || 0),
      },
      settlements: {
        count: settled._count,
        totalSettled: parseFloat(settled._sum.settlementAmount || 0),
      },
      defaults: defaults,
      defaultRate: disbursed._count > 0 
        ? Math.round((defaults / disbursed._count) * 100 * 100) / 100 
        : 0,
    };
  }
}

module.exports = new InvoiceFactoringService();
