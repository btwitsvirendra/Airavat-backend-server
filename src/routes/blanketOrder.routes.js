// =============================================================================
// AIRAVAT B2B MARKETPLACE - BLANKET ORDER ROUTES
// Routes for standing purchase order management
// =============================================================================

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const blanketOrderController = require('../controllers/blanketOrder.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const createBlanketOrderValidation = [
  body('sellerId').isUUID().withMessage('Valid seller ID required'),
  body('productId').isUUID().withMessage('Valid product ID required'),
  body('totalQuantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('unitPrice').isDecimal({ min: 0 }).withMessage('Valid unit price required'),
  body('startDate').isISO8601().withMessage('Valid start date required'),
  body('endDate').isISO8601().withMessage('Valid end date required'),
  body('releaseFrequency').isIn(['WEEKLY', 'BIWEEKLY', 'MONTHLY', 'QUARTERLY', 'CUSTOM'])
    .withMessage('Invalid release frequency'),
  body('deliveryAddress').isObject().withMessage('Delivery address required'),
];

const updateBlanketOrderValidation = [
  param('id').isUUID().withMessage('Valid blanket order ID required'),
  body('totalQuantity').optional().isInt({ min: 1 }),
  body('unitPrice').optional().isDecimal({ min: 0 }),
  body('endDate').optional().isISO8601(),
];

const respondValidation = [
  param('id').isUUID().withMessage('Valid blanket order ID required'),
  body('action').isIn(['APPROVE', 'REJECT']).withMessage('Action must be APPROVE or REJECT'),
  body('notes').optional().isString(),
];

const releaseValidation = [
  param('id').isUUID().withMessage('Valid blanket order ID required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('scheduledDate').isISO8601().withMessage('Valid scheduled date required'),
];

const extendValidation = [
  param('id').isUUID().withMessage('Valid blanket order ID required'),
  body('newEndDate').isISO8601().withMessage('Valid new end date required'),
  body('reason').optional().isString(),
];

// =============================================================================
// BUYER ROUTES
// =============================================================================

router.post(
  '/',
  authenticate,
  authorize('buyer', 'admin'),
  createBlanketOrderValidation,
  validate,
  blanketOrderController.createBlanketOrder
);

router.get(
  '/',
  authenticate,
  blanketOrderController.getBlanketOrders
);

router.get(
  '/analytics',
  authenticate,
  blanketOrderController.getAnalytics
);

router.get(
  '/:id',
  authenticate,
  param('id').isUUID(),
  validate,
  blanketOrderController.getBlanketOrderById
);

router.put(
  '/:id',
  authenticate,
  authorize('buyer', 'admin'),
  updateBlanketOrderValidation,
  validate,
  blanketOrderController.updateBlanketOrder
);

router.post(
  '/:id/submit',
  authenticate,
  authorize('buyer', 'admin'),
  param('id').isUUID(),
  validate,
  blanketOrderController.submitBlanketOrder
);

router.post(
  '/:id/releases',
  authenticate,
  authorize('buyer', 'admin'),
  releaseValidation,
  validate,
  blanketOrderController.createRelease
);

router.get(
  '/:id/releases',
  authenticate,
  param('id').isUUID(),
  validate,
  blanketOrderController.getReleases
);

router.post(
  '/:id/extend',
  authenticate,
  authorize('buyer', 'admin'),
  extendValidation,
  validate,
  blanketOrderController.extendBlanketOrder
);

router.post(
  '/:id/cancel',
  authenticate,
  authorize('buyer', 'admin'),
  param('id').isUUID(),
  body('reason').optional().isString(),
  validate,
  blanketOrderController.cancelBlanketOrder
);

// =============================================================================
// SELLER ROUTES
// =============================================================================

router.post(
  '/:id/respond',
  authenticate,
  authorize('seller', 'admin'),
  respondValidation,
  validate,
  blanketOrderController.respondToBlanketOrder
);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;



