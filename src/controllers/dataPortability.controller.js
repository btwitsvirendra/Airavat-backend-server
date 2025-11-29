// =============================================================================
// AIRAVAT B2B MARKETPLACE - DATA PORTABILITY CONTROLLER
// Handles GDPR/privacy data export and deletion requests
// =============================================================================

const dataPortabilityService = require('../services/dataPortability.service');
const rightToDeletionService = require('../services/rightToDeletion.service');
const asyncHandler = require('../middleware/async.middleware');
const { NotFoundError } = require('../utils/errors');

// =============================================================================
// DATA EXPORT
// =============================================================================

/**
 * Request data export
 * @route POST /api/v1/privacy/export
 */
const requestDataExport = asyncHandler(async (req, res) => {
  const request = await dataPortabilityService.requestExport(
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Export request submitted. You will be notified when ready.',
    data: request,
  });
});

/**
 * Get export status
 * @route GET /api/v1/privacy/export/:exportId
 */
const getExportStatus = asyncHandler(async (req, res) => {
  const status = await dataPortabilityService.getExportStatus(
    req.params.exportId,
    req.user.id
  );

  if (!status) {
    throw new NotFoundError('Export request not found');
  }

  res.json({
    success: true,
    data: status,
  });
});

/**
 * Get all export requests
 * @route GET /api/v1/privacy/exports
 */
const getExportHistory = asyncHandler(async (req, res) => {
  const exports = await dataPortabilityService.getExportHistory(req.user.id);

  res.json({
    success: true,
    data: exports,
  });
});

/**
 * Download export file
 * @route GET /api/v1/privacy/export/:exportId/download
 */
const downloadExport = asyncHandler(async (req, res) => {
  const downloadInfo = await dataPortabilityService.getDownloadUrl(
    req.params.exportId,
    req.user.id
  );

  res.json({
    success: true,
    data: downloadInfo,
  });
});

/**
 * Cancel export request
 * @route POST /api/v1/privacy/export/:exportId/cancel
 */
const cancelExportRequest = asyncHandler(async (req, res) => {
  await dataPortabilityService.cancelExport(req.params.exportId, req.user.id);

  res.json({
    success: true,
    message: 'Export request cancelled',
  });
});

/**
 * Get available data categories
 * @route GET /api/v1/privacy/export/categories
 */
const getDataCategories = asyncHandler(async (req, res) => {
  const categories = await dataPortabilityService.getDataCategories();

  res.json({
    success: true,
    data: categories,
  });
});

// =============================================================================
// DATA DELETION (RIGHT TO BE FORGOTTEN)
// =============================================================================

/**
 * Request account deletion
 * @route POST /api/v1/privacy/deletion
 */
const requestAccountDeletion = asyncHandler(async (req, res) => {
  const request = await rightToDeletionService.requestDeletion(
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Deletion request submitted. Please verify your email.',
    data: request,
  });
});

/**
 * Verify deletion request
 * @route POST /api/v1/privacy/deletion/verify
 */
const verifyDeletionRequest = asyncHandler(async (req, res) => {
  const request = await rightToDeletionService.verifyDeletionRequest(
    req.user.id,
    req.body.verificationToken
  );

  res.json({
    success: true,
    message: 'Deletion verified. Account will be deleted on scheduled date.',
    data: request,
  });
});

/**
 * Get deletion request status
 * @route GET /api/v1/privacy/deletion/status
 */
const getDeletionStatus = asyncHandler(async (req, res) => {
  const status = await rightToDeletionService.getDeletionStatus(req.user.id);

  res.json({
    success: true,
    data: status,
  });
});

/**
 * Cancel deletion request
 * @route POST /api/v1/privacy/deletion/cancel
 */
const cancelDeletionRequest = asyncHandler(async (req, res) => {
  await rightToDeletionService.cancelDeletionRequest(req.user.id);

  res.json({
    success: true,
    message: 'Deletion request cancelled. Your account will not be deleted.',
  });
});

/**
 * Get impact preview of deletion
 * @route GET /api/v1/privacy/deletion/preview
 */
const getDeletionPreview = asyncHandler(async (req, res) => {
  const preview = await rightToDeletionService.getDeletionPreview(req.user.id);

  res.json({
    success: true,
    data: preview,
  });
});

// =============================================================================
// PRIVACY SETTINGS
// =============================================================================

/**
 * Get privacy settings
 * @route GET /api/v1/privacy/settings
 */
const getPrivacySettings = asyncHandler(async (req, res) => {
  const settings = await dataPortabilityService.getPrivacySettings(req.user.id);

  res.json({
    success: true,
    data: settings,
  });
});

/**
 * Update privacy settings
 * @route PUT /api/v1/privacy/settings
 */
const updatePrivacySettings = asyncHandler(async (req, res) => {
  const settings = await dataPortabilityService.updatePrivacySettings(
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Privacy settings updated',
    data: settings,
  });
});

/**
 * Get data usage summary
 * @route GET /api/v1/privacy/data-usage
 */
const getDataUsageSummary = asyncHandler(async (req, res) => {
  const summary = await dataPortabilityService.getDataUsageSummary(req.user.id);

  res.json({
    success: true,
    data: summary,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  requestDataExport,
  getExportStatus,
  getExportHistory,
  downloadExport,
  cancelExportRequest,
  getDataCategories,
  requestAccountDeletion,
  verifyDeletionRequest,
  getDeletionStatus,
  cancelDeletionRequest,
  getDeletionPreview,
  getPrivacySettings,
  updatePrivacySettings,
  getDataUsageSummary,
};



