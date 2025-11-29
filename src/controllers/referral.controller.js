// =============================================================================
// AIRAVAT B2B MARKETPLACE - REFERRAL CONTROLLER
// Controller for referral program endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const referralService = require('../services/referral.service');
const { success, created } = require('../utils/apiResponse');

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @desc    Validate referral code
 * @route   GET /api/v1/referrals/validate/:code
 * @access  Public
 */
exports.validateReferralCode = asyncHandler(async (req, res) => {
  const result = await referralService.validateReferralCode(req.params.code);
  return success(res, result);
});

/**
 * @desc    Get referral leaderboard
 * @route   GET /api/v1/referrals/leaderboard
 * @access  Public
 */
exports.getLeaderboard = asyncHandler(async (req, res) => {
  const leaderboard = await referralService.getReferralLeaderboard(
    parseInt(req.query.limit) || 10
  );
  return success(res, leaderboard);
});

/**
 * @desc    Get my referral code
 * @route   GET /api/v1/referrals/my-code
 * @access  Private
 */
exports.getMyReferralCode = asyncHandler(async (req, res) => {
  const code = await referralService.getMyReferralCode(
    req.user.id,
    req.user.businessId
  );
  return success(res, {
    code,
    shareLink: `${process.env.FRONTEND_URL}/register?ref=${code}`,
  });
});

/**
 * @desc    Get referral statistics
 * @route   GET /api/v1/referrals/stats
 * @access  Private
 */
exports.getReferralStats = asyncHandler(async (req, res) => {
  const stats = await referralService.getReferralStats(req.user.id);
  return success(res, stats);
});

/**
 * @desc    Get my referrals
 * @route   GET /api/v1/referrals
 * @access  Private
 */
exports.getMyReferrals = asyncHandler(async (req, res) => {
  const result = await referralService.getMyReferrals(req.user.id, req.query);
  return success(res, result);
});

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @desc    Create referral invite
 * @route   POST /api/v1/referrals
 * @access  Private
 */
exports.createReferral = asyncHandler(async (req, res) => {
  const referral = await referralService.createReferral(
    req.user.id,
    req.user.businessId,
    req.body.email
  );
  return created(res, referral, 'Referral invite sent');
});

module.exports = exports;



