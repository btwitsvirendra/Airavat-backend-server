// =============================================================================
// AIRAVAT B2B MARKETPLACE - DISPUTE ROUTES
// Routes for order dispute management and resolution
// =============================================================================

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const disputeController = require('../controllers/dispute.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const raiseDisputeValidation = [
  body('orderId').isUUID(),
  body('category').notEmpty().isString(),
  body('title').notEmpty().trim().isLength({ min: 5, max: 200 }),
  body('description').notEmpty().isLength({ min: 20 }),
  body('claimAmount').optional().isDecimal({ min: 0 }),
  body('expectedResolution').optional().isString(),
];

const respondValidation = [
  param('id').isUUID(),
  body('response').notEmpty().isLength({ min: 20 }),
  body('proposedResolution').optional().isString(),
  body('counterOfferAmount').optional().isDecimal({ min: 0 }),
];

const evidenceValidation = [
  param('id').isUUID(),
  body('type').isIn(['IMAGE', 'DOCUMENT', 'VIDEO']),
  body('url').isURL(),
  body('description').optional().isString(),
];

const messageValidation = [
  param('id').isUUID(),
  body('content').notEmpty().isLength({ min: 1, max: 2000 }),
  body('attachments').optional().isArray(),
];

const resolveValidation = [
  param('id').isUUID(),
  body('resolution').notEmpty().isString(),
  body('resolutionAmount').optional().isDecimal({ min: 0 }),
  body('favoredParty').isIn(['BUYER', 'SELLER', 'BOTH', 'NONE']),
  body('notes').optional().isString(),
];

// =============================================================================
// USER ROUTES
// =============================================================================

router.get('/categories', disputeController.getCategories);

router.post(
  '/',
  authenticate,
  raiseDisputeValidation,
  validate,
  disputeController.raiseDispute
);

router.get(
  '/',
  authenticate,
  disputeController.getDisputes
);

router.get(
  '/:id',
  authenticate,
  param('id').isUUID(),
  validate,
  disputeController.getDisputeById
);

router.post(
  '/:id/respond',
  authenticate,
  respondValidation,
  validate,
  disputeController.respondToDispute
);

router.post(
  '/:id/accept-resolution',
  authenticate,
  param('id').isUUID(),
  validate,
  disputeController.acceptResolution
);

router.post(
  '/:id/reject-resolution',
  authenticate,
  param('id').isUUID(),
  body('reason').notEmpty(),
  validate,
  disputeController.rejectResolution
);

router.post(
  '/:id/escalate',
  authenticate,
  param('id').isUUID(),
  body('reason').notEmpty(),
  validate,
  disputeController.escalateDispute
);

router.post(
  '/:id/close',
  authenticate,
  param('id').isUUID(),
  validate,
  disputeController.closeDispute
);

// =============================================================================
// EVIDENCE ROUTES
// =============================================================================

router.post(
  '/:id/evidence',
  authenticate,
  evidenceValidation,
  validate,
  disputeController.addEvidence
);

router.get(
  '/:id/evidence',
  authenticate,
  param('id').isUUID(),
  validate,
  disputeController.getEvidence
);

// =============================================================================
// MESSAGING ROUTES
// =============================================================================

router.post(
  '/:id/messages',
  authenticate,
  messageValidation,
  validate,
  disputeController.sendMessage
);

router.get(
  '/:id/messages',
  authenticate,
  param('id').isUUID(),
  validate,
  disputeController.getMessages
);

// =============================================================================
// TIMELINE
// =============================================================================

router.get(
  '/:id/timeline',
  authenticate,
  param('id').isUUID(),
  validate,
  disputeController.getTimeline
);

// =============================================================================
// ADMIN ROUTES
// =============================================================================

router.get(
  '/admin/all',
  authenticate,
  authorize('admin'),
  disputeController.getAllDisputes
);

router.get(
  '/admin/stats',
  authenticate,
  authorize('admin'),
  disputeController.getDisputeStats
);

router.post(
  '/admin/:id/assign',
  authenticate,
  authorize('admin'),
  param('id').isUUID(),
  body('adminId').optional().isUUID(),
  validate,
  disputeController.assignDispute
);

router.post(
  '/admin/:id/resolve',
  authenticate,
  authorize('admin'),
  resolveValidation,
  validate,
  disputeController.resolveDispute
);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;



