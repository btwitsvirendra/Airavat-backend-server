// =============================================================================
// AIRAVAT B2B MARKETPLACE - UPLOAD ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const multer = require('multer');
const { authenticate, requireBusiness } = require('../middleware/auth');
const uploadService = require('../services/upload.service');
const { success, created } = require('../utils/response');
const { asyncHandler } = require('../middleware/errorHandler');
const { BadRequestError } = require('../utils/errors');
const config = require('../config');

// Configure multer for memory storage
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: config.businessRules.maxImageSizeMB * 1024 * 1024, // 5MB default
  },
  fileFilter: (req, file, cb) => {
    // Check file types
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/webp',
      'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'video/mp4',
      'video/quicktime',
    ];
    
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new BadRequestError(`File type ${file.mimetype} is not allowed`));
    }
  },
});

// =============================================================================
// SINGLE FILE UPLOAD
// =============================================================================

// Upload single image
router.post(
  '/image',
  authenticate,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new BadRequestError('No image file provided');
    }
    
    const { folder = 'general', resize } = req.body;
    
    const result = await uploadService.uploadImage(req.file, {
      folder: `${req.user.id}/${folder}`,
      resize: resize ? JSON.parse(resize) : null,
    });
    
    created(res, { 
      url: result.url,
      key: result.key,
      thumbnail: result.thumbnail,
    }, 'Image uploaded');
  })
);

// Upload product image
router.post(
  '/product-image',
  authenticate,
  requireBusiness,
  upload.single('image'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new BadRequestError('No image file provided');
    }
    
    const { productId } = req.body;
    
    const result = await uploadService.uploadProductImage(req.file, {
      businessId: req.business.id,
      productId,
    });
    
    created(res, {
      url: result.url,
      key: result.key,
      thumbnail: result.thumbnail,
      medium: result.medium,
    }, 'Product image uploaded');
  })
);

// Upload document
router.post(
  '/document',
  authenticate,
  upload.single('document'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new BadRequestError('No document file provided');
    }
    
    const { folder = 'documents', type } = req.body;
    
    const result = await uploadService.uploadDocument(req.file, {
      folder: `${req.user.id}/${folder}`,
      type,
    });
    
    created(res, {
      url: result.url,
      key: result.key,
      name: result.name,
      size: result.size,
      mimeType: result.mimeType,
    }, 'Document uploaded');
  })
);

// Upload business document (for verification)
router.post(
  '/business-document',
  authenticate,
  requireBusiness,
  upload.single('document'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new BadRequestError('No document file provided');
    }
    
    const { type } = req.body;
    
    if (!type) {
      throw new BadRequestError('Document type is required');
    }
    
    const result = await uploadService.uploadBusinessDocument(req.file, {
      businessId: req.business.id,
      type,
    });
    
    created(res, {
      url: result.url,
      key: result.key,
      name: result.name,
      type: result.type,
    }, 'Business document uploaded');
  })
);

// =============================================================================
// MULTIPLE FILE UPLOAD
// =============================================================================

// Upload multiple images
router.post(
  '/images',
  authenticate,
  upload.array('images', 10), // Max 10 images
  asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0) {
      throw new BadRequestError('No image files provided');
    }
    
    const { folder = 'general' } = req.body;
    
    const results = await Promise.all(
      req.files.map((file) =>
        uploadService.uploadImage(file, {
          folder: `${req.user.id}/${folder}`,
        })
      )
    );
    
    created(res, { 
      images: results.map((r) => ({
        url: r.url,
        key: r.key,
        thumbnail: r.thumbnail,
      })),
    }, `${results.length} images uploaded`);
  })
);

// Upload multiple product images
router.post(
  '/product-images',
  authenticate,
  requireBusiness,
  upload.array('images', 20), // Max 20 images per product
  asyncHandler(async (req, res) => {
    if (!req.files || req.files.length === 0) {
      throw new BadRequestError('No image files provided');
    }
    
    const { productId } = req.body;
    
    const results = await Promise.all(
      req.files.map((file) =>
        uploadService.uploadProductImage(file, {
          businessId: req.business.id,
          productId,
        })
      )
    );
    
    created(res, {
      images: results.map((r) => ({
        url: r.url,
        key: r.key,
        thumbnail: r.thumbnail,
        medium: r.medium,
      })),
    }, `${results.length} product images uploaded`);
  })
);

