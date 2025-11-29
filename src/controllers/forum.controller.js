// =============================================================================
// AIRAVAT B2B MARKETPLACE - DISCUSSION FORUM CONTROLLER
// Handles community discussions and knowledge sharing
// =============================================================================

const discussionForumService = require('../services/discussionForum.service');
const asyncHandler = require('../middleware/async.middleware');
const { NotFoundError } = require('../utils/errors');

// =============================================================================
// POST OPERATIONS
// =============================================================================

/**
 * Create a new forum post
 * @route POST /api/v1/forum/posts
 */
const createPost = asyncHandler(async (req, res) => {
  const post = await discussionForumService.createPost(req.user.id, req.body);

  res.status(201).json({
    success: true,
    message: 'Post created successfully',
    data: post,
  });
});

/**
 * Get post by ID or slug
 * @route GET /api/v1/forum/posts/:idOrSlug
 */
const getPost = asyncHandler(async (req, res) => {
  const post = await discussionForumService.getPostByIdOrSlug(
    req.params.idOrSlug,
    req.user?.id
  );

  if (!post) {
    throw new NotFoundError('Post not found');
  }

  res.json({
    success: true,
    data: post,
  });
});

/**
 * Get all forum posts with filters
 * @route GET /api/v1/forum/posts
 */
const getPosts = asyncHandler(async (req, res) => {
  const result = await discussionForumService.getPosts(req.query, req.user?.id);

  res.json({
    success: true,
    data: result.posts,
    pagination: result.pagination,
  });
});

/**
 * Update a post
 * @route PUT /api/v1/forum/posts/:id
 */
const updatePost = asyncHandler(async (req, res) => {
  const post = await discussionForumService.updatePost(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Post updated successfully',
    data: post,
  });
});

/**
 * Delete a post
 * @route DELETE /api/v1/forum/posts/:id
 */
const deletePost = asyncHandler(async (req, res) => {
  await discussionForumService.deletePost(req.params.id, req.user.id);

  res.json({
    success: true,
    message: 'Post deleted successfully',
  });
});

/**
 * Like/unlike a post
 * @route POST /api/v1/forum/posts/:id/like
 */
const togglePostLike = asyncHandler(async (req, res) => {
  const result = await discussionForumService.togglePostLike(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    message: result.liked ? 'Post liked' : 'Like removed',
    data: result,
  });
});

// =============================================================================
// REPLY OPERATIONS
// =============================================================================

/**
 * Add reply to a post
 * @route POST /api/v1/forum/posts/:postId/replies
 */
const addReply = asyncHandler(async (req, res) => {
  const reply = await discussionForumService.addReply(
    req.params.postId,
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Reply added successfully',
    data: reply,
  });
});

/**
 * Get replies for a post
 * @route GET /api/v1/forum/posts/:postId/replies
 */
const getReplies = asyncHandler(async (req, res) => {
  const result = await discussionForumService.getReplies(
    req.params.postId,
    req.query
  );

  res.json({
    success: true,
    data: result.replies,
    pagination: result.pagination,
  });
});

/**
 * Update a reply
 * @route PUT /api/v1/forum/replies/:id
 */
const updateReply = asyncHandler(async (req, res) => {
  const reply = await discussionForumService.updateReply(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Reply updated successfully',
    data: reply,
  });
});

/**
 * Delete a reply
 * @route DELETE /api/v1/forum/replies/:id
 */
const deleteReply = asyncHandler(async (req, res) => {
  await discussionForumService.deleteReply(req.params.id, req.user.id);

  res.json({
    success: true,
    message: 'Reply deleted successfully',
  });
});

/**
 * Like/unlike a reply
 * @route POST /api/v1/forum/replies/:id/like
 */
const toggleReplyLike = asyncHandler(async (req, res) => {
  const result = await discussionForumService.toggleReplyLike(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    message: result.liked ? 'Reply liked' : 'Like removed',
    data: result,
  });
});

/**
 * Mark reply as best answer
 * @route POST /api/v1/forum/replies/:id/best-answer
 */
const markBestAnswer = asyncHandler(async (req, res) => {
  const reply = await discussionForumService.markBestAnswer(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Reply marked as best answer',
    data: reply,
  });
});

// =============================================================================
// POLL OPERATIONS
// =============================================================================

/**
 * Create a poll for a post
 * @route POST /api/v1/forum/posts/:postId/poll
 */
const createPoll = asyncHandler(async (req, res) => {
  const poll = await discussionForumService.createPoll(
    req.params.postId,
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Poll created successfully',
    data: poll,
  });
});

/**
 * Vote on a poll
 * @route POST /api/v1/forum/polls/:pollId/vote
 */
const votePoll = asyncHandler(async (req, res) => {
  const poll = await discussionForumService.votePoll(
    req.params.pollId,
    req.user.id,
    req.body.optionId
  );

  res.json({
    success: true,
    message: 'Vote recorded',
    data: poll,
  });
});

// =============================================================================
// MODERATION OPERATIONS
// =============================================================================

/**
 * Report a post or reply
 * @route POST /api/v1/forum/report
 */
const reportContent = asyncHandler(async (req, res) => {
  const report = await discussionForumService.reportContent(
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Content reported successfully',
    data: report,
  });
});

/**
 * Get forum categories
 * @route GET /api/v1/forum/categories
 */
const getCategories = asyncHandler(async (req, res) => {
  const categories = await discussionForumService.getCategories();

  res.json({
    success: true,
    data: categories,
  });
});

/**
 * Get trending topics
 * @route GET /api/v1/forum/trending
 */
const getTrending = asyncHandler(async (req, res) => {
  const topics = await discussionForumService.getTrending(req.query);

  res.json({
    success: true,
    data: topics,
  });
});

/**
 * Search forum
 * @route GET /api/v1/forum/search
 */
const searchForum = asyncHandler(async (req, res) => {
  const result = await discussionForumService.search(req.query);

  res.json({
    success: true,
    data: result.posts,
    pagination: result.pagination,
  });
});

/**
 * Get user's forum activity
 * @route GET /api/v1/forum/my-activity
 */
const getMyActivity = asyncHandler(async (req, res) => {
  const activity = await discussionForumService.getUserActivity(
    req.user.id,
    req.query
  );

  res.json({
    success: true,
    data: activity,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  createPost,
  getPost,
  getPosts,
  updatePost,
  deletePost,
  togglePostLike,
  addReply,
  getReplies,
  updateReply,
  deleteReply,
  toggleReplyLike,
  markBestAnswer,
  createPoll,
  votePoll,
  reportContent,
  getCategories,
  getTrending,
  searchForum,
  getMyActivity,
};



