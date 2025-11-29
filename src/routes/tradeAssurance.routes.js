// =============================================================================
// AIRAVAT B2B MARKETPLACE - TRADE ASSURANCE ROUTES
// Routes for trade assurance and buyer protection endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const tradeAssuranceController = require('../controllers/tradeAssurance.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// All routes require authentication
router.use(authenticate);

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @route   GET /api/v1/trade-assurance/buyer
 * @desc    Get buyer's assurances
 */
router.get(
  '/buyer',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn([
      'PENDING', 'ACTIVE', 'CLAIMED', 'RESOLVED', 'EXPIRED', 'CANCELLED',
    ]),
  ],
  validate,
  tradeAssuranceController.getBuyerAssurances
);

/**
 * @route   GET /api/v1/trade-assurance/seller
 * @desc    Get seller's assurances
 */
router.get(
  '/seller',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn([
      'PENDING', 'ACTIVE', 'CLAIMED', 'RESOLVED', 'EXPIRED', 'CANCELLED',
    ]),
    query('hasClaim').optional().isBoolean(),
  ],
  validate,
  tradeAssuranceController.getSellerAssurances
);

/**
 * @route   GET /api/v1/trade-assurance/stats
 * @desc    Get assurance statistics
 */
router.get(
  '/stats',
  [query('role').optional().isIn(['buyer', 'seller'])],
  validate,
  tradeAssuranceController.getAssuranceStats
);

/**
 * @route   GET /api/v1/trade-assurance/order/:orderId
 * @desc    Get assurance by order
 */
router.get(
  '/order/:orderId',
  [param('orderId').notEmpty().withMessage('Order ID is required')],
  validate,
  tradeAssuranceController.getAssuranceByOrder
);

// =============================================================================
// BUSINESS LOGIC OPERATIONS
// =============================================================================

/**
 * @route   POST /api/v1/trade-assurance/calculate
 * @desc    Calculate premium for trade assurance
 */
router.post(
  '/calculate',
  [
    body('orderAmount')
      .isFloat({ min: 1 })
      .withMessage('Order amount must be positive'),
    body('coverageType')
      .optional()
      .isIn(['STANDARD', 'EXTENDED', 'PREMIUM', 'CUSTOM']),
  ],
  validate,
  tradeAssuranceController.calculatePremium
);

/**
 * @route   POST /api/v1/trade-assurance/:assuranceId/claim
 * @desc    File a claim
 */
router.post(
  '/:assuranceId/claim',
  [
    param('assuranceId').notEmpty().withMessage('Assurance ID is required'),
    body('reason').notEmpty().withMessage('Claim reason is required'),
    body('description')
      .notEmpty()
      .withMessage('Description is required')
      .isLength({ max: 2000 }),
    body('claimAmount')
      .isFloat({ min: 1 })
      .withMessage('Claim amount must be positive'),
    body('evidence').optional().isArray(),
  ],
  validate,
  tradeAssuranceController.fileClaim
);

module.exports = router;
