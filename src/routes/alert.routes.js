// =============================================================================
// AIRAVAT B2B MARKETPLACE - PRICE ALERT ROUTES
// Routes for price alert management endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const alertController = require('../controllers/alert.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { rateLimiter } = require('../middleware/rateLimiter');

// All routes require authentication
router.use(authenticate);

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @route   GET /api/v1/alerts
 * @desc    Get user's alerts
 */
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    query('status').optional().isIn(['ACTIVE', 'TRIGGERED', 'EXPIRED', 'CANCELLED']),
    query('alertType').optional().isIn(['PRICE_DROP', 'PRICE_THRESHOLD', 'BACK_IN_STOCK']),
  ],
  validate,
  alertController.getAlerts
);

/**
 * @route   GET /api/v1/alerts/stats
 * @desc    Get alert statistics
 */
router.get('/stats', alertController.getAlertStats);

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @route   POST /api/v1/alerts
 * @desc    Create price alert
 */
router.post(
  '/',
  rateLimiter({ windowMs: 60 * 60 * 1000, max: 50 }), // 50 per hour
  [
    body('productId').notEmpty().withMessage('Product ID is required'),
    body('targetPrice').optional().isFloat({ min: 0 }).withMessage('Target price must be positive'),
    body('alertType')
      .optional()
      .isIn(['PRICE_DROP', 'PRICE_THRESHOLD', 'BACK_IN_STOCK'])
      .withMessage('Invalid alert type'),
    body('expiresIn')
      .optional()
      .isInt({ min: 1, max: 365 })
      .withMessage('Expires in 1-365 days'),
  ],
  validate,
  alertController.createAlert
);

/**
 * @route   POST /api/v1/alerts/from-wishlist
 * @desc    Create alerts from wishlist
 */
router.post('/from-wishlist', alertController.createAlertsFromWishlist);

/**
 * @route   POST /api/v1/alerts/back-in-stock/:productId
 * @desc    Create back in stock alert
 */
router.post(
  '/back-in-stock/:productId',
  [param('productId').notEmpty().withMessage('Product ID is required')],
  validate,
  alertController.createBackInStockAlert
);

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * @route   PATCH /api/v1/alerts/:alertId
 * @desc    Update alert
 */
router.patch(
  '/:alertId',
  [
    param('alertId').notEmpty().withMessage('Alert ID is required'),
    body('targetPrice').optional().isFloat({ min: 0 }),
    body('expiresIn').optional().isInt({ min: 1, max: 365 }),
  ],
  validate,
  alertController.updateAlert
);

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * @route   DELETE /api/v1/alerts/:alertId
 * @desc    Cancel alert
 */
router.delete(
  '/:alertId',
  [param('alertId').notEmpty().withMessage('Alert ID is required')],
  validate,
  alertController.cancelAlert
);

module.exports = router;
