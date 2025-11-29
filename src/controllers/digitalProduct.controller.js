// =============================================================================
// AIRAVAT B2B MARKETPLACE - DIGITAL PRODUCT CONTROLLER
// Handles digital product management and delivery
// =============================================================================

const digitalProductService = require('../services/digitalProduct.service');
const asyncHandler = require('../middleware/async.middleware');
const { NotFoundError } = require('../utils/errors');

// =============================================================================
// DIGITAL PRODUCT MANAGEMENT
// =============================================================================

/**
 * Create a digital product
 * @route POST /api/v1/digital-products
 */
const createDigitalProduct = asyncHandler(async (req, res) => {
  const product = await digitalProductService.createDigitalProduct(
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Digital product created successfully',
    data: product,
  });
});

/**
 * Get digital product by ID
 * @route GET /api/v1/digital-products/:id
 */
const getDigitalProduct = asyncHandler(async (req, res) => {
  const product = await digitalProductService.getDigitalProductById(
    req.params.id
  );

  if (!product) {
    throw new NotFoundError('Digital product not found');
  }

  res.json({
    success: true,
    data: product,
  });
});

/**
 * Update digital product
 * @route PUT /api/v1/digital-products/:id
 */
const updateDigitalProduct = asyncHandler(async (req, res) => {
  const product = await digitalProductService.updateDigitalProduct(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Digital product updated successfully',
    data: product,
  });
});

// =============================================================================
// FILE MANAGEMENT
// =============================================================================

/**
 * Upload file to digital product
 * @route POST /api/v1/digital-products/:id/files/upload-url
 */
const getFileUploadUrl = asyncHandler(async (req, res) => {
  const uploadData = await digitalProductService.initiateFileUpload(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Upload URL generated',
    data: uploadData,
  });
});

/**
 * Complete file upload
 * @route POST /api/v1/digital-products/:id/files/:fileId/complete
 */
const completeFileUpload = asyncHandler(async (req, res) => {
  const file = await digitalProductService.completeFileUpload(
    req.params.fileId,
    req.user.id
  );

  res.json({
    success: true,
    message: 'File upload completed',
    data: file,
  });
});

/**
 * Get files for a digital product
 * @route GET /api/v1/digital-products/:id/files
 */
const getFiles = asyncHandler(async (req, res) => {
  const files = await digitalProductService.getFiles(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    data: files,
  });
});

/**
 * Delete a file
 * @route DELETE /api/v1/digital-products/:id/files/:fileId
 */
const deleteFile = asyncHandler(async (req, res) => {
  await digitalProductService.deleteFile(
    req.params.fileId,
    req.user.id
  );

  res.json({
    success: true,
    message: 'File deleted successfully',
  });
});

/**
 * Update file version
 * @route POST /api/v1/digital-products/:id/files/:fileId/version
 */
const updateFileVersion = asyncHandler(async (req, res) => {
  const file = await digitalProductService.updateFileVersion(
    req.params.fileId,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'File version updated',
    data: file,
  });
});

// =============================================================================
// DOWNLOAD MANAGEMENT
// =============================================================================

/**
 * Generate download token
 * @route POST /api/v1/digital-products/downloads/token
 */
const generateDownloadToken = asyncHandler(async (req, res) => {
  const tokenData = await digitalProductService.generateDownloadToken(
    req.user.id,
    req.body.orderItemId,
    req.body.fileId
  );

  res.json({
    success: true,
    data: tokenData,
  });
});

/**
 * Download file using token
 * @route GET /api/v1/digital-products/downloads/:token
 */
const downloadFile = asyncHandler(async (req, res) => {
  const downloadData = await digitalProductService.downloadFile(
    req.params.token,
    req.ip
  );

  res.redirect(downloadData.url);
});

/**
 * Get download history
 * @route GET /api/v1/digital-products/downloads/history
 */
const getDownloadHistory = asyncHandler(async (req, res) => {
  const history = await digitalProductService.getDownloadHistory(
    req.user.id,
    req.query
  );

  res.json({
    success: true,
    data: history.downloads,
    pagination: history.pagination,
  });
});

/**
 * Get remaining downloads
 * @route GET /api/v1/digital-products/downloads/remaining/:orderItemId
 */
const getRemainingDownloads = asyncHandler(async (req, res) => {
  const remaining = await digitalProductService.getRemainingDownloads(
    req.user.id,
    req.params.orderItemId
  );

  res.json({
    success: true,
    data: remaining,
  });
});

// =============================================================================
// LICENSE MANAGEMENT
// =============================================================================

/**
 * Get user's licenses
 * @route GET /api/v1/digital-products/licenses
 */
const getLicenses = asyncHandler(async (req, res) => {
  const licenses = await digitalProductService.getUserLicenses(
    req.user.id,
    req.query
  );

  res.json({
    success: true,
    data: licenses.licenses,
    pagination: licenses.pagination,
  });
});

/**
 * Activate a license
 * @route POST /api/v1/digital-products/licenses/:licenseKey/activate
 */
const activateLicense = asyncHandler(async (req, res) => {
  const license = await digitalProductService.activateLicense(
    req.params.licenseKey,
    req.user.id,
    req.body.machineId
  );

  res.json({
    success: true,
    message: 'License activated successfully',
    data: license,
  });
});

/**
 * Deactivate a license
 * @route POST /api/v1/digital-products/licenses/:licenseKey/deactivate
 */
const deactivateLicense = asyncHandler(async (req, res) => {
  const license = await digitalProductService.deactivateLicense(
    req.params.licenseKey,
    req.user.id,
    req.body.machineId
  );

  res.json({
    success: true,
    message: 'License deactivated',
    data: license,
  });
});

/**
 * Verify a license
 * @route POST /api/v1/digital-products/licenses/verify
 */
const verifyLicense = asyncHandler(async (req, res) => {
  const verification = await digitalProductService.verifyLicense(
    req.body.licenseKey,
    req.body.machineId
  );

  res.json({
    success: true,
    data: verification,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  createDigitalProduct,
  getDigitalProduct,
  updateDigitalProduct,
  getFileUploadUrl,
  completeFileUpload,
  getFiles,
  deleteFile,
  updateFileVersion,
  generateDownloadToken,
  downloadFile,
  getDownloadHistory,
  getRemainingDownloads,
  getLicenses,
  activateLicense,
  deactivateLicense,
  verifyLicense,
};



