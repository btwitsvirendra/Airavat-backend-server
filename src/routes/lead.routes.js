// =============================================================================
// AIRAVAT B2B MARKETPLACE - LEAD GENERATION ROUTES
// Routes for lead packages and lead marketplace
// =============================================================================

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const leadController = require('../controllers/lead.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

// =============================================================================
// LEAD PACKAGES
// =============================================================================

router.get('/packages', leadController.getPackages);

router.post(
  '/packages/purchase',
  authenticate,
  authorize('seller', 'admin'),
  body('packageId').notEmpty(),
  body('categoryFilters').optional().isArray(),
  body('regionFilters').optional().isArray(),
  validate,
  leadController.purchasePackage
);

router.get(
  '/credits',
  authenticate,
  authorize('seller', 'admin'),
  leadController.getCredits
);

// =============================================================================
// LEAD MARKETPLACE
// =============================================================================

router.get(
  '/available',
  authenticate,
  authorize('seller', 'admin'),
  leadController.getAvailableLeads
);

router.post(
  '/:leadId/purchase',
  authenticate,
  authorize('seller', 'admin'),
  param('leadId').isUUID(),
  validate,
  leadController.purchaseLead
);

router.get(
  '/purchased',
  authenticate,
  authorize('seller', 'admin'),
  leadController.getPurchasedLeads
);

router.get(
  '/:leadId',
  authenticate,
  authorize('seller', 'admin'),
  param('leadId').isUUID(),
  validate,
  leadController.getLeadById
);

router.put(
  '/:leadId/status',
  authenticate,
  authorize('seller', 'admin'),
  param('leadId').isUUID(),
  body('status').isIn(['NEW', 'CLAIMED', 'CONTACTED', 'QUALIFIED', 'CONVERTED', 'LOST']),
  body('notes').optional().isString(),
  body('followUpDate').optional().isISO8601(),
  validate,
  leadController.updateLeadStatus
);

// =============================================================================
// INTENT TRACKING
// =============================================================================

router.post(
  '/intent',
  authenticate,
  body('signal').notEmpty(),
  body('productId').optional().isUUID(),
  body('categoryId').optional().isUUID(),
  body('sellerId').optional().isUUID(),
  validate,
  leadController.trackIntent
);

router.get(
  '/intent/:buyerId',
  authenticate,
  authorize('seller', 'admin'),
  param('buyerId').isUUID(),
  validate,
  leadController.getBuyerIntent
);

// =============================================================================
// ANALYTICS
// =============================================================================

router.get(
  '/analytics',
  authenticate,
  authorize('seller', 'admin'),
  leadController.getLeadAnalytics
);

// =============================================================================
// ADMIN ROUTES
// =============================================================================

router.get(
  '/admin/all',
  authenticate,
  authorize('admin'),
  leadController.getAllLeads
);

router.get(
  '/admin/revenue',
  authenticate,
  authorize('admin'),
  leadController.getLeadRevenue
);

router.post(
  '/admin/:leadId/verify',
  authenticate,
  authorize('admin'),
  param('leadId').isUUID(),
  validate,
  leadController.verifyLead
);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;



