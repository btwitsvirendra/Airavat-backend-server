// =============================================================================
// AIRAVAT B2B MARKETPLACE - AUTOMATED RECONCILIATION SERVICE
// Match payments to invoices automatically
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { eventEmitter } = require('./eventEmitter.service');

/**
 * Reconciliation Configuration
 */
const RECON_CONFIG = {
  amountTolerance: 1, // 1% amount tolerance
  dateTolerance: 7, // Days tolerance for date matching
  minMatchScore: 70, // Minimum score to consider a match
  autoMatchScore: 95, // Auto-match if score >= this
  batchPrefix: 'REC',
  matchMethods: {
    EXACT_REFERENCE: { weight: 50, description: 'Exact reference number match' },
    EXACT_AMOUNT: { weight: 20, description: 'Exact amount match' },
    FUZZY_AMOUNT: { weight: 10, description: 'Amount within tolerance' },
    DATE_PROXIMITY: { weight: 10, description: 'Transaction date within range' },
    COUNTERPARTY: { weight: 10, description: 'Counterparty name match' },
  },
};

class ReconciliationService {
  // ===========================================================================
  // RECONCILIATION RULES
  // ===========================================================================

  /**
   * Create reconciliation rule
   */
  async createRule(businessId, ruleData) {
    const {
      name,
      description,
      matchType,
      matchFields,
      tolerance = RECON_CONFIG.amountTolerance,
      dateTolerance = RECON_CONFIG.dateTolerance,
      priority = 10,
    } = ruleData;

    const rule = await prisma.reconciliationRule.create({
      data: {
        businessId,
        name,
        description,
        matchType,
        matchFields,
        tolerance,
        dateTolerance,
        priority,
        isActive: true,
      },
    });

    logger.info('Reconciliation rule created', { ruleId: rule.id, businessId });

    return rule;
  }

  /**
   * Get rules for business
   */
  async getRules(businessId) {
    return prisma.reconciliationRule.findMany({
      where: { businessId, isActive: true },
      orderBy: { priority: 'desc' },
    });
  }

  /**
   * Update rule
   */
  async updateRule(ruleId, updates) {
    return prisma.reconciliationRule.update({
      where: { id: ruleId },
      data: updates,
    });
  }

  /**
   * Delete rule (soft delete)
   */
  async deleteRule(ruleId) {
    return prisma.reconciliationRule.update({
      where: { id: ruleId },
      data: { isActive: false },
    });
  }

  // ===========================================================================
  // BATCH RECONCILIATION
  // ===========================================================================

  /**
   * Start reconciliation batch
   */
  async startBatch(businessId, options = {}) {
    const { startDate, endDate = new Date() } = options;

    // Default start date: 30 days ago
    const defaultStartDate = new Date();
    defaultStartDate.setDate(defaultStartDate.getDate() - 30);

    const batchNumber = await this.generateBatchNumber();

    const batch = await prisma.reconciliationBatch.create({
      data: {
        businessId,
        batchNumber,
        startDate: new Date(startDate || defaultStartDate),
        endDate: new Date(endDate),
        status: 'IN_PROGRESS',
      },
    });

    logger.info('Reconciliation batch started', {
      batchId: batch.id,
      batchNumber,
      businessId,
    });

    // Start async reconciliation process
    this.processReconciliationBatch(batch.id).catch(err => {
      logger.error('Batch reconciliation failed', { batchId: batch.id, error: err.message });
    });

    return batch;
  }

  /**
   * Generate batch number
   */
  async generateBatchNumber() {
    const date = new Date();
    const dateStr = date.toISOString().slice(0, 10).replace(/-/g, '');
    
    const count = await prisma.reconciliationBatch.count({
      where: {
        batchNumber: { startsWith: `${RECON_CONFIG.batchPrefix}${dateStr}` },
      },
    });

    return `${RECON_CONFIG.batchPrefix}${dateStr}${String(count + 1).padStart(4, '0')}`;
  }

