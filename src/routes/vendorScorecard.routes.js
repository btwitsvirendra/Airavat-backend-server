// =============================================================================
// AIRAVAT B2B MARKETPLACE - VENDOR SCORECARD ROUTES
// Routes for vendor performance tracking endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const vendorScorecardController = require('../controllers/vendorScorecard.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/vendor-scorecards/leaderboard
 * @desc    Get vendor leaderboard
 */
router.get(
  '/leaderboard',
  [
    query('category').optional().isIn([
      'quality', 'delivery', 'communication', 'pricing', 'compliance',
    ]),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('minOrders').optional().isInt({ min: 0 }),
  ],
  validate,
  vendorScorecardController.getLeaderboard
);

/**
 * @route   GET /api/v1/vendor-scorecards/vendor/:vendorId
 * @desc    Get vendor scorecard
 */
router.get(
  '/vendor/:vendorId',
  optionalAuth,
  [param('vendorId').notEmpty().withMessage('Vendor ID is required')],
  validate,
  vendorScorecardController.getVendorScorecard
);

/**
 * @route   POST /api/v1/vendor-scorecards/compare
 * @desc    Compare vendors
 */
router.post(
  '/compare',
  [
    body('vendorIds')
      .isArray({ min: 2, max: 5 })
      .withMessage('Provide 2-5 vendor IDs to compare'),
    body('vendorIds.*').notEmpty().withMessage('Vendor ID cannot be empty'),
  ],
  validate,
  vendorScorecardController.compareVendors
);

// =============================================================================
// PROTECTED ROUTES
// =============================================================================

router.use(authenticate);

/**
 * @route   GET /api/v1/vendor-scorecards/my-scorecard
 * @desc    Get my scorecard (for sellers)
 */
router.get('/my-scorecard', vendorScorecardController.getMyScorecard);

/**
 * @route   POST /api/v1/vendor-scorecards/recalculate
 * @desc    Recalculate scorecard
 */
router.post('/recalculate', vendorScorecardController.recalculateScorecard);

module.exports = router;
