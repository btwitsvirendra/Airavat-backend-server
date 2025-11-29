// =============================================================================
// AIRAVAT B2B MARKETPLACE - COMMISSION ROUTES
// Routes for commission management and payouts
// =============================================================================

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const commissionController = require('../controllers/commission.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

// =============================================================================
// SELLER ROUTES
// =============================================================================

router.get(
  '/',
  authenticate,
  authorize('seller', 'admin'),
  commissionController.getSellerCommissions
);

router.get(
  '/pending-payout',
  authenticate,
  authorize('seller', 'admin'),
  commissionController.getPendingPayout
);

router.get(
  '/orders/:orderId',
  authenticate,
  param('orderId').isUUID(),
  validate,
  commissionController.getOrderCommission
);

// =============================================================================
// PAYOUT ROUTES
// =============================================================================

router.post(
  '/payouts',
  authenticate,
  authorize('seller', 'admin'),
  body('amount').optional().isDecimal({ min: 100 }),
  body('recordIds').optional().isArray(),
  validate,
  commissionController.requestPayout
);

router.get(
  '/payouts',
  authenticate,
  authorize('seller', 'admin'),
  commissionController.getPayoutHistory
);

router.get(
  '/payouts/:id',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  validate,
  commissionController.getPayoutById
);

// =============================================================================
// ADMIN ROUTES
// =============================================================================

router.post(
  '/admin/payouts/:id/process',
  authenticate,
  authorize('admin'),
  param('id').isUUID(),
  body('success').isBoolean(),
  body('transactionId').optional().isString(),
  body('failureReason').optional().isString(),
  validate,
  commissionController.processPayout
);

router.get(
  '/admin/rates',
  authenticate,
  authorize('admin'),
  commissionController.getAllRates
);

router.post(
  '/admin/rates',
  authenticate,
  authorize('admin'),
  body('categoryCode').notEmpty(),
  body('rate').isDecimal({ min: 0, max: 50 }),
  validate,
  commissionController.setCategoryRate
);

router.post(
  '/admin/overrides',
  authenticate,
  authorize('admin'),
  body('sellerId').isUUID(),
  body('rate').isDecimal({ min: 0, max: 50 }),
  body('categoryCode').optional().isString(),
  body('validUntil').optional().isISO8601(),
  body('reason').optional().isString(),
  validate,
  commissionController.setSellerOverride
);

router.get(
  '/admin/revenue',
  authenticate,
  authorize('admin'),
  commissionController.getPlatformRevenue
);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;