  /**
   * Process reconciliation batch
   */
  async processReconciliationBatch(batchId) {
    const batch = await prisma.reconciliationBatch.findUnique({
      where: { id: batchId },
      include: { business: true },
    });

    if (!batch) throw new Error('Batch not found');

    try {
      // Get unreconciled bank transactions
      const bankTransactions = await prisma.bankTransaction.findMany({
        where: {
          connection: { businessId: batch.businessId },
          isReconciled: false,
          transactionDate: {
            gte: batch.startDate,
            lte: batch.endDate,
          },
        },
      });

      // Get unmatched invoices and payments
      const invoices = await this.getUnmatchedInvoices(batch.businessId, batch.startDate, batch.endDate);
      const payments = await this.getUnmatchedPayments(batch.businessId, batch.startDate, batch.endDate);

      // Get reconciliation rules
      const rules = await this.getRules(batch.businessId);

      let matchedCount = 0;
      let unmatchedCount = 0;

      // Process each bank transaction
      for (const bankTxn of bankTransactions) {
        const matchResult = await this.findBestMatch(bankTxn, invoices, payments, rules);

        // Create reconciliation item
        const item = await prisma.reconciliationItem.create({
          data: {
            batchId,
            bankTransactionId: bankTxn.id,
            bankAmount: bankTxn.amount,
            bankDate: bankTxn.transactionDate,
            bankDescription: bankTxn.description,
            matchedType: matchResult.matchedType,
            matchedId: matchResult.matchedId,
            matchedAmount: matchResult.matchedAmount,
            matchScore: matchResult.score,
            matchMethod: matchResult.method,
            status: matchResult.status,
          },
        });

        if (matchResult.status === 'MATCHED') {
          matchedCount++;

          // Auto-apply if score is high enough
          if (matchResult.score >= RECON_CONFIG.autoMatchScore) {
            await this.applyMatch(item.id, 'AUTO');
          }
        } else {
          unmatchedCount++;
        }
      }

      // Update batch status
      await prisma.reconciliationBatch.update({
        where: { id: batchId },
        data: {
          totalTransactions: bankTransactions.length,
          matchedCount,
          unmatchedCount,
          status: 'COMPLETED',
          completedAt: new Date(),
        },
      });

      logger.info('Reconciliation batch completed', {
        batchId,
        totalTransactions: bankTransactions.length,
        matchedCount,
        unmatchedCount,
      });

      eventEmitter.emit('reconciliation.batch_completed', {
        batchId,
        matchedCount,
        unmatchedCount,
      });

    } catch (error) {
      await prisma.reconciliationBatch.update({
        where: { id: batchId },
        data: { status: 'FAILED' },
      });

      throw error;
    }
  }

  /**
   * Get unmatched invoices
   */
  async getUnmatchedInvoices(businessId, startDate, endDate) {
    // Get invoices that haven't been fully paid/reconciled
    const orders = await prisma.order.findMany({
      where: {
        sellerId: businessId,
        paymentStatus: { in: ['PENDING', 'PARTIALLY_PAID'] },
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        orderNumber: true,
        totalAmount: true,
        createdAt: true,
        buyer: {
          select: { businessName: true },
        },
      },
    });

    return orders.map(order => ({
      type: 'INVOICE',
      id: order.id,
      reference: order.orderNumber,
      amount: parseFloat(order.totalAmount),
      date: order.createdAt,
      counterparty: order.buyer?.businessName,
    }));
  }

  /**
   * Get unmatched payments
   */
  async getUnmatchedPayments(businessId, startDate, endDate) {
    const payments = await prisma.payment.findMany({
      where: {
        order: { sellerId: businessId },
        status: 'COMPLETED',
        reconciled: false,
        createdAt: {
          gte: startDate,
          lte: endDate,
        },
      },
      select: {
        id: true,
        transactionId: true,
        amount: true,
        createdAt: true,
        order: {
          select: {
            orderNumber: true,
            buyer: {
              select: { businessName: true },
            },
          },
        },
      },
    });

    return payments.map(payment => ({
      type: 'PAYMENT',
      id: payment.id,
      reference: payment.transactionId || payment.order?.orderNumber,
      amount: parseFloat(payment.amount),
      date: payment.createdAt,
      counterparty: payment.order?.buyer?.businessName,
    }));
  }

