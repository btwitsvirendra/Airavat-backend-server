// =============================================================================
// AIRAVAT B2B MARKETPLACE - PRIVACY ROUTES
// Routes for GDPR/privacy data portability and deletion
// =============================================================================

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const dataPortabilityController = require('../controllers/dataPortability.controller');
const { authenticate } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const exportValidation = [
  body('categories').optional().isArray(),
  body('categories.*').isIn([
    'profile', 'orders', 'products', 'messages', 
    'reviews', 'analytics', 'documents', 'all'
  ]),
  body('format').optional().isIn(['json', 'csv', 'xml']),
  body('includeAttachments').optional().isBoolean(),
];

const deletionValidation = [
  body('reason').optional().isString().isLength({ max: 500 }),
  body('feedback').optional().isString().isLength({ max: 1000 }),
];

const verifyDeletionValidation = [
  body('verificationToken').notEmpty().isString(),
];

// =============================================================================
// DATA EXPORT ROUTES
// =============================================================================

router.get(
  '/export/categories',
  authenticate,
  dataPortabilityController.getDataCategories
);

router.post(
  '/export',
  authenticate,
  exportValidation,
  validate,
  dataPortabilityController.requestDataExport
);

router.get(
  '/exports',
  authenticate,
  dataPortabilityController.getExportHistory
);

router.get(
  '/export/:exportId',
  authenticate,
  param('exportId').isUUID(),
  validate,
  dataPortabilityController.getExportStatus
);

router.get(
  '/export/:exportId/download',
  authenticate,
  param('exportId').isUUID(),
  validate,
  dataPortabilityController.downloadExport
);

router.post(
  '/export/:exportId/cancel',
  authenticate,
  param('exportId').isUUID(),
  validate,
  dataPortabilityController.cancelExportRequest
);

// =============================================================================
// DATA DELETION ROUTES (RIGHT TO BE FORGOTTEN)
// =============================================================================

router.get(
  '/deletion/preview',
  authenticate,
  dataPortabilityController.getDeletionPreview
);

router.get(
  '/deletion/status',
  authenticate,
  dataPortabilityController.getDeletionStatus
);

router.post(
  '/deletion',
  authenticate,
  deletionValidation,
  validate,
  dataPortabilityController.requestAccountDeletion
);

router.post(
  '/deletion/verify',
  authenticate,
  verifyDeletionValidation,
  validate,
  dataPortabilityController.verifyDeletionRequest
);

router.post(
  '/deletion/cancel',
  authenticate,
  dataPortabilityController.cancelDeletionRequest
);

// =============================================================================
// PRIVACY SETTINGS
// =============================================================================

router.get(
  '/settings',
  authenticate,
  dataPortabilityController.getPrivacySettings
);

router.put(
  '/settings',
  authenticate,
  body('marketing').optional().isBoolean(),
  body('analytics').optional().isBoolean(),
  body('thirdPartySharing').optional().isBoolean(),
  body('personalization').optional().isBoolean(),
  validate,
  dataPortabilityController.updatePrivacySettings
);

router.get(
  '/data-usage',
  authenticate,
  dataPortabilityController.getDataUsageSummary
);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;



