// =============================================================================
// AIRAVAT B2B MARKETPLACE - CREDIT SCORING SERVICE
// Business credit assessment, BNPL eligibility, and credit limit management
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const gstService = require('./gst.service');
const { BadRequestError } = require('../utils/errors');

class CreditScoringService {
  // Credit score ranges
  static SCORE_RANGES = {
    EXCELLENT: { min: 750, max: 900 },
    GOOD: { min: 650, max: 749 },
    FAIR: { min: 550, max: 649 },
    POOR: { min: 0, max: 549 },
  };
  
  // Credit limit multipliers based on score
  static CREDIT_MULTIPLIERS = {
    EXCELLENT: 3.0,
    GOOD: 2.0,
    FAIR: 1.0,
    POOR: 0,
  };
  
  // =============================================================================
  // CREDIT SCORE CALCULATION
  // =============================================================================
  
  /**
   * Calculate business credit score
   */
  async calculateCreditScore(businessId) {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      include: {
        orders: {
          where: { buyerId: businessId },
          orderBy: { createdAt: 'desc' },
          take: 100,
        },
        documents: true,
      },
    });
    
    if (!business) {
      throw new BadRequestError('Business not found');
    }
    
    const scores = {
      businessAge: this.calculateBusinessAgeScore(business),
      verificationStatus: this.calculateVerificationScore(business),
      orderHistory: await this.calculateOrderHistoryScore(businessId),
      paymentBehavior: await this.calculatePaymentBehaviorScore(businessId),
      gstCompliance: await this.calculateGSTComplianceScore(business.gstin),
      documentCompletion: this.calculateDocumentScore(business),
      platformActivity: await this.calculateActivityScore(businessId),
    };
    
    // Weighted average
    const weights = {
      businessAge: 0.10,
      verificationStatus: 0.15,
      orderHistory: 0.20,
      paymentBehavior: 0.25,
      gstCompliance: 0.15,
      documentCompletion: 0.05,
      platformActivity: 0.10,
    };
    
    let totalScore = 0;
    let totalWeight = 0;
    
    for (const [key, score] of Object.entries(scores)) {
      if (score !== null) {
        totalScore += score * weights[key];
        totalWeight += weights[key];
      }
    }
    
    const finalScore = Math.round((totalScore / totalWeight) * 900);
    const rating = this.getScoreRating(finalScore);
    
    // Save credit score
    await prisma.creditScore.upsert({
      where: { businessId },
      update: {
        score: finalScore,
        rating,
        components: scores,
        calculatedAt: new Date(),
      },
      create: {
        businessId,
        score: finalScore,
        rating,
        components: scores,
      },
    });
    
    return {
      score: finalScore,
      rating,
      components: scores,
      eligibleForCredit: finalScore >= 550,
    };
  }
  
  /**
   * Calculate business age score (0-100)
   */
  calculateBusinessAgeScore(business) {
    const establishedYear = business.establishedYear || new Date(business.createdAt).getFullYear();
    const yearsInBusiness = new Date().getFullYear() - establishedYear;
    
    // More years = higher score
    if (yearsInBusiness >= 10) return 100;
    if (yearsInBusiness >= 5) return 80;
    if (yearsInBusiness >= 3) return 60;
    if (yearsInBusiness >= 1) return 40;
    return 20;
  }
  
  /**
   * Calculate verification status score (0-100)
   */
  calculateVerificationScore(business) {
    switch (business.verificationStatus) {
      case 'VERIFIED': return 100;
      case 'PENDING': return 50;
      case 'REJECTED': return 10;
      default: return 0;
    }
  }
  
  /**
   * Calculate order history score (0-100)
   */
  async calculateOrderHistoryScore(businessId) {
    const stats = await prisma.order.aggregate({
      where: { buyerId: businessId },
      _count: true,
      _sum: { totalAmount: true },
    });
    
    const orderCount = stats._count;
    const totalValue = parseFloat(stats._sum.totalAmount || 0);
    
    // Score based on order count and value
    let score = 0;
    
    // Order count contribution (max 50)
    if (orderCount >= 50) score += 50;
    else if (orderCount >= 20) score += 40;
    else if (orderCount >= 10) score += 30;
    else if (orderCount >= 5) score += 20;
    else score += orderCount * 4;
    
    // Order value contribution (max 50)
    // Based on INR values - adjust for UAE AED
    if (totalValue >= 5000000) score += 50; // 50 Lakh+
    else if (totalValue >= 1000000) score += 40; // 10 Lakh+
    else if (totalValue >= 500000) score += 30; // 5 Lakh+
    else if (totalValue >= 100000) score += 20; // 1 Lakh+
    else score += Math.min(totalValue / 5000, 15);
    
    return Math.min(score, 100);
  }
  
  /**
   * Calculate payment behavior score (0-100)
   */
  async calculatePaymentBehaviorScore(businessId) {
    // Get payment history
    const orders = await prisma.order.findMany({
      where: {
        buyerId: businessId,
        status: { in: ['PAID', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'COMPLETED'] },
      },
      include: {
        payments: true,
      },
      take: 50,
    });
    
    if (orders.length === 0) return null; // No history
    
    let onTimePayments = 0;
    let latePayments = 0;
    let totalPayments = 0;
    
    orders.forEach((order) => {
      order.payments.forEach((payment) => {
        if (payment.status === 'CAPTURED' || payment.status === 'SUCCESS') {
          totalPayments++;
          
          // Check if paid on time (within payment terms)
          const paymentDate = new Date(payment.capturedAt || payment.createdAt);
          const orderDate = new Date(order.createdAt);
          const daysToPay = (paymentDate - orderDate) / (1000 * 60 * 60 * 24);
          
          if (daysToPay <= (order.paymentTermDays || 30)) {
            onTimePayments++;
          } else {
            latePayments++;
          }
        }
      });
    });
    
    if (totalPayments === 0) return 50; // No payment data
    
    const onTimeRate = onTimePayments / totalPayments;
    
    // Score: 100% on-time = 100, decreases with late payments
    return Math.round(onTimeRate * 100);
  }
  
  /**
   * Calculate GST compliance score (0-100)
   */
  async calculateGSTComplianceScore(gstin) {
    if (!gstin) return 0;
    
    try {
      // Verify GSTIN
      const gstData = await gstService.verifyGSTIN(gstin);
      
      if (!gstData.isValid || gstData.isCancelled) {
        return 0;
      }
      
      // Check filing status
      const currentFY = this.getCurrentFinancialYear();
      const filingStatus = await gstService.getFilingStatus(gstin, currentFY);
      
      if (filingStatus.length === 0) return 50;
      
      // Calculate based on filing regularity
      const expectedFilings = 12; // Monthly GSTR-3B
      const actualFilings = filingStatus.filter((f) => f.status === 'Filed').length;
      const filingRate = actualFilings / expectedFilings;
      
      return Math.round(filingRate * 100);
    } catch (error) {
      logger.error('GST compliance check failed', { gstin, error: error.message });
      return 50; // Default score if check fails
    }
  }
  
  /**
   * Calculate document completion score (0-100)
   */
  calculateDocumentScore(business) {
    const requiredDocs = ['GST_CERTIFICATE', 'PAN', 'BANK_STATEMENT', 'BUSINESS_PROOF'];
    const uploadedDocs = business.documents?.map((d) => d.type) || [];
    
    const completedCount = requiredDocs.filter((doc) => uploadedDocs.includes(doc)).length;
    
    return Math.round((completedCount / requiredDocs.length) * 100);
  }
  
  /**
   * Calculate platform activity score (0-100)
   */
  async calculateActivityScore(businessId) {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    
    // Count recent activities
    const [orders, rfqs, chats, logins] = await Promise.all([
      prisma.order.count({
        where: { buyerId: businessId, createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.rFQ.count({
        where: { businessId, createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.message.count({
        where: { senderId: businessId, createdAt: { gte: thirtyDaysAgo } },
      }),
      prisma.session.count({
        where: { userId: businessId, createdAt: { gte: thirtyDaysAgo } },
      }),
    ]);
    
    // Score based on activity
    const activityCount = orders * 10 + rfqs * 5 + chats * 2 + logins;
    
    if (activityCount >= 100) return 100;
    if (activityCount >= 50) return 80;
    if (activityCount >= 20) return 60;
    if (activityCount >= 10) return 40;
    return Math.max(activityCount * 4, 10);
  }
  
  /**
   * Get score rating label
   */
  getScoreRating(score) {
    if (score >= CreditScoringService.SCORE_RANGES.EXCELLENT.min) return 'EXCELLENT';
    if (score >= CreditScoringService.SCORE_RANGES.GOOD.min) return 'GOOD';
    if (score >= CreditScoringService.SCORE_RANGES.FAIR.min) return 'FAIR';
    return 'POOR';
  }
  
  // =============================================================================
  // CREDIT LIMIT MANAGEMENT
  // =============================================================================
  
  /**
   * Calculate credit limit for a business
   */
  async calculateCreditLimit(businessId) {
    // Get credit score
    const creditScore = await prisma.creditScore.findUnique({
      where: { businessId },
    });
    
    if (!creditScore || creditScore.score < 550) {
      return {
        eligible: false,
        limit: 0,
        reason: 'Credit score too low',
      };
    }
    
    // Get average monthly order value
    const sixMonthsAgo = new Date(Date.now() - 180 * 24 * 60 * 60 * 1000);
    const orderStats = await prisma.order.aggregate({
      where: {
        buyerId: businessId,
        createdAt: { gte: sixMonthsAgo },
        status: { in: ['PAID', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'COMPLETED'] },
      },
      _sum: { totalAmount: true },
      _count: true,
    });
    
    const totalOrders = parseFloat(orderStats._sum.totalAmount || 0);
    const monthlyAverage = totalOrders / 6;
    
    // Calculate limit based on score and order history
    const multiplier = CreditScoringService.CREDIT_MULTIPLIERS[creditScore.rating];
    const baseLimit = monthlyAverage * multiplier;
    
    // Apply caps
    const minLimit = 50000; // ₹50,000 or equivalent AED
    const maxLimit = 5000000; // ₹50 Lakh or equivalent AED
    
    const finalLimit = Math.max(minLimit, Math.min(baseLimit, maxLimit));
    
    // Update credit limit
    await prisma.creditLimit.upsert({
      where: { businessId },
      update: {
        limit: finalLimit,
        availableLimit: finalLimit,
        calculatedAt: new Date(),
      },
      create: {
        businessId,
        limit: finalLimit,
        availableLimit: finalLimit,
        usedLimit: 0,
      },
    });
    
    return {
      eligible: true,
      limit: finalLimit,
      rating: creditScore.rating,
      score: creditScore.score,
    };
  }
  
  /**
   * Check credit eligibility for an order
   */
  async checkOrderEligibility(businessId, orderAmount) {
    const creditLimit = await prisma.creditLimit.findUnique({
      where: { businessId },
    });
    
    if (!creditLimit) {
      return {
        eligible: false,
        reason: 'No credit limit established',
      };
    }
    
    if (orderAmount > creditLimit.availableLimit) {
      return {
        eligible: false,
        reason: 'Order amount exceeds available credit limit',
        availableLimit: creditLimit.availableLimit,
        requestedAmount: orderAmount,
      };
    }
    
    return {
      eligible: true,
      availableLimit: creditLimit.availableLimit,
      newAvailableLimit: creditLimit.availableLimit - orderAmount,
    };
  }
  
  /**
   * Use credit for an order
   */
  async useCredit(businessId, orderId, amount) {
    const creditLimit = await prisma.creditLimit.findUnique({
      where: { businessId },
    });
    
    if (!creditLimit || amount > creditLimit.availableLimit) {
      throw new BadRequestError('Insufficient credit limit');
    }
    
    // Create credit transaction
    await prisma.$transaction([
      prisma.creditLimit.update({
        where: { businessId },
        data: {
          usedLimit: { increment: amount },
          availableLimit: { decrement: amount },
        },
      }),
      prisma.creditTransaction.create({
        data: {
          businessId,
          orderId,
          type: 'USAGE',
          amount,
          balanceBefore: creditLimit.availableLimit,
          balanceAfter: creditLimit.availableLimit - amount,
        },
      }),
    ]);
    
    // Set payment due date (typically 30 days)
    const dueDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    
    await prisma.creditInvoice.create({
      data: {
        businessId,
        orderId,
        amount,
        dueDate,
        status: 'PENDING',
      },
    });
    
    return {
      success: true,
      amountUsed: amount,
      newAvailableLimit: creditLimit.availableLimit - amount,
      dueDate,
    };
  }
  
  /**
   * Release credit (order cancelled/refunded)
   */
  async releaseCredit(businessId, orderId, amount) {
    const creditLimit = await prisma.creditLimit.findUnique({
      where: { businessId },
    });
    
    if (!creditLimit) return;
    
    await prisma.$transaction([
      prisma.creditLimit.update({
        where: { businessId },
        data: {
          usedLimit: { decrement: amount },
          availableLimit: { increment: amount },
        },
      }),
      prisma.creditTransaction.create({
        data: {
          businessId,
          orderId,
          type: 'RELEASE',
          amount,
          balanceBefore: creditLimit.availableLimit,
          balanceAfter: creditLimit.availableLimit + amount,
        },
      }),
      prisma.creditInvoice.updateMany({
        where: { orderId, status: 'PENDING' },
        data: { status: 'CANCELLED' },
      }),
    ]);
  }
  
  /**
   * Process credit payment
   */
  async processPayment(businessId, invoiceId, amount, paymentMethod) {
    const invoice = await prisma.creditInvoice.findUnique({
      where: { id: invoiceId },
    });
    
    if (!invoice || invoice.businessId !== businessId) {
      throw new BadRequestError('Invoice not found');
    }
    
    if (invoice.status === 'PAID') {
      throw new BadRequestError('Invoice already paid');
    }
    
    const isPartialPayment = amount < parseFloat(invoice.amount) - parseFloat(invoice.paidAmount || 0);
    const newPaidAmount = parseFloat(invoice.paidAmount || 0) + amount;
    const isFullyPaid = newPaidAmount >= parseFloat(invoice.amount);
    
    // Update invoice
    await prisma.creditInvoice.update({
      where: { id: invoiceId },
      data: {
        paidAmount: newPaidAmount,
        status: isFullyPaid ? 'PAID' : 'PARTIAL',
        paidAt: isFullyPaid ? new Date() : undefined,
      },
    });
    
    // Restore credit limit
    const creditLimit = await prisma.creditLimit.findUnique({
      where: { businessId },
    });
    
    await prisma.$transaction([
      prisma.creditLimit.update({
        where: { businessId },
        data: {
          usedLimit: { decrement: amount },
          availableLimit: { increment: amount },
        },
      }),
      prisma.creditTransaction.create({
        data: {
          businessId,
          type: 'PAYMENT',
          amount,
          invoiceId,
          balanceBefore: creditLimit.availableLimit,
          balanceAfter: creditLimit.availableLimit + amount,
        },
      }),
    ]);
    
    // Check for late payment
    const isLate = new Date() > new Date(invoice.dueDate);
    if (isLate) {
      // Record late payment for credit score impact
      await this.recordLatePayment(businessId, invoiceId);
    }
    
    return {
      success: true,
      invoiceStatus: isFullyPaid ? 'PAID' : 'PARTIAL',
      remainingAmount: parseFloat(invoice.amount) - newPaidAmount,
      isLate,
    };
  }
  
  /**
   * Record late payment
   */
  async recordLatePayment(businessId, invoiceId) {
    await prisma.creditEvent.create({
      data: {
        businessId,
        type: 'LATE_PAYMENT',
        referenceId: invoiceId,
        impact: -10, // Negative impact on score
      },
    });
    
    // Trigger score recalculation
    await this.calculateCreditScore(businessId);
  }
  
  // =============================================================================
  // REPORTING
  // =============================================================================
  
  /**
   * Get credit summary for a business
   */
  async getCreditSummary(businessId) {
    const [creditScore, creditLimit, pendingInvoices] = await Promise.all([
      prisma.creditScore.findUnique({ where: { businessId } }),
      prisma.creditLimit.findUnique({ where: { businessId } }),
      prisma.creditInvoice.findMany({
        where: { businessId, status: { in: ['PENDING', 'PARTIAL'] } },
        orderBy: { dueDate: 'asc' },
      }),
    ]);
    
    const overdueAmount = pendingInvoices
      .filter((inv) => new Date() > new Date(inv.dueDate))
      .reduce((sum, inv) => sum + parseFloat(inv.amount) - parseFloat(inv.paidAmount || 0), 0);
    
    return {
      score: creditScore?.score || 0,
      rating: creditScore?.rating || 'UNRATED',
      totalLimit: creditLimit?.limit || 0,
      usedLimit: creditLimit?.usedLimit || 0,
      availableLimit: creditLimit?.availableLimit || 0,
      pendingInvoicesCount: pendingInvoices.length,
      totalPendingAmount: pendingInvoices.reduce(
        (sum, inv) => sum + parseFloat(inv.amount) - parseFloat(inv.paidAmount || 0),
        0
      ),
      overdueAmount,
      nextDueDate: pendingInvoices[0]?.dueDate || null,
    };
  }
  
  // =============================================================================
  // HELPER METHODS
  // =============================================================================
  
  getCurrentFinancialYear() {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    
    // Indian FY: April to March
    if (month >= 3) { // April onwards
      return `${year}-${(year + 1).toString().slice(-2)}`;
    }
    return `${year - 1}-${year.toString().slice(-2)}`;
  }
}

module.exports = new CreditScoringService();
