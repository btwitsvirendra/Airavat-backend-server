// =============================================================================
// AIRAVAT B2B MARKETPLACE - PAYMENT ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const paymentController = require('../controllers/payment.controller');
const { authenticate, requireBusiness, requireVerifiedBusiness } = require('../middleware/auth');

// =============================================================================
// PAYMENT INITIATION
// =============================================================================

// Create payment for order
router.post(
  '/create',
  authenticate,
  requireBusiness,
  paymentController.createPayment
);

// Verify payment (after Razorpay callback)
router.post(
  '/verify',
  authenticate,
  requireBusiness,
  paymentController.verifyPayment
);

// Get payment details
router.get(
  '/:paymentId',
  authenticate,
  requireBusiness,
  paymentController.getPayment
);

// Get payment history
router.get(
  '/',
  authenticate,
  requireBusiness,
  paymentController.getPaymentHistory
);

// =============================================================================
// UPI / NETBANKING
// =============================================================================

// Create UPI payment
router.post(
  '/upi/create',
  authenticate,
  requireBusiness,
  paymentController.createUPIPayment
);

// Check UPI payment status
router.get(
  '/upi/:paymentId/status',
  authenticate,
  requireBusiness,
  paymentController.checkUPIStatus
);

// =============================================================================
// REFUNDS
// =============================================================================

// Initiate refund
router.post(
  '/:paymentId/refund',
  authenticate,
  requireBusiness,
  paymentController.initiateRefund
);

// Get refund status
router.get(
  '/:paymentId/refund/:refundId',
  authenticate,
  requireBusiness,
  paymentController.getRefundStatus
);

// =============================================================================
// SETTLEMENTS (SELLER)
// =============================================================================

// Get settlement history
router.get(
  '/settlements',
  authenticate,
  requireBusiness,
  requireVerifiedBusiness,
  paymentController.getSettlements
);

// Get settlement details
router.get(
  '/settlements/:settlementId',
  authenticate,
  requireBusiness,
  requireVerifiedBusiness,
  paymentController.getSettlementDetails
);

// Get pending settlements
router.get(
  '/settlements/pending',
  authenticate,
  requireBusiness,
  requireVerifiedBusiness,
  paymentController.getPendingSettlements
);

// =============================================================================
// WALLET / CREDITS
// =============================================================================

// Get wallet balance
router.get(
  '/wallet/balance',
  authenticate,
  requireBusiness,
  paymentController.getWalletBalance
);

// Get wallet transactions
router.get(
  '/wallet/transactions',
  authenticate,
  requireBusiness,
  paymentController.getWalletTransactions
);

// Add money to wallet
router.post(
  '/wallet/add',
  authenticate,
  requireBusiness,
  paymentController.addToWallet
);

// =============================================================================
// CREDIT LINE (BNPL)
// =============================================================================

// Check credit eligibility
router.get(
  '/credit/eligibility',
  authenticate,
  requireBusiness,
  requireVerifiedBusiness,
  paymentController.checkCreditEligibility
);

// Get credit limit
router.get(
  '/credit/limit',
  authenticate,
  requireBusiness,
  paymentController.getCreditLimit
);

// Get credit usage
router.get(
  '/credit/usage',
  authenticate,
  requireBusiness,
  paymentController.getCreditUsage
);

// Pay credit invoice
router.post(
  '/credit/pay',
  authenticate,
  requireBusiness,
  paymentController.payCreditInvoice
);

// =============================================================================
// PAYMENT METHODS
// =============================================================================

// Get saved payment methods
router.get(
  '/methods',
  authenticate,
  paymentController.getPaymentMethods
);

// Add payment method
router.post(
  '/methods',
  authenticate,
  paymentController.addPaymentMethod
);

// Delete payment method
router.delete(
  '/methods/:methodId',
  authenticate,
  paymentController.deletePaymentMethod
);

module.exports = router;
