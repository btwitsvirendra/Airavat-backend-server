// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL REPORTS SERVICE
// Comprehensive reporting and analytics for financial services
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');

// =============================================================================
// CONFIGURATION
// =============================================================================

const REPORT_CONFIG = {
  defaultPeriod: 30, // days
  maxExportRows: 10000,
  currencies: ['INR', 'AED', 'USD', 'EUR', 'GBP'],
};

// =============================================================================
// DASHBOARD ANALYTICS
// =============================================================================

/**
 * Get financial dashboard overview
 */
exports.getDashboardOverview = async (businessId = null, period = 30) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - period);

  const whereClause = businessId ? { businessId } : {};
  const userWhereClause = businessId 
    ? { wallet: { businessId } } 
    : {};

  const [
    walletStats,
    transactionStats,
    emiStats,
    factoringStats,
    cardStats,
    insuranceStats,
  ] = await Promise.all([
    // Wallet statistics
    prisma.wallet.aggregate({
      where: whereClause,
      _sum: { balance: true, lockedBalance: true },
      _count: true,
      _avg: { balance: true },
    }),

    // Transaction statistics
    prisma.walletTransaction.groupBy({
      by: ['type'],
      where: {
        createdAt: { gte: startDate },
        status: 'COMPLETED',
        ...(businessId && { wallet: { businessId } }),
      },
      _sum: { amount: true },
      _count: true,
    }),

    // EMI statistics
    prisma.eMIOrder.aggregate({
      where: {
        ...userWhereClause,
        status: { in: ['ACTIVE', 'COMPLETED'] },
      },
      _sum: { principalAmount: true, paidAmount: true, remainingAmount: true },
      _count: true,
    }),

    // Factoring statistics
    prisma.factoringApplication.aggregate({
      where: {
        ...whereClause,
        createdAt: { gte: startDate },
      },
      _sum: { invoiceAmount: true, advanceAmount: true },
      _count: true,
    }),

    // Virtual card statistics
    prisma.virtualCard.aggregate({
      where: userWhereClause,
      _sum: { cardLimit: true, spentAmount: true },
      _count: true,
    }),

    // Insurance statistics
    prisma.creditInsurancePolicy.aggregate({
      where: {
        ...whereClause,
        status: 'ACTIVE',
      },
      _sum: { coverageLimit: true, usedCoverage: true, premiumAmount: true },
      _count: true,
    }),
  ]);

  // Process transaction stats into readable format
  const transactionsByType = {};
  transactionStats.forEach(stat => {
    transactionsByType[stat.type] = {
      count: stat._count,
      totalAmount: parseFloat(stat._sum.amount || 0),
    };
  });

  return {
    period: { days: period, startDate, endDate: new Date() },
    wallet: {
      totalWallets: walletStats._count,
      totalBalance: parseFloat(walletStats._sum.balance || 0),
      totalLocked: parseFloat(walletStats._sum.lockedBalance || 0),
      averageBalance: parseFloat(walletStats._avg.balance || 0),
    },
    transactions: {
      byType: transactionsByType,
      totalVolume: Object.values(transactionsByType)
        .reduce((sum, t) => sum + t.totalAmount, 0),
      totalCount: Object.values(transactionsByType)
        .reduce((sum, t) => sum + t.count, 0),
    },
    emi: {
      totalOrders: emiStats._count,
      totalPrincipal: parseFloat(emiStats._sum.principalAmount || 0),
      totalCollected: parseFloat(emiStats._sum.paidAmount || 0),
      totalOutstanding: parseFloat(emiStats._sum.remainingAmount || 0),
    },
    factoring: {
      totalApplications: factoringStats._count,
      totalInvoiceValue: parseFloat(factoringStats._sum.invoiceAmount || 0),
      totalDisbursed: parseFloat(factoringStats._sum.advanceAmount || 0),
    },
    virtualCards: {
      totalCards: cardStats._count,
      totalLimit: parseFloat(cardStats._sum.cardLimit || 0),
      totalSpent: parseFloat(cardStats._sum.spentAmount || 0),
      utilizationRate: cardStats._sum.cardLimit 
        ? Math.round((cardStats._sum.spentAmount / cardStats._sum.cardLimit) * 100)
        : 0,
    },
    insurance: {
      activePolicies: insuranceStats._count,
      totalCoverage: parseFloat(insuranceStats._sum.coverageLimit || 0),
      usedCoverage: parseFloat(insuranceStats._sum.usedCoverage || 0),
      totalPremiums: parseFloat(insuranceStats._sum.premiumAmount || 0),
    },
    generatedAt: new Date(),
  };
};

