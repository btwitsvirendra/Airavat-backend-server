// =============================================================================
// AIRAVAT B2B MARKETPLACE - DEEP LINK ROUTES
// Routes for deep linking functionality
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const deepLinkController = require('../controllers/deepLink.controller');
const { protect, optionalAuth } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/deep-links/:shortCode
 * @desc    Resolve deep link by short code
 */
router.get(
  '/:shortCode',
  [param('shortCode').notEmpty().withMessage('Short code is required')],
  validate,
  deepLinkController.resolveDeepLink
);

/**
 * @route   GET /api/v1/deep-links/:shortCode/redirect
 * @desc    Redirect to destination
 */
router.get(
  '/:shortCode/redirect',
  [param('shortCode').notEmpty().withMessage('Short code is required')],
  validate,
  deepLinkController.redirectDeepLink
);

// =============================================================================
// AUTHENTICATED ROUTES
// =============================================================================

router.use(protect);

/**
 * @route   GET /api/v1/deep-links
 * @desc    Get user's deep links
 */
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('type').optional().isString(),
  ],
  validate,
  deepLinkController.getUserDeepLinks
);

/**
 * @route   POST /api/v1/deep-links
 * @desc    Generate deep link
 */
router.post(
  '/',
  [
    body('type').notEmpty().withMessage('Link type is required'),
    body('params').isObject().withMessage('Params must be an object'),
    body('expiresIn').optional().isInt({ min: 3600000 }),
    body('campaign').optional().isString(),
    body('source').optional().isString(),
  ],
  validate,
  deepLinkController.generateDeepLink
);

/**
 * @route   POST /api/v1/deep-links/product/:productId
 * @desc    Generate product deep link
 */
router.post(
  '/product/:productId',
  [
    param('productId').notEmpty().withMessage('Product ID is required'),
    body('campaign').optional().isString(),
    body('source').optional().isString(),
  ],
  validate,
  deepLinkController.generateProductLink
);

/**
 * @route   POST /api/v1/deep-links/referral
 * @desc    Generate referral deep link
 */
router.post(
  '/referral',
  [
    body('campaign').optional().isString(),
    body('source').optional().isString(),
  ],
  validate,
  deepLinkController.generateReferralLink
);

/**
 * @route   GET /api/v1/deep-links/:shortCode/analytics
 * @desc    Get deep link analytics
 */
router.get(
  '/:shortCode/analytics',
  [param('shortCode').notEmpty().withMessage('Short code is required')],
  validate,
  deepLinkController.getLinkAnalytics
);

/**
 * @route   PUT /api/v1/deep-links/:shortCode/expiry
 * @desc    Update deep link expiry
 */
router.put(
  '/:shortCode/expiry',
  [
    param('shortCode').notEmpty().withMessage('Short code is required'),
    body('expiresAt').isISO8601().withMessage('Valid expiry date is required'),
  ],
  validate,
  deepLinkController.updateExpiry
);

/**
 * @route   DELETE /api/v1/deep-links/:shortCode
 * @desc    Delete deep link
 */
router.delete(
  '/:shortCode',
  [param('shortCode').notEmpty().withMessage('Short code is required')],
  validate,
  deepLinkController.deleteDeepLink
);

module.exports = router;



