// =============================================================================
// AIRAVAT B2B MARKETPLACE - TRADE ASSURANCE CONTROLLER
// Controller for trade assurance and buyer protection endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const tradeAssuranceService = require('../services/tradeAssurance.service');
const { success, created } = require('../utils/apiResponse');

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @desc    Calculate premium for trade assurance
 * @route   POST /api/v1/trade-assurance/calculate
 * @access  Private
 */
exports.calculatePremium = asyncHandler(async (req, res) => {
  const calculation = await tradeAssuranceService.calculatePremium(
    req.body.orderAmount,
    req.body.coverageType
  );
  return success(res, calculation);
});

/**
 * @desc    Get buyer's assurances
 * @route   GET /api/v1/trade-assurance/buyer
 * @access  Private
 */
exports.getBuyerAssurances = asyncHandler(async (req, res) => {
  const result = await tradeAssuranceService.getBuyerAssurances(
    req.user.businessId,
    req.query
  );
  return success(res, result);
});

/**
 * @desc    Get seller's assurances
 * @route   GET /api/v1/trade-assurance/seller
 * @access  Private
 */
exports.getSellerAssurances = asyncHandler(async (req, res) => {
  const result = await tradeAssuranceService.getSellerAssurances(
    req.user.businessId,
    req.query
  );
  return success(res, result);
});

/**
 * @desc    Get assurance statistics
 * @route   GET /api/v1/trade-assurance/stats
 * @access  Private
 */
exports.getAssuranceStats = asyncHandler(async (req, res) => {
  const isSeller = req.query.role === 'seller';
  const stats = await tradeAssuranceService.getAssuranceStats(
    req.user.businessId,
    isSeller
  );
  return success(res, stats);
});

/**
 * @desc    Get assurance by order
 * @route   GET /api/v1/trade-assurance/order/:orderId
 * @access  Private
 */
exports.getAssuranceByOrder = asyncHandler(async (req, res) => {
  const assurance = await tradeAssuranceService.getAssuranceByOrder(
    req.params.orderId,
    req.user.businessId
  );
  return success(res, assurance);
});

// =============================================================================
// CLAIM OPERATIONS
// =============================================================================

/**
 * @desc    File a claim
 * @route   POST /api/v1/trade-assurance/:assuranceId/claim
 * @access  Private
 */
exports.fileClaim = asyncHandler(async (req, res) => {
  const result = await tradeAssuranceService.fileClaim(
    req.params.assuranceId,
    req.user.businessId,
    req.body
  );
  return created(res, result, 'Claim filed successfully');
});

module.exports = exports;



