// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL REPORTS CONTROLLER
// Controller for financial analytics and reporting endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const financialReportsService = require('../services/financialReports.service');
const financialAuditService = require('../services/financialAudit.service');
const { prisma } = require('../config/database');
const logger = require('../config/logger');

// =============================================================================
// DASHBOARD ENDPOINTS
// =============================================================================

/**
 * @desc    Get financial dashboard overview
 * @route   GET /api/v1/reports/financial/dashboard
 * @access  Private (Admin, Business Owner)
 */
exports.getDashboard = asyncHandler(async (req, res) => {
  const { period = 30 } = req.query;
  const businessId = req.user.role === 'ADMIN' ? null : req.user.businessId;

  const dashboard = await financialReportsService.getDashboardOverview(
    businessId,
    parseInt(period)
  );

  res.status(200).json({
    success: true,
    data: dashboard,
  });
});

/**
 * @desc    Get real-time financial metrics
 * @route   GET /api/v1/reports/financial/realtime
 * @access  Private (Admin)
 */
exports.getRealtimeMetrics = asyncHandler(async (req, res) => {
  const now = new Date();
  const hourAgo = new Date(now - 60 * 60 * 1000);
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const [hourlyTransactions, dailyTransactions, activeWallets, pendingWithdrawals] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: { createdAt: { gte: hourAgo }, status: 'COMPLETED' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.walletTransaction.aggregate({
      where: { createdAt: { gte: dayAgo }, status: 'COMPLETED' },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.wallet.count({ where: { status: 'ACTIVE' } }),
    prisma.walletTransaction.count({
      where: { type: 'WITHDRAWAL', status: 'PENDING' },
    }),
  ]);

  res.status(200).json({
    success: true,
    data: {
      hourly: {
        transactions: hourlyTransactions._count,
        volume: parseFloat(hourlyTransactions._sum.amount || 0),
      },
      daily: {
        transactions: dailyTransactions._count,
        volume: parseFloat(dailyTransactions._sum.amount || 0),
      },
      activeWallets,
      pendingWithdrawals,
      timestamp: now,
    },
  });
});

// =============================================================================
// TRANSACTION REPORTS
// =============================================================================

/**
 * @desc    Get transaction report
 * @route   GET /api/v1/reports/financial/transactions
 * @access  Private
 */
exports.getTransactionReport = asyncHandler(async (req, res) => {
  const {
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
  } = req.query;

  const businessId = req.user.role === 'ADMIN' ? req.query.businessId : req.user.businessId;

  const report = await financialReportsService.getTransactionReport({
    businessId,
    walletId,
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    type,
    status,
    minAmount,
    maxAmount,
    page: parseInt(page),
    limit: parseInt(limit),
    groupBy,
  });

  res.status(200).json({
    success: true,
    data: report,
  });
});

/**
 * @desc    Get transaction volume by time period
 * @route   GET /api/v1/reports/financial/transactions/volume
 * @access  Private
 */
exports.getTransactionVolume = asyncHandler(async (req, res) => {
  const { period = 30, granularity = 'day' } = req.query;
  const businessId = req.user.role === 'ADMIN' ? req.query.businessId : req.user.businessId;

  const trend = await financialReportsService.getTrendAnalysis(
    'wallet_volume',
    parseInt(period),
    granularity
  );

  res.status(200).json({
    success: true,
    data: trend,
  });
});

// =============================================================================
// EMI REPORTS
// =============================================================================

/**
 * @desc    Get EMI collection report
 * @route   GET /api/v1/reports/financial/emi/collection
 * @access  Private (Admin)
 */
exports.getEMICollectionReport = asyncHandler(async (req, res) => {
  const { startDate, endDate, status } = req.query;
  const businessId = req.user.role === 'ADMIN' ? req.query.businessId : req.user.businessId;

  const report = await financialReportsService.getEMICollectionReport({
    startDate: startDate ? new Date(startDate) : undefined,
    endDate: endDate ? new Date(endDate) : undefined,
    status,
    businessId,
  });

  res.status(200).json({
    success: true,
    data: report,
  });
});

/**
 * @desc    Get EMI aging report
 * @route   GET /api/v1/reports/financial/emi/aging
 * @access  Private (Admin)
 */
exports.getEMIAgingReport = asyncHandler(async (req, res) => {
  const { businessId: queryBusinessId } = req.query;
  const businessId = req.user.role === 'ADMIN' ? queryBusinessId : req.user.businessId;

  const where = { status: { in: ['PENDING', 'OVERDUE'] } };
  if (businessId) {
    where.emiOrder = { user: { businessId } };
  }

  const installments = await prisma.eMIInstallment.findMany({
    where,
    include: {
      emiOrder: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
    orderBy: { dueDate: 'asc' },
  });

  const today = new Date();
  const agingBuckets = {
    current: [],
    '1-30': [],
    '31-60': [],
    '61-90': [],
    '90+': [],
  };

  installments.forEach(inst => {
    const daysOverdue = Math.floor((today - inst.dueDate) / (1000 * 60 * 60 * 24));
    const item = {
      id: inst.id,
      amount: inst.amount,
      dueDate: inst.dueDate,
      daysOverdue: Math.max(0, daysOverdue),
      user: inst.emiOrder.user,
      emiOrderId: inst.emiOrderId,
    };

    if (daysOverdue <= 0) {
      agingBuckets.current.push(item);
    } else if (daysOverdue <= 30) {
      agingBuckets['1-30'].push(item);
    } else if (daysOverdue <= 60) {
      agingBuckets['31-60'].push(item);
    } else if (daysOverdue <= 90) {
      agingBuckets['61-90'].push(item);
    } else {
      agingBuckets['90+'].push(item);
    }
  });

  const summary = Object.entries(agingBuckets).reduce((acc, [bucket, items]) => {
    acc[bucket] = {
      count: items.length,
      totalAmount: items.reduce((sum, i) => sum + parseFloat(i.amount), 0),
    };
    return acc;
  }, {});

  res.status(200).json({
    success: true,
    data: {
      summary,
      details: agingBuckets,
      generatedAt: new Date(),
    },
  });
});

// =============================================================================
// FACTORING REPORTS
// =============================================================================

/**
 * @desc    Get factoring portfolio report
 * @route   GET /api/v1/reports/financial/factoring/portfolio
 * @access  Private
 */
exports.getFactoringPortfolioReport = asyncHandler(async (req, res) => {
  const { status, startDate, endDate } = req.query;
  const businessId = req.user.role === 'ADMIN' ? req.query.businessId : req.user.businessId;

  const report = await financialReportsService.getFactoringPortfolioReport({
    businessId,
    status,
    startDate,
    endDate,
  });

  res.status(200).json({
    success: true,
    data: report,
  });
});

// =============================================================================
// TRADE FINANCE REPORTS
// =============================================================================

/**
 * @desc    Get trade finance (LC) report
 * @route   GET /api/v1/reports/financial/trade-finance
 * @access  Private
 */
exports.getTradeFinanceReport = asyncHandler(async (req, res) => {
  const { status, type, startDate, endDate } = req.query;
  const businessId = req.user.role === 'ADMIN' ? req.query.businessId : req.user.businessId;

  const report = await financialReportsService.getTradeFinanceReport({
    businessId,
    status,
    type,
    startDate,
    endDate,
  });

  res.status(200).json({
    success: true,
    data: report,
  });
});

// =============================================================================
// INSURANCE REPORTS
// =============================================================================

/**
 * @desc    Get insurance claims report
 * @route   GET /api/v1/reports/financial/insurance/claims
 * @access  Private
 */
exports.getInsuranceClaimsReport = asyncHandler(async (req, res) => {
  const { status, startDate, endDate } = req.query;
  const businessId = req.user.role === 'ADMIN' ? req.query.businessId : req.user.businessId;

  const report = await financialReportsService.getInsuranceClaimsReport({
    businessId,
    status,
    startDate,
    endDate,
  });

  res.status(200).json({
    success: true,
    data: report,
  });
});

// =============================================================================
// RECONCILIATION REPORTS
// =============================================================================

/**
 * @desc    Get reconciliation report
 * @route   GET /api/v1/reports/financial/reconciliation
 * @access  Private
 */
exports.getReconciliationReport = asyncHandler(async (req, res) => {
  const businessId = req.user.role === 'ADMIN' ? req.query.businessId : req.user.businessId;

  const report = await financialReportsService.getReconciliationReport(businessId);

  res.status(200).json({
    success: true,
    data: report,
  });
});

// =============================================================================
// TREND ANALYSIS
// =============================================================================

/**
 * @desc    Get trend analysis for specific metric
 * @route   GET /api/v1/reports/financial/trends/:metric
 * @access  Private
 */
exports.getTrendAnalysis = asyncHandler(async (req, res) => {
  const { metric } = req.params;
  const { period = 30, granularity = 'day' } = req.query;

  const validMetrics = ['wallet_volume', 'emi_collection', 'factoring_disbursement', 'card_spending'];
  if (!validMetrics.includes(metric)) {
    return res.status(400).json({
      success: false,
      error: `Invalid metric. Valid options: ${validMetrics.join(', ')}`,
    });
  }

  const trend = await financialReportsService.getTrendAnalysis(
    metric,
    parseInt(period),
    granularity
  );

  res.status(200).json({
    success: true,
    data: trend,
  });
});

// =============================================================================
// AUDIT REPORTS
// =============================================================================

/**
 * @desc    Get audit logs
 * @route   GET /api/v1/reports/financial/audit
 * @access  Private (Admin)
 */
exports.getAuditLogs = asyncHandler(async (req, res) => {
  const {
    category,
    action,
    entityType,
    entityId,
    userId,
    severity,
    startDate,
    endDate,
    page = 1,
    limit = 50,
  } = req.query;

  const businessId = req.user.role === 'ADMIN' ? req.query.businessId : req.user.businessId;

  const result = await financialAuditService.getAuditLogs(
    {
      category,
      action,
      entityType,
      entityId,
      userId,
      businessId,
      severity,
      startDate,
      endDate,
    },
    { page: parseInt(page), limit: parseInt(limit) }
  );

  res.status(200).json({
    success: true,
    data: result.logs,
    pagination: result.pagination,
  });
});

/**
 * @desc    Get audit trail for entity
 * @route   GET /api/v1/reports/financial/audit/entity/:entityType/:entityId
 * @access  Private (Admin)
 */
exports.getEntityAuditTrail = asyncHandler(async (req, res) => {
  const { entityType, entityId } = req.params;

  const trail = await financialAuditService.getEntityAuditTrail(entityType, entityId);

  res.status(200).json({
    success: true,
    data: trail,
  });
});

/**
 * @desc    Get audit statistics
 * @route   GET /api/v1/reports/financial/audit/stats
 * @access  Private (Admin)
 */
exports.getAuditStats = asyncHandler(async (req, res) => {
  const { period = 30 } = req.query;

  const stats = await financialAuditService.getAuditStats(parseInt(period));

  res.status(200).json({
    success: true,
    data: stats,
  });
});

/**
 * @desc    Verify audit log integrity
 * @route   POST /api/v1/reports/financial/audit/verify
 * @access  Private (Super Admin)
 */
exports.verifyAuditIntegrity = asyncHandler(async (req, res) => {
  const { auditLogId, startDate, endDate } = req.body;

  let result;

  if (auditLogId) {
    result = await financialAuditService.verifyIntegrity(auditLogId);
  } else if (startDate && endDate) {
    result = await financialAuditService.verifyBulkIntegrity(startDate, endDate);
  } else {
    return res.status(400).json({
      success: false,
      error: 'Provide either auditLogId or startDate/endDate range',
    });
  }

  res.status(200).json({
    success: true,
    data: result,
  });
});

// =============================================================================
// EXPORT ENDPOINTS
// =============================================================================

/**
 * @desc    Export report to Excel
 * @route   POST /api/v1/reports/financial/export/excel
 * @access  Private
 */
exports.exportToExcel = asyncHandler(async (req, res) => {
  const { reportType, filters = {} } = req.body;
  const businessId = req.user.role === 'ADMIN' ? req.body.businessId : req.user.businessId;

  // Get report data based on type
  let data;
  switch (reportType) {
    case 'transactions':
      data = await financialReportsService.getTransactionReport({ businessId, ...filters });
      break;
    case 'emi_collection':
      data = await financialReportsService.getEMICollectionReport({ businessId, ...filters });
      break;
    case 'factoring':
      data = await financialReportsService.getFactoringPortfolioReport({ businessId, ...filters });
      break;
    case 'trade_finance':
      data = await financialReportsService.getTradeFinanceReport({ businessId, ...filters });
      break;
    case 'insurance':
      data = await financialReportsService.getInsuranceClaimsReport({ businessId, ...filters });
      break;
    default:
      return res.status(400).json({
        success: false,
        error: 'Invalid report type',
      });
  }

  const workbook = await financialReportsService.exportToExcel(reportType, data);

  res.setHeader(
    'Content-Type',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
  );
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=${reportType}_report_${Date.now()}.xlsx`
  );

  await workbook.xlsx.write(res);
  res.end();
});

/**
 * @desc    Export report to PDF
 * @route   POST /api/v1/reports/financial/export/pdf
 * @access  Private
 */
exports.exportToPDF = asyncHandler(async (req, res) => {
  const { reportType, filters = {} } = req.body;
  const businessId = req.user.role === 'ADMIN' ? req.body.businessId : req.user.businessId;

  // Get report data based on type
  let data;
  switch (reportType) {
    case 'dashboard':
      data = await financialReportsService.getDashboardOverview(businessId, filters.period || 30);
      break;
    case 'transactions':
      data = await financialReportsService.getTransactionReport({ businessId, ...filters });
      break;
    default:
      return res.status(400).json({
        success: false,
        error: 'Invalid report type',
      });
  }

  const doc = await financialReportsService.exportToPDF(reportType, data);

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename=${reportType}_report_${Date.now()}.pdf`
  );

  doc.pipe(res);
  doc.end();
});

// =============================================================================
// COMPARATIVE ANALYSIS
// =============================================================================

/**
 * @desc    Get period comparison
 * @route   GET /api/v1/reports/financial/compare
 * @access  Private
 */
exports.getPeriodComparison = asyncHandler(async (req, res) => {
  const { metric, currentStart, currentEnd, previousStart, previousEnd } = req.query;
  const businessId = req.user.role === 'ADMIN' ? req.query.businessId : req.user.businessId;

  const where = businessId ? { wallet: { businessId } } : {};

  const [currentPeriod, previousPeriod] = await Promise.all([
    prisma.walletTransaction.aggregate({
      where: {
        ...where,
        createdAt: {
          gte: new Date(currentStart),
          lte: new Date(currentEnd),
        },
        status: 'COMPLETED',
      },
      _sum: { amount: true },
      _count: true,
    }),
    prisma.walletTransaction.aggregate({
      where: {
        ...where,
        createdAt: {
          gte: new Date(previousStart),
          lte: new Date(previousEnd),
        },
        status: 'COMPLETED',
      },
      _sum: { amount: true },
      _count: true,
    }),
  ]);

  const currentVolume = parseFloat(currentPeriod._sum.amount || 0);
  const previousVolume = parseFloat(previousPeriod._sum.amount || 0);
  const volumeChange = previousVolume > 0
    ? Math.round(((currentVolume - previousVolume) / previousVolume) * 100)
    : 0;

  const currentCount = currentPeriod._count;
  const previousCount = previousPeriod._count;
  const countChange = previousCount > 0
    ? Math.round(((currentCount - previousCount) / previousCount) * 100)
    : 0;

  res.status(200).json({
    success: true,
    data: {
      currentPeriod: {
        start: currentStart,
        end: currentEnd,
        volume: currentVolume,
        transactions: currentCount,
      },
      previousPeriod: {
        start: previousStart,
        end: previousEnd,
        volume: previousVolume,
        transactions: previousCount,
      },
      change: {
        volume: volumeChange,
        transactions: countChange,
      },
    },
  });
});

// =============================================================================
// SCHEDULED REPORT MANAGEMENT
// =============================================================================

/**
 * @desc    Create scheduled report
 * @route   POST /api/v1/reports/financial/scheduled
 * @access  Private
 */
exports.createScheduledReport = asyncHandler(async (req, res) => {
  const {
    name,
    reportType,
    schedule, // DAILY, WEEKLY, MONTHLY
    filters,
    recipients, // email addresses
    format, // EXCEL, PDF
  } = req.body;

  const scheduledReport = await prisma.scheduledReport.create({
    data: {
      name,
      reportType,
      schedule,
      filters: filters || {},
      recipients,
      format: format || 'EXCEL',
      userId: req.user.id,
      businessId: req.user.businessId,
      isActive: true,
      nextRunAt: calculateNextRunDate(schedule),
    },
  });

  res.status(201).json({
    success: true,
    data: scheduledReport,
  });
});

/**
 * @desc    Get scheduled reports
 * @route   GET /api/v1/reports/financial/scheduled
 * @access  Private
 */
exports.getScheduledReports = asyncHandler(async (req, res) => {
  const reports = await prisma.scheduledReport.findMany({
    where: {
      userId: req.user.id,
    },
    orderBy: { createdAt: 'desc' },
  });

  res.status(200).json({
    success: true,
    data: reports,
  });
});

/**
 * @desc    Delete scheduled report
 * @route   DELETE /api/v1/reports/financial/scheduled/:id
 * @access  Private
 */
exports.deleteScheduledReport = asyncHandler(async (req, res) => {
  const report = await prisma.scheduledReport.findUnique({
    where: { id: req.params.id },
  });

  if (!report) {
    return res.status(404).json({
      success: false,
      error: 'Scheduled report not found',
    });
  }

  if (report.userId !== req.user.id && req.user.role !== 'ADMIN') {
    return res.status(403).json({
      success: false,
      error: 'Not authorized to delete this report',
    });
  }

  await prisma.scheduledReport.delete({
    where: { id: req.params.id },
  });

  res.status(200).json({
    success: true,
    message: 'Scheduled report deleted',
  });
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function calculateNextRunDate(schedule) {
  const now = new Date();
  switch (schedule) {
    case 'DAILY':
      now.setDate(now.getDate() + 1);
      now.setHours(6, 0, 0, 0); // 6 AM
      break;
    case 'WEEKLY':
      now.setDate(now.getDate() + (7 - now.getDay())); // Next Sunday
      now.setHours(6, 0, 0, 0);
      break;
    case 'MONTHLY':
      now.setMonth(now.getMonth() + 1);
      now.setDate(1);
      now.setHours(6, 0, 0, 0);
      break;
    default:
      now.setDate(now.getDate() + 1);
  }
  return now;
}

module.exports = exports;