// =============================================================================
// TRANSACTION REPORTS
// =============================================================================

/**
 * Generate detailed transaction report
 */
exports.getTransactionReport = async (options = {}) => {
  const {
    businessId,
    walletId,
    startDate,
    endDate,
    type,
    status,
    minAmount,
    maxAmount,
    page = 1,
    limit = 50,
    groupBy,
  } = options;

  const where = {
    createdAt: {
      gte: startDate || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      lte: endDate || new Date(),
    },
  };

  if (walletId) where.walletId = walletId;
  if (businessId) where.wallet = { businessId };
  if (type) where.type = type;
  if (status) where.status = status;
  if (minAmount) where.amount = { gte: parseFloat(minAmount) };
  if (maxAmount) where.amount = { ...where.amount, lte: parseFloat(maxAmount) };

  // If grouping requested, return aggregated data
  if (groupBy) {
    const groupedData = await prisma.walletTransaction.groupBy({
      by: [groupBy],
      where,
      _sum: { amount: true },
      _count: true,
      _avg: { amount: true },
      orderBy: { _sum: { amount: 'desc' } },
    });

    return {
      groupBy,
      data: groupedData.map(g => ({
        [groupBy]: g[groupBy],
        count: g._count,
        totalAmount: parseFloat(g._sum.amount || 0),
        averageAmount: parseFloat(g._avg.amount || 0),
      })),
    };
  }

  // Otherwise return detailed transactions
  const [transactions, total, summary] = await Promise.all([
    prisma.walletTransaction.findMany({
      where,
      include: {
        wallet: {
          select: {
            id: true,
            business: { select: { businessName: true } },
            user: { select: { name: true, email: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.walletTransaction.count({ where }),
    prisma.walletTransaction.aggregate({
      where,
      _sum: { amount: true },
      _avg: { amount: true },
      _max: { amount: true },
      _min: { amount: true },
    }),
  ]);

  return {
    transactions,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
    },
    summary: {
      totalAmount: parseFloat(summary._sum.amount || 0),
      averageAmount: parseFloat(summary._avg.amount || 0),
      maxAmount: parseFloat(summary._max.amount || 0),
      minAmount: parseFloat(summary._min.amount || 0),
      transactionCount: total,
    },
  };
};

// =============================================================================
// EMI COLLECTION REPORT
// =============================================================================

/**
 * Generate EMI collection report
 */
exports.getEMICollectionReport = async (options = {}) => {
  const {
    startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
    endDate = new Date(),
    status,
    businessId,
  } = options;

  const where = {
    dueDate: { gte: startDate, lte: endDate },
  };

  if (status) where.status = status;
  if (businessId) where.emiOrder = { user: { business: { id: businessId } } };

  const [
    installments,
    statusBreakdown,
    collectionSummary,
  ] = await Promise.all([
    prisma.eMIInstallment.findMany({
      where,
      include: {
        emiOrder: {
          include: {
            user: { select: { name: true, email: true, phone: true } },
          },
        },
      },
      orderBy: { dueDate: 'asc' },
    }),

    prisma.eMIInstallment.groupBy({
      by: ['status'],
      where,
      _sum: { amount: true, paidAmount: true, lateFee: true },
      _count: true,
    }),

    prisma.eMIInstallment.aggregate({
      where,
      _sum: { amount: true, paidAmount: true, lateFee: true },
    }),
  ]);

  // Calculate collection efficiency
  const totalDue = parseFloat(collectionSummary._sum.amount || 0);
  const totalCollected = parseFloat(collectionSummary._sum.paidAmount || 0);
  const collectionEfficiency = totalDue > 0 
    ? Math.round((totalCollected / totalDue) * 100) 
    : 0;

  // Aging analysis
  const today = new Date();
  const agingBuckets = {
    current: { count: 0, amount: 0 },
    '1-30_days': { count: 0, amount: 0 },
    '31-60_days': { count: 0, amount: 0 },
    '61-90_days': { count: 0, amount: 0 },
    'over_90_days': { count: 0, amount: 0 },
  };

  installments.forEach(inst => {
    if (inst.status === 'PAID') return;
    
    const daysOverdue = Math.floor((today - inst.dueDate) / (1000 * 60 * 60 * 24));
    const amount = parseFloat(inst.amount);

    if (daysOverdue <= 0) {
      agingBuckets.current.count++;
      agingBuckets.current.amount += amount;
    } else if (daysOverdue <= 30) {
      agingBuckets['1-30_days'].count++;
      agingBuckets['1-30_days'].amount += amount;
    } else if (daysOverdue <= 60) {
      agingBuckets['31-60_days'].count++;
      agingBuckets['31-60_days'].amount += amount;
    } else if (daysOverdue <= 90) {
      agingBuckets['61-90_days'].count++;
      agingBuckets['61-90_days'].amount += amount;
    } else {
      agingBuckets.over_90_days.count++;
      agingBuckets.over_90_days.amount += amount;
    }
  });

  return {
    period: { startDate, endDate },
    summary: {
      totalDue: totalDue,
      totalCollected: totalCollected,
      totalOutstanding: totalDue - totalCollected,
      totalLateFees: parseFloat(collectionSummary._sum.lateFee || 0),
      collectionEfficiency: `${collectionEfficiency}%`,
    },
    statusBreakdown: statusBreakdown.map(s => ({
      status: s.status,
      count: s._count,
      totalDue: parseFloat(s._sum.amount || 0),
      totalPaid: parseFloat(s._sum.paidAmount || 0),
      lateFees: parseFloat(s._sum.lateFee || 0),
    })),
    agingAnalysis: agingBuckets,
    installmentCount: installments.length,
    generatedAt: new Date(),
  };
};

// =============================================================================
// FACTORING PORTFOLIO REPORT
// =============================================================================

/**
 * Generate factoring portfolio report
 */
exports.getFactoringPortfolioReport = async (options = {}) => {
  const { businessId, status, startDate, endDate } = options;

  const where = {};
  if (businessId) where.businessId = businessId;
  if (status) where.status = status;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const [
    applications,
    statusSummary,
    portfolioSummary,
  ] = await Promise.all([
    prisma.factoringApplication.findMany({
      where,
      include: {
        business: { select: { businessName: true } },
        buyerBusiness: { select: { businessName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),

    prisma.factoringApplication.groupBy({
      by: ['status'],
      where,
      _sum: { invoiceAmount: true, advanceAmount: true, feeAmount: true },
      _count: true,
    }),

    prisma.factoringApplication.aggregate({
      where,
      _sum: { invoiceAmount: true, advanceAmount: true, feeAmount: true },
      _avg: { advanceRate: true },
    }),
  ]);

  // Calculate key metrics
  const totalInvoices = parseFloat(portfolioSummary._sum.invoiceAmount || 0);
  const totalAdvanced = parseFloat(portfolioSummary._sum.advanceAmount || 0);
  const totalFees = parseFloat(portfolioSummary._sum.feeAmount || 0);
  const averageAdvanceRate = parseFloat(portfolioSummary._avg.advanceRate || 0);

  // Risk analysis by buyer
  const buyerExposure = {};
  applications.forEach(app => {
    const buyerName = app.buyerBusiness?.businessName || app.buyerName || 'Unknown';
    if (!buyerExposure[buyerName]) {
      buyerExposure[buyerName] = { count: 0, totalAmount: 0 };
    }
    buyerExposure[buyerName].count++;
    buyerExposure[buyerName].totalAmount += parseFloat(app.invoiceAmount);
  });

  return {
    summary: {
      totalApplications: applications.length,
      totalInvoiceValue: totalInvoices,
      totalAdvanced: totalAdvanced,
      totalFeesEarned: totalFees,
      averageAdvanceRate: `${Math.round(averageAdvanceRate)}%`,
      netExposure: totalAdvanced - (applications.filter(a => a.status === 'SETTLED').reduce((sum, a) => sum + parseFloat(a.settlementAmount || 0), 0)),
    },
    statusBreakdown: statusSummary.map(s => ({
      status: s.status,
      count: s._count,
      invoiceValue: parseFloat(s._sum.invoiceAmount || 0),
      advancedAmount: parseFloat(s._sum.advanceAmount || 0),
      fees: parseFloat(s._sum.feeAmount || 0),
    })),
    buyerConcentration: Object.entries(buyerExposure)
      .map(([buyer, data]) => ({
        buyer,
        ...data,
        percentageOfTotal: Math.round((data.totalAmount / totalInvoices) * 100),
      }))
      .sort((a, b) => b.totalAmount - a.totalAmount)
      .slice(0, 10),
    generatedAt: new Date(),
  };
};

// =============================================================================
// TRADE FINANCE REPORT
// =============================================================================

/**
 * Generate trade finance (LC) report
 */
exports.getTradeFinanceReport = async (options = {}) => {
  const { businessId, status, type, startDate, endDate } = options;

  const where = {};
  if (businessId) {
    where.OR = [
      { applicantId: businessId },
      { beneficiaryId: businessId },
    ];
  }
  if (status) where.status = status;
  if (type) where.type = type;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const [
    lcs,
    statusSummary,
    typeSummary,
    currencySummary,
  ] = await Promise.all([
    prisma.letterOfCredit.findMany({
      where,
      include: {
        applicant: { select: { businessName: true } },
        beneficiary: { select: { businessName: true } },
      },
      orderBy: { createdAt: 'desc' },
    }),

    prisma.letterOfCredit.groupBy({
      by: ['status'],
      where,
      _sum: { amount: true },
      _count: true,
    }),

    prisma.letterOfCredit.groupBy({
      by: ['type'],
      where,
      _sum: { amount: true },
      _count: true,
    }),

    prisma.letterOfCredit.groupBy({
      by: ['currency'],
      where,
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  // Calculate expiring soon
  const thirtyDaysFromNow = new Date();
  thirtyDaysFromNow.setDate(thirtyDaysFromNow.getDate() + 30);
  
  const expiringSoon = lcs.filter(lc => 
    lc.status !== 'EXPIRED' && 
    lc.status !== 'PAID' && 
    new Date(lc.expiryDate) <= thirtyDaysFromNow
  );

  return {
    summary: {
      totalLCs: lcs.length,
      totalValue: lcs.reduce((sum, lc) => sum + parseFloat(lc.amount), 0),
      activeValue: lcs
        .filter(lc => ['ISSUED', 'ADVISED', 'CONFIRMED'].includes(lc.status))
        .reduce((sum, lc) => sum + parseFloat(lc.amount), 0),
    },
    statusBreakdown: statusSummary.map(s => ({
      status: s.status,
      count: s._count,
      totalValue: parseFloat(s._sum.amount || 0),
    })),
    typeBreakdown: typeSummary.map(t => ({
      type: t.type,
      count: t._count,
      totalValue: parseFloat(t._sum.amount || 0),
    })),
    currencyBreakdown: currencySummary.map(c => ({
      currency: c.currency,
      count: c._count,
      totalValue: parseFloat(c._sum.amount || 0),
    })),
    expiringSoon: {
      count: expiringSoon.length,
      totalValue: expiringSoon.reduce((sum, lc) => sum + parseFloat(lc.amount), 0),
      items: expiringSoon.map(lc => ({
        lcNumber: lc.lcNumber,
        amount: lc.amount,
        currency: lc.currency,
        expiryDate: lc.expiryDate,
        daysToExpiry: Math.ceil((new Date(lc.expiryDate) - new Date()) / (1000 * 60 * 60 * 24)),
      })),
    },
    generatedAt: new Date(),
  };
};

// =============================================================================
// INSURANCE CLAIMS REPORT
// =============================================================================

/**
 * Generate insurance claims report
 */
exports.getInsuranceClaimsReport = async (options = {}) => {
  const { businessId, status, startDate, endDate } = options;

  const where = {};
  if (businessId) where.policy = { businessId };
  if (status) where.status = status;
  if (startDate || endDate) {
    where.claimDate = {};
    if (startDate) where.claimDate.gte = new Date(startDate);
    if (endDate) where.claimDate.lte = new Date(endDate);
  }

  const [
    claims,
    statusSummary,
    policySummary,
  ] = await Promise.all([
    prisma.insuranceClaim.findMany({
      where,
      include: {
        policy: {
          select: {
            policyNumber: true,
            businessId: true,
            business: { select: { businessName: true } },
          },
        },
      },
      orderBy: { claimDate: 'desc' },
    }),

    prisma.insuranceClaim.groupBy({
      by: ['status'],
      where,
      _sum: { invoiceAmount: true, claimAmount: true, settlementAmount: true },
      _count: true,
    }),

    prisma.creditInsurancePolicy.aggregate({
      where: businessId ? { businessId } : {},
      _sum: { coverageLimit: true, usedCoverage: true, premiumAmount: true },
      _count: true,
    }),
  ]);

  // Calculate loss ratio
  const totalPremiums = parseFloat(policySummary._sum.premiumAmount || 0);
  const totalSettlements = claims
    .filter(c => c.status === 'SETTLED')
    .reduce((sum, c) => sum + parseFloat(c.settlementAmount || 0), 0);
  const lossRatio = totalPremiums > 0 
    ? Math.round((totalSettlements / totalPremiums) * 100)
    : 0;

  // Average claim processing time
  const settledClaims = claims.filter(c => c.status === 'SETTLED' && c.settledAt);
  const avgProcessingDays = settledClaims.length > 0
    ? Math.round(
        settledClaims.reduce((sum, c) => {
          return sum + Math.ceil((new Date(c.settledAt) - new Date(c.claimDate)) / (1000 * 60 * 60 * 24));
        }, 0) / settledClaims.length
      )
    : 0;

  return {
    summary: {
      totalClaims: claims.length,
      totalClaimValue: claims.reduce((sum, c) => sum + parseFloat(c.claimAmount), 0),
      totalSettled: totalSettlements,
      pendingClaims: claims.filter(c => !['SETTLED', 'REJECTED', 'CLOSED'].includes(c.status)).length,
      lossRatio: `${lossRatio}%`,
      avgProcessingDays,
    },
    statusBreakdown: statusSummary.map(s => ({
      status: s.status,
      count: s._count,
      invoiceValue: parseFloat(s._sum.invoiceAmount || 0),
      claimAmount: parseFloat(s._sum.claimAmount || 0),
      settledAmount: parseFloat(s._sum.settlementAmount || 0),
    })),
    policyOverview: {
      totalPolicies: policySummary._count,
      totalCoverage: parseFloat(policySummary._sum.coverageLimit || 0),
      usedCoverage: parseFloat(policySummary._sum.usedCoverage || 0),
      totalPremiums: totalPremiums,
    },
    generatedAt: new Date(),
  };
};

// =============================================================================
// RECONCILIATION REPORT
// =============================================================================

/**
 * Generate reconciliation status report
 */
exports.getReconciliationReport = async (businessId) => {
  const where = businessId ? { businessId } : {};

  const [
    batches,
    itemStats,
    recentBatches,
  ] = await Promise.all([
    prisma.reconciliationBatch.aggregate({
      where,
      _count: true,
    }),

    prisma.reconciliationItem.groupBy({
      by: ['status'],
      where: businessId ? { batch: { businessId } } : {},
      _sum: { transactionAmount: true },
      _count: true,
    }),

    prisma.reconciliationBatch.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: 10,
      select: {
        id: true,
        startDate: true,
        endDate: true,
        status: true,
        totalItems: true,
        matchedItems: true,
        unmatchedItems: true,
        matchRate: true,
        completedAt: true,
      },
    }),
  ]);

  // Calculate overall match rate
  const totalMatched = itemStats.find(s => s.status === 'MATCHED')?._count || 0;
  const totalUnmatched = itemStats.find(s => s.status === 'UNMATCHED')?._count || 0;
  const totalItems = totalMatched + totalUnmatched;
  const overallMatchRate = totalItems > 0
    ? Math.round((totalMatched / totalItems) * 100)
    : 0;

  return {
    summary: {
      totalBatches: batches._count,
      overallMatchRate: `${overallMatchRate}%`,
      totalItemsProcessed: totalItems,
      totalMatched,
      totalUnmatched,
    },
    itemBreakdown: itemStats.map(s => ({
      status: s.status,
      count: s._count,
      totalAmount: parseFloat(s._sum.transactionAmount || 0),
    })),
    recentBatches,
    generatedAt: new Date(),
  };
};

// =============================================================================
// EXPORT FUNCTIONS
// =============================================================================

/**
 * Export report to Excel
 */
exports.exportToExcel = async (reportType, data, options = {}) => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Airavat B2B Marketplace';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(reportType);

  // Add headers based on report type
  switch (reportType) {
    case 'transactions':
      sheet.columns = [
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Type', key: 'type', width: 12 },
        { header: 'Amount', key: 'amount', width: 15 },
        { header: 'Currency', key: 'currency', width: 10 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Reference', key: 'reference', width: 20 },
        { header: 'Description', key: 'description', width: 30 },
      ];
      
      data.transactions?.forEach(txn => {
        sheet.addRow({
          date: txn.createdAt,
          type: txn.type,
          amount: parseFloat(txn.amount),
          currency: txn.currency,
          status: txn.status,
          reference: txn.referenceId,
          description: txn.description,
        });
      });
      break;

    case 'emi_collection':
      sheet.columns = [
        { header: 'Due Date', key: 'dueDate', width: 15 },
        { header: 'Customer', key: 'customer', width: 25 },
        { header: 'EMI Amount', key: 'amount', width: 15 },
        { header: 'Paid Amount', key: 'paidAmount', width: 15 },
        { header: 'Late Fee', key: 'lateFee', width: 12 },
        { header: 'Status', key: 'status', width: 12 },
        { header: 'Paid Date', key: 'paidDate', width: 15 },
      ];
      break;

    default:
      // Generic export
      if (Array.isArray(data)) {
        const headers = Object.keys(data[0] || {});
        sheet.columns = headers.map(h => ({ header: h, key: h, width: 15 }));
        data.forEach(row => sheet.addRow(row));
      }
  }

  // Style header row
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  return workbook;
};

/**
 * Export report to PDF
 */
exports.exportToPDF = async (reportType, data, options = {}) => {
  const doc = new PDFDocument({ margin: 50 });
  
  // Header
  doc.fontSize(20).text('Airavat B2B Marketplace', { align: 'center' });
  doc.fontSize(16).text(`${reportType} Report`, { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'right' });
  doc.moveDown(2);

  // Summary section
  if (data.summary) {
    doc.fontSize(14).text('Summary', { underline: true });
    doc.moveDown();
    doc.fontSize(10);
    Object.entries(data.summary).forEach(([key, value]) => {
      const formattedKey = key.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
      doc.text(`${formattedKey}: ${typeof value === 'number' ? value.toLocaleString() : value}`);
    });
    doc.moveDown(2);
  }

  return doc;
};

// =============================================================================
// TREND ANALYSIS
// =============================================================================

/**
 * Get trend analysis for key metrics
 */
exports.getTrendAnalysis = async (metric, period = 30, granularity = 'day') => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - period);

  let data = [];

  switch (metric) {
    case 'wallet_volume':
      data = await getWalletVolumeTrend(startDate, granularity);
      break;
    case 'emi_collection':
      data = await getEMICollectionTrend(startDate, granularity);
      break;
    case 'factoring_disbursement':
      data = await getFactoringTrend(startDate, granularity);
      break;
    case 'card_spending':
      data = await getCardSpendingTrend(startDate, granularity);
      break;
    default:
      throw new Error(`Unknown metric: ${metric}`);
  }

  // Calculate growth rate
  if (data.length >= 2) {
    const firstPeriod = data[0]?.value || 0;
    const lastPeriod = data[data.length - 1]?.value || 0;
    const growthRate = firstPeriod > 0
      ? Math.round(((lastPeriod - firstPeriod) / firstPeriod) * 100)
      : 0;

    return {
      metric,
      period,
      granularity,
      data,
      growthRate: `${growthRate}%`,
      average: Math.round(data.reduce((sum, d) => sum + d.value, 0) / data.length),
      max: Math.max(...data.map(d => d.value)),
      min: Math.min(...data.map(d => d.value)),
    };
  }

  return { metric, period, granularity, data };
};

// Helper functions for trend analysis
async function getWalletVolumeTrend(startDate, granularity) {
  // Implementation would use raw SQL for date grouping
  const transactions = await prisma.walletTransaction.findMany({
    where: {
      createdAt: { gte: startDate },
      status: 'COMPLETED',
    },
    select: {
      createdAt: true,
      amount: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return aggregateByDate(transactions, granularity);
}

async function getEMICollectionTrend(startDate, granularity) {
  const installments = await prisma.eMIInstallment.findMany({
    where: {
      paidDate: { gte: startDate },
      status: 'PAID',
    },
    select: {
      paidDate: true,
      paidAmount: true,
    },
    orderBy: { paidDate: 'asc' },
  });

  return aggregateByDate(
    installments.map(i => ({ createdAt: i.paidDate, amount: i.paidAmount })),
    granularity
  );
}

async function getFactoringTrend(startDate, granularity) {
  const applications = await prisma.factoringApplication.findMany({
    where: {
      disbursedAt: { gte: startDate },
      status: 'DISBURSED',
    },
    select: {
      disbursedAt: true,
      advanceAmount: true,
    },
    orderBy: { disbursedAt: 'asc' },
  });

  return aggregateByDate(
    applications.map(a => ({ createdAt: a.disbursedAt, amount: a.advanceAmount })),
    granularity
  );
}

async function getCardSpendingTrend(startDate, granularity) {
  const transactions = await prisma.cardTransaction.findMany({
    where: {
      createdAt: { gte: startDate },
      status: 'SETTLED',
    },
    select: {
      createdAt: true,
      amount: true,
    },
    orderBy: { createdAt: 'asc' },
  });

  return aggregateByDate(transactions, granularity);
}

function aggregateByDate(items, granularity) {
  const grouped = {};

  items.forEach(item => {
    const date = new Date(item.createdAt);
    let key;

    switch (granularity) {
      case 'hour':
        key = date.toISOString().slice(0, 13);
        break;
      case 'day':
        key = date.toISOString().slice(0, 10);
        break;
      case 'week':
        const weekStart = new Date(date);
        weekStart.setDate(date.getDate() - date.getDay());
        key = weekStart.toISOString().slice(0, 10);
        break;
      case 'month':
        key = date.toISOString().slice(0, 7);
        break;
      default:
        key = date.toISOString().slice(0, 10);
    }

    if (!grouped[key]) {
      grouped[key] = { date: key, value: 0, count: 0 };
    }
    grouped[key].value += parseFloat(item.amount || 0);
    grouped[key].count++;
  });

  return Object.values(grouped).sort((a, b) => a.date.localeCompare(b.date));
}

module.exports = exports;
