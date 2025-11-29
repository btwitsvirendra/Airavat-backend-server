// =============================================================================
// AIRAVAT B2B MARKETPLACE - SELLER STORY CONTROLLER
// Controller for seller success stories and case studies
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const sellerStoryService = require('../services/sellerStory.service');
const logger = require('../config/logger');

// =============================================================================
// PUBLIC ENDPOINTS
// =============================================================================

/**
 * @desc    Get published stories
 * @route   GET /api/v1/stories
 * @access  Public
 */
exports.getPublishedStories = asyncHandler(async (req, res) => {
  const { page, limit, category, tag, search, featured } = req.query;

  const result = await sellerStoryService.getPublishedStories({
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 12,
    category,
    tag,
    search,
    featured: featured === 'true',
  });

  res.status(200).json({
    success: true,
    data: result.stories,
    pagination: result.pagination,
  });
});

/**
 * @desc    Get featured stories
 * @route   GET /api/v1/stories/featured
 * @access  Public
 */
exports.getFeaturedStories = asyncHandler(async (req, res) => {
  const { limit } = req.query;

  const stories = await sellerStoryService.getFeaturedStories(parseInt(limit) || 6);

  res.status(200).json({
    success: true,
    data: stories,
  });
});

/**
 * @desc    Get story by ID or slug
 * @route   GET /api/v1/stories/:identifier
 * @access  Public
 */
exports.getStory = asyncHandler(async (req, res) => {
  const story = await sellerStoryService.getStory(req.params.identifier);

  res.status(200).json({
    success: true,
    data: story,
  });
});

/**
 * @desc    Get related stories
 * @route   GET /api/v1/stories/:id/related
 * @access  Public
 */
exports.getRelatedStories = asyncHandler(async (req, res) => {
  const { limit } = req.query;

  const stories = await sellerStoryService.getRelatedStories(
    req.params.id,
    parseInt(limit) || 4
  );

  res.status(200).json({
    success: true,
    data: stories,
  });
});

/**
 * @desc    Get story categories
 * @route   GET /api/v1/stories/categories
 * @access  Public
 */
exports.getCategories = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: sellerStoryService.STORY_CATEGORIES,
  });
});

// =============================================================================
// BUSINESS STORY MANAGEMENT
// =============================================================================

/**
 * @desc    Create a story
 * @route   POST /api/v1/stories
 * @access  Private (Seller)
 */
exports.createStory = asyncHandler(async (req, res) => {
  const story = await sellerStoryService.createStory(req.user.businessId, req.body);

  res.status(201).json({
    success: true,
    message: 'Story created successfully',
    data: story,
  });
});

/**
 * @desc    Update a story
 * @route   PUT /api/v1/stories/:id
 * @access  Private (Owner)
 */
exports.updateStory = asyncHandler(async (req, res) => {
  const story = await sellerStoryService.updateStory(
    req.params.id,
    req.user.businessId,
    req.body
  );

  res.status(200).json({
    success: true,
    message: 'Story updated successfully',
    data: story,
  });
});

/**
 * @desc    Delete a story
 * @route   DELETE /api/v1/stories/:id
 * @access  Private (Owner)
 */
exports.deleteStory = asyncHandler(async (req, res) => {
  await sellerStoryService.deleteStory(req.params.id, req.user.businessId);

  res.status(200).json({
    success: true,
    message: 'Story deleted successfully',
  });
});

/**
 * @desc    Get my business stories
 * @route   GET /api/v1/stories/my-stories
 * @access  Private (Seller)
 */
exports.getMyStories = asyncHandler(async (req, res) => {
  const { page, limit, status } = req.query;

  const result = await sellerStoryService.getBusinessStories(req.user.businessId, {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 10,
    status,
  });

  res.status(200).json({
    success: true,
    data: result.stories,
    pagination: result.pagination,
  });
});

/**
 * @desc    Submit story for review
 * @route   POST /api/v1/stories/:id/submit
 * @access  Private (Owner)
 */
exports.submitForReview = asyncHandler(async (req, res) => {
  const story = await sellerStoryService.submitForReview(
    req.params.id,
    req.user.businessId
  );

  res.status(200).json({
    success: true,
    message: 'Story submitted for review',
    data: story,
  });
});

/**
 * @desc    Archive a story
 * @route   POST /api/v1/stories/:id/archive
 * @access  Private (Owner)
 */
exports.archiveStory = asyncHandler(async (req, res) => {
  const story = await sellerStoryService.archiveStory(
    req.params.id,
    req.user.businessId
  );

  res.status(200).json({
    success: true,
    message: 'Story archived successfully',
    data: story,
  });
});

// =============================================================================
// ENGAGEMENT
// =============================================================================

/**
 * @desc    Like/unlike a story
 * @route   POST /api/v1/stories/:id/like
 * @access  Private
 */
exports.likeStory = asyncHandler(async (req, res) => {
  const result = await sellerStoryService.likeStory(req.params.id, req.user.id);

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Get story engagement stats
 * @route   GET /api/v1/stories/:id/engagement
 * @access  Public
 */
exports.getEngagementStats = asyncHandler(async (req, res) => {
  const stats = await sellerStoryService.getEngagementStats(req.params.id);

  res.status(200).json({
    success: true,
    data: stats,
  });
});

// =============================================================================
// ADMIN ENDPOINTS
// =============================================================================

/**
 * @desc    Publish a story (Admin)
 * @route   POST /api/v1/stories/admin/:id/publish
 * @access  Private (Admin)
 */
exports.publishStory = asyncHandler(async (req, res) => {
  const story = await sellerStoryService.publishStory(req.params.id, req.user.id);

  res.status(200).json({
    success: true,
    message: 'Story published successfully',
    data: story,
  });
});

/**
 * @desc    Feature a story (Admin)
 * @route   POST /api/v1/stories/admin/:id/feature
 * @access  Private (Admin)
 */
exports.featureStory = asyncHandler(async (req, res) => {
  const story = await sellerStoryService.featureStory(req.params.id, req.user.id);

  res.status(200).json({
    success: true,
    message: 'Story featured successfully',
    data: story,
  });
});

/**
 * @desc    Reject a story (Admin)
 * @route   POST /api/v1/stories/admin/:id/reject
 * @access  Private (Admin)
 */
exports.rejectStory = asyncHandler(async (req, res) => {
  const { reason } = req.body;

  const story = await sellerStoryService.rejectStory(
    req.params.id,
    req.user.id,
    reason
  );

  res.status(200).json({
    success: true,
    message: 'Story rejected',
    data: story,
  });
});

/**
 * @desc    Get pending stories (Admin)
 * @route   GET /api/v1/stories/admin/pending
 * @access  Private (Admin)
 */
exports.getPendingStories = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;

  const result = await sellerStoryService.getPublishedStories({
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
    status: 'PENDING',
  });

  res.status(200).json({
    success: true,
    data: result.stories,
    pagination: result.pagination,
  });
});

module.exports = exports;



