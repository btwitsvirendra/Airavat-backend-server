// =============================================================================
// AIRAVAT B2B MARKETPLACE - ADMIN FINANCIAL ROUTES
// Admin API routes for financial services management
// =============================================================================

const express = require('express');
const router = express.Router();
const adminFinancialController = require('../controllers/adminFinancial.controller');
const { protect, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { body, param, query } = require('express-validator');

// Middleware: All routes require admin access
router.use(protect);
router.use(authorize('ADMIN', 'SUPER_ADMIN'));

// =============================================================================
// DASHBOARD
// =============================================================================

router.get('/dashboard', adminFinancialController.getFinancialDashboard);

// =============================================================================
// WALLET ADMIN ROUTES
// =============================================================================

router.get('/wallets', adminFinancialController.getAllWallets);

router.get('/wallets/stats', adminFinancialController.getWalletStats);

router.post(
  '/wallets/:walletId/suspend',
  [
    param('walletId').isString(),
    body('reason').isString().notEmpty(),
  ],
  validate,
  adminFinancialController.suspendWallet
);

router.post(
  '/wallets/:walletId/activate',
  [param('walletId').isString()],
  validate,
  adminFinancialController.activateWallet
);

router.patch(
  '/wallets/:walletId/limits',
  [
    param('walletId').isString(),
    body('dailyLimit').optional().isFloat({ min: 0 }),
    body('monthlyLimit').optional().isFloat({ min: 0 }),
  ],
  validate,
  adminFinancialController.updateWalletLimits
);

// =============================================================================
// EMI ADMIN ROUTES
// =============================================================================

router.get('/emi/orders', adminFinancialController.getAllEMIOrders);

router.post(
  '/emi/orders/:emiOrderId/approve',
  [param('emiOrderId').isString()],
  validate,
  adminFinancialController.approveEMIOrder
);

router.post(
  '/emi/orders/:emiOrderId/reject',
  [
    param('emiOrderId').isString(),
    body('reason').isString().notEmpty(),
  ],
  validate,
  adminFinancialController.rejectEMIOrder
);

router.post(
  '/emi/installments/:installmentId/waive-fee',
  [
    param('installmentId').isString(),
    body('reason').isString().notEmpty(),
  ],
  validate,
  adminFinancialController.waiveLateFee
);

router.get(
  '/emi/reports/collection',
  [
    query('startDate').isISO8601(),
    query('endDate').isISO8601(),
  ],
  validate,
  adminFinancialController.getEMICollectionReport
);

router.post(
  '/emi/plans',
  [
    body('name').isString().notEmpty(),
    body('tenureMonths').isInt({ min: 3, max: 60 }),
    body('interestRate').isFloat({ min: 0, max: 50 }),
    body('processingFee').optional().isFloat({ min: 0, max: 10 }),
    body('minAmount').optional().isFloat({ min: 0 }),
    body('maxAmount').optional().isFloat({ min: 0 }),
  ],
  validate,
  adminFinancialController.createEMIPlan
);

// =============================================================================
// INVOICE FACTORING ADMIN ROUTES
// =============================================================================

router.get('/factoring/applications', adminFinancialController.getAllFactoringApplications);

router.post(
  '/factoring/applications/:applicationId/approve',
  [param('applicationId').isString()],
  validate,
  adminFinancialController.approveFactoringApplication
);

router.post(
  '/factoring/applications/:applicationId/reject',
  [
    param('applicationId').isString(),
    body('reason').isString().notEmpty(),
  ],
  validate,
  adminFinancialController.rejectFactoringApplication
);

router.post(
  '/factoring/applications/:applicationId/disburse',
  [
    param('applicationId').isString(),
    body('disbursementRef').isString(),
  ],
  validate,
  adminFinancialController.disburseFactoring
);

router.post(
  '/factoring/applications/:applicationId/settle',
  [
    param('applicationId').isString(),
    body('settlementAmount').isFloat({ min: 0 }),
    body('settlementRef').isString(),
  ],
  validate,
  adminFinancialController.recordFactoringSettlement
);

router.get(
  '/factoring/reports',
  [
    query('startDate').isISO8601(),
    query('endDate').isISO8601(),
  ],
  validate,
  adminFinancialController.getFactoringReport
);

// =============================================================================
// TRADE FINANCE (LC) ADMIN ROUTES
// =============================================================================

router.post(
  '/trade-finance/lc/:lcId/issue',
  [param('lcId').isString()],
  validate,
  adminFinancialController.issueLC
);

router.post(
  '/trade-finance/lc/:lcId/advise',
  [param('lcId').isString()],
  validate,
  adminFinancialController.adviseLC
);

router.post(
  '/trade-finance/lc/:lcId/confirm',
  [
    param('lcId').isString(),
    body('confirmingBank').isString(),
  ],
  validate,
  adminFinancialController.confirmLC
);

router.post(
  '/trade-finance/amendments/:amendmentId/approve',
  [param('amendmentId').isString()],
  validate,
  adminFinancialController.approveLCAmendment
);

router.post(
  '/trade-finance/presentations/:presentationId/examine',
  [
    param('presentationId').isString(),
    body('examinationResult').isIn(['COMPLIANT', 'DISCREPANT']),
    body('discrepancies').optional().isArray(),
  ],
  validate,
  adminFinancialController.examineLCDocuments
);

router.post(
  '/trade-finance/lc/:lcId/payment',
  [
    param('lcId').isString(),
    body('amount').isFloat({ min: 0 }),
    body('paymentRef').isString(),
  ],
  validate,
  adminFinancialController.processLCPayment
);

// =============================================================================
// CASHBACK ADMIN ROUTES
// =============================================================================

router.get('/cashback/programs', adminFinancialController.getAllCashbackPrograms);

router.post(
  '/cashback/programs',
  [
    body('name').isString().notEmpty(),
    body('type').isIn(['PERCENTAGE', 'FIXED', 'TIERED']),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
  ],
  validate,
  adminFinancialController.createCashbackProgram
);

router.patch(
  '/cashback/programs/:programId',
  [param('programId').isString()],
  validate,
  adminFinancialController.updateCashbackProgram
);

router.delete(
  '/cashback/programs/:programId',
  [param('programId').isString()],
  validate,
  adminFinancialController.deactivateCashbackProgram
);

router.post(
  '/cashback/rewards/:rewardId/approve',
  [param('rewardId').isString()],
  validate,
  adminFinancialController.approveCashbackReward
);

router.post(
  '/cashback/rewards/:rewardId/cancel',
  [
    param('rewardId').isString(),
    body('reason').isString().notEmpty(),
  ],
  validate,
  adminFinancialController.cancelCashbackReward
);

// =============================================================================
// VIRTUAL CARD ADMIN ROUTES
// =============================================================================

router.get('/virtual-cards', adminFinancialController.getAllVirtualCards);

router.patch(
  '/virtual-cards/:cardId/limit',
  [
    param('cardId').isString(),
    body('newLimit').isFloat({ min: 0 }),
  ],
  validate,
  adminFinancialController.updateCardLimit
);

router.get('/virtual-cards/reports', adminFinancialController.getCardTransactionReport);

// =============================================================================
// CREDIT INSURANCE ADMIN ROUTES
// =============================================================================

router.get('/insurance/overview', adminFinancialController.getInsuranceOverview);

router.post(
  '/insurance/claims/:claimId/review',
  [param('claimId').isString()],
  validate,
  adminFinancialController.reviewInsuranceClaim
);

router.post(
  '/insurance/claims/:claimId/approve',
  [param('claimId').isString()],
  validate,
  adminFinancialController.approveInsuranceClaim
);

router.post(
  '/insurance/claims/:claimId/reject',
  [
    param('claimId').isString(),
    body('reason').isString().notEmpty(),
  ],
  validate,
  adminFinancialController.rejectInsuranceClaim
);

router.post(
  '/insurance/claims/:claimId/settle',
  [
    param('claimId').isString(),
    body('settlementAmount').isFloat({ min: 0 }),
    body('settlementRef').isString(),
  ],
  validate,
  adminFinancialController.settleInsuranceClaim
);

// =============================================================================
// SCHEDULED JOBS ADMIN
// =============================================================================

router.get('/jobs', adminFinancialController.getFinancialJobStatus);

router.post(
  '/jobs/:jobName/run',
  [
    param('jobName').isString().isIn([
      'markOverdueInstallments',
      'processPendingCashback',
      'expireCashbackRewards',
      'expireVirtualCards',
      'resetCardLimits',
      'syncBankTransactions',
      'cleanOldBankTransactions',
      'expireInsurancePolicies',
      'autoReconciliation',
    ]),
  ],
  validate,
  adminFinancialController.runFinancialJob
);

module.exports = router;
