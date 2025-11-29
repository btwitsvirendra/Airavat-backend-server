// =============================================================================
// AIRAVAT B2B MARKETPLACE - PRICE ALERT CONTROLLER
// Controller for price alert management endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const alertService = require('../services/alert.service');
const { success, created } = require('../utils/apiResponse');

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @desc    Create price alert
 * @route   POST /api/v1/alerts
 * @access  Private
 */
exports.createAlert = asyncHandler(async (req, res) => {
  const alert = await alertService.createAlert(req.user.id, req.body);
  return created(res, alert, 'Price alert created');
});

/**
 * @desc    Create back in stock alert
 * @route   POST /api/v1/alerts/back-in-stock/:productId
 * @access  Private
 */
exports.createBackInStockAlert = asyncHandler(async (req, res) => {
  const alert = await alertService.createBackInStockAlert(
    req.user.id,
    req.params.productId
  );
  return created(res, alert, 'Back in stock alert created');
});

/**
 * @desc    Create alerts from wishlist
 * @route   POST /api/v1/alerts/from-wishlist
 * @access  Private
 */
exports.createAlertsFromWishlist = asyncHandler(async (req, res) => {
  const result = await alertService.createAlertsFromWishlist(req.user.id);
  return success(res, result, `Created ${result.created} alerts`);
});

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @desc    Get user's alerts
 * @route   GET /api/v1/alerts
 * @access  Private
 */
exports.getAlerts = asyncHandler(async (req, res) => {
  const result = await alertService.getAlerts(req.user.id, req.query);
  return success(res, result);
});

/**
 * @desc    Get alert statistics
 * @route   GET /api/v1/alerts/stats
 * @access  Private
 */
exports.getAlertStats = asyncHandler(async (req, res) => {
  const stats = await alertService.getAlertStats(req.user.id);
  return success(res, stats);
});

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * @desc    Update alert
 * @route   PATCH /api/v1/alerts/:alertId
 * @access  Private
 */
exports.updateAlert = asyncHandler(async (req, res) => {
  const alert = await alertService.updateAlert(
    req.user.id,
    req.params.alertId,
    req.body
  );
  return success(res, alert, 'Alert updated');
});

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * @desc    Cancel alert
 * @route   DELETE /api/v1/alerts/:alertId
 * @access  Private
 */
exports.cancelAlert = asyncHandler(async (req, res) => {
  await alertService.cancelAlert(req.user.id, req.params.alertId);
  return success(res, null, 'Alert cancelled');
});

module.exports = exports;
