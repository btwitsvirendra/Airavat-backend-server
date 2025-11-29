// =============================================================================
// AIRAVAT B2B MARKETPLACE - VENDOR SCORECARD CONTROLLER
// Controller for vendor performance tracking endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const vendorScorecardService = require('../services/vendorScorecard.service');
const { success } = require('../utils/apiResponse');

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @desc    Get vendor leaderboard
 * @route   GET /api/v1/vendor-scorecards/leaderboard
 * @access  Public
 */
exports.getLeaderboard = asyncHandler(async (req, res) => {
  const leaderboard = await vendorScorecardService.getLeaderboard(req.query);
  return success(res, leaderboard);
});

/**
 * @desc    Get vendor scorecard
 * @route   GET /api/v1/vendor-scorecards/vendor/:vendorId
 * @access  Public
 */
exports.getVendorScorecard = asyncHandler(async (req, res) => {
  const scorecard = await vendorScorecardService.getScorecard(req.params.vendorId);
  return success(res, scorecard);
});

/**
 * @desc    Get my scorecard (for sellers)
 * @route   GET /api/v1/vendor-scorecards/my-scorecard
 * @access  Private (Seller)
 */
exports.getMyScorecard = asyncHandler(async (req, res) => {
  const scorecard = await vendorScorecardService.getScorecard(req.user.businessId);
  return success(res, scorecard);
});

// =============================================================================
// BUSINESS LOGIC OPERATIONS
// =============================================================================

/**
 * @desc    Compare vendors
 * @route   POST /api/v1/vendor-scorecards/compare
 * @access  Public
 */
exports.compareVendors = asyncHandler(async (req, res) => {
  const comparison = await vendorScorecardService.compareVendors(req.body.vendorIds);
  return success(res, comparison);
});

/**
 * @desc    Recalculate scorecard
 * @route   POST /api/v1/vendor-scorecards/recalculate
 * @access  Private (Seller)
 */
exports.recalculateScorecard = asyncHandler(async (req, res) => {
  const scorecard = await vendorScorecardService.recalculateScorecard(req.user.businessId);
  return success(res, scorecard, 'Scorecard recalculated');
});

module.exports = exports;



