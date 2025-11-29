// =============================================================================
// AIRAVAT B2B MARKETPLACE - PRODUCT VIDEO SERVICE
// Service for managing product video uploads and streaming
// =============================================================================

const crypto = require('crypto');
const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  maxFileSize: 500 * 1024 * 1024, // 500MB
  maxVideosPerProduct: 5,
  allowedFormats: ['mp4', 'webm', 'mov', 'avi', 'mkv'],
  maxDuration: 600, // 10 minutes
  thumbnailSizes: [
    { name: 'small', width: 160, height: 90 },
    { name: 'medium', width: 320, height: 180 },
    { name: 'large', width: 640, height: 360 },
  ],
  transcodingProfiles: [
    { name: '360p', width: 640, height: 360, bitrate: '800k' },
    { name: '480p', width: 854, height: 480, bitrate: '1500k' },
    { name: '720p', width: 1280, height: 720, bitrate: '3000k' },
    { name: '1080p', width: 1920, height: 1080, bitrate: '6000k' },
  ],
};

/**
 * Video statuses
 */
const VIDEO_STATUS = {
  PENDING: 'Pending Upload',
  UPLOADING: 'Uploading',
  PROCESSING: 'Processing',
  READY: 'Ready',
  FAILED: 'Failed',
  DELETED: 'Deleted',
};

/**
 * Video types
 */
const VIDEO_TYPES = {
  PRODUCT_DEMO: 'Product Demo',
  UNBOXING: 'Unboxing',
  TUTORIAL: 'Tutorial',
  REVIEW: 'Review',
  MANUFACTURING: 'Manufacturing Process',
  TESTIMONIAL: 'Customer Testimonial',
  COMPARISON: 'Product Comparison',
  PROMO: 'Promotional',
};

// =============================================================================
// UPLOAD OPERATIONS
// =============================================================================

/**
 * Initialize video upload
 * @param {string} productId - Product ID
 * @param {string} userId - Uploader user ID
 * @param {Object} metadata - Video metadata
 * @returns {Promise<Object>} Upload initialization data
 */
exports.initializeUpload = async (productId, userId, metadata) => {
  try {
    const {
      filename,
      fileSize,
      mimeType,
      title,
      description,
      videoType = 'PRODUCT_DEMO',
      duration,
    } = metadata;

    // Validate product ownership
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { business: true },
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    if (product.business.ownerId !== userId) {
      throw new AppError('Not authorized to add videos to this product', 403);
    }

    // Check video limit
    const existingCount = await prisma.productVideo.count({
      where: { productId, status: { not: 'DELETED' } },
    });

    if (existingCount >= CONFIG.maxVideosPerProduct) {
      throw new AppError(`Maximum ${CONFIG.maxVideosPerProduct} videos per product`, 400);
    }

    // Validate file
    const extension = filename.split('.').pop().toLowerCase();
    if (!CONFIG.allowedFormats.includes(extension)) {
      throw new AppError(`Invalid format. Allowed: ${CONFIG.allowedFormats.join(', ')}`, 400);
    }

    if (fileSize > CONFIG.maxFileSize) {
      throw new AppError(`File too large. Maximum: ${CONFIG.maxFileSize / 1024 / 1024}MB`, 400);
    }

    if (duration && duration > CONFIG.maxDuration) {
      throw new AppError(`Video too long. Maximum: ${CONFIG.maxDuration} seconds`, 400);
    }

    // Generate upload ID and storage path
    const uploadId = crypto.randomBytes(16).toString('hex');
    const storagePath = `videos/products/${productId}/${uploadId}`;

    // Create video record
    const video = await prisma.productVideo.create({
      data: {
        productId,
        uploaderId: userId,
        uploadId,
        title: title || filename,
        description,
        videoType,
        originalFilename: filename,
        fileSize,
        mimeType,
        storagePath,
        status: 'PENDING',
        metadata: {
          duration,
          extension,
        },
      },
    });

    // Generate presigned upload URL (placeholder - implement with your storage provider)
    const uploadUrl = await generatePresignedUploadUrl(storagePath, mimeType);

    logger.info('Video upload initialized', {
      videoId: video.id,
      productId,
      uploadId,
    });

    return {
      videoId: video.id,
      uploadId,
      uploadUrl,
      expiresIn: 3600, // 1 hour
    };
  } catch (error) {
    logger.error('Initialize upload error', { error: error.message, productId });
    throw error;
  }
};

