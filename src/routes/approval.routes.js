// =============================================================================
// AIRAVAT B2B MARKETPLACE - APPROVAL ROUTES
// Routes for approval workflow endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const approvalController = require('../controllers/approval.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// All routes require authentication
router.use(authenticate);

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @route   GET /api/v1/approvals/pending
 * @desc    Get pending approvals for current user
 */
router.get(
  '/pending',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('type').optional().isIn([
      'ORDER', 'PURCHASE_ORDER', 'QUOTATION', 'CONTRACT',
      'PAYMENT', 'REFUND', 'CREDIT_REQUEST', 'VENDOR_ONBOARD',
      'PRICE_CHANGE', 'DISCOUNT',
    ]),
    query('priority').optional().isIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
  ],
  validate,
  approvalController.getPendingApprovals
);

/**
 * @route   GET /api/v1/approvals/my-requests
 * @desc    Get my submitted requests
 */
router.get(
  '/my-requests',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn([
      'PENDING', 'IN_PROGRESS', 'APPROVED', 'REJECTED', 'CANCELLED', 'ESCALATED',
    ]),
    query('type').optional(),
  ],
  validate,
  approvalController.getMyRequests
);

/**
 * @route   GET /api/v1/approvals/stats
 * @desc    Get approval statistics
 */
router.get('/stats', approvalController.getApprovalStats);

/**
 * @route   GET /api/v1/approvals/history/:referenceType/:referenceId
 * @desc    Get approval history for reference
 */
router.get(
  '/history/:referenceType/:referenceId',
  [
    param('referenceType').notEmpty().withMessage('Reference type is required'),
    param('referenceId').notEmpty().withMessage('Reference ID is required'),
  ],
  validate,
  approvalController.getApprovalHistory
);

/**
 * @route   GET /api/v1/approvals/:requestId
 * @desc    Get approval request by ID
 */
router.get(
  '/:requestId',
  [param('requestId').notEmpty().withMessage('Request ID is required')],
  validate,
  approvalController.getApprovalById
);

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @route   POST /api/v1/approvals
 * @desc    Create approval request
 */
router.post(
  '/',
  [
    body('type')
      .isIn([
        'ORDER', 'PURCHASE_ORDER', 'QUOTATION', 'CONTRACT',
        'PAYMENT', 'REFUND', 'CREDIT_REQUEST', 'VENDOR_ONBOARD',
        'PRICE_CHANGE', 'DISCOUNT',
      ])
      .withMessage('Valid approval type is required'),
    body('referenceId').notEmpty().withMessage('Reference ID is required'),
    body('referenceType').notEmpty().withMessage('Reference type is required'),
    body('title')
      .notEmpty()
      .withMessage('Title is required')
      .isLength({ max: 200 }),
    body('description').optional().isLength({ max: 1000 }),
    body('amount').optional().isFloat({ min: 0 }),
    body('priority').optional().isIn(['LOW', 'NORMAL', 'HIGH', 'URGENT']),
    body('approvers')
      .isArray({ min: 1 })
      .withMessage('At least one approver is required'),
    body('approvers.*').notEmpty().withMessage('Approver ID cannot be empty'),
    body('dueDate').optional().isISO8601(),
  ],
  validate,
  approvalController.createApprovalRequest
);

// =============================================================================
// WORKFLOW OPERATIONS
// =============================================================================

/**
 * @route   POST /api/v1/approvals/:requestId/approve
 * @desc    Approve request
 */
router.post(
  '/:requestId/approve',
  [
    param('requestId').notEmpty().withMessage('Request ID is required'),
    body('comments').optional().isLength({ max: 1000 }),
  ],
  validate,
  approvalController.approveRequest
);

/**
 * @route   POST /api/v1/approvals/:requestId/reject
 * @desc    Reject request
 */
router.post(
  '/:requestId/reject',
  [
    param('requestId').notEmpty().withMessage('Request ID is required'),
    body('reason').notEmpty().withMessage('Rejection reason is required'),
  ],
  validate,
  approvalController.rejectRequest
);

/**
 * @route   POST /api/v1/approvals/:requestId/escalate
 * @desc    Escalate request
 */
router.post(
  '/:requestId/escalate',
  [
    param('requestId').notEmpty().withMessage('Request ID is required'),
    body('escalateToId').notEmpty().withMessage('Escalation target is required'),
    body('reason').notEmpty().withMessage('Escalation reason is required'),
  ],
  validate,
  approvalController.escalateRequest
);

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * @route   DELETE /api/v1/approvals/:requestId
 * @desc    Cancel approval request
 */
router.delete(
  '/:requestId',
  [
    param('requestId').notEmpty().withMessage('Request ID is required'),
    body('reason').optional().isLength({ max: 500 }),
  ],
  validate,
  approvalController.cancelRequest
);

module.exports = router;
