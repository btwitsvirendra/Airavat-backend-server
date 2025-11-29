// =============================================================================
// AIRAVAT B2B MARKETPLACE - PURCHASE REQUISITION ROUTES
// Routes for internal purchase request workflows
// =============================================================================

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const requisitionController = require('../controllers/requisition.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const createRequisitionValidation = [
  body('title').notEmpty().withMessage('Title is required'),
  body('items').isArray({ min: 1 }).withMessage('At least one item required'),
  body('items.*.description').notEmpty().withMessage('Item description required'),
  body('items.*.quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('items.*.estimatedPrice').isDecimal({ min: 0 }).withMessage('Valid price required'),
  body('requiredBy').optional().isISO8601(),
  body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
];

const updateRequisitionValidation = [
  param('id').isUUID().withMessage('Valid requisition ID required'),
  body('title').optional().notEmpty(),
  body('priority').optional().isIn(['LOW', 'MEDIUM', 'HIGH', 'URGENT']),
];

const addItemValidation = [
  param('id').isUUID().withMessage('Valid requisition ID required'),
  body('description').notEmpty().withMessage('Description required'),
  body('quantity').isInt({ min: 1 }).withMessage('Quantity must be at least 1'),
  body('estimatedPrice').isDecimal({ min: 0 }).withMessage('Valid price required'),
];

// =============================================================================
// REQUISITION ROUTES
// =============================================================================

router.post(
  '/',
  authenticate,
  createRequisitionValidation,
  validate,
  requisitionController.createRequisition
);

router.get(
  '/',
  authenticate,
  requisitionController.getRequisitions
);

router.get(
  '/pending-approvals',
  authenticate,
  requisitionController.getPendingApprovals
);

router.get(
  '/analytics',
  authenticate,
  requisitionController.getAnalytics
);

router.get(
  '/:id',
  authenticate,
  param('id').isUUID(),
  validate,
  requisitionController.getRequisitionById
);

router.put(
  '/:id',
  authenticate,
  updateRequisitionValidation,
  validate,
  requisitionController.updateRequisition
);

router.post(
  '/:id/submit',
  authenticate,
  param('id').isUUID(),
  validate,
  requisitionController.submitRequisition
);

router.post(
  '/:id/approve',
  authenticate,
  param('id').isUUID(),
  body('notes').optional().isString(),
  validate,
  requisitionController.approveRequisition
);

router.post(
  '/:id/reject',
  authenticate,
  param('id').isUUID(),
  body('reason').notEmpty().withMessage('Rejection reason required'),
  validate,
  requisitionController.rejectRequisition
);

router.post(
  '/:id/convert-to-rfq',
  authenticate,
  param('id').isUUID(),
  validate,
  requisitionController.convertToRfq
);

router.post(
  '/:id/convert-to-order',
  authenticate,
  param('id').isUUID(),
  validate,
  requisitionController.convertToOrder
);

router.post(
  '/:id/items',
  authenticate,
  addItemValidation,
  validate,
  requisitionController.addItem
);

router.delete(
  '/:id/items/:itemId',
  authenticate,
  param('id').isUUID(),
  param('itemId').isUUID(),
  validate,
  requisitionController.removeItem
);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;