// =============================================================================
// DELETE
// =============================================================================

// Delete file
router.delete(
  '/',
  authenticate,
  asyncHandler(async (req, res) => {
    const { key } = req.body;
    
    if (!key) {
      throw new BadRequestError('File key is required');
    }
    
    // Verify ownership (key should contain user ID)
    if (!key.includes(req.user.id) && req.user.role !== 'ADMIN') {
      throw new BadRequestError('Unauthorized to delete this file');
    }
    
    await uploadService.deleteFile(key);
    
    success(res, null, 'File deleted');
  })
);

// Delete multiple files
router.delete(
  '/bulk',
  authenticate,
  asyncHandler(async (req, res) => {
    const { keys } = req.body;
    
    if (!keys || !Array.isArray(keys)) {
      throw new BadRequestError('File keys array is required');
    }
    
    // Verify ownership
    for (const key of keys) {
      if (!key.includes(req.user.id) && req.user.role !== 'ADMIN') {
        throw new BadRequestError('Unauthorized to delete some files');
      }
    }
    
    await uploadService.deleteFiles(keys);
    
    success(res, null, `${keys.length} files deleted`);
  })
);

// =============================================================================
// SIGNED URLS
// =============================================================================

// Get signed URL for upload (for large files / direct S3 upload)
router.post(
  '/signed-url',
  authenticate,
  asyncHandler(async (req, res) => {
    const { filename, contentType, folder = 'general' } = req.body;
    
    if (!filename || !contentType) {
      throw new BadRequestError('Filename and content type are required');
    }
    
    const { uploadUrl, key, publicUrl } = await uploadService.getSignedUploadUrl({
      filename,
      contentType,
      folder: `${req.user.id}/${folder}`,
    });
    
    success(res, { uploadUrl, key, publicUrl });
  })
);

// Get signed URL for private file access
router.get(
  '/signed-url/:key',
  authenticate,
  asyncHandler(async (req, res) => {
    const { key } = req.params;
    const { expiresIn = 3600 } = req.query;
    
    // Verify ownership
    if (!key.includes(req.user.id) && req.user.role !== 'ADMIN') {
      throw new BadRequestError('Unauthorized');
    }
    
    const signedUrl = await uploadService.getSignedDownloadUrl(key, parseInt(expiresIn));
    
    success(res, { url: signedUrl });
  })
);

// =============================================================================
// VIDEO UPLOAD
// =============================================================================

// Upload video
router.post(
  '/video',
  authenticate,
  requireBusiness,
  upload.single('video'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new BadRequestError('No video file provided');
    }
    
    // Check file size (100MB max for video)
    if (req.file.size > 100 * 1024 * 1024) {
      throw new BadRequestError('Video file too large. Maximum size is 100MB');
    }
    
    const { folder = 'videos', productId } = req.body;
    
    const result = await uploadService.uploadVideo(req.file, {
      folder: `${req.business.id}/${folder}`,
      productId,
    });
    
    created(res, {
      url: result.url,
      key: result.key,
      thumbnail: result.thumbnail,
      duration: result.duration,
    }, 'Video uploaded');
  })
);

// =============================================================================
// BULK IMPORT FILES
// =============================================================================

// Upload CSV for import
router.post(
  '/csv',
  authenticate,
  requireBusiness,
  upload.single('file'),
  asyncHandler(async (req, res) => {
    if (!req.file) {
      throw new BadRequestError('No CSV file provided');
    }
    
    if (req.file.mimetype !== 'text/csv' && !req.file.originalname.endsWith('.csv')) {
      throw new BadRequestError('File must be a CSV');
    }
    
    const result = await uploadService.uploadCSV(req.file, {
      businessId: req.business.id,
    });
    
    created(res, {
      url: result.url,
      key: result.key,
      rowCount: result.rowCount,
    }, 'CSV uploaded');
  })
);

module.exports = router;
