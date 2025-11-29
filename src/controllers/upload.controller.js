// =============================================================================
// AIRAVAT B2B MARKETPLACE - UPLOAD CONTROLLER
// =============================================================================

const uploadService = require('../services/upload.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, created } = require('../utils/response');
const { BadRequestError, NotFoundError } = require('../utils/errors');

/**
 * Get presigned URL for S3 upload
 * POST /api/v1/uploads/presigned-url
 */
exports.getPresignedUrl = asyncHandler(async (req, res) => {
  const { fileName, fileType, folder = 'general' } = req.body;
  
  if (!fileName || !fileType) {
    throw new BadRequestError('File name and type are required');
  }
  
  // Validate file type
  const allowedTypes = [
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'text/csv',
  ];
  
  if (!allowedTypes.includes(fileType)) {
    throw new BadRequestError('File type not allowed');
  }
  
  const { uploadUrl, fileUrl, key } = await uploadService.getPresignedUrl({
    fileName,
    fileType,
    folder,
    userId: req.user.id,
  });
  
  success(res, { uploadUrl, fileUrl, key });
});

/**
 * Upload single image
 * POST /api/v1/uploads/image
 */
exports.uploadImage = asyncHandler(async (req, res) => {
  const { base64, fileName, folder = 'images' } = req.body;
  
  if (!base64) {
    throw new BadRequestError('Image data is required');
  }
  
  // Validate image size (max 5MB)
  const sizeInBytes = Buffer.from(base64, 'base64').length;
  if (sizeInBytes > 5 * 1024 * 1024) {
    throw new BadRequestError('Image size must be less than 5MB');
  }
  
  const result = await uploadService.uploadBase64Image({
    base64,
    fileName,
    folder,
    userId: req.user.id,
  });
  
  created(res, result, 'Image uploaded successfully');
});

/**
 * Upload multiple images
 * POST /api/v1/uploads/images
 */
exports.uploadImages = asyncHandler(async (req, res) => {
  const { images, folder = 'images' } = req.body;
  
  if (!Array.isArray(images) || images.length === 0) {
    throw new BadRequestError('Images array is required');
  }
  
  if (images.length > 10) {
    throw new BadRequestError('Maximum 10 images allowed per request');
  }
  
  const results = await Promise.all(
    images.map((image) =>
      uploadService.uploadBase64Image({
        base64: image.base64,
        fileName: image.fileName,
        folder,
        userId: req.user.id,
      })
    )
  );
  
  created(res, { images: results }, `${results.length} images uploaded`);
});

/**
 * Delete image
 * DELETE /api/v1/uploads/image/:imageId
 */
exports.deleteImage = asyncHandler(async (req, res) => {
  await uploadService.deleteFile(req.params.imageId, req.user.id);
  
  success(res, null, 'Image deleted successfully');
});

/**
 * Upload document
 * POST /api/v1/uploads/document
 */
exports.uploadDocument = asyncHandler(async (req, res) => {
  const { base64, fileName, documentType, folder = 'documents' } = req.body;
  
  if (!base64 || !fileName) {
    throw new BadRequestError('Document data and file name are required');
  }
  
  // Validate document size (max 10MB)
  const sizeInBytes = Buffer.from(base64, 'base64').length;
  if (sizeInBytes > 10 * 1024 * 1024) {
    throw new BadRequestError('Document size must be less than 10MB');
  }
  
  // Validate file extension
  const ext = fileName.split('.').pop().toLowerCase();
  const allowedExtensions = ['pdf', 'doc', 'docx', 'xls', 'xlsx', 'csv'];
  if (!allowedExtensions.includes(ext)) {
    throw new BadRequestError('Invalid document type');
  }
  
  const result = await uploadService.uploadBase64Document({
    base64,
    fileName,
    documentType,
    folder,
    userId: req.user.id,
    businessId: req.business?.id,
  });
  
  created(res, result, 'Document uploaded successfully');
});

/**
 * Delete document
 * DELETE /api/v1/uploads/document/:documentId
 */
exports.deleteDocument = asyncHandler(async (req, res) => {
  await uploadService.deleteDocument(req.params.documentId, req.business.id);
  
  success(res, null, 'Document deleted successfully');
});

/**
 * Get video presigned URL
 * POST /api/v1/uploads/video/presigned-url
 */
exports.getVideoPresignedUrl = asyncHandler(async (req, res) => {
  const { fileName, fileType, duration } = req.body;
  
  if (!fileName || !fileType) {
    throw new BadRequestError('File name and type are required');
  }
  
  const allowedTypes = ['video/mp4', 'video/webm', 'video/quicktime'];
  if (!allowedTypes.includes(fileType)) {
    throw new BadRequestError('Video type not allowed');
  }
  
  // Max duration 5 minutes
  if (duration && duration > 300) {
    throw new BadRequestError('Video duration must be less than 5 minutes');
  }
  
  const { uploadUrl, fileUrl, key } = await uploadService.getVideoPresignedUrl({
    fileName,
    fileType,
    userId: req.user.id,
  });
  
  success(res, { uploadUrl, fileUrl, key });
});

/**
 * Confirm video upload
 * POST /api/v1/uploads/video/confirm
 */
exports.confirmVideoUpload = asyncHandler(async (req, res) => {
  const { key, duration, thumbnail } = req.body;
  
  if (!key) {
    throw new BadRequestError('Video key is required');
  }
  
  const result = await uploadService.confirmVideoUpload({
    key,
    duration,
    thumbnail,
    userId: req.user.id,
    businessId: req.business?.id,
  });
  
  success(res, result, 'Video upload confirmed');
});

/**
 * Upload CSV for product import
 * POST /api/v1/uploads/csv
 */
exports.uploadCSV = asyncHandler(async (req, res) => {
  const { base64, fileName } = req.body;
  
  if (!base64 || !fileName) {
    throw new BadRequestError('CSV data and file name are required');
  }
  
  // Validate file extension
  if (!fileName.toLowerCase().endsWith('.csv')) {
    throw new BadRequestError('Only CSV files are allowed');
  }
  
  // Validate size (max 5MB)
  const sizeInBytes = Buffer.from(base64, 'base64').length;
  if (sizeInBytes > 5 * 1024 * 1024) {
    throw new BadRequestError('CSV file must be less than 5MB');
  }
  
  const result = await uploadService.uploadCSV({
    base64,
    fileName,
    userId: req.user.id,
    businessId: req.business.id,
  });
  
  created(res, result, 'CSV uploaded. Import will be processed.');
});

/**
 * Get upload status
 * GET /api/v1/uploads/status/:uploadId
 */
exports.getUploadStatus = asyncHandler(async (req, res) => {
  const status = await uploadService.getUploadStatus(req.params.uploadId);
  
  if (!status) {
    throw new NotFoundError('Upload');
  }
  
  success(res, { status });
});

/**
 * Generate thumbnails for image
 */
exports.generateThumbnails = asyncHandler(async (req, res) => {
  const { imageUrl, sizes } = req.body;
  
  if (!imageUrl) {
    throw new BadRequestError('Image URL is required');
  }
  
  const thumbnails = await uploadService.generateThumbnails(imageUrl, sizes);
  
  success(res, { thumbnails });
});

/**
 * Optimize image
 */
exports.optimizeImage = asyncHandler(async (req, res) => {
  const { imageUrl, quality = 80, format = 'webp' } = req.body;
  
  if (!imageUrl) {
    throw new BadRequestError('Image URL is required');
  }
  
  const optimized = await uploadService.optimizeImage(imageUrl, {
    quality,
    format,
  });
  
  success(res, { optimized });
});
