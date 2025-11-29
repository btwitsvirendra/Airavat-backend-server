// =============================================================================
// AIRAVAT B2B MARKETPLACE - PRODUCT VIDEO CONTROLLER
// Handles video uploads and management for products
// =============================================================================

const productVideoService = require('../services/productVideo.service');
const asyncHandler = require('../middleware/async.middleware');
const { NotFoundError } = require('../utils/errors');

// =============================================================================
// VIDEO UPLOAD OPERATIONS
// =============================================================================

/**
 * Initiate video upload
 * @route POST /api/v1/products/:productId/videos/upload-url
 */
const getUploadUrl = asyncHandler(async (req, res) => {
  const uploadData = await productVideoService.initiateUpload(
    req.params.productId,
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
 * Confirm video upload completion
 * @route POST /api/v1/products/:productId/videos/:uploadId/complete
 */
const completeUpload = asyncHandler(async (req, res) => {
  const video = await productVideoService.completeUpload(
    req.params.uploadId,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Upload completed, processing started',
    data: video,
  });
});

// =============================================================================
// VIDEO MANAGEMENT
// =============================================================================

/**
 * Get all videos for a product
 * @route GET /api/v1/products/:productId/videos
 */
const getProductVideos = asyncHandler(async (req, res) => {
  const videos = await productVideoService.getProductVideos(
    req.params.productId
  );

  res.json({
    success: true,
    data: videos,
  });
});

/**
 * Get video by ID
 * @route GET /api/v1/videos/:id
 */
const getVideoById = asyncHandler(async (req, res) => {
  const video = await productVideoService.getVideoById(req.params.id);

  if (!video) {
    throw new NotFoundError('Video not found');
  }

  res.json({
    success: true,
    data: video,
  });
});

/**
 * Update video metadata
 * @route PUT /api/v1/videos/:id
 */
const updateVideo = asyncHandler(async (req, res) => {
  const video = await productVideoService.updateVideo(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Video updated successfully',
    data: video,
  });
});

/**
 * Delete a video
 * @route DELETE /api/v1/videos/:id
 */
const deleteVideo = asyncHandler(async (req, res) => {
  await productVideoService.deleteVideo(req.params.id, req.user.id);

  res.json({
    success: true,
    message: 'Video deleted successfully',
  });
});

/**
 * Set primary video for product
 * @route POST /api/v1/videos/:id/set-primary
 */
const setPrimaryVideo = asyncHandler(async (req, res) => {
  const video = await productVideoService.setPrimaryVideo(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Primary video set',
    data: video,
  });
});

/**
 * Reorder videos for a product
 * @route PUT /api/v1/products/:productId/videos/reorder
 */
const reorderVideos = asyncHandler(async (req, res) => {
  const videos = await productVideoService.reorderVideos(
    req.params.productId,
    req.user.id,
    req.body.videoOrder
  );

  res.json({
    success: true,
    message: 'Videos reordered successfully',
    data: videos,
  });
});

// =============================================================================
// VIDEO STREAMING
// =============================================================================

/**
 * Get video streaming URL
 * @route GET /api/v1/videos/:id/stream
 */
const getStreamUrl = asyncHandler(async (req, res) => {
  const streamData = await productVideoService.getStreamUrl(
    req.params.id,
    req.query.quality
  );

  res.json({
    success: true,
    data: streamData,
  });
});

/**
 * Record video view
 * @route POST /api/v1/videos/:id/view
 */
const recordView = asyncHandler(async (req, res) => {
  await productVideoService.recordView(
    req.params.id,
    req.user?.id,
    req.body.watchDuration
  );

  res.json({
    success: true,
    message: 'View recorded',
  });
});

// =============================================================================
// VIDEO ANALYTICS
// =============================================================================

/**
 * Get video analytics
 * @route GET /api/v1/videos/:id/analytics
 */
const getVideoAnalytics = asyncHandler(async (req, res) => {
  const analytics = await productVideoService.getVideoAnalytics(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    data: analytics,
  });
});

/**
 * Get processing status
 * @route GET /api/v1/videos/:id/status
 */
const getProcessingStatus = asyncHandler(async (req, res) => {
  const status = await productVideoService.getProcessingStatus(req.params.id);

  res.json({
    success: true,
    data: status,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  getUploadUrl,
  completeUpload,
  getProductVideos,
  getVideoById,
  updateVideo,
  deleteVideo,
  setPrimaryVideo,
  reorderVideos,
  getStreamUrl,
  recordView,
  getVideoAnalytics,
  getProcessingStatus,
};



