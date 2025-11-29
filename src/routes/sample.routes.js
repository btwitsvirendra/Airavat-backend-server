// =============================================================================
// AIRAVAT B2B MARKETPLACE - SAMPLE ORDER ROUTES
// Routes for sample order management endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const sampleController = require('../controllers/sample.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { rateLimiter } = require('../middleware/rateLimiter');

// All routes require authentication
router.use(authenticate);

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @route   GET /api/v1/samples/stats
 * @desc    Get sample statistics
 */
router.get(
  '/stats',
  [query('role').optional().isIn(['buyer', 'seller'])],
  validate,
  sampleController.getSampleStats
);

/**
 * @route   GET /api/v1/samples/buyer
 * @desc    Get buyer's sample requests
 */
router.get(
  '/buyer',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn([
      'REQUESTED', 'APPROVED', 'REJECTED', 'SHIPPED',
      'DELIVERED', 'FEEDBACK_PENDING', 'COMPLETED', 'CANCELLED',
    ]),
  ],
  validate,
  sampleController.getBuyerSamples
);

/**
 * @route   GET /api/v1/samples/seller
 * @desc    Get seller's sample requests
 */
router.get(
  '/seller',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn([
      'REQUESTED', 'APPROVED', 'REJECTED', 'SHIPPED',
      'DELIVERED', 'FEEDBACK_PENDING', 'COMPLETED', 'CANCELLED',
    ]),
  ],
  validate,
  sampleController.getSellerSamples
);

/**
 * @route   GET /api/v1/samples/:sampleId
 * @desc    Get sample by ID
 */
router.get(
  '/:sampleId',
  [
    param('sampleId').notEmpty().withMessage('Sample ID is required'),
    query('role').optional().isIn(['buyer', 'seller']),
  ],
  validate,
  sampleController.getSampleById
);

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @route   POST /api/v1/samples
 * @desc    Request a product sample
 */
router.post(
  '/',
  rateLimiter({ windowMs: 24 * 60 * 60 * 1000, max: 10 }), // 10 per day
  [
    body('productId').notEmpty().withMessage('Product ID is required'),
    body('quantity').isInt({ min: 1, max: 10 }).withMessage('Quantity must be 1-10'),
    body('purpose')
      .optional()
      .isIn(['QUALITY_CHECK', 'PRODUCT_TESTING', 'CERTIFICATION', 'CUSTOMER_DEMO', 'OTHER']),
    body('shippingAddress').notEmpty().withMessage('Shipping address is required'),
    body('shippingAddress.street').notEmpty().withMessage('Street is required'),
    body('shippingAddress.city').notEmpty().withMessage('City is required'),
    body('shippingAddress.state').notEmpty().withMessage('State is required'),
    body('shippingAddress.pincode').notEmpty().withMessage('Pincode is required'),
  ],
  validate,
  sampleController.requestSample
);

// =============================================================================
// SELLER OPERATIONS
// =============================================================================

/**
 * @route   POST /api/v1/samples/:sampleId/approve
 * @desc    Approve sample request
 */
router.post(
  '/:sampleId/approve',
  [param('sampleId').notEmpty().withMessage('Sample ID is required')],
  validate,
  sampleController.approveSample
);

/**
 * @route   POST /api/v1/samples/:sampleId/reject
 * @desc    Reject sample request
 */
router.post(
  '/:sampleId/reject',
  [
    param('sampleId').notEmpty().withMessage('Sample ID is required'),
    body('reason').notEmpty().withMessage('Rejection reason is required'),
  ],
  validate,
  sampleController.rejectSample
);

/**
 * @route   POST /api/v1/samples/:sampleId/ship
 * @desc    Mark sample as shipped
 */
router.post(
  '/:sampleId/ship',
  [
    param('sampleId').notEmpty().withMessage('Sample ID is required'),
    body('trackingNumber').notEmpty().withMessage('Tracking number is required'),
    body('carrier').optional().isLength({ max: 100 }),
  ],
  validate,
  sampleController.markAsShipped
);

// =============================================================================
// BUYER OPERATIONS
// =============================================================================

/**
 * @route   POST /api/v1/samples/:sampleId/confirm-delivery
 * @desc    Confirm sample delivery
 */
router.post(
  '/:sampleId/confirm-delivery',
  [param('sampleId').notEmpty().withMessage('Sample ID is required')],
  validate,
  sampleController.confirmDelivery
);

/**
 * @route   POST /api/v1/samples/:sampleId/feedback
 * @desc    Submit sample feedback
 */
router.post(
  '/:sampleId/feedback',
  [
    param('sampleId').notEmpty().withMessage('Sample ID is required'),
    body('rating').isInt({ min: 1, max: 5 }).withMessage('Rating must be 1-5'),
    body('feedback').optional().isLength({ max: 1000 }),
    body('intendToPurchase').optional().isBoolean(),
  ],
  validate,
  sampleController.submitFeedback
);

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * @route   DELETE /api/v1/samples/:sampleId
 * @desc    Cancel sample request
 */
router.delete(
  '/:sampleId',
  [
    param('sampleId').notEmpty().withMessage('Sample ID is required'),
    body('reason').optional().isLength({ max: 500 }),
  ],
  validate,
  sampleController.cancelSample
);

module.exports = router;
