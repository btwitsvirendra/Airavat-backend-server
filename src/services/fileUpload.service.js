// =============================================================================
// AIRAVAT B2B MARKETPLACE - FILE UPLOAD SERVICE
// Secure file upload handling with validation and processing
// =============================================================================

const multer = require('multer');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const fs = require('fs').promises;
const logger = require('../config/logger');

/**
 * File type configurations
 */
const FILE_TYPES = {
  IMAGE: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/gif', 'image/webp'],
    maxSize: 5 * 1024 * 1024, // 5MB
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp'],
  },
  DOCUMENT: {
    mimeTypes: [
      'application/pdf',
      'application/msword',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
    maxSize: 10 * 1024 * 1024, // 10MB
    extensions: ['.pdf', '.doc', '.docx', '.xls', '.xlsx'],
  },
  VIDEO: {
    mimeTypes: ['video/mp4', 'video/webm', 'video/quicktime'],
    maxSize: 100 * 1024 * 1024, // 100MB
    extensions: ['.mp4', '.webm', '.mov'],
  },
  AVATAR: {
    mimeTypes: ['image/jpeg', 'image/png', 'image/webp'],
    maxSize: 2 * 1024 * 1024, // 2MB
    extensions: ['.jpg', '.jpeg', '.png', '.webp'],
  },
};

/**
 * Image processing presets
 */
const IMAGE_PRESETS = {
  thumbnail: { width: 150, height: 150, fit: 'cover' },
  small: { width: 300, height: 300, fit: 'inside' },
  medium: { width: 600, height: 600, fit: 'inside' },
  large: { width: 1200, height: 1200, fit: 'inside' },
  avatar: { width: 200, height: 200, fit: 'cover' },
  productMain: { width: 800, height: 800, fit: 'inside' },
  productThumb: { width: 200, height: 200, fit: 'cover' },
  banner: { width: 1920, height: 600, fit: 'cover' },
};

class FileUploadService {
  constructor() {
    this.uploadDir = process.env.UPLOAD_DIR || './uploads';
    this.tempDir = path.join(this.uploadDir, 'temp');
    this.initDirectories();
  }

  /**
   * Initialize upload directories
   */
  async initDirectories() {
    const dirs = [
      this.uploadDir,
      this.tempDir,
      path.join(this.uploadDir, 'images'),
      path.join(this.uploadDir, 'documents'),
      path.join(this.uploadDir, 'videos'),
      path.join(this.uploadDir, 'avatars'),
    ];

    for (const dir of dirs) {
      try {
        await fs.mkdir(dir, { recursive: true });
      } catch (error) {
        // Directory exists
      }
    }
  }

  /**
   * Generate unique filename
   */
  generateFilename(originalName) {
    const ext = path.extname(originalName).toLowerCase();
    const timestamp = Date.now();
    const random = crypto.randomBytes(8).toString('hex');
    return `${timestamp}-${random}${ext}`;
  }

  /**
   * Get storage configuration for multer
   */
  getStorage(destination) {
    return multer.diskStorage({
      destination: (req, file, cb) => {
        cb(null, destination || this.tempDir);
      },
      filename: (req, file, cb) => {
        cb(null, this.generateFilename(file.originalname));
      },
    });
  }

  /**
   * Validate file type
   */
  validateFileType(file, allowedTypes) {
    const config = FILE_TYPES[allowedTypes];
    if (!config) return { valid: false, error: 'Unknown file type category' };

    const ext = path.extname(file.originalname).toLowerCase();

    if (!config.extensions.includes(ext)) {
      return {
        valid: false,
        error: `Invalid file extension. Allowed: ${config.extensions.join(', ')}`,
      };
    }

    if (!config.mimeTypes.includes(file.mimetype)) {
      return {
        valid: false,
        error: `Invalid file type. Allowed: ${config.mimeTypes.join(', ')}`,
      };
    }

    return { valid: true };
  }

