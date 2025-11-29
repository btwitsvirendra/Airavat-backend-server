// =============================================================================
// AIRAVAT B2B MARKETPLACE - CREDIT INSURANCE SERVICE
// Insurance against buyer default for B2B transactions
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const { eventEmitter } = require('./eventEmitter.service');

/**
 * Credit Insurance Configuration
 */
const INSURANCE_CONFIG = {
  minCoverageLimit: 100000,
  maxCoverageLimit: 50000000,
  defaultDeductible: 10, // 10%
  premiumRates: {
    WHOLE_TURNOVER: 0.15, // 0.15% of coverage
    SPECIFIC_BUYERS: 0.25,
    SINGLE_BUYER: 0.35,
    TOP_UP: 0.20,
  },
  riskGrades: {
    A: { multiplier: 0.8, maxCoverage: 100 },
    B: { multiplier: 1.0, maxCoverage: 80 },
    C: { multiplier: 1.3, maxCoverage: 60 },
    D: { multiplier: 1.8, maxCoverage: 40 },
  },
  waitingPeriodDays: 90, // Days overdue before claim
  claimFilingDeadlineDays: 180, // Days to file claim after default
  policyPrefix: 'CIP',
  claimPrefix: 'CLM',
};

class CreditInsuranceService {
  // ===========================================================================
  // POLICY MANAGEMENT
  // ===========================================================================