  /**
   * Find best match for bank transaction
   */
  async findBestMatch(bankTxn, invoices, payments, rules) {
    let bestMatch = {
      matchedType: null,
      matchedId: null,
      matchedAmount: null,
      score: 0,
      method: null,
      status: 'UNMATCHED',
    };

    // Combine invoices and payments for matching
    const candidates = [
      ...invoices.filter(i => bankTxn.type === 'CREDIT'),
      ...payments.filter(p => bankTxn.type === 'CREDIT'),
    ];

    for (const candidate of candidates) {
      const score = this.calculateMatchScore(bankTxn, candidate, rules);

      if (score > bestMatch.score && score >= RECON_CONFIG.minMatchScore) {
        bestMatch = {
          matchedType: candidate.type,
          matchedId: candidate.id,
          matchedAmount: candidate.amount,
          score,
          method: 'AUTO',
          status: 'MATCHED',
        };
      }
    }

    return bestMatch;
  }

  /**
   * Calculate match score between bank transaction and candidate
   */
  calculateMatchScore(bankTxn, candidate, rules) {
    let score = 0;
    const methods = RECON_CONFIG.matchMethods;

    // Reference matching
    if (bankTxn.reference && candidate.reference) {
      if (bankTxn.reference.toLowerCase().includes(candidate.reference.toLowerCase()) ||
          candidate.reference.toLowerCase().includes(bankTxn.reference.toLowerCase())) {
        score += methods.EXACT_REFERENCE.weight;
      }
    }

    // Amount matching
    const bankAmount = parseFloat(bankTxn.amount);
    const candidateAmount = candidate.amount;
    const amountDiff = Math.abs(bankAmount - candidateAmount);
    const amountDiffPercent = (amountDiff / candidateAmount) * 100;

    if (amountDiff === 0) {
      score += methods.EXACT_AMOUNT.weight;
    } else if (amountDiffPercent <= RECON_CONFIG.amountTolerance) {
      score += methods.FUZZY_AMOUNT.weight;
    }

    // Date proximity
    const bankDate = new Date(bankTxn.transactionDate);
    const candidateDate = new Date(candidate.date);
    const daysDiff = Math.abs(bankDate - candidateDate) / (1000 * 60 * 60 * 24);

    if (daysDiff <= RECON_CONFIG.dateTolerance) {
      const dateScore = methods.DATE_PROXIMITY.weight * (1 - daysDiff / RECON_CONFIG.dateTolerance);
      score += Math.max(0, dateScore);
    }

    // Counterparty matching
    if (bankTxn.counterpartyName && candidate.counterparty) {
      const bankParty = bankTxn.counterpartyName.toLowerCase();
      const candidateParty = candidate.counterparty.toLowerCase();

      if (bankParty.includes(candidateParty) || candidateParty.includes(bankParty)) {
        score += methods.COUNTERPARTY.weight;
      } else {
        // Fuzzy match using Levenshtein-like similarity
        const similarity = this.calculateSimilarity(bankParty, candidateParty);
        if (similarity > 0.7) {
          score += methods.COUNTERPARTY.weight * similarity;
        }
      }
    }

    return Math.round(score);
  }

  /**
   * Calculate string similarity (Dice coefficient)
   */
  calculateSimilarity(str1, str2) {
    if (str1 === str2) return 1;
    if (str1.length < 2 || str2.length < 2) return 0;

    const bigrams1 = new Set();
    for (let i = 0; i < str1.length - 1; i++) {
      bigrams1.add(str1.substring(i, i + 2));
    }

    let intersection = 0;
    for (let i = 0; i < str2.length - 1; i++) {
      const bigram = str2.substring(i, i + 2);
      if (bigrams1.has(bigram)) {
        intersection++;
        bigrams1.delete(bigram);
      }
    }

    return (2 * intersection) / (str1.length + str2.length - 2);
  }

  // ===========================================================================
  // MATCH MANAGEMENT
  // ===========================================================================

