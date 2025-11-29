// =============================================================================
// AIRAVAT B2B MARKETPLACE - ORDER TEMPLATE ROUTES
// Routes for order template management endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const orderTemplateController = require('../controllers/orderTemplate.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// All routes require authentication
router.use(authenticate);

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @route   GET /api/v1/order-templates
 * @desc    Get all templates
 */
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
  ],
  validate,
  orderTemplateController.getTemplates
);

/**
 * @route   GET /api/v1/order-templates/:templateId
 * @desc    Get template by ID
 */
router.get(
  '/:templateId',
  [param('templateId').notEmpty().withMessage('Template ID is required')],
  validate,
  orderTemplateController.getTemplateById
);

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @route   POST /api/v1/order-templates
 * @desc    Create order template
 */
router.post(
  '/',
  [
    body('name')
      .notEmpty()
      .withMessage('Name is required')
      .isLength({ max: 100 })
      .withMessage('Name max 100 characters'),
    body('description').optional().isLength({ max: 500 }),
    body('items')
      .isArray({ min: 1 })
      .withMessage('At least one item is required'),
    body('items.*.productId').notEmpty().withMessage('Product ID required for each item'),
    body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be positive'),
    body('isDefault').optional().isBoolean(),
  ],
  validate,
  orderTemplateController.createTemplate
);

/**
 * @route   POST /api/v1/order-templates/from-order/:orderId
 * @desc    Create template from order
 */
router.post(
  '/from-order/:orderId',
  [
    param('orderId').notEmpty().withMessage('Order ID is required'),
    body('name').optional().isLength({ max: 100 }),
  ],
  validate,
  orderTemplateController.createFromOrder
);

/**
 * @route   POST /api/v1/order-templates/:templateId/duplicate
 * @desc    Duplicate template
 */
router.post(
  '/:templateId/duplicate',
  [
    param('templateId').notEmpty().withMessage('Template ID is required'),
    body('name').optional().isLength({ max: 100 }),
  ],
  validate,
  orderTemplateController.duplicateTemplate
);

/**
 * @route   POST /api/v1/order-templates/:templateId/items
 * @desc    Add item to template
 */
router.post(
  '/:templateId/items',
  [
    param('templateId').notEmpty().withMessage('Template ID is required'),
    body('productId').notEmpty().withMessage('Product ID is required'),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be positive'),
    body('notes').optional().isLength({ max: 500 }),
  ],
  validate,
  orderTemplateController.addItemToTemplate
);

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * @route   PATCH /api/v1/order-templates/:templateId
 * @desc    Update template
 */
router.patch(
  '/:templateId',
  [
    param('templateId').notEmpty().withMessage('Template ID is required'),
    body('name').optional().isLength({ max: 100 }),
    body('description').optional().isLength({ max: 500 }),
    body('isDefault').optional().isBoolean(),
  ],
  validate,
  orderTemplateController.updateTemplate
);

/**
 * @route   PATCH /api/v1/order-templates/:templateId/items/:itemId
 * @desc    Update template item
 */
router.patch(
  '/:templateId/items/:itemId',
  [
    param('templateId').notEmpty().withMessage('Template ID is required'),
    param('itemId').notEmpty().withMessage('Item ID is required'),
    body('quantity').optional().isInt({ min: 1 }),
    body('notes').optional().isLength({ max: 500 }),
  ],
  validate,
  orderTemplateController.updateTemplateItem
);

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * @route   DELETE /api/v1/order-templates/:templateId
 * @desc    Delete template
 */
router.delete(
  '/:templateId',
  [param('templateId').notEmpty().withMessage('Template ID is required')],
  validate,
  orderTemplateController.deleteTemplate
);

/**
 * @route   DELETE /api/v1/order-templates/:templateId/items/:itemId
 * @desc    Remove item from template
 */
router.delete(
  '/:templateId/items/:itemId',
  [
    param('templateId').notEmpty().withMessage('Template ID is required'),
    param('itemId').notEmpty().withMessage('Item ID is required'),
  ],
  validate,
  orderTemplateController.removeItemFromTemplate
);

module.exports = router;
