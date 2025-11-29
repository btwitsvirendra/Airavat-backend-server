// =============================================================================
// AIRAVAT B2B MARKETPLACE - SELLER STORY ROUTES
// Routes for seller success stories
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const sellerStoryController = require('../controllers/sellerStory.controller');
const { protect, authorize, optionalAuth } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/stories
 * @desc    Get published stories
 */
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('category').optional().isString(),
    query('tag').optional().isString(),
    query('search').optional().isString(),
    query('featured').optional().isBoolean(),
  ],
  validate,
  sellerStoryController.getPublishedStories
);

/**
 * @route   GET /api/v1/stories/featured
 * @desc    Get featured stories
 */
router.get(
  '/featured',
  [query('limit').optional().isInt({ min: 1, max: 20 })],
  validate,
  sellerStoryController.getFeaturedStories
);

/**
 * @route   GET /api/v1/stories/categories
 * @desc    Get story categories
 */
router.get('/categories', sellerStoryController.getCategories);

/**
 * @route   GET /api/v1/stories/:identifier
 * @desc    Get story by ID or slug
 */
router.get(
  '/:identifier',
  [param('identifier').notEmpty().withMessage('Story identifier is required')],
  validate,
  sellerStoryController.getStory
);

/**
 * @route   GET /api/v1/stories/:id/related
 * @desc    Get related stories
 */
router.get(
  '/:id/related',
  [
    param('id').notEmpty().withMessage('Story ID is required'),
    query('limit').optional().isInt({ min: 1, max: 10 }),
  ],
  validate,
  sellerStoryController.getRelatedStories
);

/**
 * @route   GET /api/v1/stories/:id/engagement
 * @desc    Get story engagement stats
 */
router.get(
  '/:id/engagement',
  [param('id').notEmpty().withMessage('Story ID is required')],
  validate,
  sellerStoryController.getEngagementStats
);

// =============================================================================
// AUTHENTICATED ROUTES
// =============================================================================

router.use(protect);

/**
 * @route   GET /api/v1/stories/my-stories
 * @desc    Get my business stories
 */
router.get(
  '/my/list',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
    query('status').optional().isString(),
  ],
  validate,
  sellerStoryController.getMyStories
);

/**
 * @route   POST /api/v1/stories
 * @desc    Create a story
 */
router.post(
  '/',
  authorize('SELLER', 'ADMIN', 'SUPER_ADMIN'),
  [
    body('title').notEmpty().trim().withMessage('Title is required'),
    body('content').notEmpty().withMessage('Content is required'),
    body('subtitle').optional().trim(),
    body('category').optional().isString(),
    body('coverImage').optional().isURL(),
    body('images').optional().isArray(),
    body('videoUrl').optional().isURL(),
    body('metrics').optional().isObject(),
    body('tags').optional().isArray(),
  ],
  validate,
  sellerStoryController.createStory
);

/**
 * @route   PUT /api/v1/stories/:id
 * @desc    Update a story
 */
router.put(
  '/:id',
  [
    param('id').notEmpty().withMessage('Story ID is required'),
    body('title').optional().trim(),
    body('content').optional(),
    body('category').optional(),
  ],
  validate,
  sellerStoryController.updateStory
);

/**
 * @route   DELETE /api/v1/stories/:id
 * @desc    Delete a story
 */
router.delete(
  '/:id',
  [param('id').notEmpty().withMessage('Story ID is required')],
  validate,
  sellerStoryController.deleteStory
);

/**
 * @route   POST /api/v1/stories/:id/submit
 * @desc    Submit story for review
 */
router.post(
  '/:id/submit',
  [param('id').notEmpty().withMessage('Story ID is required')],
  validate,
  sellerStoryController.submitForReview
);

/**
 * @route   POST /api/v1/stories/:id/archive
 * @desc    Archive a story
 */
router.post(
  '/:id/archive',
  [param('id').notEmpty().withMessage('Story ID is required')],
  validate,
  sellerStoryController.archiveStory
);

/**
 * @route   POST /api/v1/stories/:id/like
 * @desc    Like/unlike a story
 */
router.post(
  '/:id/like',
  [param('id').notEmpty().withMessage('Story ID is required')],
  validate,
  sellerStoryController.likeStory
);

// =============================================================================
// ADMIN ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/stories/admin/pending
 * @desc    Get pending stories (Admin)
 */
router.get(
  '/admin/pending',
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 50 }),
  ],
  validate,
  sellerStoryController.getPendingStories
);

/**
 * @route   POST /api/v1/stories/admin/:id/publish
 * @desc    Publish a story (Admin)
 */
router.post(
  '/admin/:id/publish',
  authorize('ADMIN', 'SUPER_ADMIN'),
  [param('id').notEmpty().withMessage('Story ID is required')],
  validate,
  sellerStoryController.publishStory
);

/**
 * @route   POST /api/v1/stories/admin/:id/feature
 * @desc    Feature a story (Admin)
 */
router.post(
  '/admin/:id/feature',
  authorize('ADMIN', 'SUPER_ADMIN'),
  [param('id').notEmpty().withMessage('Story ID is required')],
  validate,
  sellerStoryController.featureStory
);

/**
 * @route   POST /api/v1/stories/admin/:id/reject
 * @desc    Reject a story (Admin)
 */
router.post(
  '/admin/:id/reject',
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    param('id').notEmpty().withMessage('Story ID is required'),
    body('reason').notEmpty().withMessage('Rejection reason is required'),
  ],
  validate,
  sellerStoryController.rejectStory
);

module.exports = router;