  /**
   * Create multer upload middleware
   */
  createUploader(options = {}) {
    const {
      fileType = 'IMAGE',
      fieldName = 'file',
      maxCount = 1,
      destination,
    } = options;

    const config = FILE_TYPES[fileType];

    const fileFilter = (req, file, cb) => {
      const validation = this.validateFileType(file, fileType);
      if (validation.valid) {
        cb(null, true);
      } else {
        cb(new Error(validation.error), false);
      }
    };

    const upload = multer({
      storage: this.getStorage(destination),
      limits: {
        fileSize: config.maxSize,
        files: maxCount,
      },
      fileFilter,
    });

    if (maxCount === 1) {
      return upload.single(fieldName);
    }
    return upload.array(fieldName, maxCount);
  }

  /**
   * Process and optimize image
   */
  async processImage(filePath, preset = 'medium', options = {}) {
    const presetConfig = IMAGE_PRESETS[preset] || IMAGE_PRESETS.medium;
    const outputFormat = options.format || 'webp';
    const quality = options.quality || 80;

    const outputFilename = path.basename(filePath, path.extname(filePath)) + '.' + outputFormat;
    const outputDir = path.dirname(filePath);
    const outputPath = path.join(outputDir, outputFilename);

    try {
      let pipeline = sharp(filePath);

      // Resize
      pipeline = pipeline.resize(presetConfig.width, presetConfig.height, {
        fit: presetConfig.fit,
        withoutEnlargement: true,
      });

      // Convert format and set quality
      switch (outputFormat) {
        case 'webp':
          pipeline = pipeline.webp({ quality });
          break;
        case 'jpeg':
        case 'jpg':
          pipeline = pipeline.jpeg({ quality, progressive: true });
          break;
        case 'png':
          pipeline = pipeline.png({ compressionLevel: 9 });
          break;
      }

      // Save
      await pipeline.toFile(outputPath);

      // Get metadata
      const metadata = await sharp(outputPath).metadata();

      return {
        path: outputPath,
        filename: outputFilename,
        width: metadata.width,
        height: metadata.height,
        size: metadata.size,
        format: metadata.format,
      };
    } catch (error) {
      logger.error('Image processing failed', { filePath, error: error.message });
      throw error;
    }
  }

  /**
   * Generate multiple image sizes
   */
  async generateImageSizes(filePath, presets = ['thumbnail', 'medium', 'large']) {
    const results = {};

    for (const preset of presets) {
      try {
        results[preset] = await this.processImage(filePath, preset);
      } catch (error) {
        logger.error(`Failed to generate ${preset} image`, { error: error.message });
      }
    }

    return results;
  }

