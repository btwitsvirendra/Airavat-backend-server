// =============================================================================
// AIRAVAT B2B MARKETPLACE - PURCHASE REQUISITION CONTROLLER
// Handles internal purchase request workflows
// =============================================================================

const purchaseRequisitionService = require('../services/purchaseRequisition.service');
const asyncHandler = require('../middleware/async.middleware');
const { NotFoundError } = require('../utils/errors');

// =============================================================================
// REQUISITION OPERATIONS
// =============================================================================

/**
 * Create a new purchase requisition
 * @route POST /api/v1/requisitions
 */
const createRequisition = asyncHandler(async (req, res) => {
  const requisition = await purchaseRequisitionService.createRequisition(
    req.user.id,
    req.user.businessId,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Purchase requisition created successfully',
    data: requisition,
  });
});

/**
 * Get requisition by ID
 * @route GET /api/v1/requisitions/:id
 */
const getRequisitionById = asyncHandler(async (req, res) => {
  const requisition = await purchaseRequisitionService.getRequisitionById(
    req.params.id,
    req.user.businessId
  );

  if (!requisition) {
    throw new NotFoundError('Requisition not found');
  }

  res.json({
    success: true,
    data: requisition,
  });
});

/**
 * Get all requisitions for business
 * @route GET /api/v1/requisitions
 */
const getRequisitions = asyncHandler(async (req, res) => {
  const result = await purchaseRequisitionService.getRequisitions(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: result.requisitions,
    pagination: result.pagination,
  });
});

/**
 * Update requisition
 * @route PUT /api/v1/requisitions/:id
 */
const updateRequisition = asyncHandler(async (req, res) => {
  const requisition = await purchaseRequisitionService.updateRequisition(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Requisition updated successfully',
    data: requisition,
  });
});

/**
 * Submit requisition for approval
 * @route POST /api/v1/requisitions/:id/submit
 */
const submitRequisition = asyncHandler(async (req, res) => {
  const requisition = await purchaseRequisitionService.submitRequisition(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Requisition submitted for approval',
    data: requisition,
  });
});

/**
 * Approve requisition
 * @route POST /api/v1/requisitions/:id/approve
 */
const approveRequisition = asyncHandler(async (req, res) => {
  const requisition = await purchaseRequisitionService.approveRequisition(
    req.params.id,
    req.user.id,
    req.body.notes
  );

  res.json({
    success: true,
    message: 'Requisition approved',
    data: requisition,
  });
});

/**
 * Reject requisition
 * @route POST /api/v1/requisitions/:id/reject
 */
const rejectRequisition = asyncHandler(async (req, res) => {
  const requisition = await purchaseRequisitionService.rejectRequisition(
    req.params.id,
    req.user.id,
    req.body.reason
  );

  res.json({
    success: true,
    message: 'Requisition rejected',
    data: requisition,
  });
});

/**
 * Convert requisition to RFQ
 * @route POST /api/v1/requisitions/:id/convert-to-rfq
 */
const convertToRfq = asyncHandler(async (req, res) => {
  const rfq = await purchaseRequisitionService.convertToRfq(
    req.params.id,
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'RFQ created from requisition',
    data: rfq,
  });
});

/**
 * Convert requisition to direct order
 * @route POST /api/v1/requisitions/:id/convert-to-order
 */
const convertToOrder = asyncHandler(async (req, res) => {
  const order = await purchaseRequisitionService.convertToOrder(
    req.params.id,
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Order created from requisition',
    data: order,
  });
});

/**
 * Add item to requisition
 * @route POST /api/v1/requisitions/:id/items
 */
const addItem = asyncHandler(async (req, res) => {
  const requisition = await purchaseRequisitionService.addItem(
    req.params.id,
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Item added to requisition',
    data: requisition,
  });
});

/**
 * Remove item from requisition
 * @route DELETE /api/v1/requisitions/:id/items/:itemId
 */
const removeItem = asyncHandler(async (req, res) => {
  const requisition = await purchaseRequisitionService.removeItem(
    req.params.id,
    req.params.itemId,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Item removed from requisition',
    data: requisition,
  });
});

/**
 * Get pending approvals for user
 * @route GET /api/v1/requisitions/pending-approvals
 */
const getPendingApprovals = asyncHandler(async (req, res) => {
  const requisitions = await purchaseRequisitionService.getPendingApprovals(
    req.user.id,
    req.user.businessId
  );

  res.json({
    success: true,
    data: requisitions,
  });
});

/**
 * Get requisition analytics
 * @route GET /api/v1/requisitions/analytics
 */
const getAnalytics = asyncHandler(async (req, res) => {
  const analytics = await purchaseRequisitionService.getAnalytics(
    req.user.businessId
  );

  res.json({
    success: true,
    data: analytics,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  createRequisition,
  getRequisitionById,
  getRequisitions,
  updateRequisition,
  submitRequisition,
  approveRequisition,
  rejectRequisition,
  convertToRfq,
  convertToOrder,
  addItem,
  removeItem,
  getPendingApprovals,
  getAnalytics,
};



