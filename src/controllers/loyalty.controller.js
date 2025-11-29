// =============================================================================
// AIRAVAT B2B MARKETPLACE - LOYALTY CONTROLLER
// Controller for loyalty program and rewards endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const loyaltyService = require('../services/loyalty.service');
const { success } = require('../utils/apiResponse');

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @desc    Get loyalty dashboard
 * @route   GET /api/v1/loyalty/dashboard
 * @access  Private
 */
exports.getDashboard = asyncHandler(async (req, res) => {
  const dashboard = await loyaltyService.getLoyaltyDashboard(
    req.user.id,
    req.user.businessId
  );
  return success(res, dashboard);
});

/**
 * @desc    Get points history
 * @route   GET /api/v1/loyalty/history
 * @access  Private
 */
exports.getPointsHistory = asyncHandler(async (req, res) => {
  const history = await loyaltyService.getPointsHistory(req.user.id, req.query);
  return success(res, history);
});

/**
 * @desc    Calculate redemption for order
 * @route   GET /api/v1/loyalty/calculate-redemption
 * @access  Private
 */
exports.calculateRedemption = asyncHandler(async (req, res) => {
  const calculation = await loyaltyService.calculateRedemption(
    req.user.id,
    req.user.businessId,
    req.query.orderAmount
  );
  return success(res, calculation);
});

/**
 * @desc    Get tier benefits
 * @route   GET /api/v1/loyalty/tiers
 * @access  Public
 */
exports.getTierBenefits = asyncHandler(async (req, res) => {
  const benefits = loyaltyService.getTierBenefits();
  return success(res, benefits);
});

// =============================================================================
// BUSINESS LOGIC OPERATIONS
// =============================================================================

/**
 * @desc    Redeem points
 * @route   POST /api/v1/loyalty/redeem
 * @access  Private
 */
exports.redeemPoints = asyncHandler(async (req, res) => {
  const result = await loyaltyService.redeemPoints(
    req.user.id,
    req.user.businessId,
    req.body.points,
    req.body.orderId
  );
  return success(res, result, 'Points redeemed successfully');
});

module.exports = exports;