  /**
   * Upload to cloud storage (S3)
   */
  async uploadToS3(filePath, key, options = {}) {
    const { S3Client, PutObjectCommand } = require('@aws-sdk/client-s3');

    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'ap-south-1',
      credentials: {
        accessKeyId: process.env.AWS_ACCESS_KEY_ID,
        secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      },
    });

    const fileContent = await fs.readFile(filePath);
    const contentType = options.contentType || this.getMimeType(filePath);

    const command = new PutObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
      Body: fileContent,
      ContentType: contentType,
      ACL: options.public ? 'public-read' : 'private',
      CacheControl: options.cacheControl || 'max-age=31536000',
    });

    await s3Client.send(command);

    // Return public URL
    const baseUrl = process.env.AWS_CLOUDFRONT_URL || 
      `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION}.amazonaws.com`;

    return `${baseUrl}/${key}`;
  }

  /**
   * Delete from S3
   */
  async deleteFromS3(key) {
    const { S3Client, DeleteObjectCommand } = require('@aws-sdk/client-s3');

    const s3Client = new S3Client({
      region: process.env.AWS_REGION || 'ap-south-1',
    });

    const command = new DeleteObjectCommand({
      Bucket: process.env.AWS_S3_BUCKET,
      Key: key,
    });

    await s3Client.send(command);
  }

  /**
   * Get MIME type from file path
   */
  getMimeType(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    const mimeTypes = {
      '.jpg': 'image/jpeg',
      '.jpeg': 'image/jpeg',
      '.png': 'image/png',
      '.gif': 'image/gif',
      '.webp': 'image/webp',
      '.pdf': 'application/pdf',
      '.doc': 'application/msword',
      '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      '.xls': 'application/vnd.ms-excel',
      '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      '.mp4': 'video/mp4',
      '.webm': 'video/webm',
    };
    return mimeTypes[ext] || 'application/octet-stream';
  }

  /**
   * Validate file with virus scanning (placeholder)
   */
  async scanForVirus(filePath) {
    // Placeholder for virus scanning integration
    // In production, integrate with ClamAV or similar
    logger.debug('Virus scan placeholder', { filePath });
    return { clean: true };
  }

  /**
   * Clean up temporary files
   */
  async cleanupTempFiles(maxAge = 3600000) {
    try {
      const files = await fs.readdir(this.tempDir);
      const now = Date.now();
      let cleaned = 0;

      for (const file of files) {
        const filePath = path.join(this.tempDir, file);
        const stat = await fs.stat(filePath);

        if (now - stat.mtimeMs > maxAge) {
          await fs.unlink(filePath);
          cleaned++;
        }
      }

      logger.info(`Cleaned up ${cleaned} temporary files`);
      return cleaned;
    } catch (error) {
      logger.error('Temp file cleanup failed', { error: error.message });
      return 0;
    }
  }

  /**
   * Handle product image upload
   */
  async handleProductImageUpload(file, businessId, productId) {
    const key = `products/${businessId}/${productId}/${file.filename}`;

    // Process image to multiple sizes
    const sizes = await this.generateImageSizes(file.path, ['thumbnail', 'medium', 'large']);

    // Upload all sizes to S3
    const urls = {};

    for (const [size, processed] of Object.entries(sizes)) {
      const sizeKey = `products/${businessId}/${productId}/${size}-${processed.filename}`;
      urls[size] = await this.uploadToS3(processed.path, sizeKey, { public: true });

      // Clean up local file
      await fs.unlink(processed.path).catch(() => {});
    }

    // Clean up original
    await fs.unlink(file.path).catch(() => {});

    return urls;
  }

  /**
   * Handle document upload
   */
  async handleDocumentUpload(file, userId, category) {
    const key = `documents/${userId}/${category}/${file.filename}`;

    // Scan for virus
    const scanResult = await this.scanForVirus(file.path);
    if (!scanResult.clean) {
      await fs.unlink(file.path);
      throw new Error('File failed virus scan');
    }

    // Upload to S3
    const url = await this.uploadToS3(file.path, key, { public: false });

    // Clean up local file
    await fs.unlink(file.path).catch(() => {});

    return {
      url,
      key,
      originalName: file.originalname,
      size: file.size,
      mimeType: file.mimetype,
    };
  }

  /**
   * Handle avatar upload
   */
  async handleAvatarUpload(file, userId) {
    // Process to avatar size
    const processed = await this.processImage(file.path, 'avatar', {
      format: 'webp',
      quality: 90,
    });

    // Upload to S3
    const key = `avatars/${userId}/${processed.filename}`;
    const url = await this.uploadToS3(processed.path, key, { public: true });

    // Clean up local files
    await fs.unlink(file.path).catch(() => {});
    await fs.unlink(processed.path).catch(() => {});

    return url;
  }
}

// Create express middleware
function uploadMiddleware(options = {}) {
  const uploadService = new FileUploadService();
  return uploadService.createUploader(options);
}

// Error handler middleware
function uploadErrorHandler(err, req, res, next) {
  if (err instanceof multer.MulterError) {
    if (err.code === 'LIMIT_FILE_SIZE') {
      return res.status(400).json({
        success: false,
        error: 'File too large',
        code: 'FILE_TOO_LARGE',
      });
    }
    if (err.code === 'LIMIT_FILE_COUNT') {
      return res.status(400).json({
        success: false,
        error: 'Too many files',
        code: 'TOO_MANY_FILES',
      });
    }
    return res.status(400).json({
      success: false,
      error: err.message,
      code: 'UPLOAD_ERROR',
    });
  }

  if (err.message && err.message.includes('Invalid file')) {
    return res.status(400).json({
      success: false,
      error: err.message,
      code: 'INVALID_FILE_TYPE',
    });
  }

  next(err);
}

module.exports = {
  FileUploadService,
  uploadMiddleware,
  uploadErrorHandler,
  FILE_TYPES,
  IMAGE_PRESETS,
};