  /**
   * Apply match (mark as reconciled)
   */
  async applyMatch(itemId, matchedBy = 'SYSTEM') {
    const item = await prisma.reconciliationItem.findUnique({
      where: { id: itemId },
    });

    if (!item) throw new Error('Reconciliation item not found');
    if (!item.matchedId) throw new Error('No match to apply');

    await prisma.$transaction(async (tx) => {
      // Update reconciliation item
      await tx.reconciliationItem.update({
        where: { id: itemId },
        data: {
          status: matchedBy === 'SYSTEM' ? 'MATCHED' : 'MANUALLY_MATCHED',
          matchMethod: matchedBy === 'SYSTEM' ? 'AUTO' : 'MANUAL',
          resolvedBy: matchedBy,
          resolvedAt: new Date(),
        },
      });

      // Mark bank transaction as reconciled
      await tx.bankTransaction.update({
        where: { id: item.bankTransactionId },
        data: {
          isReconciled: true,
          reconciledWith: `${item.matchedType}:${item.matchedId}`,
          reconciledAt: new Date(),
        },
      });

      // Update matched record
      if (item.matchedType === 'PAYMENT') {
        await tx.payment.update({
          where: { id: item.matchedId },
          data: { reconciled: true },
        });
      } else if (item.matchedType === 'INVOICE') {
        // Update order payment status if needed
        await tx.order.update({
          where: { id: item.matchedId },
          data: { paymentStatus: 'PAID' },
        });
      }

      // Update batch counts
      const batch = await tx.reconciliationBatch.findFirst({
        where: { id: item.batchId },
      });

      if (batch && item.status === 'UNMATCHED') {
        await tx.reconciliationBatch.update({
          where: { id: item.batchId },
          data: {
            matchedCount: { increment: 1 },
            unmatchedCount: { decrement: 1 },
            manualCount: matchedBy !== 'SYSTEM' ? { increment: 1 } : undefined,
          },
        });
      }
    });

    logger.info('Match applied', { itemId, matchedBy });

    return { success: true };
  }

  /**
   * Manual match
   */
  async manualMatch(itemId, matchData, resolvedBy) {
    const { matchedType, matchedId, notes } = matchData;

    // Get matched record amount
    let matchedAmount;
    if (matchedType === 'INVOICE') {
      const order = await prisma.order.findUnique({
        where: { id: matchedId },
        select: { totalAmount: true },
      });
      matchedAmount = order?.totalAmount;
    } else if (matchedType === 'PAYMENT') {
      const payment = await prisma.payment.findUnique({
        where: { id: matchedId },
        select: { amount: true },
      });
      matchedAmount = payment?.amount;
    }

    await prisma.reconciliationItem.update({
      where: { id: itemId },
      data: {
        matchedType,
        matchedId,
        matchedAmount,
        matchScore: 100, // Manual match = perfect score
        matchMethod: 'MANUAL',
        status: 'MANUALLY_MATCHED',
        resolvedBy,
        resolvedAt: new Date(),
        notes,
      },
    });

    // Apply the match
    await this.applyMatch(itemId, resolvedBy);

    logger.info('Manual match applied', { itemId, matchedType, matchedId, resolvedBy });

    return { success: true };
  }

  /**
   * Mark as exception (won't be matched)
   */
  async markAsException(itemId, notes, resolvedBy) {
    const item = await prisma.reconciliationItem.update({
      where: { id: itemId },
      data: {
        status: 'EXCEPTION',
        notes,
        resolvedBy,
        resolvedAt: new Date(),
      },
    });

    logger.info('Item marked as exception', { itemId, resolvedBy });

    return item;
  }

  /**
   * Unmatch previously matched item
   */
  async unmatch(itemId, reason, unmathedBy) {
    const item = await prisma.reconciliationItem.findUnique({
      where: { id: itemId },
    });

    if (!item) throw new Error('Item not found');
    if (!['MATCHED', 'MANUALLY_MATCHED'].includes(item.status)) {
      throw new Error('Item is not matched');
    }

    await prisma.$transaction(async (tx) => {
      // Reset reconciliation item
      await tx.reconciliationItem.update({
        where: { id: itemId },
        data: {
          status: 'PENDING',
          resolvedBy: null,
          resolvedAt: null,
          notes: reason,
        },
      });

      // Reset bank transaction
      await tx.bankTransaction.update({
        where: { id: item.bankTransactionId },
        data: {
          isReconciled: false,
          reconciledWith: null,
          reconciledAt: null,
        },
      });

      // Reset matched record
      if (item.matchedType === 'PAYMENT') {
        await tx.payment.update({
          where: { id: item.matchedId },
          data: { reconciled: false },
        });
      }
    });

    logger.info('Match removed', { itemId, reason, unmathedBy });

    return { success: true };
  }

