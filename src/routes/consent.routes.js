// =============================================================================
// AIRAVAT B2B MARKETPLACE - COOKIE CONSENT ROUTES
// Routes for GDPR/CCPA cookie consent management
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const consentController = require('../controllers/consent.controller');
const { protect, authorize, optionalAuth } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/consent/config
 * @desc    Get cookie consent configuration
 */
router.get('/config', consentController.getConsentConfig);

/**
 * @route   GET /api/v1/consent/banner
 * @desc    Get cookie banner configuration
 */
router.get(
  '/banner',
  [query('locale').optional().isString()],
  validate,
  consentController.getBannerConfig
);

/**
 * @route   POST /api/v1/consent
 * @desc    Save cookie consent
 */
router.post(
  '/',
  optionalAuth,
  [
    body('preferences').isObject().withMessage('Preferences object is required'),
    body('preferences.necessary')
      .optional()
      .isBoolean()
      .withMessage('Preferences must be boolean'),
    body('preferences.functional').optional().isBoolean(),
    body('preferences.analytics').optional().isBoolean(),
    body('preferences.marketing').optional().isBoolean(),
    body('preferences.thirdParty').optional().isBoolean(),
  ],
  validate,
  consentController.saveConsent
);

/**
 * @route   GET /api/v1/consent/:consentId
 * @desc    Get consent by ID
 */
router.get(
  '/:consentId',
  [param('consentId').notEmpty().withMessage('Consent ID is required')],
  validate,
  consentController.getConsent
);

/**
 * @route   PUT /api/v1/consent/:consentId
 * @desc    Update consent preferences
 */
router.put(
  '/:consentId',
  [
    param('consentId').notEmpty().withMessage('Consent ID is required'),
    body('preferences').isObject().withMessage('Preferences object is required'),
  ],
  validate,
  consentController.updateConsent
);

/**
 * @route   POST /api/v1/consent/:consentId/withdraw
 * @desc    Withdraw consent
 */
router.post(
  '/:consentId/withdraw',
  [param('consentId').notEmpty().withMessage('Consent ID is required')],
  validate,
  consentController.withdrawConsent
);

/**
 * @route   GET /api/v1/consent/:consentId/check/:category
 * @desc    Check if category is allowed
 */
router.get(
  '/:consentId/check/:category',
  [
    param('consentId').notEmpty().withMessage('Consent ID is required'),
    param('category')
      .isIn(['necessary', 'functional', 'analytics', 'marketing', 'thirdParty'])
      .withMessage('Invalid category'),
  ],
  validate,
  consentController.checkCategoryAllowed
);

/**
 * @route   GET /api/v1/consent/:consentId/version
 * @desc    Check consent version
 */
router.get(
  '/:consentId/version',
  [param('consentId').notEmpty().withMessage('Consent ID is required')],
  validate,
  consentController.checkVersion
);

// =============================================================================
// ADMIN ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/consent/admin/stats
 * @desc    Get consent statistics (Admin)
 */
router.get(
  '/admin/stats',
  protect,
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
  ],
  validate,
  consentController.getConsentStats
);

/**
 * @route   GET /api/v1/consent/admin/export
 * @desc    Export consent records (Admin)
 */
router.get(
  '/admin/export',
  protect,
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    query('userId').optional().isString(),
    query('startDate').optional().isISO8601(),
    query('endDate').optional().isISO8601(),
    query('format').optional().isIn(['json', 'csv']),
  ],
  validate,
  consentController.exportConsentRecords
);

module.exports = router;



