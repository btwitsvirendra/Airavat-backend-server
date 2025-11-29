// =============================================================================
// AIRAVAT B2B MARKETPLACE - QUICK ORDER ROUTES
// Routes for quick order and reordering endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const quickOrderController = require('../controllers/quickOrder.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// All routes require authentication
router.use(authenticate);

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @route   GET /api/v1/quick-orders
 * @desc    Get quick orders
 */
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    query('status').optional().isIn(['DRAFT', 'VALIDATED', 'CONVERTED', 'CANCELLED']),
  ],
  validate,
  quickOrderController.getQuickOrders
);

/**
 * @route   GET /api/v1/quick-orders/suggestions
 * @desc    Get reorder suggestions
 */
router.get(
  '/suggestions',
  [query('limit').optional().isInt({ min: 1, max: 20 }).withMessage('Limit must be 1-20')],
  validate,
  quickOrderController.getReorderSuggestions
);

/**
 * @route   GET /api/v1/quick-orders/:quickOrderId
 * @desc    Get quick order by ID
 */
router.get(
  '/:quickOrderId',
  [param('quickOrderId').notEmpty().withMessage('Quick order ID is required')],
  validate,
  quickOrderController.getQuickOrder
);

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @route   POST /api/v1/quick-orders/from-template/:templateId
 * @desc    Create quick order from template
 */
router.post(
  '/from-template/:templateId',
  [param('templateId').notEmpty().withMessage('Template ID is required')],
  validate,
  quickOrderController.createFromTemplate
);

/**
 * @route   POST /api/v1/quick-orders/from-order/:orderId
 * @desc    Create quick order from previous order
 */
router.post(
  '/from-order/:orderId',
  [param('orderId').notEmpty().withMessage('Order ID is required')],
  validate,
  quickOrderController.createFromOrder
);

/**
 * @route   POST /api/v1/quick-orders/from-cart
 * @desc    Create quick order from cart
 */
router.post('/from-cart', quickOrderController.createFromCart);

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * @route   PATCH /api/v1/quick-orders/:quickOrderId/items/:itemId
 * @desc    Update quick order item
 */
router.patch(
  '/:quickOrderId/items/:itemId',
  [
    param('quickOrderId').notEmpty().withMessage('Quick order ID is required'),
    param('itemId').notEmpty().withMessage('Item ID is required'),
    body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be positive'),
  ],
  validate,
  quickOrderController.updateQuickOrderItem
);

// =============================================================================
// BUSINESS LOGIC OPERATIONS
// =============================================================================

/**
 * @route   POST /api/v1/quick-orders/:quickOrderId/convert
 * @desc    Convert quick order to order
 */
router.post(
  '/:quickOrderId/convert',
  [
    param('quickOrderId').notEmpty().withMessage('Quick order ID is required'),
    body('shippingAddressId').optional(),
    body('paymentMethod').optional(),
  ],
  validate,
  quickOrderController.convertToOrder
);

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * @route   DELETE /api/v1/quick-orders/:quickOrderId
 * @desc    Cancel quick order
 */
router.delete(
  '/:quickOrderId',
  [param('quickOrderId').notEmpty().withMessage('Quick order ID is required')],
  validate,
  quickOrderController.cancelQuickOrder
);

module.exports = router;
