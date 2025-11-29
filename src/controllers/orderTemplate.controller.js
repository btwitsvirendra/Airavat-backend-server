// =============================================================================
// AIRAVAT B2B MARKETPLACE - ORDER TEMPLATE CONTROLLER
// Controller for order template management endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const orderTemplateService = require('../services/orderTemplate.service');
const { success, created } = require('../utils/apiResponse');

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @desc    Create order template
 * @route   POST /api/v1/order-templates
 * @access  Private
 */
exports.createTemplate = asyncHandler(async (req, res) => {
  const template = await orderTemplateService.createTemplate(
    req.user.id,
    req.user.businessId,
    req.body
  );
  return created(res, template, 'Order template created');
});

/**
 * @desc    Create template from order
 * @route   POST /api/v1/order-templates/from-order/:orderId
 * @access  Private
 */
exports.createFromOrder = asyncHandler(async (req, res) => {
  const template = await orderTemplateService.createFromOrder(
    req.user.id,
    req.user.businessId,
    req.params.orderId,
    req.body.name
  );
  return created(res, template, 'Template created from order');
});

/**
 * @desc    Duplicate template
 * @route   POST /api/v1/order-templates/:templateId/duplicate
 * @access  Private
 */
exports.duplicateTemplate = asyncHandler(async (req, res) => {
  const template = await orderTemplateService.duplicateTemplate(
    req.user.id,
    req.params.templateId,
    req.body.name
  );
  return created(res, template, 'Template duplicated');
});

/**
 * @desc    Add item to template
 * @route   POST /api/v1/order-templates/:templateId/items
 * @access  Private
 */
exports.addItemToTemplate = asyncHandler(async (req, res) => {
  const item = await orderTemplateService.addItemToTemplate(
    req.user.id,
    req.params.templateId,
    req.body
  );
  return created(res, item, 'Item added to template');
});

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @desc    Get all templates
 * @route   GET /api/v1/order-templates
 * @access  Private
 */
exports.getTemplates = asyncHandler(async (req, res) => {
  const result = await orderTemplateService.getTemplates(req.user.id, req.query);
  return success(res, result);
});

/**
 * @desc    Get template by ID
 * @route   GET /api/v1/order-templates/:templateId
 * @access  Private
 */
exports.getTemplateById = asyncHandler(async (req, res) => {
  const template = await orderTemplateService.getTemplateById(
    req.user.id,
    req.params.templateId
  );
  return success(res, template);
});

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * @desc    Update template
 * @route   PATCH /api/v1/order-templates/:templateId
 * @access  Private
 */
exports.updateTemplate = asyncHandler(async (req, res) => {
  const template = await orderTemplateService.updateTemplate(
    req.user.id,
    req.params.templateId,
    req.body
  );
  return success(res, template, 'Template updated');
});

/**
 * @desc    Update template item
 * @route   PATCH /api/v1/order-templates/:templateId/items/:itemId
 * @access  Private
 */
exports.updateTemplateItem = asyncHandler(async (req, res) => {
  const item = await orderTemplateService.updateTemplateItem(
    req.user.id,
    req.params.templateId,
    req.params.itemId,
    req.body
  );
  return success(res, item, 'Item updated');
});

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * @desc    Delete template
 * @route   DELETE /api/v1/order-templates/:templateId
 * @access  Private
 */
exports.deleteTemplate = asyncHandler(async (req, res) => {
  await orderTemplateService.deleteTemplate(req.user.id, req.params.templateId);
  return success(res, null, 'Template deleted');
});

/**
 * @desc    Remove item from template
 * @route   DELETE /api/v1/order-templates/:templateId/items/:itemId
 * @access  Private
 */
exports.removeItemFromTemplate = asyncHandler(async (req, res) => {
  await orderTemplateService.removeItemFromTemplate(
    req.user.id,
    req.params.templateId,
    req.params.itemId
  );
  return success(res, null, 'Item removed');
});

module.exports = exports;