/**
 * Complete video upload
 * @param {string} videoId - Video ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Video processing status
 */
exports.completeUpload = async (videoId, userId) => {
  try {
    const video = await prisma.productVideo.findUnique({
      where: { id: videoId },
      include: { product: { include: { business: true } } },
    });

    if (!video) {
      throw new AppError('Video not found', 404);
    }

    if (video.product.business.ownerId !== userId) {
      throw new AppError('Not authorized', 403);
    }

    if (video.status !== 'PENDING') {
      throw new AppError('Upload already completed', 400);
    }

    // Update status
    const updated = await prisma.productVideo.update({
      where: { id: videoId },
      data: {
        status: 'PROCESSING',
        uploadedAt: new Date(),
      },
    });

    // Queue for processing (transcoding, thumbnail generation)
    await queueVideoProcessing(videoId);

    logger.info('Video upload completed, processing started', { videoId });

    return {
      videoId,
      status: 'PROCESSING',
      message: 'Video is being processed. This may take a few minutes.',
    };
  } catch (error) {
    logger.error('Complete upload error', { error: error.message, videoId });
    throw error;
  }
};

/**
 * Process video (transcoding, thumbnails)
 * @param {string} videoId - Video ID
 * @returns {Promise<Object>} Processing result
 */
exports.processVideo = async (videoId) => {
  try {
    const video = await prisma.productVideo.findUnique({
      where: { id: videoId },
    });

    if (!video) {
      throw new AppError('Video not found', 404);
    }

    // Generate thumbnails (placeholder - implement with FFmpeg or cloud service)
    const thumbnails = await generateThumbnails(video.storagePath);

    // Transcode to multiple qualities (placeholder)
    const variants = await transcodeVideo(video.storagePath);

    // Extract video info (placeholder)
    const videoInfo = await extractVideoInfo(video.storagePath);

    // Update video record
    const updated = await prisma.productVideo.update({
      where: { id: videoId },
      data: {
        status: 'READY',
        thumbnails,
        variants,
        duration: videoInfo.duration,
        resolution: videoInfo.resolution,
        aspectRatio: videoInfo.aspectRatio,
        processedAt: new Date(),
        metadata: {
          ...video.metadata,
          ...videoInfo,
        },
      },
    });

    logger.info('Video processing completed', { videoId });

    return updated;
  } catch (error) {
    logger.error('Process video error', { error: error.message, videoId });

    await prisma.productVideo.update({
      where: { id: videoId },
      data: {
        status: 'FAILED',
        processingError: error.message,
      },
    });

    throw error;
  }
};

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * Get video by ID
 * @param {string} videoId - Video ID
 * @returns {Promise<Object>} Video details
 */
exports.getVideo = async (videoId) => {
  const video = await prisma.productVideo.findUnique({
    where: { id: videoId },
    include: {
      product: {
        select: { id: true, name: true, slug: true },
      },
      uploader: {
        select: { id: true, firstName: true, lastName: true },
      },
    },
  });

  if (!video || video.status === 'DELETED') {
    throw new AppError('Video not found', 404);
  }

  // Increment view count
  await prisma.productVideo.update({
    where: { id: videoId },
    data: { viewCount: { increment: 1 } },
  });

  return {
    ...video,
    statusInfo: VIDEO_STATUS[video.status],
    typeInfo: VIDEO_TYPES[video.videoType],
  };
};

