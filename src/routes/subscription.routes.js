// =============================================================================
// AIRAVAT B2B MARKETPLACE - SUBSCRIPTION ROUTES
// Routes for subscription plans and billing
// =============================================================================

const express = require('express');
const { body, param } = require('express-validator');
const router = express.Router();

const subscriptionController = require('../controllers/subscription.controller');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

router.get('/plans', subscriptionController.getPlans);

router.get('/plans/:planId', subscriptionController.getPlan);

router.get('/compare', subscriptionController.comparePlans);

// =============================================================================
// AUTHENTICATED ROUTES
// =============================================================================

router.get(
  '/current',
  authenticate,
  subscriptionController.getCurrentSubscription
);

router.post(
  '/',
  authenticate,
  body('planId').notEmpty(),
  body('billingCycle').optional().isIn(['MONTHLY', 'ANNUAL']),
  body('couponCode').optional().isString(),
  validate,
  subscriptionController.subscribe
);

router.post(
  '/upgrade',
  authenticate,
  body('planId').notEmpty(),
  validate,
  subscriptionController.upgradePlan
);

router.post(
  '/downgrade',
  authenticate,
  body('planId').notEmpty(),
  validate,
  subscriptionController.downgradePlan
);

router.post(
  '/cancel',
  authenticate,
  body('immediately').optional().isBoolean(),
  body('reason').optional().isString(),
  body('feedback').optional().isString(),
  validate,
  subscriptionController.cancelSubscription
);

// =============================================================================
// FEATURE ACCESS
// =============================================================================

router.get(
  '/features/:featureKey',
  authenticate,
  param('featureKey').notEmpty(),
  validate,
  subscriptionController.checkFeatureAccess
);

router.get(
  '/usage/:featureKey',
  authenticate,
  param('featureKey').notEmpty(),
  validate,
  subscriptionController.checkUsageLimit
);

// =============================================================================
// BILLING
// =============================================================================

router.get(
  '/billing',
  authenticate,
  subscriptionController.getBillingHistory
);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;
