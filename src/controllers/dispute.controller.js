// =============================================================================
// AIRAVAT B2B MARKETPLACE - DISPUTE RESOLUTION CONTROLLER
// Handles order disputes and resolution workflow
// =============================================================================

const disputeResolutionService = require('../services/disputeResolution.service');
const asyncHandler = require('../middleware/async.middleware');
const { NotFoundError } = require('../utils/errors');

// =============================================================================
// DISPUTE LIFECYCLE
// =============================================================================

/**
 * Raise a new dispute
 * @route POST /api/v1/disputes
 */
const raiseDispute = asyncHandler(async (req, res) => {
  const dispute = await disputeResolutionService.raiseDispute(
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Dispute raised successfully',
    data: dispute,
  });
});

/**
 * Get dispute by ID
 * @route GET /api/v1/disputes/:id
 */
const getDisputeById = asyncHandler(async (req, res) => {
  const dispute = await disputeResolutionService.getDisputeById(
    req.params.id,
    req.user.id
  );

  if (!dispute) {
    throw new NotFoundError('Dispute not found');
  }

  res.json({
    success: true,
    data: dispute,
  });
});

/**
 * Get all disputes for user
 * @route GET /api/v1/disputes
 */
const getDisputes = asyncHandler(async (req, res) => {
  const result = await disputeResolutionService.getDisputes(
    req.user.id,
    req.query
  );

  res.json({
    success: true,
    data: result.disputes,
    pagination: result.pagination,
  });
});

/**
 * Respond to a dispute (seller)
 * @route POST /api/v1/disputes/:id/respond
 */
const respondToDispute = asyncHandler(async (req, res) => {
  const dispute = await disputeResolutionService.respondToDispute(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Response submitted',
    data: dispute,
  });
});

/**
 * Accept seller's proposed resolution
 * @route POST /api/v1/disputes/:id/accept-resolution
 */
const acceptResolution = asyncHandler(async (req, res) => {
  const dispute = await disputeResolutionService.acceptResolution(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Resolution accepted',
    data: dispute,
  });
});

/**
 * Reject seller's proposed resolution
 * @route POST /api/v1/disputes/:id/reject-resolution
 */
const rejectResolution = asyncHandler(async (req, res) => {
  const dispute = await disputeResolutionService.rejectResolution(
    req.params.id,
    req.user.id,
    req.body.reason
  );

  res.json({
    success: true,
    message: 'Resolution rejected',
    data: dispute,
  });
});

/**
 * Escalate dispute to admin
 * @route POST /api/v1/disputes/:id/escalate
 */
const escalateDispute = asyncHandler(async (req, res) => {
  const dispute = await disputeResolutionService.escalateDispute(
    req.params.id,
    req.user.id,
    req.body.reason
  );

  res.json({
    success: true,
    message: 'Dispute escalated to admin',
    data: dispute,
  });
});

/**
 * Close dispute
 * @route POST /api/v1/disputes/:id/close
 */
const closeDispute = asyncHandler(async (req, res) => {
  const dispute = await disputeResolutionService.closeDispute(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Dispute closed',
    data: dispute,
  });
});

// =============================================================================
// EVIDENCE MANAGEMENT
// =============================================================================

/**
 * Add evidence to dispute
 * @route POST /api/v1/disputes/:id/evidence
 */
const addEvidence = asyncHandler(async (req, res) => {
  const evidence = await disputeResolutionService.addEvidence(
    req.params.id,
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Evidence added',
    data: evidence,
  });
});

/**
 * Get evidence for a dispute
 * @route GET /api/v1/disputes/:id/evidence
 */
const getEvidence = asyncHandler(async (req, res) => {
  const evidence = await disputeResolutionService.getEvidence(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    data: evidence,
  });
});

// =============================================================================
// MESSAGING
// =============================================================================

/**
 * Send message in dispute
 * @route POST /api/v1/disputes/:id/messages
 */
const sendMessage = asyncHandler(async (req, res) => {
  const message = await disputeResolutionService.sendMessage(
    req.params.id,
    req.user.id,
    req.body.content,
    req.body.attachments
  );

  res.status(201).json({
    success: true,
    message: 'Message sent',
    data: message,
  });
});

/**
 * Get dispute messages
 * @route GET /api/v1/disputes/:id/messages
 */
const getMessages = asyncHandler(async (req, res) => {
  const result = await disputeResolutionService.getMessages(
    req.params.id,
    req.user.id,
    req.query
  );

  res.json({
    success: true,
    data: result.messages,
    pagination: result.pagination,
  });
});

// =============================================================================
// TIMELINE & HISTORY
// =============================================================================

/**
 * Get dispute timeline
 * @route GET /api/v1/disputes/:id/timeline
 */
const getTimeline = asyncHandler(async (req, res) => {
  const timeline = await disputeResolutionService.getTimeline(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    data: timeline,
  });
});

// =============================================================================
// ADMIN OPERATIONS
// =============================================================================

/**
 * Get all disputes (admin)
 * @route GET /api/v1/admin/disputes
 */
const getAllDisputes = asyncHandler(async (req, res) => {
  const result = await disputeResolutionService.getAllDisputes(req.query);

  res.json({
    success: true,
    data: result.disputes,
    pagination: result.pagination,
  });
});

/**
 * Assign dispute to admin
 * @route POST /api/v1/admin/disputes/:id/assign
 */
const assignDispute = asyncHandler(async (req, res) => {
  const dispute = await disputeResolutionService.assignDispute(
    req.params.id,
    req.body.adminId || req.user.id
  );

  res.json({
    success: true,
    message: 'Dispute assigned',
    data: dispute,
  });
});

/**
 * Resolve dispute (admin)
 * @route POST /api/v1/admin/disputes/:id/resolve
 */
const resolveDispute = asyncHandler(async (req, res) => {
  const dispute = await disputeResolutionService.resolveDispute(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Dispute resolved',
    data: dispute,
  });
});

/**
 * Get dispute statistics (admin)
 * @route GET /api/v1/admin/disputes/stats
 */
const getDisputeStats = asyncHandler(async (req, res) => {
  const stats = await disputeResolutionService.getDisputeStats(req.query);

  res.json({
    success: true,
    data: stats,
  });
});

/**
 * Get dispute categories
 * @route GET /api/v1/disputes/categories
 */
const getCategories = asyncHandler(async (req, res) => {
  const categories = await disputeResolutionService.getCategories();

  res.json({
    success: true,
    data: categories,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  raiseDispute,
  getDisputeById,
  getDisputes,
  respondToDispute,
  acceptResolution,
  rejectResolution,
  escalateDispute,
  closeDispute,
  addEvidence,
  getEvidence,
  sendMessage,
  getMessages,
  getTimeline,
  getAllDisputes,
  assignDispute,
  resolveDispute,
  getDisputeStats,
  getCategories,
};



