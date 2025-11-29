// =============================================================================
// AIRAVAT B2B MARKETPLACE - REFERRAL ROUTES
// Routes for referral program endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const referralController = require('../controllers/referral.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { rateLimiter } = require('../middleware/rateLimiter');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/referrals/validate/:code
 * @desc    Validate referral code
 */
router.get(
  '/validate/:code',
  [param('code').notEmpty().withMessage('Referral code is required')],
  validate,
  referralController.validateReferralCode
);

/**
 * @route   GET /api/v1/referrals/leaderboard
 * @desc    Get referral leaderboard
 */
router.get(
  '/leaderboard',
  [query('limit').optional().isInt({ min: 1, max: 50 })],
  validate,
  referralController.getLeaderboard
);

// =============================================================================
// PROTECTED ROUTES
// =============================================================================

router.use(authenticate);

/**
 * @route   GET /api/v1/referrals/my-code
 * @desc    Get my referral code
 */
router.get('/my-code', referralController.getMyReferralCode);

/**
 * @route   GET /api/v1/referrals/stats
 * @desc    Get referral statistics
 */
router.get('/stats', referralController.getReferralStats);

/**
 * @route   GET /api/v1/referrals
 * @desc    Get my referrals
 */
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn([
      'PENDING', 'SIGNED_UP', 'QUALIFIED', 'REWARDED', 'EXPIRED', 'INVALID',
    ]),
  ],
  validate,
  referralController.getMyReferrals
);

/**
 * @route   POST /api/v1/referrals
 * @desc    Create referral invite
 */
router.post(
  '/',
  rateLimiter({ windowMs: 60 * 60 * 1000, max: 20 }), // 20 per hour
  [body('email').isEmail().withMessage('Valid email is required').normalizeEmail()],
  validate,
  referralController.createReferral
);

module.exports = router;
