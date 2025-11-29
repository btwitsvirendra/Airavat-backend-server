// =============================================================================
// AIRAVAT B2B MARKETPLACE - VERIFIED BADGE ROUTES
// Routes for business verification badges
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const badgeController = require('../controllers/badge.controller');
const { protect, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/badges/types
 * @desc    Get available badge types
 */
router.get('/types', badgeController.getBadgeTypes);

/**
 * @route   GET /api/v1/badges/business/:businessId
 * @desc    Get public badges for a business
 */
router.get(
  '/business/:businessId',
  [param('businessId').notEmpty().withMessage('Business ID is required')],
  validate,
  badgeController.getBusinessPublicBadges
);

// =============================================================================
// AUTHENTICATED ROUTES
// =============================================================================

router.use(protect);

/**
 * @route   GET /api/v1/badges/my-badges
 * @desc    Get my business badges
 */
router.get(
  '/my-badges',
  [
    query('includeExpired').optional().isBoolean(),
    query('includeRevoked').optional().isBoolean(),
  ],
  validate,
  badgeController.getMyBadges
);

/**
 * @route   GET /api/v1/badges/eligibility
 * @desc    Get badge eligibility for my business
 */
router.get('/eligibility', badgeController.getMyEligibility);

/**
 * @route   POST /api/v1/badges/request
 * @desc    Request badge verification
 */
router.post(
  '/request',
  [
    body('badgeType').notEmpty().withMessage('Badge type is required'),
    body('documents').optional().isObject(),
  ],
  validate,
  badgeController.requestVerification
);

/**
 * @route   POST /api/v1/badges/auto-verify
 * @desc    Trigger auto-verification check
 */
router.post('/auto-verify', badgeController.triggerAutoVerification);

// =============================================================================
// ADMIN ROUTES
// =============================================================================

/**
 * @route   POST /api/v1/badges/admin/assign
 * @desc    Assign badge to business (Admin)
 */
router.post(
  '/admin/assign',
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    body('businessId').notEmpty().withMessage('Business ID is required'),
    body('badgeType').notEmpty().withMessage('Badge type is required'),
    body('expiresAt').optional().isISO8601(),
    body('metadata').optional().isObject(),
    body('documents').optional().isArray(),
  ],
  validate,
  badgeController.assignBadge
);

/**
 * @route   POST /api/v1/badges/admin/revoke
 * @desc    Revoke badge from business (Admin)
 */
router.post(
  '/admin/revoke',
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    body('businessId').notEmpty().withMessage('Business ID is required'),
    body('badgeType').notEmpty().withMessage('Badge type is required'),
    body('reason').notEmpty().withMessage('Revocation reason is required'),
  ],
  validate,
  badgeController.revokeBadge
);

/**
 * @route   GET /api/v1/badges/admin/requests
 * @desc    Get pending verification requests (Admin)
 */
router.get(
  '/admin/requests',
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isString(),
  ],
  validate,
  badgeController.getPendingRequests
);

/**
 * @route   POST /api/v1/badges/admin/requests/:requestId/process
 * @desc    Process verification request (Admin)
 */
router.post(
  '/admin/requests/:requestId/process',
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    param('requestId').notEmpty().withMessage('Request ID is required'),
    body('decision')
      .isIn(['APPROVED', 'REJECTED'])
      .withMessage('Decision must be APPROVED or REJECTED'),
    body('notes').optional().isString(),
  ],
  validate,
  badgeController.processVerificationRequest
);

/**
 * @route   GET /api/v1/badges/admin/business/:businessId
 * @desc    Get all badges for business (Admin)
 */
router.get(
  '/admin/business/:businessId',
  authorize('ADMIN', 'SUPER_ADMIN'),
  [param('businessId').notEmpty().withMessage('Business ID is required')],
  validate,
  badgeController.getBusinessBadgesAdmin
);

module.exports = router;



