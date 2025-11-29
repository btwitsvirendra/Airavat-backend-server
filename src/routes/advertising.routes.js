// =============================================================================
// AIRAVAT B2B MARKETPLACE - ADVERTISING ROUTES
// Routes for ad campaigns and sponsored listings
// =============================================================================

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const advertisingController = require('../controllers/advertising.controller');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

// =============================================================================
// PUBLIC AD SERVING
// =============================================================================

router.get(
  '/placements',
  advertisingController.getPlacements
);

router.get(
  '/serve/:placement',
  optionalAuth,
  param('placement').notEmpty(),
  validate,
  advertisingController.getAds
);

router.post(
  '/click',
  optionalAuth,
  body('productId').isUUID(),
  body('placement').notEmpty(),
  validate,
  advertisingController.recordClick
);

// =============================================================================
// CAMPAIGN MANAGEMENT
// =============================================================================

router.post(
  '/campaigns',
  authenticate,
  authorize('seller', 'admin'),
  body('name').notEmpty().trim(),
  body('placements').isArray({ min: 1 }),
  body('budget').isDecimal({ min: 500 }),
  body('startDate').isISO8601(),
  body('bidAmount').optional().isDecimal({ min: 1 }),
  validate,
  advertisingController.createCampaign
);

router.get(
  '/campaigns',
  authenticate,
  authorize('seller', 'admin'),
  advertisingController.getCampaigns
);

router.get(
  '/campaigns/:id',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  validate,
  advertisingController.getCampaignById
);

router.put(
  '/campaigns/:id',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  validate,
  advertisingController.updateCampaign
);

router.post(
  '/campaigns/:id/submit',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  validate,
  advertisingController.submitForReview
);

router.post(
  '/campaigns/:id/pause',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  validate,
  advertisingController.pauseCampaign
);

router.post(
  '/campaigns/:id/resume',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  validate,
  advertisingController.resumeCampaign
);

router.get(
  '/campaigns/:id/performance',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  validate,
  advertisingController.getCampaignPerformance
);

// =============================================================================
// ADMIN ROUTES
// =============================================================================

router.get(
  '/admin/campaigns',
  authenticate,
  authorize('admin'),
  advertisingController.getAllCampaigns
);

router.post(
  '/admin/campaigns/:id/review',
  authenticate,
  authorize('admin'),
  param('id').isUUID(),
  body('approved').isBoolean(),
  body('rejectionReason').optional().isString(),
  validate,
  advertisingController.reviewCampaign
);

router.get(
  '/admin/revenue',
  authenticate,
  authorize('admin'),
  advertisingController.getAdRevenue
);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;



