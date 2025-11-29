// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL ADMIN ROUTES
// Admin routes for managing financial services
// =============================================================================

const express = require('express');
const router = express.Router();
const financialAdminController = require('../controllers/financialAdmin.controller');
const { protect, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { body, param, query } = require('express-validator');

// All admin routes require authentication and admin role
router.use(protect);
router.use(authorize('ADMIN', 'SUPER_ADMIN'));

// =============================================================================
// FINANCIAL DASHBOARD
// =============================================================================

router.get('/overview', financialAdminController.getFinancialOverview);

router.get(
  '/transactions-report',
  [
    query('startDate').isISO8601(),
    query('endDate').isISO8601(),
  ],
  validate,
  financialAdminController.getFinancialTransactionsReport
);

// =============================================================================
// WALLET ADMIN ROUTES
// =============================================================================

router.get('/wallets', financialAdminController.getAllWallets);

router.get('/wallets/stats', financialAdminController.getWalletStats);

router.patch(
  '/wallets/:walletId/limits',
  [
    param('walletId').isString(),
    body('dailyLimit').optional().isFloat({ min: 0 }),
    body('monthlyLimit').optional().isFloat({ min: 0 }),
  ],
  validate,
  financialAdminController.updateWalletLimits
);

router.post(
  '/wallets/:walletId/suspend',
  [
    param('walletId').isString(),
    body('reason').isString(),
  ],
  validate,
  financialAdminController.suspendWallet
);

router.post(
  '/wallets/:walletId/activate',
  [param('walletId').isString()],
  validate,
  financialAdminController.activateWallet
);

// =============================================================================
// EMI ADMIN ROUTES
// =============================================================================

router.get('/emi/orders', financialAdminController.getAllEMIOrders);

router.get(
  '/emi/collection-report',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  financialAdminController.getEMICollectionReport
);

router.get('/emi/overdue', financialAdminController.getAllOverdueInstallments);

router.post(
  '/emi/orders/:emiOrderId/approve',
  [param('emiOrderId').isString()],
  validate,
  financialAdminController.approveEMIOrder
);

router.post(
  '/emi/orders/:emiOrderId/reject',
  [
    param('emiOrderId').isString(),
    body('reason').isString(),
  ],
  validate,
  financialAdminController.rejectEMIOrder
);

router.post(
  '/emi/installments/:installmentId/waive-fee',
  [
    param('installmentId').isString(),
    body('reason').isString(),
  ],
  validate,
  financialAdminController.waiveLateFee
);

// =============================================================================
// INVOICE FACTORING ADMIN ROUTES
// =============================================================================

router.get('/factoring/applications', financialAdminController.getAllFactoringApplications);

router.get(
  '/factoring/report',
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  financialAdminController.getFactoringReport
);

router.post(
  '/factoring/applications/:applicationId/approve',
  [
    param('applicationId').isString(),
    body('notes').optional().isString(),
  ],
  validate,
  financialAdminController.approveFactoringApplication
);

router.post(
  '/factoring/applications/:applicationId/reject',
  [
    param('applicationId').isString(),
    body('reason').isString(),
  ],
  validate,
  financialAdminController.rejectFactoringApplication
);

router.post(
  '/factoring/applications/:applicationId/disburse',
  [
    param('applicationId').isString(),
    body('disbursementRef').isString(),
    body('bankAccountId').optional().isString(),
  ],
  validate,
  financialAdminController.disburseFactoring
);

router.post(
  '/factoring/applications/:applicationId/settle',
  [
    param('applicationId').isString(),
    body('settlementAmount').isFloat({ min: 0 }),
    body('settlementRef').isString(),
  ],
  validate,
  financialAdminController.recordFactoringSettlement
);

// =============================================================================
// TRADE FINANCE (LC) ADMIN ROUTES
// =============================================================================

router.get('/trade-finance/lcs', financialAdminController.getAllLCs);

router.post(
  '/trade-finance/lc/:lcId/issue',
  [param('lcId').isString()],
  validate,
  financialAdminController.issueLC
);

router.post(
  '/trade-finance/lc/:lcId/advise',
  [param('lcId').isString()],
  validate,
  financialAdminController.adviseLC
);

router.post(
  '/trade-finance/lc/:lcId/confirm',
  [
    param('lcId').isString(),
    body('confirmingBank').isString(),
  ],
  validate,
  financialAdminController.confirmLC
);

router.post(
  '/trade-finance/amendments/:amendmentId/approve',
  [param('amendmentId').isString()],
  validate,
  financialAdminController.approveLCAmendment
);

router.post(
  '/trade-finance/presentations/:presentationId/examine',
  [
    param('presentationId').isString(),
    body('examinationResult').isIn(['COMPLIANT', 'DISCREPANT']),
  ],
  validate,
  financialAdminController.examineLCDocuments
);

router.post(
  '/trade-finance/lc/:lcId/payment',
  [
    param('lcId').isString(),
    body('paymentAmount').isFloat({ min: 0 }),
    body('paymentRef').isString(),
  ],
  validate,
  financialAdminController.processLCPayment
);

// =============================================================================
// CASHBACK ADMIN ROUTES
// =============================================================================

router.get('/cashback/programs', financialAdminController.getAllCashbackPrograms);

router.post(
  '/cashback/programs',
  [
    body('name').isString().isLength({ max: 200 }),
    body('type').isIn(['PERCENTAGE', 'FIXED', 'TIERED']),
    body('value').isFloat({ min: 0 }),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
  ],
  validate,
  financialAdminController.createCashbackProgram
);

router.patch(
  '/cashback/programs/:programId',
  [param('programId').isString()],
  validate,
  financialAdminController.updateCashbackProgram
);

router.delete(
  '/cashback/programs/:programId',
  [param('programId').isString()],
  validate,
  financialAdminController.deactivateCashbackProgram
);

router.post(
  '/cashback/rewards/:rewardId/credit',
  [param('rewardId').isString()],
  validate,
  financialAdminController.manuallyCreditCashback
);

router.post(
  '/cashback/rewards/:rewardId/cancel',
  [
    param('rewardId').isString(),
    body('reason').isString(),
  ],
  validate,
  financialAdminController.cancelCashbackReward
);

// =============================================================================
// CREDIT INSURANCE ADMIN ROUTES
// =============================================================================

router.get('/insurance/claims', financialAdminController.getAllInsuranceClaims);

router.post(
  '/insurance/claims/:claimId/review',
  [
    param('claimId').isString(),
    body('notes').optional().isString(),
  ],
  validate,
  financialAdminController.reviewInsuranceClaim
);

router.post(
  '/insurance/claims/:claimId/approve',
  [param('claimId').isString()],
  validate,
  financialAdminController.approveInsuranceClaim
);

router.post(
  '/insurance/claims/:claimId/reject',
  [
    param('claimId').isString(),
    body('reason').isString(),
  ],
  validate,
  financialAdminController.rejectInsuranceClaim
);

router.post(
  '/insurance/claims/:claimId/settle',
  [
    param('claimId').isString(),
    body('settlementAmount').isFloat({ min: 0 }),
    body('settlementRef').isString(),
  ],
  validate,
  financialAdminController.settleInsuranceClaim
);

router.patch(
  '/insurance/buyers/:insuredBuyerId/limit',
  [
    param('insuredBuyerId').isString(),
    body('newLimit').isFloat({ min: 0 }),
  ],
  validate,
  financialAdminController.updateBuyerCreditLimit
);

// =============================================================================
// RECONCILIATION ADMIN ROUTES
// =============================================================================

router.get('/reconciliation/dashboard', financialAdminController.getReconciliationDashboard);

module.exports = router;
