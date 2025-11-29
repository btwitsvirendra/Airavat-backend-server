// =============================================================================
// AIRAVAT B2B MARKETPLACE - LOYALTY ROUTES
// Routes for loyalty program and rewards endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, query } = require('express-validator');

const loyaltyController = require('../controllers/loyalty.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/loyalty/tiers
 * @desc    Get tier benefits
 */
router.get('/tiers', loyaltyController.getTierBenefits);

// =============================================================================
// PROTECTED ROUTES
// =============================================================================

router.use(authenticate);

/**
 * @route   GET /api/v1/loyalty/dashboard
 * @desc    Get loyalty dashboard
 */
router.get('/dashboard', loyaltyController.getDashboard);

/**
 * @route   GET /api/v1/loyalty/history
 * @desc    Get points history
 */
router.get(
  '/history',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('type').optional().isIn([
      'EARN_PURCHASE', 'EARN_BONUS', 'EARN_REFERRAL', 'EARN_REVIEW',
      'EARN_BIRTHDAY', 'EARN_ANNIVERSARY', 'REDEEM', 'EXPIRE', 'ADJUST',
      'TIER_UPGRADE', 'TIER_DOWNGRADE',
    ]),
  ],
  validate,
  loyaltyController.getPointsHistory
);

/**
 * @route   GET /api/v1/loyalty/calculate-redemption
 * @desc    Calculate redemption for order
 */
router.get(
  '/calculate-redemption',
  [
    query('orderAmount')
      .notEmpty()
      .withMessage('Order amount is required')
      .isFloat({ min: 0 })
      .withMessage('Order amount must be positive'),
  ],
  validate,
  loyaltyController.calculateRedemption
);

/**
 * @route   POST /api/v1/loyalty/redeem
 * @desc    Redeem points
 */
router.post(
  '/redeem',
  [
    body('points')
      .isInt({ min: 1 })
      .withMessage('Points must be positive'),
    body('orderId').optional(),
  ],
  validate,
  loyaltyController.redeemPoints
);

module.exports = router;
