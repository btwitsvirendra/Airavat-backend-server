// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL REPORTS ROUTES
// Routes for financial analytics and reporting endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { query, body, param } = require('express-validator');

const financialReportsController = require('../controllers/financialReports.controller');
const { protect, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { financialReadLimiter } = require('../middleware/financialRateLimiter.middleware');

// All routes require authentication
router.use(protect);

// =============================================================================
// DASHBOARD ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/reports/financial/dashboard
 * @desc    Get financial dashboard overview
 */
router.get(
  '/dashboard',
  financialReadLimiter,
  [
    query('period')
      .optional()
      .isInt({ min: 1, max: 365 })
      .withMessage('Period must be between 1 and 365 days'),
  ],
  validate,
  financialReportsController.getDashboard
);

/**
 * @route   GET /api/v1/reports/financial/realtime
 * @desc    Get real-time financial metrics
 */
router.get(
  '/realtime',
  authorize('ADMIN', 'SUPER_ADMIN'),
  financialReadLimiter,
  financialReportsController.getRealtimeMetrics
);

// =============================================================================
// TRANSACTION REPORTS
// =============================================================================

/**
 * @route   GET /api/v1/reports/financial/transactions
 * @desc    Get transaction report
 */
router.get(
  '/transactions',
  financialReadLimiter,
  [
    query('walletId').optional().isString(),
    query('startDate').optional().isISO8601().withMessage('Invalid start date'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date'),
    query('type')
      .optional()
      .isIn(['CREDIT', 'DEBIT', 'TRANSFER_IN', 'TRANSFER_OUT', 'HOLD', 'RELEASE', 'WITHDRAWAL'])
      .withMessage('Invalid transaction type'),
    query('status')
      .optional()
      .isIn(['PENDING', 'COMPLETED', 'FAILED', 'REVERSED'])
      .withMessage('Invalid status'),
    query('minAmount').optional().isFloat({ min: 0 }).withMessage('Invalid minimum amount'),
    query('maxAmount').optional().isFloat({ min: 0 }).withMessage('Invalid maximum amount'),
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    query('groupBy')
      .optional()
      .isIn(['type', 'status', 'currency'])
      .withMessage('Invalid groupBy field'),
  ],
  validate,
  financialReportsController.getTransactionReport
);

/**
 * @route   GET /api/v1/reports/financial/transactions/volume
 * @desc    Get transaction volume trend
 */
router.get(
  '/transactions/volume',
  financialReadLimiter,
  [
    query('period').optional().isInt({ min: 1, max: 365 }),
    query('granularity')
      .optional()
      .isIn(['hour', 'day', 'week', 'month'])
      .withMessage('Invalid granularity'),
  ],
  validate,
  financialReportsController.getTransactionVolume
);

// =============================================================================
// EMI REPORTS
// =============================================================================

/**
 * @route   GET /api/v1/reports/financial/emi/collection
 * @desc    Get EMI collection report
 */
router.get(
  '/emi/collection',
  authorize('ADMIN', 'SUPER_ADMIN', 'BUSINESS_OWNER'),
  financialReadLimiter,
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('status')
      .optional()
      .isIn(['PENDING', 'PAID', 'OVERDUE', 'WAIVED'])
      .withMessage('Invalid status'),
  ],
  validate,
  financialReportsController.getEMICollectionReport
);

/**
 * @route   GET /api/v1/reports/financial/emi/aging
 * @desc    Get EMI aging report
 */
router.get(
  '/emi/aging',
  authorize('ADMIN', 'SUPER_ADMIN'),
  financialReadLimiter,
  financialReportsController.getEMIAgingReport
);

// =============================================================================
// FACTORING REPORTS
// =============================================================================

/**
 * @route   GET /api/v1/reports/financial/factoring/portfolio
 * @desc    Get factoring portfolio report
 */
router.get(
  '/factoring/portfolio',
  financialReadLimiter,
  [
    query('status')
      .optional()
      .isIn(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'DISBURSED', 'SETTLED', 'DEFAULTED'])
      .withMessage('Invalid status'),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  financialReportsController.getFactoringPortfolioReport
);

// =============================================================================
// TRADE FINANCE REPORTS
// =============================================================================

/**
 * @route   GET /api/v1/reports/financial/trade-finance
 * @desc    Get trade finance (LC) report
 */
router.get(
  '/trade-finance',
  financialReadLimiter,
  [
    query('status')
      .optional()
      .isIn(['DRAFT', 'SUBMITTED', 'ISSUED', 'ADVISED', 'CONFIRMED', 'EXPIRED', 'PAID', 'CANCELLED'])
      .withMessage('Invalid status'),
    query('type')
      .optional()
      .isIn(['IRREVOCABLE', 'CONFIRMED', 'STANDBY', 'REVOLVING', 'TRANSFERABLE', 'BACK_TO_BACK'])
      .withMessage('Invalid LC type'),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  financialReportsController.getTradeFinanceReport
);

// =============================================================================
// INSURANCE REPORTS
// =============================================================================

/**
 * @route   GET /api/v1/reports/financial/insurance/claims
 * @desc    Get insurance claims report
 */
router.get(
  '/insurance/claims',
  financialReadLimiter,
  [
    query('status')
      .optional()
      .isIn(['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'SETTLED', 'CLOSED'])
      .withMessage('Invalid status'),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  financialReportsController.getInsuranceClaimsReport
);

// =============================================================================
// RECONCILIATION REPORTS
// =============================================================================

/**
 * @route   GET /api/v1/reports/financial/reconciliation
 * @desc    Get reconciliation report
 */
router.get(
  '/reconciliation',
  financialReadLimiter,
  financialReportsController.getReconciliationReport
);

// =============================================================================
// TREND ANALYSIS
// =============================================================================

/**
 * @route   GET /api/v1/reports/financial/trends/:metric
 * @desc    Get trend analysis for specific metric
 */
router.get(
  '/trends/:metric',
  financialReadLimiter,
  [
    param('metric')
      .isIn(['wallet_volume', 'emi_collection', 'factoring_disbursement', 'card_spending'])
      .withMessage('Invalid metric'),
    query('period').optional().isInt({ min: 1, max: 365 }),
    query('granularity')
      .optional()
      .isIn(['hour', 'day', 'week', 'month'])
      .withMessage('Invalid granularity'),
  ],
  validate,
  financialReportsController.getTrendAnalysis
);

// =============================================================================
// AUDIT REPORTS
// =============================================================================

/**
 * @route   GET /api/v1/reports/financial/audit
 * @desc    Get audit logs
 */
router.get(
  '/audit',
  authorize('ADMIN', 'SUPER_ADMIN'),
  financialReadLimiter,
  [
    query('category').optional().isString(),
    query('action').optional().isString(),
    query('entityType').optional().isString(),
    query('entityId').optional().isString(),
    query('userId').optional().isString(),
    query('severity')
      .optional()
      .isIn(['INFO', 'WARNING', 'CRITICAL'])
      .withMessage('Invalid severity'),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  financialReportsController.getAuditLogs
);

/**
 * @route   GET /api/v1/reports/financial/audit/entity/:entityType/:entityId
 * @desc    Get audit trail for specific entity
 */
router.get(
  '/audit/entity/:entityType/:entityId',
  authorize('ADMIN', 'SUPER_ADMIN'),
  financialReadLimiter,
  [
    param('entityType').notEmpty().withMessage('Entity type is required'),
    param('entityId').notEmpty().withMessage('Entity ID is required'),
  ],
  validate,
  financialReportsController.getEntityAuditTrail
);

/**
 * @route   GET /api/v1/reports/financial/audit/stats
 * @desc    Get audit statistics
 */
router.get(
  '/audit/stats',
  authorize('ADMIN', 'SUPER_ADMIN'),
  financialReadLimiter,
  [query('period').optional().isInt({ min: 1, max: 365 })],
  validate,
  financialReportsController.getAuditStats
);

/**
 * @route   POST /api/v1/reports/financial/audit/verify
 * @desc    Verify audit log integrity
 */
router.post(
  '/audit/verify',
  authorize('SUPER_ADMIN'),
  [
    body('auditLogId').optional().isString(),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
  ],
  validate,
  financialReportsController.verifyAuditIntegrity
);

// =============================================================================
// EXPORT ROUTES
// =============================================================================

/**
 * @route   POST /api/v1/reports/financial/export/excel
 * @desc    Export report to Excel
 */
router.post(
  '/export/excel',
  [
    body('reportType')
      .isIn(['transactions', 'emi_collection', 'factoring', 'trade_finance', 'insurance'])
      .withMessage('Invalid report type'),
    body('filters').optional().isObject(),
    body('businessId').optional().isString(),
  ],
  validate,
  financialReportsController.exportToExcel
);

/**
 * @route   POST /api/v1/reports/financial/export/pdf
 * @desc    Export report to PDF
 */
router.post(
  '/export/pdf',
  [
    body('reportType')
      .isIn(['dashboard', 'transactions'])
      .withMessage('Invalid report type'),
    body('filters').optional().isObject(),
    body('businessId').optional().isString(),
  ],
  validate,
  financialReportsController.exportToPDF
);

// =============================================================================
// COMPARATIVE ANALYSIS
// =============================================================================

/**
 * @route   GET /api/v1/reports/financial/compare
 * @desc    Get period comparison
 */
router.get(
  '/compare',
  financialReadLimiter,
  [
    query('metric').optional().isString(),
    query('currentStart').isISO8601().withMessage('Current start date required'),
    query('currentEnd').isISO8601().withMessage('Current end date required'),
    query('previousStart').isISO8601().withMessage('Previous start date required'),
    query('previousEnd').isISO8601().withMessage('Previous end date required'),
  ],
  validate,
  financialReportsController.getPeriodComparison
);

// =============================================================================
// SCHEDULED REPORTS
// =============================================================================

/**
 * @route   POST /api/v1/reports/financial/scheduled
 * @desc    Create scheduled report
 */
router.post(
  '/scheduled',
  [
    body('name').notEmpty().withMessage('Report name is required'),
    body('reportType')
      .isIn(['transactions', 'emi_collection', 'factoring', 'trade_finance', 'insurance', 'dashboard'])
      .withMessage('Invalid report type'),
    body('schedule')
      .isIn(['DAILY', 'WEEKLY', 'MONTHLY'])
      .withMessage('Invalid schedule'),
    body('recipients')
      .isArray({ min: 1 })
      .withMessage('At least one recipient required'),
    body('recipients.*').isEmail().withMessage('Invalid email in recipients'),
    body('format')
      .optional()
      .isIn(['EXCEL', 'PDF'])
      .withMessage('Invalid format'),
    body('filters').optional().isObject(),
  ],
  validate,
  financialReportsController.createScheduledReport
);

/**
 * @route   GET /api/v1/reports/financial/scheduled
 * @desc    Get scheduled reports
 */
router.get('/scheduled', financialReportsController.getScheduledReports);

/**
 * @route   DELETE /api/v1/reports/financial/scheduled/:id
 * @desc    Delete scheduled report
 */
router.delete(
  '/scheduled/:id',
  [param('id').notEmpty().withMessage('Report ID is required')],
  validate,
  financialReportsController.deleteScheduledReport
);

module.exports = router;
