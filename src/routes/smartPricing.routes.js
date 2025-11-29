// =============================================================================
// AIRAVAT B2B MARKETPLACE - SMART PRICING ROUTES
// Routes for AI-powered dynamic pricing
// =============================================================================

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const smartPricingController = require('../controllers/smartPricing.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const createRuleValidation = [
  body('name').notEmpty().trim().isLength({ min: 3, max: 100 }),
  body('type').isIn(['DISCOUNT', 'MARKUP', 'DYNAMIC']),
  body('conditions').optional().isObject(),
  body('adjustment').isObject(),
  body('adjustment.type').isIn(['PERCENTAGE', 'FIXED']),
  body('adjustment.value').isNumeric(),
  body('priority').optional().isInt({ min: 0, max: 100 }),
  body('validFrom').optional().isISO8601(),
  body('validUntil').optional().isISO8601(),
];

const updateRuleValidation = [
  param('id').isUUID(),
  body('name').optional().trim().isLength({ min: 3, max: 100 }),
  body('conditions').optional().isObject(),
  body('adjustment').optional().isObject(),
  body('priority').optional().isInt({ min: 0, max: 100 }),
];

const monitoringValidation = [
  body('productId').isUUID(),
  body('competitors').isArray({ min: 1, max: 10 }),
  body('competitors.*.url').isURL(),
  body('competitors.*.name').notEmpty(),
];

const simulateValidation = [
  body('productId').isUUID(),
  body('newPrice').isDecimal({ min: 0 }),
];

// =============================================================================
// RECOMMENDATIONS
// =============================================================================

router.get(
  '/recommendations',
  authenticate,
  authorize('seller', 'admin'),
  smartPricingController.getRecommendations
);

router.get(
  '/recommendations/:productId',
  authenticate,
  authorize('seller', 'admin'),
  param('productId').isUUID(),
  validate,
  smartPricingController.getRecommendation
);

router.post(
  '/recommendations/bulk',
  authenticate,
  authorize('seller', 'admin'),
  body('productIds').isArray({ min: 1, max: 50 }),
  body('productIds.*').isUUID(),
  validate,
  smartPricingController.getBulkRecommendations
);

router.post(
  '/recommendations/:id/apply',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  validate,
  smartPricingController.applyRecommendation
);

router.post(
  '/recommendations/:id/dismiss',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  body('reason').optional().isString(),
  validate,
  smartPricingController.dismissRecommendation
);

// =============================================================================
// PRICING RULES
// =============================================================================

router.post(
  '/rules',
  authenticate,
  authorize('seller', 'admin'),
  createRuleValidation,
  validate,
  smartPricingController.createRule
);

router.get(
  '/rules',
  authenticate,
  authorize('seller', 'admin'),
  smartPricingController.getRules
);

router.get(
  '/rules/:id',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  validate,
  smartPricingController.getRuleById
);

router.put(
  '/rules/:id',
  authenticate,
  authorize('seller', 'admin'),
  updateRuleValidation,
  validate,
  smartPricingController.updateRule
);

router.delete(
  '/rules/:id',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  validate,
  smartPricingController.deleteRule
);

router.post(
  '/rules/:id/toggle',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  validate,
  smartPricingController.toggleRule
);

// =============================================================================
// COMPETITOR MONITORING
// =============================================================================

router.post(
  '/monitoring',
  authenticate,
  authorize('seller', 'admin'),
  monitoringValidation,
  validate,
  smartPricingController.setupMonitoring
);

router.get(
  '/monitoring',
  authenticate,
  authorize('seller', 'admin'),
  smartPricingController.getMonitoringSettings
);

router.get(
  '/monitoring/:productId',
  authenticate,
  authorize('seller', 'admin'),
  param('productId').isUUID(),
  validate,
  smartPricingController.getCompetitorPrices
);

router.put(
  '/monitoring/:productId',
  authenticate,
  authorize('seller', 'admin'),
  param('productId').isUUID(),
  validate,
  smartPricingController.updateMonitoring
);

router.delete(
  '/monitoring/:productId',
  authenticate,
  authorize('seller', 'admin'),
  param('productId').isUUID(),
  validate,
  smartPricingController.deleteMonitoring
);

// =============================================================================
// ANALYTICS & HISTORY
// =============================================================================

router.get(
  '/history/:productId',
  authenticate,
  authorize('seller', 'admin'),
  param('productId').isUUID(),
  validate,
  smartPricingController.getPriceHistory
);

router.get(
  '/analytics',
  authenticate,
  authorize('seller', 'admin'),
  smartPricingController.getAnalytics
);

router.post(
  '/calculate',
  authenticate,
  authorize('seller', 'admin'),
  body('productId').isUUID(),
  body('params').optional().isObject(),
  validate,
  smartPricingController.calculateOptimalPrice
);

router.post(
  '/simulate',
  authenticate,
  authorize('seller', 'admin'),
  simulateValidation,
  validate,
  smartPricingController.simulatePriceChange
);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;



