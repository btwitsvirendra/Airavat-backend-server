// =============================================================================
// AIRAVAT B2B MARKETPLACE - UPLOAD MIDDLEWARE
// File upload handling with Multer and S3
// =============================================================================

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { S3Client } = require('@aws-sdk/client-s3');
const multerS3 = require('multer-s3');
const config = require('../config');
const { BadRequestError } = require('../utils/errors');

// =============================================================================
// S3 CLIENT
// =============================================================================

const s3Client = new S3Client({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
});

// =============================================================================
// FILE FILTERS
// =============================================================================

const imageFilter = (req, file, cb) => {
  const allowedMimes = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new BadRequestError('Only JPEG, PNG, GIF, and WebP images are allowed'), false);
  }
};

const documentFilter = (req, file, cb) => {
  const allowedMimes = [
    'application/pdf',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'image/jpeg',
    'image/png',
  ];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new BadRequestError('Invalid file type. Allowed: PDF, DOC, DOCX, XLS, XLSX, JPEG, PNG'), false);
  }
};

const videoFilter = (req, file, cb) => {
  const allowedMimes = ['video/mp4', 'video/webm', 'video/quicktime'];
  if (allowedMimes.includes(file.mimetype)) {
    cb(null, true);
  } else {
    cb(new BadRequestError('Only MP4, WebM, and MOV videos are allowed'), false);
  }
};

// =============================================================================
// FILENAME GENERATOR
// =============================================================================

const generateFilename = (req, file, cb) => {
  const uniqueSuffix = crypto.randomBytes(16).toString('hex');
  const ext = path.extname(file.originalname).toLowerCase();
  const basename = path.basename(file.originalname, ext)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '-')
    .substring(0, 50);
  cb(null, `${basename}-${uniqueSuffix}${ext}`);
};

// =============================================================================
// S3 STORAGE CONFIGURATIONS
// =============================================================================

const createS3Storage = (folder) => {
  return multerS3({
    s3: s3Client,
    bucket: config.aws.s3Bucket,
    acl: 'public-read',
    contentType: multerS3.AUTO_CONTENT_TYPE,
    metadata: (req, file, cb) => {
      cb(null, {
        fieldName: file.fieldname,
        originalName: file.originalname,
        uploadedBy: req.user?.id || 'anonymous',
      });
    },
    key: (req, file, cb) => {
      generateFilename(req, file, (err, filename) => {
        if (err) return cb(err);
        const key = `${folder}/${new Date().getFullYear()}/${new Date().getMonth() + 1}/${filename}`;
        cb(null, key);
      });
    },
  });
};

// =============================================================================
// LOCAL STORAGE (Development fallback)
// =============================================================================

const localStorage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, path.join(__dirname, '../../uploads'));
  },
  filename: generateFilename,
});

// =============================================================================
// UPLOAD CONFIGURATIONS
// =============================================================================

// Product images
const productImageUpload = multer({
  storage: config.aws.s3Bucket ? createS3Storage('products') : localStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 10,
  },
});

// Business logo/banner
const businessImageUpload = multer({
  storage: config.aws.s3Bucket ? createS3Storage('businesses') : localStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB
    files: 2,
  },
});

// User avatar
const avatarUpload = multer({
  storage: config.aws.s3Bucket ? createS3Storage('avatars') : localStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 1 * 1024 * 1024, // 1MB
    files: 1,
  },
});

// Business documents (GST, PAN, etc.)
const documentUpload = multer({
  storage: config.aws.s3Bucket ? createS3Storage('documents') : localStorage,
  fileFilter: documentFilter,
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 10,
  },
});

// Chat attachments
const chatAttachmentUpload = multer({
  storage: config.aws.s3Bucket ? createS3Storage('chat') : localStorage,
  fileFilter: (req, file, cb) => {
    const allowedMimes = [
      'image/jpeg',
      'image/png',
      'image/gif',
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ];
    if (allowedMimes.includes(file.mimetype)) {
      cb(null, true);
    } else {
      cb(new BadRequestError('Invalid file type'), false);
    }
  },
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 5,
  },
});

// Video upload
const videoUpload = multer({
  storage: config.aws.s3Bucket ? createS3Storage('videos') : localStorage,
  fileFilter: videoFilter,
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
    files: 3,
  },
});

// Review images
const reviewImageUpload = multer({
  storage: config.aws.s3Bucket ? createS3Storage('reviews') : localStorage,
  fileFilter: imageFilter,
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 5,
  },
});

// =============================================================================
// UPLOAD MIDDLEWARE WRAPPERS
// =============================================================================

/**
 * Handle upload errors
 */
const handleUploadError = (err, req, res, next) => {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return next(new BadRequestError('File size too large'));
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return next(new BadRequestError('Too many files'));
    }
    if (err.code === 'LIMIT_UNEXPECTED_FILE') {
      return next(new BadRequestError('Unexpected file field'));
    }
    return next(new BadRequestError(err.message));
  }
  next(err);
};

/**
 * Process uploaded files and add URLs to request
 */
const processUploads = (req, res, next) => {
  if (req.file) {
    req.fileUrl = req.file.location || `/uploads/${req.file.filename}`;
  }
  
  if (req.files) {
    if (Array.isArray(req.files)) {
      req.fileUrls = req.files.map((f) => f.location || `/uploads/${f.filename}`);
    } else {
      req.fileUrls = {};
      for (const [field, files] of Object.entries(req.files)) {
        req.fileUrls[field] = files.map((f) => f.location || `/uploads/${f.filename}`);
      }
    }
  }
  
  next();
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Single file uploads
  uploadProductImage: productImageUpload.single('image'),
  uploadProductImages: productImageUpload.array('images', 10),
  uploadBusinessLogo: businessImageUpload.single('logo'),
  uploadBusinessBanner: businessImageUpload.single('banner'),
  uploadAvatar: avatarUpload.single('avatar'),
  uploadDocument: documentUpload.single('document'),
  uploadDocuments: documentUpload.array('documents', 10),
  uploadChatAttachment: chatAttachmentUpload.single('attachment'),
  uploadChatAttachments: chatAttachmentUpload.array('attachments', 5),
  uploadVideo: videoUpload.single('video'),
  uploadReviewImages: reviewImageUpload.array('images', 5),

  // Multiple fields
  uploadBusinessImages: businessImageUpload.fields([
    { name: 'logo', maxCount: 1 },
    { name: 'banner', maxCount: 1 },
  ]),

  uploadProductMedia: multer({
    storage: config.aws.s3Bucket ? createS3Storage('products') : localStorage,
    fileFilter: (req, file, cb) => {
      const allowedMimes = [
        'image/jpeg',
        'image/png',
        'image/gif',
        'image/webp',
        'video/mp4',
        'video/webm',
      ];
      if (allowedMimes.includes(file.mimetype)) {
        cb(null, true);
      } else {
        cb(new BadRequestError('Invalid file type'), false);
      }
    },
    limits: {
      fileSize: 50 * 1024 * 1024,
      files: 15,
    },
  }).fields([
    { name: 'images', maxCount: 10 },
    { name: 'videos', maxCount: 3 },
  ]),

  // Error handler
  handleUploadError,
  
  // Process uploads
  processUploads,

  // Raw multer instances for custom configurations
  multer,
  s3Client,
  createS3Storage,
};
