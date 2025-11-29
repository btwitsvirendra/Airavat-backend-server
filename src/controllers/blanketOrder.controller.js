// =============================================================================
// AIRAVAT B2B MARKETPLACE - BLANKET ORDER CONTROLLER
// Handles standing purchase order management
// =============================================================================

const blanketOrderService = require('../services/blanketOrder.service');
const asyncHandler = require('../middleware/async.middleware');
const { NotFoundError } = require('../utils/errors');

// =============================================================================
// BLANKET ORDER OPERATIONS
// =============================================================================

/**
 * Create a new blanket order
 * @route POST /api/v1/blanket-orders
 */
const createBlanketOrder = asyncHandler(async (req, res) => {
  const blanketOrder = await blanketOrderService.createBlanketOrder(
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Blanket order created successfully',
    data: blanketOrder,
  });
});

/**
 * Get blanket order by ID
 * @route GET /api/v1/blanket-orders/:id
 */
const getBlanketOrderById = asyncHandler(async (req, res) => {
  const blanketOrder = await blanketOrderService.getBlanketOrderById(
    req.params.id,
    req.user.id
  );

  if (!blanketOrder) {
    throw new NotFoundError('Blanket order not found');
  }

  res.json({
    success: true,
    data: blanketOrder,
  });
});

/**
 * Get all blanket orders for buyer
 * @route GET /api/v1/blanket-orders
 */
const getBlanketOrders = asyncHandler(async (req, res) => {
  const result = await blanketOrderService.getBlanketOrders(req.user.id, req.query);

  res.json({
    success: true,
    data: result.blanketOrders,
    pagination: result.pagination,
  });
});

/**
 * Update blanket order
 * @route PUT /api/v1/blanket-orders/:id
 */
const updateBlanketOrder = asyncHandler(async (req, res) => {
  const blanketOrder = await blanketOrderService.updateBlanketOrder(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Blanket order updated successfully',
    data: blanketOrder,
  });
});

/**
 * Submit blanket order for approval
 * @route POST /api/v1/blanket-orders/:id/submit
 */
const submitBlanketOrder = asyncHandler(async (req, res) => {
  const blanketOrder = await blanketOrderService.submitBlanketOrder(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Blanket order submitted for approval',
    data: blanketOrder,
  });
});

/**
 * Approve/reject blanket order (seller)
 * @route POST /api/v1/blanket-orders/:id/respond
 */
const respondToBlanketOrder = asyncHandler(async (req, res) => {
  const { action, notes } = req.body;
  const blanketOrder = await blanketOrderService.respondToBlanketOrder(
    req.params.id,
    req.user.id,
    action,
    notes
  );

  res.json({
    success: true,
    message: `Blanket order ${action.toLowerCase()}`,
    data: blanketOrder,
  });
});

/**
 * Create release from blanket order
 * @route POST /api/v1/blanket-orders/:id/releases
 */
const createRelease = asyncHandler(async (req, res) => {
  const release = await blanketOrderService.createRelease(
    req.params.id,
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Release created successfully',
    data: release,
  });
});

/**
 * Get releases for a blanket order
 * @route GET /api/v1/blanket-orders/:id/releases
 */
const getReleases = asyncHandler(async (req, res) => {
  const releases = await blanketOrderService.getReleases(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    data: releases,
  });
});

/**
 * Extend blanket order end date
 * @route POST /api/v1/blanket-orders/:id/extend
 */
const extendBlanketOrder = asyncHandler(async (req, res) => {
  const { newEndDate, reason } = req.body;
  const blanketOrder = await blanketOrderService.extendBlanketOrder(
    req.params.id,
    req.user.id,
    newEndDate,
    reason
  );

  res.json({
    success: true,
    message: 'Blanket order extended successfully',
    data: blanketOrder,
  });
});

/**
 * Cancel blanket order
 * @route POST /api/v1/blanket-orders/:id/cancel
 */
const cancelBlanketOrder = asyncHandler(async (req, res) => {
  const blanketOrder = await blanketOrderService.cancelBlanketOrder(
    req.params.id,
    req.user.id,
    req.body.reason
  );

  res.json({
    success: true,
    message: 'Blanket order cancelled',
    data: blanketOrder,
  });
});

/**
 * Get blanket order analytics
 * @route GET /api/v1/blanket-orders/analytics
 */
const getAnalytics = asyncHandler(async (req, res) => {
  const analytics = await blanketOrderService.getAnalytics(req.user.id);

  res.json({
    success: true,
    data: analytics,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  createBlanketOrder,
  getBlanketOrderById,
  getBlanketOrders,
  updateBlanketOrder,
  submitBlanketOrder,
  respondToBlanketOrder,
  createRelease,
  getReleases,
  extendBlanketOrder,
  cancelBlanketOrder,
  getAnalytics,
};