/**
 * Get videos for a product
 * @param {string} productId - Product ID
 * @param {Object} options - Query options
 * @returns {Promise<Object[]>} Product videos
 */
exports.getProductVideos = async (productId, options = {}) => {
  const { includeProcessing = false } = options;

  const where = { productId };

  if (!includeProcessing) {
    where.status = 'READY';
  } else {
    where.status = { notIn: ['DELETED'] };
  }

  const videos = await prisma.productVideo.findMany({
    where,
    orderBy: { order: 'asc' },
    include: {
      uploader: {
        select: { id: true, firstName: true },
      },
    },
  });

  return videos.map((v) => ({
    ...v,
    statusInfo: VIDEO_STATUS[v.status],
    typeInfo: VIDEO_TYPES[v.videoType],
  }));
};

/**
 * Get streaming URL for video
 * @param {string} videoId - Video ID
 * @param {string} quality - Video quality
 * @returns {Promise<Object>} Streaming URLs
 */
exports.getStreamingUrl = async (videoId, quality = 'auto') => {
  const video = await prisma.productVideo.findUnique({
    where: { id: videoId },
  });

  if (!video || video.status !== 'READY') {
    throw new AppError('Video not available', 404);
  }

  // Generate signed streaming URLs (placeholder)
  const urls = {};
  
  if (video.variants) {
    for (const [q, path] of Object.entries(video.variants)) {
      urls[q] = await generateSignedUrl(path);
    }
  }

  return {
    videoId,
    quality,
    urls,
    duration: video.duration,
    thumbnails: video.thumbnails,
  };
};

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * Update video details
 * @param {string} videoId - Video ID
 * @param {string} userId - User ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated video
 */
exports.updateVideo = async (videoId, userId, data) => {
  const video = await prisma.productVideo.findUnique({
    where: { id: videoId },
    include: { product: { include: { business: true } } },
  });

  if (!video) {
    throw new AppError('Video not found', 404);
  }

  if (video.product.business.ownerId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  const updateData = {};
  const allowedFields = ['title', 'description', 'videoType', 'order'];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updateData[field] = data[field];
    }
  }

  const updated = await prisma.productVideo.update({
    where: { id: videoId },
    data: updateData,
  });

  logger.info('Video updated', { videoId, userId });

  return updated;
};

/**
 * Reorder videos
 * @param {string} productId - Product ID
 * @param {string} userId - User ID
 * @param {Object[]} orderData - Array of {videoId, order}
 * @returns {Promise<Object>} Reorder result
 */
exports.reorderVideos = async (productId, userId, orderData) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { business: true },
  });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  if (product.business.ownerId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  await prisma.$transaction(
    orderData.map(({ videoId, order }) =>
      prisma.productVideo.update({
        where: { id: videoId },
        data: { order },
      })
    )
  );

  return { success: true };
};

/**
 * Set primary video
 * @param {string} productId - Product ID
 * @param {string} videoId - Video ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Result
 */
exports.setPrimaryVideo = async (productId, videoId, userId) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { business: true },
  });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  if (product.business.ownerId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  // Remove primary from all
  await prisma.productVideo.updateMany({
    where: { productId, isPrimary: true },
    data: { isPrimary: false },
  });

  // Set new primary
  await prisma.productVideo.update({
    where: { id: videoId },
    data: { isPrimary: true },
  });

  return { success: true };
};

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * Delete video
 * @param {string} videoId - Video ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Deletion result
 */
