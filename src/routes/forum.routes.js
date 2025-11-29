// =============================================================================
// AIRAVAT B2B MARKETPLACE - DISCUSSION FORUM ROUTES
// Routes for community discussions and knowledge sharing
// =============================================================================

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const forumController = require('../controllers/forum.controller');
const { authenticate, optionalAuth } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const createPostValidation = [
  body('title').notEmpty().trim().isLength({ min: 5, max: 200 }),
  body('content').notEmpty().isLength({ min: 20 }),
  body('category').optional().isString(),
  body('tags').optional().isArray(),
];

const updatePostValidation = [
  param('id').isUUID(),
  body('title').optional().trim().isLength({ min: 5, max: 200 }),
  body('content').optional().isLength({ min: 20 }),
];

const replyValidation = [
  param('postId').isUUID(),
  body('content').notEmpty().isLength({ min: 5 }),
  body('parentReplyId').optional().isUUID(),
];

const pollValidation = [
  param('postId').isUUID(),
  body('question').notEmpty().isLength({ max: 200 }),
  body('options').isArray({ min: 2, max: 10 }),
  body('options.*.text').notEmpty(),
  body('endsAt').optional().isISO8601(),
];

const reportValidation = [
  body('entityType').isIn(['post', 'reply']),
  body('entityId').isUUID(),
  body('reason').notEmpty().isLength({ max: 500 }),
];

// =============================================================================
// PUBLIC ROUTES (OPTIONAL AUTH)
// =============================================================================

router.get('/categories', forumController.getCategories);

router.get('/trending', forumController.getTrending);

router.get('/search', forumController.searchForum);

router.get(
  '/posts',
  optionalAuth,
  forumController.getPosts
);

router.get(
  '/posts/:idOrSlug',
  optionalAuth,
  forumController.getPost
);

router.get(
  '/posts/:postId/replies',
  param('postId').isUUID(),
  validate,
  forumController.getReplies
);

// =============================================================================
// AUTHENTICATED ROUTES
// =============================================================================

router.post(
  '/posts',
  authenticate,
  createPostValidation,
  validate,
  forumController.createPost
);

router.put(
  '/posts/:id',
  authenticate,
  updatePostValidation,
  validate,
  forumController.updatePost
);

router.delete(
  '/posts/:id',
  authenticate,
  param('id').isUUID(),
  validate,
  forumController.deletePost
);

router.post(
  '/posts/:id/like',
  authenticate,
  param('id').isUUID(),
  validate,
  forumController.togglePostLike
);

// =============================================================================
// REPLY ROUTES
// =============================================================================

router.post(
  '/posts/:postId/replies',
  authenticate,
  replyValidation,
  validate,
  forumController.addReply
);

router.put(
  '/replies/:id',
  authenticate,
  param('id').isUUID(),
  body('content').notEmpty().isLength({ min: 5 }),
  validate,
  forumController.updateReply
);

router.delete(
  '/replies/:id',
  authenticate,
  param('id').isUUID(),
  validate,
  forumController.deleteReply
);

router.post(
  '/replies/:id/like',
  authenticate,
  param('id').isUUID(),
  validate,
  forumController.toggleReplyLike
);

router.post(
  '/replies/:id/best-answer',
  authenticate,
  param('id').isUUID(),
  validate,
  forumController.markBestAnswer
);

// =============================================================================
// POLL ROUTES
// =============================================================================

router.post(
  '/posts/:postId/poll',
  authenticate,
  pollValidation,
  validate,
  forumController.createPoll
);

router.post(
  '/polls/:pollId/vote',
  authenticate,
  param('pollId').isUUID(),
  body('optionId').isInt({ min: 0 }),
  validate,
  forumController.votePoll
);

// =============================================================================
// MODERATION ROUTES
// =============================================================================

router.post(
  '/report',
  authenticate,
  reportValidation,
  validate,
  forumController.reportContent
);

// =============================================================================
// USER ACTIVITY
// =============================================================================

router.get(
  '/my-activity',
  authenticate,
  forumController.getMyActivity
);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;



