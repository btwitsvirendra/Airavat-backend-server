// =============================================================================
// AIRAVAT B2B MARKETPLACE - FILE UPLOAD MIDDLEWARE
// Handle file uploads with multer and S3
// =============================================================================

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const { S3Client, PutObjectCommand, DeleteObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const config = require('../config');
const { BadRequestError } = require('../utils/errors');
const logger = require('../config/logger');

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
// FILE FILTER
// =============================================================================

const fileFilter = (allowedTypes) => (req, file, cb) => {
  const ext = path.extname(file.originalname).toLowerCase();
  const mime = file.mimetype;

  const typeConfig = {
    image: {
      extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
      mimes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    },
    document: {
      extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx', '.txt', '.csv'],
      mimes: [
        'application/pdf',
        'application/msword',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/plain',
        'text/csv',
      ],
    },
    video: {
      extensions: ['.mp4', '.mov', '.avi', '.webm'],
      mimes: ['video/mp4', 'video/quicktime', 'video/x-msvideo', 'video/webm'],
    },
  };

  let allowed = false;

  for (const type of allowedTypes) {
    const config = typeConfig[type];
    if (config && config.extensions.includes(ext) && config.mimes.includes(mime)) {
      allowed = true;
      break;
    }
  }

  if (allowed) {
    cb(null, true);
  } else {
    cb(new BadRequestError(`File type not allowed. Allowed types: ${allowedTypes.join(', ')}`));
  }
};

// =============================================================================
// MULTER STORAGE (Memory)
// =============================================================================

const memoryStorage = multer.memoryStorage();

// =============================================================================
// UPLOAD CONFIGURATIONS
// =============================================================================

/**
 * Product images upload
 */
const productImages = multer({
  storage: memoryStorage,
  fileFilter: fileFilter(['image']),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 10,
  },
});

/**
 * Business logo/banner upload
 */
const businessImages = multer({
  storage: memoryStorage,
  fileFilter: fileFilter(['image']),
  limits: {
    fileSize: 2 * 1024 * 1024, // 2MB
    files: 2,
  },
});

/**
 * Document upload (KYC, invoices, etc.)
 */
const documents = multer({
  storage: memoryStorage,
  fileFilter: fileFilter(['document', 'image']),
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB
    files: 5,
  },
});

/**
 * Chat attachments
 */
const chatAttachments = multer({
  storage: memoryStorage,
  fileFilter: fileFilter(['image', 'document']),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB
    files: 5,
  },
});

/**
 * Video upload
 */
const videos = multer({
  storage: memoryStorage,
  fileFilter: fileFilter(['video']),
  limits: {
    fileSize: 100 * 1024 * 1024, // 100MB
    files: 3,
  },
});

// =============================================================================
// S3 UPLOAD HELPERS
// =============================================================================

/**
 * Generate unique filename
 */
const generateFilename = (originalName, prefix = '') => {
  const ext = path.extname(originalName);
  const hash = crypto.randomBytes(16).toString('hex');
  const timestamp = Date.now();
  return `${prefix}${timestamp}-${hash}${ext}`;
};

/**
 * Get S3 folder path
 */
const getS3Path = (type, businessId = 'general') => {
  const paths = {
    product: `products/${businessId}`,
    logo: `businesses/${businessId}/logo`,
    banner: `businesses/${businessId}/banner`,
    document: `documents/${businessId}`,
    kyc: `kyc/${businessId}`,
    chat: `chat`,
    avatar: `avatars`,
    invoice: `invoices/${businessId}`,
  };
  return paths[type] || 'uploads';
};

/**
 * Upload file to S3
 */
