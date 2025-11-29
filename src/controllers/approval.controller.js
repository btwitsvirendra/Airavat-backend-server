// =============================================================================
// AIRAVAT B2B MARKETPLACE - APPROVAL CONTROLLER
// Controller for approval workflow endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const approvalService = require('../services/approval.service');
const { success, created } = require('../utils/apiResponse');

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @desc    Create approval request
 * @route   POST /api/v1/approvals
 * @access  Private
 */
exports.createApprovalRequest = asyncHandler(async (req, res) => {
  const request = await approvalService.createApprovalRequest(
    req.user.id,
    req.user.businessId,
    req.body
  );
  return created(res, request, 'Approval request created');
});

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @desc    Get pending approvals for current user
 * @route   GET /api/v1/approvals/pending
 * @access  Private
 */
exports.getPendingApprovals = asyncHandler(async (req, res) => {
  const result = await approvalService.getPendingApprovals(req.user.id, req.query);
  return success(res, result);
});

/**
 * @desc    Get my submitted requests
 * @route   GET /api/v1/approvals/my-requests
 * @access  Private
 */
exports.getMyRequests = asyncHandler(async (req, res) => {
  const result = await approvalService.getMyRequests(req.user.id, req.query);
  return success(res, result);
});

/**
 * @desc    Get approval statistics
 * @route   GET /api/v1/approvals/stats
 * @access  Private
 */
exports.getApprovalStats = asyncHandler(async (req, res) => {
  const stats = await approvalService.getApprovalStats(req.user.businessId);
  return success(res, stats);
});

/**
 * @desc    Get approval request by ID
 * @route   GET /api/v1/approvals/:requestId
 * @access  Private
 */
exports.getApprovalById = asyncHandler(async (req, res) => {
  const request = await approvalService.getApprovalById(
    req.params.requestId,
    req.user.id
  );
  return success(res, request);
});

/**
 * @desc    Get approval history for reference
 * @route   GET /api/v1/approvals/history/:referenceType/:referenceId
 * @access  Private
 */
exports.getApprovalHistory = asyncHandler(async (req, res) => {
  const history = await approvalService.getApprovalHistory(
    req.params.referenceType,
    req.params.referenceId
  );
  return success(res, history);
});

// =============================================================================
// WORKFLOW OPERATIONS
// =============================================================================

/**
 * @desc    Approve request
 * @route   POST /api/v1/approvals/:requestId/approve
 * @access  Private
 */
exports.approveRequest = asyncHandler(async (req, res) => {
  const request = await approvalService.approveRequest(
    req.user.id,
    req.params.requestId,
    req.body.comments
  );
  return success(res, request, 'Request approved');
});

/**
 * @desc    Reject request
 * @route   POST /api/v1/approvals/:requestId/reject
 * @access  Private
 */
exports.rejectRequest = asyncHandler(async (req, res) => {
  const request = await approvalService.rejectRequest(
    req.user.id,
    req.params.requestId,
    req.body.reason
  );
  return success(res, request, 'Request rejected');
});

/**
 * @desc    Escalate request
 * @route   POST /api/v1/approvals/:requestId/escalate
 * @access  Private
 */
exports.escalateRequest = asyncHandler(async (req, res) => {
  const request = await approvalService.escalateRequest(
    req.user.id,
    req.params.requestId,
    req.body.escalateToId,
    req.body.reason
  );
  return success(res, request, 'Request escalated');
});

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * @desc    Cancel approval request
 * @route   DELETE /api/v1/approvals/:requestId
 * @access  Private
 */
exports.cancelRequest = asyncHandler(async (req, res) => {
  const request = await approvalService.cancelRequest(
    req.user.id,
    req.params.requestId,
    req.body.reason
  );
  return success(res, request, 'Request cancelled');
});

module.exports = exports;



