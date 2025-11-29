// =============================================================================
// AIRAVAT B2B MARKETPLACE - CONTRACT ROUTES
// Routes for contract management endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const contractController = require('../controllers/contract.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// All routes require authentication
router.use(authenticate);

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @route   GET /api/v1/contracts
 * @desc    Get contracts list
 */
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn([
      'DRAFT', 'PENDING_APPROVAL', 'NEGOTIATION', 'PENDING_SIGNATURE',
      'ACTIVE', 'SUSPENDED', 'EXPIRED', 'TERMINATED', 'RENEWED',
    ]),
    query('type').optional().isIn([
      'SUPPLY_AGREEMENT', 'EXCLUSIVE_DISTRIBUTION', 'FRAMEWORK_AGREEMENT',
      'ANNUAL_PURCHASE', 'CONSIGNMENT', 'SERVICE_LEVEL',
    ]),
    query('role').optional().isIn(['buyer', 'seller']),
  ],
  validate,
  contractController.getContracts
);

/**
 * @route   GET /api/v1/contracts/stats
 * @desc    Get contract statistics
 */
router.get('/stats', contractController.getContractStats);

/**
 * @route   GET /api/v1/contracts/:contractId
 * @desc    Get contract by ID
 */
router.get(
  '/:contractId',
  [param('contractId').notEmpty().withMessage('Contract ID is required')],
  validate,
  contractController.getContractById
);

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @route   POST /api/v1/contracts
 * @desc    Create contract draft
 */
router.post(
  '/',
  [
    body('partnerId').notEmpty().withMessage('Partner ID is required'),
    body('title')
      .notEmpty()
      .withMessage('Title is required')
      .isLength({ max: 200 }),
    body('description').optional().isLength({ max: 2000 }),
    body('type').optional().isIn([
      'SUPPLY_AGREEMENT', 'EXCLUSIVE_DISTRIBUTION', 'FRAMEWORK_AGREEMENT',
      'ANNUAL_PURCHASE', 'CONSIGNMENT', 'SERVICE_LEVEL',
    ]),
    body('role').optional().isIn(['buyer', 'seller']),
    body('startDate').isISO8601().withMessage('Valid start date required'),
    body('endDate').isISO8601().withMessage('Valid end date required'),
    body('autoRenew').optional().isBoolean(),
    body('renewalTermDays').optional().isInt({ min: 1, max: 365 }),
    body('terms').notEmpty().withMessage('Terms are required'),
    body('pricing').notEmpty().withMessage('Pricing is required'),
    body('totalValue').optional().isFloat({ min: 0 }),
    body('minOrderValue').optional().isFloat({ min: 0 }),
    body('maxOrderValue').optional().isFloat({ min: 0 }),
  ],
  validate,
  contractController.createContract
);

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * @route   PATCH /api/v1/contracts/:contractId
 * @desc    Update contract
 */
router.patch(
  '/:contractId',
  [
    param('contractId').notEmpty().withMessage('Contract ID is required'),
    body('title').optional().isLength({ max: 200 }),
    body('description').optional().isLength({ max: 2000 }),
  ],
  validate,
  contractController.updateContract
);

// =============================================================================
// WORKFLOW OPERATIONS
// =============================================================================

/**
 * @route   POST /api/v1/contracts/:contractId/submit
 * @desc    Submit contract for approval
 */
router.post(
  '/:contractId/submit',
  [param('contractId').notEmpty().withMessage('Contract ID is required')],
  validate,
  contractController.submitForApproval
);

/**
 * @route   POST /api/v1/contracts/:contractId/respond
 * @desc    Respond to contract
 */
router.post(
  '/:contractId/respond',
  [
    param('contractId').notEmpty().withMessage('Contract ID is required'),
    body('action')
      .isIn(['approve', 'reject', 'negotiate'])
      .withMessage('Action must be approve, reject, or negotiate'),
    body('comments').optional().isLength({ max: 1000 }),
  ],
  validate,
  contractController.respondToContract
);

/**
 * @route   POST /api/v1/contracts/:contractId/sign
 * @desc    Sign contract
 */
router.post(
  '/:contractId/sign',
  [param('contractId').notEmpty().withMessage('Contract ID is required')],
  validate,
  contractController.signContract
);

/**
 * @route   POST /api/v1/contracts/:contractId/terminate
 * @desc    Terminate contract
 */
router.post(
  '/:contractId/terminate',
  [
    param('contractId').notEmpty().withMessage('Contract ID is required'),
    body('reason').notEmpty().withMessage('Termination reason is required'),
  ],
  validate,
  contractController.terminateContract
);

/**
 * @route   POST /api/v1/contracts/:contractId/renew
 * @desc    Renew contract
 */
router.post(
  '/:contractId/renew',
  [
    param('contractId').notEmpty().withMessage('Contract ID is required'),
    body('newEndDate').isISO8601().withMessage('Valid end date required'),
  ],
  validate,
  contractController.renewContract
);

module.exports = router;
