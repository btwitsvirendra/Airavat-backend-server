// =============================================================================
// AIRAVAT B2B MARKETPLACE - SOCIAL SHARING ROUTES
// Routes for social sharing functionality
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const socialShareController = require('../controllers/socialShare.controller');
const { protect, optionalAuth } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/share/platforms
 * @desc    Get supported platforms
 */
router.get('/platforms', socialShareController.getSupportedPlatforms);

/**
 * @route   GET /api/v1/share/product/:productId
 * @desc    Get share links for product
 */
router.get(
  '/product/:productId',
  optionalAuth,
  [
    param('productId').notEmpty().withMessage('Product ID is required'),
    query('source').optional().isString(),
  ],
  validate,
  socialShareController.getProductShareLinks
);

/**
 * @route   GET /api/v1/share/business/:businessId
 * @desc    Get share links for business
 */
router.get(
  '/business/:businessId',
  optionalAuth,
  [
    param('businessId').notEmpty().withMessage('Business ID is required'),
    query('source').optional().isString(),
  ],
  validate,
  socialShareController.getBusinessShareLinks
);

/**
 * @route   GET /api/v1/share/rfq/:rfqId
 * @desc    Get share links for RFQ
 */
router.get(
  '/rfq/:rfqId',
  optionalAuth,
  [
    param('rfqId').notEmpty().withMessage('RFQ ID is required'),
    query('source').optional().isString(),
  ],
  validate,
  socialShareController.getRFQShareLinks
);

/**
 * @route   POST /api/v1/share/track
 * @desc    Track a share event
 */
router.post(
  '/track',
  optionalAuth,
  [
    body('entityType').notEmpty().withMessage('Entity type is required'),
    body('entityId').notEmpty().withMessage('Entity ID is required'),
    body('platform').notEmpty().withMessage('Platform is required'),
    body('source').optional().isString(),
    body('referrer').optional().isString(),
  ],
  validate,
  socialShareController.trackShare
);

/**
 * @route   GET /api/v1/share/referral/:trackingCode
 * @desc    Handle referral from share
 */
router.get(
  '/referral/:trackingCode',
  [param('trackingCode').notEmpty().withMessage('Tracking code is required')],
  validate,
  socialShareController.handleReferral
);

/**
 * @route   GET /api/v1/share/social-proof/:entityType/:entityId
 * @desc    Get social proof for entity
 */
router.get(
  '/social-proof/:entityType/:entityId',
  [
    param('entityType').notEmpty().withMessage('Entity type is required'),
    param('entityId').notEmpty().withMessage('Entity ID is required'),
  ],
  validate,
  socialShareController.getSocialProof
);

// =============================================================================
// AUTHENTICATED ROUTES
// =============================================================================

/**
 * @route   POST /api/v1/share/custom
 * @desc    Get custom share links
 */
router.post(
  '/custom',
  protect,
  [
    body('title').notEmpty().withMessage('Title is required'),
    body('url').isURL().withMessage('Valid URL is required'),
    body('description').optional().isString(),
    body('image').optional().isURL(),
    body('hashtags').optional().isArray(),
  ],
  validate,
  socialShareController.getCustomShareLinks
);

/**
 * @route   GET /api/v1/share/analytics/:entityType/:entityId
 * @desc    Get share analytics
 */
router.get(
  '/analytics/:entityType/:entityId',
  protect,
  [
    param('entityType').notEmpty().withMessage('Entity type is required'),
    param('entityId').notEmpty().withMessage('Entity ID is required'),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  socialShareController.getShareAnalytics
);

module.exports = router;