const uploadToS3 = async (file, options = {}) => {
  const {
    type = 'general',
    businessId = 'general',
    resize = null,
    quality = 80,
  } = options;

  let buffer = file.buffer;
  let contentType = file.mimetype;

  // Process image if resize options provided
  if (resize && file.mimetype.startsWith('image/')) {
    const image = sharp(buffer);
    
    if (resize.width || resize.height) {
      image.resize(resize.width, resize.height, {
        fit: resize.fit || 'inside',
        withoutEnlargement: true,
      });
    }

    // Convert to webp for better compression
    if (options.convertToWebp) {
      buffer = await image.webp({ quality }).toBuffer();
      contentType = 'image/webp';
    } else {
      buffer = await image.jpeg({ quality }).toBuffer();
      contentType = 'image/jpeg';
    }
  }

  const filename = generateFilename(file.originalname);
  const key = `${getS3Path(type, businessId)}/${filename}`;

  const command = new PutObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'max-age=31536000', // 1 year
    Metadata: {
      originalName: file.originalname,
      uploadedAt: new Date().toISOString(),
    },
  });

  await s3Client.send(command);

  const url = `https://${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com/${key}`;

  logger.info('File uploaded to S3', { key, size: buffer.length });

  return {
    url,
    key,
    filename,
    originalName: file.originalname,
    size: buffer.length,
    contentType,
  };
};

/**
 * Upload multiple files to S3
 */
const uploadMultipleToS3 = async (files, options = {}) => {
  const uploads = await Promise.all(
    files.map((file) => uploadToS3(file, options))
  );
  return uploads;
};

/**
 * Delete file from S3
 */
const deleteFromS3 = async (key) => {
  const command = new DeleteObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
  });

  await s3Client.send(command);
  logger.info('File deleted from S3', { key });
};

/**
 * Get signed URL for private files
 */
const getSignedDownloadUrl = async (key, expiresIn = 3600) => {
  const command = new GetObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
};

/**
 * Get signed URL for direct upload (presigned)
 */
const getPresignedUploadUrl = async (filename, contentType, options = {}) => {
  const { type = 'general', businessId = 'general' } = options;
  const key = `${getS3Path(type, businessId)}/${generateFilename(filename)}`;

  const command = new PutObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
    ContentType: contentType,
  });

  const uploadUrl = await getSignedUrl(s3Client, command, { expiresIn: 3600 });

  return {
    uploadUrl,
    key,
    publicUrl: `https://${config.aws.s3Bucket}.s3.${config.aws.region}.amazonaws.com/${key}`,
  };
};

// =============================================================================
// MIDDLEWARE FUNCTIONS
// =============================================================================

/**
 * Process uploaded files and upload to S3
 */
const processUpload = (options = {}) => {
  return async (req, res, next) => {
    try {
      if (!req.files && !req.file) {
        return next();
      }

      const files = req.files || [req.file];
      const businessId = req.user?.businessId || 'general';

      const uploadedFiles = await uploadMultipleToS3(files, {
        ...options,
        businessId,
      });

      req.uploadedFiles = uploadedFiles;
      next();
    } catch (error) {
      next(error);
    }
  };
};

/**
 * Validate file dimensions for images
 */
const validateImageDimensions = (minWidth, minHeight, maxWidth, maxHeight) => {
  return async (req, res, next) => {
    try {
      if (!req.files && !req.file) {
        return next();
      }

      const files = req.files || [req.file];

      for (const file of files) {
        if (!file.mimetype.startsWith('image/')) continue;

        const metadata = await sharp(file.buffer).metadata();

        if (minWidth && metadata.width < minWidth) {
          throw new BadRequestError(`Image width must be at least ${minWidth}px`);
        }
        if (minHeight && metadata.height < minHeight) {
          throw new BadRequestError(`Image height must be at least ${minHeight}px`);
        }
        if (maxWidth && metadata.width > maxWidth) {
          throw new BadRequestError(`Image width must not exceed ${maxWidth}px`);
        }
        if (maxHeight && metadata.height > maxHeight) {
          throw new BadRequestError(`Image height must not exceed ${maxHeight}px`);
        }
      }

      next();
    } catch (error) {
      next(error);
    }
  };
};

module.exports = {
  // Multer configurations
  productImages,
  businessImages,
  documents,
  chatAttachments,
  videos,
  
  // S3 helpers
  uploadToS3,
  uploadMultipleToS3,
  deleteFromS3,
  getSignedDownloadUrl,
  getPresignedUploadUrl,
  
  // Middleware
  processUpload,
  validateImageDimensions,
  
  // Utils
  generateFilename,
  getS3Path,
};