  /**
   * Get insurance quote
   */
  async getQuote(businessId, quoteRequest) {
    const {
      coverageType,
      coverageLimit,
      buyers = [],
      validityMonths = 12,
    } = quoteRequest;

    // Validate business
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: {
        orders: {
          where: { status: 'DELIVERED' },
          select: { totalAmount: true },
        },
      },
    });

    if (!business) throw new Error('Business not found');
    if (business.verificationStatus !== 'VERIFIED') {
      throw new Error('Business must be verified for credit insurance');
    }

    // Validate coverage limit
    if (coverageLimit < INSURANCE_CONFIG.minCoverageLimit) {
      throw new Error(`Minimum coverage is ₹${INSURANCE_CONFIG.minCoverageLimit}`);
    }
    if (coverageLimit > INSURANCE_CONFIG.maxCoverageLimit) {
      throw new Error(`Maximum coverage is ₹${INSURANCE_CONFIG.maxCoverageLimit}`);
    }

    // Get base premium rate
    const basePremiumRate = INSURANCE_CONFIG.premiumRates[coverageType] || 0.25;

    // Calculate risk-adjusted premium
    let riskMultiplier = 1.0;

    // Business history factor
    const totalRevenue = business.orders.reduce(
      (sum, o) => sum + parseFloat(o.totalAmount),
      0
    );
    if (totalRevenue > 10000000) riskMultiplier *= 0.9;
    else if (totalRevenue < 1000000) riskMultiplier *= 1.2;

    // Trust score factor
    if (business.trustScore > 80) riskMultiplier *= 0.85;
    else if (business.trustScore < 60) riskMultiplier *= 1.25;

    // Calculate buyer-specific risks for SPECIFIC_BUYERS
    let buyerLimits = [];
    if (coverageType === 'SPECIFIC_BUYERS' && buyers.length > 0) {
      for (const buyerId of buyers) {
        const buyerRisk = await this.assessBuyerRisk(buyerId);
        const maxLimit = (coverageLimit * buyerRisk.maxCoveragePercent) / 100;
        buyerLimits.push({
          buyerId,
          buyerName: buyerRisk.buyerName,
          riskGrade: buyerRisk.grade,
          suggestedLimit: Math.min(buyerRisk.suggestedLimit, maxLimit),
          maxLimit,
        });
      }
    }

    // Calculate final premium
    const annualPremiumRate = basePremiumRate * riskMultiplier;
    const premiumAmount = (coverageLimit * annualPremiumRate * validityMonths) / (100 * 12);

    return {
      businessId,
      coverageType,
      coverageLimit,
      validityMonths,
      deductiblePercent: INSURANCE_CONFIG.defaultDeductible,
      premiumRate: Math.round(annualPremiumRate * 1000) / 1000,
      premiumAmount: Math.round(premiumAmount * 100) / 100,
      riskFactors: {
        baseRate: basePremiumRate,
        riskMultiplier: Math.round(riskMultiplier * 100) / 100,
        businessTrustScore: business.trustScore,
        totalRevenue,
      },
      buyerLimits: buyerLimits.length > 0 ? buyerLimits : undefined,
      terms: {
        waitingPeriodDays: INSURANCE_CONFIG.waitingPeriodDays,
        claimFilingDeadlineDays: INSURANCE_CONFIG.claimFilingDeadlineDays,
      },
      validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // Quote valid for 7 days
    };
  }

  /**
   * Assess buyer risk
   */
  async assessBuyerRisk(buyerBusinessId) {
    const buyer = await prisma.business.findUnique({
      where: { id: buyerBusinessId },
      include: {
        ordersAsBuyer: {
          where: { status: { in: ['DELIVERED', 'COMPLETED'] } },
          select: {
            totalAmount: true,
            paymentStatus: true,
            createdAt: true,
          },
        },
      },
    });

    if (!buyer) {
      return {
        grade: 'D',
        maxCoveragePercent: INSURANCE_CONFIG.riskGrades.D.maxCoverage,
        suggestedLimit: 0,
        buyerName: 'Unknown',
      };
    }

    // Calculate risk grade based on payment history
    const totalOrders = buyer.ordersAsBuyer?.length || 0;
    const paidOrders = buyer.ordersAsBuyer?.filter(
      (o) => o.paymentStatus === 'PAID'
    ).length || 0;
    const paymentRate = totalOrders > 0 ? paidOrders / totalOrders : 0;

    let grade;
    if (paymentRate >= 0.95 && totalOrders >= 10) grade = 'A';
    else if (paymentRate >= 0.85 && totalOrders >= 5) grade = 'B';
    else if (paymentRate >= 0.70) grade = 'C';
    else grade = 'D';

    // Adjust for trust score
    if (buyer.trustScore > 80 && grade !== 'A') {
      grade = String.fromCharCode(grade.charCodeAt(0) - 1); // Upgrade one level
    }

    const riskConfig = INSURANCE_CONFIG.riskGrades[grade];
    
    // Calculate suggested limit based on historical trade
    const avgOrderValue = totalOrders > 0
      ? buyer.ordersAsBuyer.reduce((sum, o) => sum + parseFloat(o.totalAmount), 0) / totalOrders
      : 100000;
    const suggestedLimit = avgOrderValue * 3; // 3x average order

    return {
      grade,
      maxCoveragePercent: riskConfig.maxCoverage,
      suggestedLimit: Math.round(suggestedLimit),
      buyerName: buyer.businessName,
      paymentHistory: {
        totalOrders,
        paidOrders,
        paymentRate: Math.round(paymentRate * 100),
      },
    };
  }

  /**
   * Create insurance policy
   */
  async createPolicy(businessId, policyData) {
    const {
      coverageType,
      coverageLimit,
      validityMonths = 12,
      insurerId,
      insurerName,
      deductiblePercent = INSURANCE_CONFIG.defaultDeductible,
      buyers = [],
    } = policyData;

    // Get quote to validate and calculate premium
    const quote = await this.getQuote(businessId, {
      coverageType,
      coverageLimit,
      buyers: buyers.map((b) => b.buyerBusinessId),
      validityMonths,
    });

    // Generate policy number
    const policyNumber = await this.generatePolicyNumber();

    const startDate = new Date();
    const endDate = new Date();
    endDate.setMonth(endDate.getMonth() + validityMonths);

    // Create policy
    const policy = await prisma.creditInsurancePolicy.create({
      data: {
        businessId,
        policyNumber,
        insurerId: insurerId || 'INTERNAL',
        insurerName: insurerName || 'Airavat Trade Insurance',
        coverageType,
        coverageLimit,
        usedCoverage: 0,
        availableCoverage: coverageLimit,
        premiumRate: quote.premiumRate / 100,
        premiumAmount: quote.premiumAmount,
        premiumPaid: false,
        startDate,
        endDate,
        deductiblePercent,
        status: 'PENDING',
      },
    });

    // Add covered buyers for SPECIFIC_BUYERS or SINGLE_BUYER
    if (['SPECIFIC_BUYERS', 'SINGLE_BUYER'].includes(coverageType) && buyers.length > 0) {
      for (const buyer of buyers) {
        await prisma.insuredBuyer.create({
          data: {
            policyId: policy.id,
            buyerBusinessId: buyer.buyerBusinessId,
            buyerName: buyer.buyerName,
            creditLimit: buyer.creditLimit,
            usedLimit: 0,
            riskGrade: buyer.riskGrade,
            isActive: true,
          },
        });
      }
    }

    logger.info('Credit insurance policy created', {
      policyId: policy.id,
      policyNumber,
      businessId,
      coverageLimit,
    });

    eventEmitter.emit('insurance.policy_created', {
      policyId: policy.id,
      businessId,
    });

    return this.getPolicy(policy.id);
  }

  /**
   * Generate policy number
   */
  async generatePolicyNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');

    const count = await prisma.creditInsurancePolicy.count({
      where: {
        policyNumber: { startsWith: `${INSURANCE_CONFIG.policyPrefix}${year}${month}` },
      },
    });

    return `${INSURANCE_CONFIG.policyPrefix}${year}${month}${String(count + 1).padStart(5, '0')}`;
  }

  /**
   * Activate policy after premium payment
   */
  async activatePolicy(policyId, paymentDetails) {
    const policy = await prisma.creditInsurancePolicy.findUnique({
      where: { id: policyId },
    });

    if (!policy) throw new Error('Policy not found');
    if (policy.status !== 'PENDING') throw new Error('Policy is not pending activation');

    const updatedPolicy = await prisma.creditInsurancePolicy.update({
      where: { id: policyId },
      data: {
        status: 'ACTIVE',
        premiumPaid: true,
      },
    });

    logger.info('Insurance policy activated', { policyId, policyNumber: policy.policyNumber });

    eventEmitter.emit('insurance.policy_activated', {
      policyId,
      businessId: policy.businessId,
    });

    return updatedPolicy;
  }

  /**
   * Get policy details
   */
  async getPolicy(policyId) {
    return prisma.creditInsurancePolicy.findUnique({
      where: { id: policyId },
      include: {
        coveredBuyers: true,
        claims: {
          orderBy: { claimDate: 'desc' },
        },
      },
    });
  }

  /**
   * Get business policies
   */
  async getBusinessPolicies(businessId, options = {}) {
    const { status, page = 1, limit = 10 } = options;

    const where = { businessId };
    if (status) where.status = status;

    const [policies, total] = await Promise.all([
      prisma.creditInsurancePolicy.findMany({
        where,
        include: {
          _count: {
            select: { coveredBuyers: true, claims: true },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.creditInsurancePolicy.count({ where }),
    ]);

    return {
      policies,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // ===========================================================================
  // BUYER MANAGEMENT
  // ===========================================================================

  /**
   * Add buyer to policy
   */
  async addBuyer(policyId, buyerData) {
    const { buyerBusinessId, buyerName, creditLimit } = buyerData;

    const policy = await this.getPolicy(policyId);
    if (!policy) throw new Error('Policy not found');
    if (policy.status !== 'ACTIVE') throw new Error('Policy is not active');
    if (!['SPECIFIC_BUYERS', 'WHOLE_TURNOVER'].includes(policy.coverageType)) {
      throw new Error('Cannot add buyers to this policy type');
    }

    // Check if buyer already exists
    const existingBuyer = await prisma.insuredBuyer.findFirst({
      where: { policyId, buyerBusinessId },
    });

    if (existingBuyer) {
      throw new Error('Buyer already covered under this policy');
    }

    // Assess buyer risk
    const buyerRisk = await this.assessBuyerRisk(buyerBusinessId);

    // Validate credit limit
    const maxLimit = (parseFloat(policy.availableCoverage) * buyerRisk.maxCoveragePercent) / 100;
    if (creditLimit > maxLimit) {
      throw new Error(`Maximum limit for this buyer is ₹${maxLimit} based on risk grade ${buyerRisk.grade}`);
    }

    const insuredBuyer = await prisma.insuredBuyer.create({
      data: {
        policyId,
        buyerBusinessId,
        buyerName: buyerName || buyerRisk.buyerName,
        creditLimit,
        usedLimit: 0,
        riskGrade: buyerRisk.grade,
        isActive: true,
      },
    });

    logger.info('Buyer added to policy', {
      policyId,
      buyerBusinessId,
      creditLimit,
    });

    return insuredBuyer;
  }

  /**
   * Update buyer credit limit
   */
  async updateBuyerLimit(insuredBuyerId, newLimit) {
    const insuredBuyer = await prisma.insuredBuyer.findUnique({
      where: { id: insuredBuyerId },
      include: { policy: true },
    });

    if (!insuredBuyer) throw new Error('Insured buyer not found');

    // Re-assess risk
    const buyerRisk = await this.assessBuyerRisk(insuredBuyer.buyerBusinessId);
    const maxLimit = (parseFloat(insuredBuyer.policy.availableCoverage) * buyerRisk.maxCoveragePercent) / 100;

    if (newLimit > maxLimit) {
      throw new Error(`Maximum limit is ₹${maxLimit} based on current risk grade`);
    }

    const updated = await prisma.insuredBuyer.update({
      where: { id: insuredBuyerId },
      data: {
        creditLimit: newLimit,
        riskGrade: buyerRisk.grade,
      },
    });

    logger.info('Buyer limit updated', { insuredBuyerId, newLimit });

    return updated;
  }

  /**
   * Deactivate buyer
   */
  async deactivateBuyer(insuredBuyerId, reason) {
    const updated = await prisma.insuredBuyer.update({
      where: { id: insuredBuyerId },
      data: { isActive: false },
    });

    logger.info('Insured buyer deactivated', { insuredBuyerId, reason });

    return updated;
  }

  // ===========================================================================
  // CLAIM MANAGEMENT
  // ===========================================================================

  /**
   * Check claim eligibility
   */
  async checkClaimEligibility(policyId, invoiceDetails) {
    const { buyerBusinessId, invoiceId, invoiceAmount, invoiceDueDate } = invoiceDetails;

    const policy = await this.getPolicy(policyId);
    if (!policy) return { eligible: false, reason: 'Policy not found' };
    if (policy.status !== 'ACTIVE') {
      return { eligible: false, reason: 'Policy is not active' };
    }

    // Check if within policy period
    const now = new Date();
    if (now < policy.startDate || now > policy.endDate) {
      return { eligible: false, reason: 'Invoice not within policy period' };
    }

    // Check waiting period
    const daysOverdue = Math.floor((now - new Date(invoiceDueDate)) / (1000 * 60 * 60 * 24));
    if (daysOverdue < INSURANCE_CONFIG.waitingPeriodDays) {
      return {
        eligible: false,
        reason: `Waiting period not met. ${INSURANCE_CONFIG.waitingPeriodDays - daysOverdue} days remaining`,
      };
    }

    // Check filing deadline
    if (daysOverdue > INSURANCE_CONFIG.claimFilingDeadlineDays) {
      return { eligible: false, reason: 'Claim filing deadline exceeded' };
    }

    // Check buyer coverage
    const insuredBuyer = await prisma.insuredBuyer.findFirst({
      where: {
        policyId,
        buyerBusinessId,
        isActive: true,
      },
    });

    if (policy.coverageType !== 'WHOLE_TURNOVER' && !insuredBuyer) {
      return { eligible: false, reason: 'Buyer not covered under this policy' };
    }

    // Check buyer limit
    if (insuredBuyer && invoiceAmount > parseFloat(insuredBuyer.creditLimit) - parseFloat(insuredBuyer.usedLimit)) {
      return { eligible: false, reason: 'Invoice exceeds available buyer credit limit' };
    }

    // Check overall policy coverage
    if (invoiceAmount > parseFloat(policy.availableCoverage)) {
      return { eligible: false, reason: 'Invoice exceeds available policy coverage' };
    }

    // Check for existing claim on same invoice
    const existingClaim = await prisma.insuranceClaim.findFirst({
      where: {
        policyId,
        invoiceId,
        status: { notIn: ['REJECTED', 'CLOSED'] },
      },
    });

    if (existingClaim) {
      return { eligible: false, reason: 'Claim already exists for this invoice' };
    }

    // Calculate claim amount
    const deductibleAmount = (invoiceAmount * parseFloat(policy.deductiblePercent)) / 100;
    const payableAmount = invoiceAmount - deductibleAmount;

    return {
      eligible: true,
      invoiceAmount,
      deductiblePercent: parseFloat(policy.deductiblePercent),
      deductibleAmount,
      payableAmount,
      buyerCreditLimit: insuredBuyer?.creditLimit,
    };
  }

  /**
   * File insurance claim
   */
  async fileClaim(policyId, claimData) {
    const {
      buyerBusinessId,
      buyerName,
      invoiceId,
      invoiceNumber,
      invoiceAmount,
      invoiceDueDate,
      documents,
    } = claimData;

    // Check eligibility
    const eligibility = await this.checkClaimEligibility(policyId, {
      buyerBusinessId,
      invoiceId,
      invoiceAmount,
      invoiceDueDate,
    });

    if (!eligibility.eligible) {
      throw new Error(eligibility.reason);
    }

    // Generate claim number
    const claimNumber = await this.generateClaimNumber();

    const claim = await prisma.insuranceClaim.create({
      data: {
        policyId,
        claimNumber,
        buyerBusinessId,
        buyerName,
        invoiceId,
        invoiceNumber,
        invoiceAmount,
        invoiceDueDate: new Date(invoiceDueDate),
        claimAmount: invoiceAmount,
        deductibleAmount: eligibility.deductibleAmount,
        payableAmount: eligibility.payableAmount,
        status: 'SUBMITTED',
        documents,
      },
    });

    // Update policy used coverage
    await prisma.creditInsurancePolicy.update({
      where: { id: policyId },
      data: {
        usedCoverage: { increment: invoiceAmount },
        availableCoverage: { decrement: invoiceAmount },
      },
    });

    // Update buyer used limit
    const insuredBuyer = await prisma.insuredBuyer.findFirst({
      where: { policyId, buyerBusinessId },
    });
    if (insuredBuyer) {
      await prisma.insuredBuyer.update({
        where: { id: insuredBuyer.id },
        data: { usedLimit: { increment: invoiceAmount } },
      });
    }

    logger.info('Insurance claim filed', {
      claimId: claim.id,
      claimNumber,
      policyId,
      invoiceAmount,
    });

    eventEmitter.emit('insurance.claim_filed', {
      claimId: claim.id,
      policyId,
      businessId: (await this.getPolicy(policyId)).businessId,
    });

    return claim;
  }

  /**
   * Generate claim number
   */
  async generateClaimNumber() {
    const date = new Date();
    const year = date.getFullYear().toString().slice(-2);
    const month = String(date.getMonth() + 1).padStart(2, '0');

    const count = await prisma.insuranceClaim.count({
      where: {
        claimNumber: { startsWith: `${INSURANCE_CONFIG.claimPrefix}${year}${month}` },
      },
    });

    return `${INSURANCE_CONFIG.claimPrefix}${year}${month}${String(count + 1).padStart(5, '0')}`;
  }

  /**
   * Review claim
   */
  async reviewClaim(claimId, reviewData, reviewedBy) {
    const { status, notes } = reviewData;

    const claim = await prisma.insuranceClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) throw new Error('Claim not found');
    if (claim.status !== 'SUBMITTED') throw new Error('Claim already processed');

    const updatedClaim = await prisma.insuranceClaim.update({
      where: { id: claimId },
      data: {
        status: 'UNDER_REVIEW',
        reviewedAt: new Date(),
      },
    });

    logger.info('Claim under review', { claimId, reviewedBy });

    return updatedClaim;
  }

  /**
   * Approve claim
   */
  async approveClaim(claimId, approvedBy) {
    const claim = await prisma.insuranceClaim.findUnique({
      where: { id: claimId },
    });

    if (!claim) throw new Error('Claim not found');
    if (!['SUBMITTED', 'UNDER_REVIEW'].includes(claim.status)) {
      throw new Error('Claim cannot be approved');
    }

    const updatedClaim = await prisma.insuranceClaim.update({
      where: { id: claimId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
      },
    });

    logger.info('Insurance claim approved', { claimId, approvedBy });

    eventEmitter.emit('insurance.claim_approved', { claimId });

    return updatedClaim;
  }

  /**
   * Reject claim
   */
  async rejectClaim(claimId, reason, rejectedBy) {
    const claim = await prisma.insuranceClaim.findUnique({
      where: { id: claimId },
      include: { policy: true },
    });

    if (!claim) throw new Error('Claim not found');

    // Restore coverage
    await prisma.creditInsurancePolicy.update({
      where: { id: claim.policyId },
      data: {
        usedCoverage: { decrement: claim.invoiceAmount },
        availableCoverage: { increment: claim.invoiceAmount },
      },
    });

    // Restore buyer limit
    const insuredBuyer = await prisma.insuredBuyer.findFirst({
      where: { policyId: claim.policyId, buyerBusinessId: claim.buyerBusinessId },
    });
    if (insuredBuyer) {
      await prisma.insuredBuyer.update({
        where: { id: insuredBuyer.id },
        data: { usedLimit: { decrement: claim.invoiceAmount } },
      });
    }

    const updatedClaim = await prisma.insuranceClaim.update({
      where: { id: claimId },
      data: {
        status: 'REJECTED',
        rejectionReason: reason,
      },
    });

    logger.info('Insurance claim rejected', { claimId, reason, rejectedBy });

    return updatedClaim;
  }

  /**
   * Settle claim
   */
  async settleClaim(claimId, settlementData) {
    const { settlementAmount, settlementRef } = settlementData;

    const claim = await prisma.insuranceClaim.findUnique({
      where: { id: claimId },
      include: { policy: true },
    });

    if (!claim) throw new Error('Claim not found');
    if (claim.status !== 'APPROVED') throw new Error('Claim must be approved first');

    const updatedClaim = await prisma.insuranceClaim.update({
      where: { id: claimId },
      data: {
        status: 'SETTLED',
        settledAt: new Date(),
        settlementAmount,
        settlementRef,
      },
    });

    // Credit to business wallet
    try {
      const walletService = require('./wallet.service');
      const business = await prisma.business.findUnique({
        where: { id: claim.policy.businessId },
        select: { userId: true },
      });
      
      const wallet = await walletService.getUserWallet(business.userId);
      if (wallet) {
        await walletService.credit(wallet.id, settlementAmount, {
          referenceType: 'INSURANCE_CLAIM',
          referenceId: claimId,
          description: `Insurance settlement for claim ${claim.claimNumber}`,
        });
      }
    } catch (error) {
      logger.warn('Failed to credit wallet', { claimId, error: error.message });
    }

    logger.info('Insurance claim settled', {
      claimId,
      settlementAmount,
      settlementRef,
    });

    eventEmitter.emit('insurance.claim_settled', {
      claimId,
      businessId: claim.policy.businessId,
      amount: settlementAmount,
    });

    return updatedClaim;
  }

  /**
   * Get claim details
   */
  async getClaim(claimId) {
    return prisma.insuranceClaim.findUnique({
      where: { id: claimId },
      include: {
        policy: {
          select: {
            policyNumber: true,
            businessId: true,
            coverageType: true,
          },
        },
      },
    });
  }

  /**
   * Get claims for policy
   */
  async getPolicyClaims(policyId, options = {}) {
    const { status, page = 1, limit = 10 } = options;

    const where = { policyId };
    if (status) where.status = status;

    const [claims, total] = await Promise.all([
      prisma.insuranceClaim.findMany({
        where,
        orderBy: { claimDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.insuranceClaim.count({ where }),
    ]);

    return {
      claims,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  // ===========================================================================
  // REPORTS
  // ===========================================================================

  /**
   * Get policy summary
   */
  async getPolicySummary(policyId) {
    const policy = await this.getPolicy(policyId);
    if (!policy) throw new Error('Policy not found');

    const [claimStats, buyerStats] = await Promise.all([
      prisma.insuranceClaim.groupBy({
        by: ['status'],
        where: { policyId },
        _count: true,
        _sum: { claimAmount: true, settlementAmount: true },
      }),
      prisma.insuredBuyer.aggregate({
        where: { policyId, isActive: true },
        _sum: { creditLimit: true, usedLimit: true },
        _count: true,
      }),
    ]);

    return {
      policy: {
        policyNumber: policy.policyNumber,
        coverageType: policy.coverageType,
        coverageLimit: parseFloat(policy.coverageLimit),
        usedCoverage: parseFloat(policy.usedCoverage),
        availableCoverage: parseFloat(policy.availableCoverage),
        utilizationPercent: Math.round(
          (parseFloat(policy.usedCoverage) / parseFloat(policy.coverageLimit)) * 100
        ),
        status: policy.status,
        validUntil: policy.endDate,
      },
      claims: {
        byStatus: claimStats.reduce((acc, s) => {
          acc[s.status] = {
            count: s._count,
            totalAmount: parseFloat(s._sum.claimAmount || 0),
            settledAmount: parseFloat(s._sum.settlementAmount || 0),
          };
          return acc;
        }, {}),
      },
      buyers: {
        count: buyerStats._count,
        totalLimit: parseFloat(buyerStats._sum.creditLimit || 0),
        usedLimit: parseFloat(buyerStats._sum.usedLimit || 0),
      },
    };
  }

  /**
   * Expire old policies (scheduled job)
   */
  async expirePolicies() {
    const result = await prisma.creditInsurancePolicy.updateMany({
      where: {
        status: 'ACTIVE',
        endDate: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });

    if (result.count > 0) {
      logger.info('Expired insurance policies', { count: result.count });
    }

    return result.count;
  }
}

module.exports = new CreditInsuranceService();
