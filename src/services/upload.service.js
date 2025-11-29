// =============================================================================
// AIRAVAT B2B MARKETPLACE - UPLOAD SERVICE
// AWS S3 file upload with image processing
// =============================================================================

const {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const sharp = require('sharp');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const config = require('../config');
const logger = require('../config/logger');
const { BadRequestError } = require('../utils/errors');

// Initialize S3 client
const s3Client = new S3Client({
  region: config.aws.region,
  credentials: {
    accessKeyId: config.aws.accessKeyId,
    secretAccessKey: config.aws.secretAccessKey,
  },
});

const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];
const ALLOWED_DOC_TYPES = ['application/pdf', 'image/jpeg', 'image/png'];
const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB

/**
 * Upload file to S3
 */
const uploadFile = async (file, options = {}) => {
  const {
    folder = 'uploads',
    resize = null,
    allowedTypes = null,
    maxSize = MAX_FILE_SIZE,
  } = options;

  // Validate file size
  if (file.size > maxSize) {
    throw new BadRequestError(`File size exceeds ${maxSize / (1024 * 1024)}MB limit`);
  }

  // Validate file type
  const mimeTypes = allowedTypes || [...ALLOWED_IMAGE_TYPES, ...ALLOWED_DOC_TYPES];
  if (!mimeTypes.includes(file.mimetype)) {
    throw new BadRequestError(`File type ${file.mimetype} not allowed`);
  }

  // Generate unique filename
  const ext = path.extname(file.originalname).toLowerCase();
  const filename = `${uuidv4()}${ext}`;
  const key = `${folder}/${filename}`;

  let buffer = file.buffer;
  let contentType = file.mimetype;

  // Process image if resize options provided
  if (resize && ALLOWED_IMAGE_TYPES.includes(file.mimetype)) {
    const processed = await processImage(buffer, resize);
    buffer = processed.buffer;
    contentType = processed.contentType;
  }

  // Upload to S3
  const command = new PutObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
    Body: buffer,
    ContentType: contentType,
    CacheControl: 'max-age=31536000', // 1 year cache
  });

  try {
    await s3Client.send(command);
    const url = `${config.aws.s3Url}/${key}`;
    
    logger.info(`File uploaded: ${url}`);
    return url;
  } catch (error) {
    logger.error('S3 upload error:', error);
    throw new BadRequestError('Failed to upload file');
  }
};

/**
 * Process image with sharp
 */
const processImage = async (buffer, options) => {
  const { width, height, fit = 'inside', quality = 80, format = 'webp' } = options;

  let processor = sharp(buffer);

  // Resize
  if (width || height) {
    processor = processor.resize(width, height, {
      fit,
      withoutEnlargement: true,
    });
  }

  // Convert to WebP for better compression (unless specified otherwise)
  let outputBuffer;
  let contentType;

  switch (format) {
    case 'jpeg':
    case 'jpg':
      outputBuffer = await processor.jpeg({ quality }).toBuffer();
      contentType = 'image/jpeg';
      break;
    case 'png':
      outputBuffer = await processor.png({ quality }).toBuffer();
      contentType = 'image/png';
      break;
    case 'webp':
    default:
      outputBuffer = await processor.webp({ quality }).toBuffer();
      contentType = 'image/webp';
      break;
  }

  return { buffer: outputBuffer, contentType };
};

/**
 * Upload multiple files
 */
const uploadMultiple = async (files, options = {}) => {
  const urls = [];
  
  for (const file of files) {
    const url = await uploadFile(file, options);
    urls.push(url);
  }

  return urls;
};

/**
 * Delete file from S3
 */
const deleteFile = async (url) => {
  try {
    // Extract key from URL
    const key = url.replace(`${config.aws.s3Url}/`, '');

    const command = new DeleteObjectCommand({
      Bucket: config.aws.s3Bucket,
      Key: key,
    });

    await s3Client.send(command);
    logger.info(`File deleted: ${url}`);
    return true;
  } catch (error) {
    logger.error('S3 delete error:', error);
    return false;
  }
};

/**
 * Delete multiple files
 */
const deleteMultiple = async (urls) => {
  const results = await Promise.all(urls.map(deleteFile));
  return results;
};

/**
 * Generate presigned URL for direct upload
 */
const getPresignedUploadUrl = async (filename, contentType, folder = 'uploads') => {
  const ext = path.extname(filename).toLowerCase();
  const key = `${folder}/${uuidv4()}${ext}`;

  const command = new PutObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
    ContentType: contentType,
  });

  const presignedUrl = await getSignedUrl(s3Client, command, {
    expiresIn: 3600, // 1 hour
  });

  return {
    uploadUrl: presignedUrl,
    fileUrl: `${config.aws.s3Url}/${key}`,
    key,
  };
};

/**
 * Generate presigned URL for download
 */
const getPresignedDownloadUrl = async (url, expiresIn = 3600) => {
  const key = url.replace(`${config.aws.s3Url}/`, '');

  const command = new GetObjectCommand({
    Bucket: config.aws.s3Bucket,
    Key: key,
  });

  return getSignedUrl(s3Client, command, { expiresIn });
};

/**
 * Create thumbnail from image
 */
const createThumbnail = async (buffer, size = 200) => {
  return sharp(buffer)
    .resize(size, size, { fit: 'cover' })
    .webp({ quality: 70 })
    .toBuffer();
};

/**
 * Get image metadata
 */
const getImageMetadata = async (buffer) => {
  const metadata = await sharp(buffer).metadata();
  return {
    width: metadata.width,
    height: metadata.height,
    format: metadata.format,
    size: metadata.size,
  };
};

module.exports = {
  uploadFile,
  uploadMultiple,
  deleteFile,
  deleteMultiple,
  getPresignedUploadUrl,
  getPresignedDownloadUrl,
  createThumbnail,
  getImageMetadata,
  processImage,
  ALLOWED_IMAGE_TYPES,
  ALLOWED_DOC_TYPES,
};
