// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL SERVICES ROUTES
// API routes for all financial services
// =============================================================================

const express = require('express');
const router = express.Router();
const financialController = require('../controllers/financial.controller');
const { protect, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { body, param, query } = require('express-validator');

// =============================================================================
// WALLET ROUTES
// =============================================================================

router.post(
  '/wallets',
  protect,
  [
    body('currency').optional().isIn(['INR', 'AED', 'USD', 'EUR', 'GBP']),
    body('dailyLimit').optional().isFloat({ min: 0 }),
    body('monthlyLimit').optional().isFloat({ min: 0 }),
  ],
  validate,
  financialController.createWallet
);

router.get('/wallets', protect, financialController.getWallets);

router.get(
  '/wallets/:walletId/balance',
  protect,
  [param('walletId').isString()],
  validate,
  financialController.getWalletBalance
);

router.get(
  '/wallets/:walletId/summary',
  protect,
  [param('walletId').isString()],
  validate,
  financialController.getWalletSummary
);

router.post(
  '/wallets/:walletId/credit',
  protect,
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    param('walletId').isString(),
    body('amount').isFloat({ min: 0.01 }),
    body('description').optional().isString(),
  ],
  validate,
  financialController.creditWallet
);

router.post(
  '/wallets/:walletId/debit',
  protect,
  [
    param('walletId').isString(),
    body('amount').isFloat({ min: 0.01 }),
    body('description').optional().isString(),
  ],
  validate,
  financialController.debitWallet
);

router.post(
  '/wallets/transfer',
  protect,
  [
    body('fromWalletId').isString(),
    body('toWalletId').isString(),
    body('amount').isFloat({ min: 0.01 }),
    body('description').optional().isString(),
  ],
  validate,
  financialController.walletTransfer
);