  // ===========================================================================
  // QUERIES & REPORTS
  // ===========================================================================

  /**
   * Get batch details
   */
  async getBatch(batchId) {
    return prisma.reconciliationBatch.findUnique({
      where: { id: batchId },
      include: {
        items: {
          orderBy: { status: 'asc' },
        },
      },
    });
  }

  /**
   * Get unmatched items
   */
  async getUnmatchedItems(batchId, options = {}) {
    const { page = 1, limit = 20 } = options;

    const where = {
      batchId,
      status: { in: ['PENDING', 'UNMATCHED'] },
    };

    const [items, total] = await Promise.all([
      prisma.reconciliationItem.findMany({
        where,
        orderBy: { bankDate: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.reconciliationItem.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get reconciliation summary
   */
  async getReconciliationSummary(businessId, period = 'month') {
    const startDate = new Date();
    if (period === 'week') {
      startDate.setDate(startDate.getDate() - 7);
    } else if (period === 'month') {
      startDate.setMonth(startDate.getMonth() - 1);
    } else if (period === 'year') {
      startDate.setFullYear(startDate.getFullYear() - 1);
    }

    const [batches, items] = await Promise.all([
      prisma.reconciliationBatch.aggregate({
        where: {
          businessId,
          startedAt: { gte: startDate },
        },
        _sum: {
          totalTransactions: true,
          matchedCount: true,
          unmatchedCount: true,
          manualCount: true,
        },
        _count: true,
      }),
      prisma.reconciliationItem.groupBy({
        by: ['status'],
        where: {
          batch: {
            businessId,
            startedAt: { gte: startDate },
          },
        },
        _count: true,
      }),
    ]);

    const itemsByStatus = {};
    for (const item of items) {
      itemsByStatus[item.status] = item._count;
    }

    const totalTransactions = batches._sum.totalTransactions || 0;
    const matchedCount = batches._sum.matchedCount || 0;

    return {
      period,
      batchCount: batches._count,
      totalTransactions,
      matchedCount,
      unmatchedCount: batches._sum.unmatchedCount || 0,
      manualMatchCount: batches._sum.manualCount || 0,
      autoMatchRate: totalTransactions > 0 
        ? Math.round(((matchedCount - (batches._sum.manualCount || 0)) / totalTransactions) * 100) 
        : 0,
      itemsByStatus,
    };
  }

  /**
   * Find matching candidates for a bank transaction
   */
  async findMatchingCandidates(bankTransactionId) {
    const bankTxn = await prisma.bankTransaction.findUnique({
      where: { id: bankTransactionId },
      include: {
        connection: true,
      },
    });

    if (!bankTxn) throw new Error('Bank transaction not found');

    const businessId = bankTxn.connection.businessId;

    // Get potential matches
    const invoices = await this.getUnmatchedInvoices(
      businessId,
      new Date(bankTxn.transactionDate.getTime() - 30 * 24 * 60 * 60 * 1000),
      new Date(bankTxn.transactionDate.getTime() + 7 * 24 * 60 * 60 * 1000)
    );

    const payments = await this.getUnmatchedPayments(
      businessId,
      new Date(bankTxn.transactionDate.getTime() - 30 * 24 * 60 * 60 * 1000),
      new Date(bankTxn.transactionDate.getTime() + 7 * 24 * 60 * 60 * 1000)
    );

    const rules = await this.getRules(businessId);
    const candidates = [...invoices, ...payments];

    // Score all candidates
    const scoredCandidates = candidates.map(candidate => ({
      ...candidate,
      score: this.calculateMatchScore(bankTxn, candidate, rules),
    }));

    // Sort by score descending
    scoredCandidates.sort((a, b) => b.score - a.score);

    // Return top candidates
    return scoredCandidates.filter(c => c.score >= 30).slice(0, 10);
  }
}

module.exports = new ReconciliationService();
