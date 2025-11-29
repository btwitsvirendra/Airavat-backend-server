// =============================================================================
// AIRAVAT B2B MARKETPLACE - SAMPLE ORDER CONTROLLER
// Controller for sample order management endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const sampleService = require('../services/sample.service');
const { success, created } = require('../utils/apiResponse');

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @desc    Request a product sample
 * @route   POST /api/v1/samples
 * @access  Private
 */
exports.requestSample = asyncHandler(async (req, res) => {
  const sample = await sampleService.requestSample(
    req.user.id,
    req.user.businessId,
    req.body
  );
  return created(res, sample, 'Sample request submitted');
});

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @desc    Get buyer's sample requests
 * @route   GET /api/v1/samples/buyer
 * @access  Private
 */
exports.getBuyerSamples = asyncHandler(async (req, res) => {
  const result = await sampleService.getBuyerSamples(req.user.id, req.query);
  return success(res, result);
});

/**
 * @desc    Get seller's sample requests
 * @route   GET /api/v1/samples/seller
 * @access  Private (Seller)
 */
exports.getSellerSamples = asyncHandler(async (req, res) => {
  const result = await sampleService.getSellerSamples(req.user.businessId, req.query);
  return success(res, result);
});

/**
 * @desc    Get sample by ID
 * @route   GET /api/v1/samples/:sampleId
 * @access  Private
 */
exports.getSampleById = asyncHandler(async (req, res) => {
  const isSeller = req.query.role === 'seller';
  const sample = await sampleService.getSampleById(
    req.params.sampleId,
    isSeller ? req.user.businessId : req.user.id,
    isSeller
  );
  return success(res, sample);
});

/**
 * @desc    Get sample statistics
 * @route   GET /api/v1/samples/stats
 * @access  Private
 */
exports.getSampleStats = asyncHandler(async (req, res) => {
  const isSeller = req.query.role === 'seller';
  const stats = await sampleService.getSampleStats(req.user.businessId, isSeller);
  return success(res, stats);
});

// =============================================================================
// SELLER OPERATIONS
// =============================================================================

/**
 * @desc    Approve sample request
 * @route   POST /api/v1/samples/:sampleId/approve
 * @access  Private (Seller)
 */
exports.approveSample = asyncHandler(async (req, res) => {
  const sample = await sampleService.approveSample(
    req.user.businessId,
    req.params.sampleId
  );
  return success(res, sample, 'Sample request approved');
});

/**
 * @desc    Reject sample request
 * @route   POST /api/v1/samples/:sampleId/reject
 * @access  Private (Seller)
 */
exports.rejectSample = asyncHandler(async (req, res) => {
  const sample = await sampleService.rejectSample(
    req.user.businessId,
    req.params.sampleId,
    req.body.reason
  );
  return success(res, sample, 'Sample request rejected');
});

/**
 * @desc    Mark sample as shipped
 * @route   POST /api/v1/samples/:sampleId/ship
 * @access  Private (Seller)
 */
exports.markAsShipped = asyncHandler(async (req, res) => {
  const sample = await sampleService.markAsShipped(
    req.user.businessId,
    req.params.sampleId,
    req.body
  );
  return success(res, sample, 'Sample marked as shipped');
});

// =============================================================================
// BUYER OPERATIONS
// =============================================================================

/**
 * @desc    Confirm sample delivery
 * @route   POST /api/v1/samples/:sampleId/confirm-delivery
 * @access  Private
 */
exports.confirmDelivery = asyncHandler(async (req, res) => {
  const sample = await sampleService.confirmDelivery(
    req.user.id,
    req.params.sampleId
  );
  return success(res, sample, 'Delivery confirmed');
});

/**
 * @desc    Submit sample feedback
 * @route   POST /api/v1/samples/:sampleId/feedback
 * @access  Private
 */
exports.submitFeedback = asyncHandler(async (req, res) => {
  const sample = await sampleService.submitFeedback(
    req.user.id,
    req.params.sampleId,
    req.body
  );
  return success(res, sample, 'Feedback submitted');
});

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * @desc    Cancel sample request
 * @route   DELETE /api/v1/samples/:sampleId
 * @access  Private
 */
exports.cancelSample = asyncHandler(async (req, res) => {
  const sample = await sampleService.cancelSample(
    req.user.id,
    req.params.sampleId,
    req.body.reason
  );
  return success(res, sample, 'Sample request cancelled');
});

module.exports = exports;
