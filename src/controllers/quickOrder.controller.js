// =============================================================================
// AIRAVAT B2B MARKETPLACE - QUICK ORDER CONTROLLER
// Controller for quick order and reordering endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const quickOrderService = require('../services/quickOrder.service');
const { success, created } = require('../utils/apiResponse');

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @desc    Create quick order from template
 * @route   POST /api/v1/quick-orders/from-template/:templateId
 * @access  Private
 */
exports.createFromTemplate = asyncHandler(async (req, res) => {
  const quickOrder = await quickOrderService.createFromTemplate(
    req.user.id,
    req.user.businessId,
    req.params.templateId
  );
  return created(res, quickOrder, 'Quick order created from template');
});

/**
 * @desc    Create quick order from previous order (reorder)
 * @route   POST /api/v1/quick-orders/from-order/:orderId
 * @access  Private
 */
exports.createFromOrder = asyncHandler(async (req, res) => {
  const quickOrder = await quickOrderService.createFromOrder(
    req.user.id,
    req.user.businessId,
    req.params.orderId
  );
  return created(res, quickOrder, 'Quick order created (reorder)');
});

/**
 * @desc    Create quick order from cart
 * @route   POST /api/v1/quick-orders/from-cart
 * @access  Private
 */
exports.createFromCart = asyncHandler(async (req, res) => {
  const quickOrder = await quickOrderService.createFromCart(
    req.user.id,
    req.user.businessId
  );
  return created(res, quickOrder, 'Quick order created from cart');
});

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @desc    Get quick orders
 * @route   GET /api/v1/quick-orders
 * @access  Private
 */
exports.getQuickOrders = asyncHandler(async (req, res) => {
  const result = await quickOrderService.getQuickOrders(req.user.id, req.query);
  return success(res, result);
});

/**
 * @desc    Get quick order by ID
 * @route   GET /api/v1/quick-orders/:quickOrderId
 * @access  Private
 */
exports.getQuickOrder = asyncHandler(async (req, res) => {
  const quickOrder = await quickOrderService.getQuickOrder(
    req.user.id,
    req.params.quickOrderId
  );
  return success(res, quickOrder);
});

/**
 * @desc    Get reorder suggestions
 * @route   GET /api/v1/quick-orders/suggestions
 * @access  Private
 */
exports.getReorderSuggestions = asyncHandler(async (req, res) => {
  const suggestions = await quickOrderService.getReorderSuggestions(
    req.user.id,
    req.user.businessId,
    parseInt(req.query.limit) || 5
  );
  return success(res, suggestions);
});

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * @desc    Update quick order item
 * @route   PATCH /api/v1/quick-orders/:quickOrderId/items/:itemId
 * @access  Private
 */
exports.updateQuickOrderItem = asyncHandler(async (req, res) => {
  const quickOrder = await quickOrderService.updateQuickOrderItem(
    req.user.id,
    req.params.quickOrderId,
    req.params.itemId,
    req.body
  );
  return success(res, quickOrder, 'Item updated');
});

// =============================================================================
// BUSINESS LOGIC OPERATIONS
// =============================================================================

/**
 * @desc    Convert quick order to actual order
 * @route   POST /api/v1/quick-orders/:quickOrderId/convert
 * @access  Private
 */
exports.convertToOrder = asyncHandler(async (req, res) => {
  const result = await quickOrderService.convertToOrder(
    req.user.id,
    req.user.businessId,
    req.params.quickOrderId,
    req.body
  );
  return success(res, result, 'Quick order converted to order');
});

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * @desc    Cancel quick order
 * @route   DELETE /api/v1/quick-orders/:quickOrderId
 * @access  Private
 */
exports.cancelQuickOrder = asyncHandler(async (req, res) => {
  await quickOrderService.cancelQuickOrder(req.user.id, req.params.quickOrderId);
  return success(res, null, 'Quick order cancelled');
});

module.exports = exports;