router.get(
  '/wallets/:walletId/transactions',
  protect,
  [
    param('walletId').isString(),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('type').optional().isString(),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  financialController.getWalletTransactions
);

router.post(
  '/wallets/:walletId/pin',
  protect,
  [
    param('walletId').isString(),
    body('pin').isString().matches(/^\d{4,6}$/),
  ],
  validate,
  financialController.setWalletPin
);

router.post(
  '/wallets/:walletId/pin/verify',
  protect,
  [
    param('walletId').isString(),
    body('pin').isString(),
  ],
  validate,
  financialController.verifyWalletPin
);

router.post(
  '/wallets/:walletId/withdrawal',
  protect,
  [
    param('walletId').isString(),
    body('amount').isFloat({ min: 100 }),
    body('bankAccountId').isString(),
  ],
  validate,
  financialController.requestWithdrawal
);

// =============================================================================
// MULTI-CURRENCY WALLET ROUTES
// =============================================================================

router.get(
  '/wallets/:walletId/currencies',
  protect,
  financialController.getCurrencyBalances
);

router.post(
  '/wallets/:walletId/currencies',
  protect,
  [
    param('walletId').isString(),
    body('currency').isIn(['INR', 'AED', 'USD', 'EUR', 'GBP', 'SGD', 'JPY', 'CNY']),
  ],
  validate,
  financialController.addCurrency
);

router.post(
  '/wallets/:walletId/exchange/quote',
  protect,
  [
    param('walletId').isString(),
    body('fromCurrency').isString(),
    body('toCurrency').isString(),
    body('amount').isFloat({ min: 0.01 }),
  ],
  validate,
  financialController.getExchangeQuote
);

router.post(
  '/wallets/:walletId/exchange',
  protect,
  [
    param('walletId').isString(),
    body('fromCurrency').isString(),
    body('toCurrency').isString(),
    body('amount').isFloat({ min: 0.01 }),
    body('expectedRate').optional().isFloat({ min: 0 }),
  ],
  validate,
  financialController.executeExchange
);

router.get('/currencies', financialController.getSupportedCurrencies);

// =============================================================================
// EMI ROUTES
// =============================================================================

router.get(
  '/emi/plans',
  protect,
  [query('amount').isFloat({ min: 1000 })],
  validate,
  financialController.getEMIPlans
);

router.post(
  '/emi/calculate',
  protect,
  [
    body('principal').isFloat({ min: 0 }),
    body('tenureMonths').isInt({ min: 3, max: 60 }),
    body('interestRate').isFloat({ min: 0 }),
    body('processingFee').optional().isFloat({ min: 0 }),
  ],
  validate,
  financialController.calculateEMI
);

router.post(
  '/emi/orders',
  protect,
  [
    body('orderId').isString(),
    body('emiPlanId').isString(),
  ],
  validate,
  financialController.createEMIOrder
);

router.get('/emi/orders', protect, financialController.getUserEMIOrders);

router.get(
  '/emi/orders/:emiOrderId',
  protect,
  [param('emiOrderId').isString()],
  validate,
  financialController.getEMIOrder
);

router.get('/emi/installments/upcoming', protect, financialController.getUpcomingInstallments);

router.post(
  '/emi/installments/:installmentId/pay',
  protect,
  [
    param('installmentId').isString(),
    body('paymentId').isString(),
    body('amount').isFloat({ min: 0 }),
  ],
  validate,
  financialController.payInstallment
);

router.get(
  '/emi/orders/:emiOrderId/foreclosure',
  protect,
  financialController.getForeclosureAmount
);

router.post(
  '/emi/orders/:emiOrderId/foreclose',
  protect,
  [
    param('emiOrderId').isString(),
    body('paymentId').isString(),
  ],
  validate,
  financialController.foreclosureEMI
);

router.get('/emi/summary', protect, financialController.getEMISummary);

// =============================================================================
// INVOICE FACTORING ROUTES
// =============================================================================

router.post(
  '/factoring/eligibility',
  protect,
  [
    body('businessId').isString(),
    body('invoiceAmount').isFloat({ min: 0 }),
    body('invoiceDueDate').isISO8601(),
  ],
  validate,
  financialController.checkFactoringEligibility
);

router.post(
  '/factoring/applications',
  protect,
  [
    body('businessId').isString(),
    body('invoiceNumber').isString(),
    body('invoiceAmount').isFloat({ min: 0 }),
    body('invoiceDate').isISO8601(),
    body('invoiceDueDate').isISO8601(),
    body('buyerName').isString(),
  ],
  validate,
  financialController.submitFactoringApplication
);

router.get(
  '/factoring/applications/business/:businessId',
  protect,
  financialController.getFactoringApplications
);

router.get(
  '/factoring/applications/:applicationId',
  protect,
  financialController.getFactoringApplication
);

router.get(
  '/factoring/summary/:businessId',
  protect,
  financialController.getFactoringSummary
);

// =============================================================================
// TRADE FINANCE (LETTER OF CREDIT) ROUTES
// =============================================================================

router.post(
  '/trade-finance/lc',
  protect,
  [
    body('applicantId').isString(),
    body('beneficiaryId').isString(),
    body('amount').isFloat({ min: 0 }),
    body('currency').isString(),
    body('expiryDate').isISO8601(),
    body('goodsDescription').isString(),
  ],
  validate,
  financialController.createDraftLC
);

router.get(
  '/trade-finance/lc/:lcId',
  protect,
  financialController.getLC
);

router.post(
  '/trade-finance/lc/:lcId/submit',
  protect,
  financialController.submitLC
);

router.get(
  '/trade-finance/lc/business/:businessId',
  protect,
  financialController.getBusinessLCs
);

router.post(
  '/trade-finance/lc/:lcId/amendment',
  protect,
  [
    body('description').isString(),
    body('changes').isObject(),
  ],
  validate,
  financialController.requestLCAmendment
);

router.post(
  '/trade-finance/lc/:lcId/documents/present',
  protect,
  [body('documents').isArray()],
  validate,
  financialController.presentLCDocuments
);

router.post(
  '/trade-finance/lc/:lcId/documents',
  protect,
  [
    body('documentType').isString(),
    body('fileUrl').isURL(),
    body('fileName').isString(),
  ],
  validate,
  financialController.uploadLCDocument
);

router.get(
  '/trade-finance/summary/:businessId',
  protect,
  financialController.getLCSummary
);

// =============================================================================
// CASHBACK ROUTES
// =============================================================================

router.get('/cashback/programs', protect, financialController.getCashbackPrograms);

router.post(
  '/cashback/calculate',
  protect,
  [
    body('orderAmount').isFloat({ min: 0 }),
  ],
  validate,
  financialController.calculateCashback
);

router.get('/cashback/rewards', protect, financialController.getUserCashbackRewards);

router.get('/cashback/summary', protect, financialController.getCashbackSummary);

router.get('/cashback/tier', protect, financialController.getUserTier);

// =============================================================================
// VIRTUAL CARD ROUTES
// =============================================================================

router.post(
  '/virtual-cards',
  protect,
  [
    body('cardholderName').isString(),
    body('cardLimit').isFloat({ min: 0 }),
    body('cardType').optional().isIn(['VISA', 'MASTERCARD']),
  ],
  validate,
  financialController.createVirtualCard
);

router.get('/virtual-cards', protect, financialController.getUserCards);

router.get(
  '/virtual-cards/:cardId/details',
  protect,
  financialController.getCardDetails
);

router.patch(
  '/virtual-cards/:cardId',
  protect,
  financialController.updateCard
);

router.post(
  '/virtual-cards/:cardId/lock',
  protect,
  financialController.lockCard
);

router.post(
  '/virtual-cards/:cardId/unlock',
  protect,
  financialController.unlockCard
);

router.delete(
  '/virtual-cards/:cardId',
  protect,
  financialController.deactivateCard
);

router.get(
  '/virtual-cards/:cardId/transactions',
  protect,
  financialController.getCardTransactions
);

router.get(
  '/virtual-cards/:cardId/summary',
  protect,
  financialController.getCardSpendingSummary
);

// =============================================================================
// BANK INTEGRATION ROUTES
// =============================================================================

router.post(
  '/bank/connect',
  protect,
  [
    body('businessId').isString(),
    body('bankName').isString(),
    body('bankCode').isString(),
    body('accountNumber').isString(),
    body('accountType').isIn(['CURRENT', 'SAVINGS']),
  ],
  validate,
  financialController.initiateBankConnection
);

router.post(
  '/bank/connections/:connectionId/callback',
  financialController.handleConsentCallback
);

router.get(
  '/bank/connections/business/:businessId',
  protect,
  financialController.getBankConnections
);

router.post(
  '/bank/connections/:connectionId/sync',
  protect,
  financialController.syncBankTransactions
);

router.get(
  '/bank/connections/:connectionId/transactions/:businessId',
  protect,
  financialController.getBankTransactions
);

router.get(
  '/bank/balances/:businessId',
  protect,
  financialController.getBankBalances
);

router.get(
  '/bank/connections/:connectionId/statement/:businessId',
  protect,
  [
    query('startDate').isISO8601(),
    query('endDate').isISO8601(),
  ],
  validate,
  financialController.generateBankStatement
);

router.delete(
  '/bank/connections/:connectionId/:businessId',
  protect,
  financialController.revokeBankConnection
);

// =============================================================================
// CREDIT INSURANCE ROUTES
// =============================================================================

router.post(
  '/insurance/quote',
  protect,
  [
    body('businessId').isString(),
    body('coverageType').isIn(['WHOLE_TURNOVER', 'SPECIFIC_BUYERS', 'SINGLE_BUYER', 'TOP_UP']),
    body('coverageLimit').isFloat({ min: 0 }),
    body('validityMonths').optional().isInt({ min: 1, max: 36 }),
  ],
  validate,
  financialController.getInsuranceQuote
);

router.post(
  '/insurance/policies',
  protect,
  [
    body('businessId').isString(),
    body('coverageType').isIn(['WHOLE_TURNOVER', 'SPECIFIC_BUYERS', 'SINGLE_BUYER', 'TOP_UP']),
    body('coverageLimit').isFloat({ min: 0 }),
  ],
  validate,
  financialController.createInsurancePolicy
);

router.get(
  '/insurance/policies/:policyId',
  protect,
  financialController.getInsurancePolicy
);

router.get(
  '/insurance/policies/business/:businessId',
  protect,
  financialController.getBusinessPolicies
);

router.post(
  '/insurance/policies/:policyId/activate',
  protect,
  financialController.activateInsurancePolicy
);

router.post(
  '/insurance/policies/:policyId/buyers',
  protect,
  [
    body('buyerBusinessId').isString(),
    body('creditLimit').isFloat({ min: 0 }),
  ],
  validate,
  financialController.addInsuredBuyer
);

router.post(
  '/insurance/policies/:policyId/claims/eligibility',
  protect,
  [
    body('buyerBusinessId').isString(),
    body('invoiceId').isString(),
    body('invoiceAmount').isFloat({ min: 0 }),
    body('invoiceDueDate').isISO8601(),
  ],
  validate,
  financialController.checkClaimEligibility
);

router.post(
  '/insurance/policies/:policyId/claims',
  protect,
  [
    body('buyerBusinessId').isString(),
    body('invoiceId').isString(),
    body('invoiceNumber').isString(),
    body('invoiceAmount').isFloat({ min: 0 }),
    body('invoiceDueDate').isISO8601(),
  ],
  validate,
  financialController.fileInsuranceClaim
);

router.get(
  '/insurance/claims/:claimId',
  protect,
  financialController.getInsuranceClaim
);

router.get(
  '/insurance/policies/:policyId/claims',
  protect,
  financialController.getPolicyClaims
);

router.get(
  '/insurance/policies/:policyId/summary',
  protect,
  financialController.getInsurancePolicySummary
);

// =============================================================================
// RECONCILIATION ROUTES
// =============================================================================

router.post(
  '/reconciliation/rules',
  protect,
  [
    body('businessId').isString(),
    body('name').isString(),
    body('matchType').isIn(['EXACT', 'FUZZY', 'REFERENCE', 'AMOUNT_DATE']),
    body('matchFields').isObject(),
  ],
  validate,
  financialController.createReconciliationRule
);

router.get(
  '/reconciliation/rules/:businessId',
  protect,
  financialController.getReconciliationRules
);

router.post(
  '/reconciliation/batches',
  protect,
  [
    body('businessId').isString(),
    body('startDate').isISO8601(),
    body('endDate').isISO8601(),
  ],
  validate,
  financialController.startReconciliation
);

router.get(
  '/reconciliation/batches/:batchId',
  protect,
  financialController.getReconciliationBatch
);

router.get(
  '/reconciliation/batches/:batchId/unmatched',
  protect,
  financialController.getUnmatchedItems
);

router.post(
  '/reconciliation/items/:itemId/match',
  protect,
  [
    body('matchType').isString(),
    body('matchId').isString(),
  ],
  validate,
  financialController.manualMatch
);

router.get(
  '/reconciliation/summary/:businessId',
  protect,
  financialController.getReconciliationSummary
);

module.exports = router;