exports.deleteVideo = async (videoId, userId) => {
  const video = await prisma.productVideo.findUnique({
    where: { id: videoId },
    include: { product: { include: { business: true } } },
  });

  if (!video) {
    throw new AppError('Video not found', 404);
  }

  if (video.product.business.ownerId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  // Soft delete
  await prisma.productVideo.update({
    where: { id: videoId },
    data: {
      status: 'DELETED',
      deletedAt: new Date(),
    },
  });

  // Queue storage cleanup
  await queueStorageCleanup(video.storagePath);

  logger.info('Video deleted', { videoId, userId });

  return { success: true };
};

// =============================================================================
// ANALYTICS
// =============================================================================

/**
 * Get video analytics
 * @param {string} videoId - Video ID
 * @param {string} userId - Owner user ID
 * @returns {Promise<Object>} Analytics data
 */
exports.getVideoAnalytics = async (videoId, userId) => {
  const video = await prisma.productVideo.findUnique({
    where: { id: videoId },
    include: { product: { include: { business: true } } },
  });

  if (!video) {
    throw new AppError('Video not found', 404);
  }

  if (video.product.business.ownerId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  const [viewsByDay, avgWatchTime] = await Promise.all([
    prisma.$queryRaw`
      SELECT DATE(viewed_at) as date, COUNT(*) as views
      FROM video_views
      WHERE video_id = ${videoId}
      GROUP BY DATE(viewed_at)
      ORDER BY date DESC
      LIMIT 30
    `,
    prisma.videoView.aggregate({
      where: { videoId },
      _avg: { watchDuration: true },
    }),
  ]);

  return {
    videoId,
    totalViews: video.viewCount,
    avgWatchTime: avgWatchTime._avg.watchDuration || 0,
    completionRate: video.duration 
      ? ((avgWatchTime._avg.watchDuration || 0) / video.duration * 100).toFixed(2) 
      : 0,
    viewsByDay,
  };
};

/**
 * Track video view
 * @param {string} videoId - Video ID
 * @param {Object} data - View data
 * @returns {Promise<Object>} Tracking result
 */
exports.trackView = async (videoId, data) => {
  const { userId, watchDuration, completed } = data;

  try {
    await prisma.videoView.create({
      data: {
        videoId,
        userId,
        watchDuration,
        completed: completed || false,
        viewedAt: new Date(),
      },
    });

    return { tracked: true };
  } catch (error) {
    logger.warn('Track view error', { error: error.message });
    return { tracked: false };
  }
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate presigned upload URL
 * Implement with your cloud storage provider (S3, GCS, Azure Blob)
 */
async function generatePresignedUploadUrl(storagePath, mimeType) {
  // Placeholder - implement with your storage provider
  const baseUrl = process.env.STORAGE_URL || 'https://storage.airavat.com';
  return `${baseUrl}/${storagePath}?upload=true`;
}

/**
 * Generate signed URL for streaming
 */
async function generateSignedUrl(path) {
  const baseUrl = process.env.CDN_URL || 'https://cdn.airavat.com';
  return `${baseUrl}/${path}`;
}

/**
 * Queue video for processing
 */
async function queueVideoProcessing(videoId) {
  // Implement with your job queue (Bull, etc.)
  logger.info('Video queued for processing', { videoId });
}

/**
 * Queue storage cleanup
 */
async function queueStorageCleanup(storagePath) {
  // Implement cleanup job
  logger.info('Storage cleanup queued', { storagePath });
}

/**
 * Generate thumbnails
 */
async function generateThumbnails(storagePath) {
  // Placeholder - implement with FFmpeg
  return {
    small: `${storagePath}/thumb_small.jpg`,
    medium: `${storagePath}/thumb_medium.jpg`,
    large: `${storagePath}/thumb_large.jpg`,
  };
}

/**
 * Transcode video
 */
async function transcodeVideo(storagePath) {
  // Placeholder - implement with FFmpeg or cloud transcoding
  return {
    '360p': `${storagePath}/360p.mp4`,
    '480p': `${storagePath}/480p.mp4`,
    '720p': `${storagePath}/720p.mp4`,
  };
}

/**
 * Extract video info
 */
async function extractVideoInfo(storagePath) {
  // Placeholder - implement with FFprobe
  return {
    duration: 120,
    resolution: '1920x1080',
    aspectRatio: '16:9',
    codec: 'h264',
    fps: 30,
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  VIDEO_STATUS,
  VIDEO_TYPES,
  CONFIG,
};



