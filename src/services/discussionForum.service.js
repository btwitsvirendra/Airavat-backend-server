// =============================================================================
// AIRAVAT B2B MARKETPLACE - DISCUSSION FORUM SERVICE
// Service for community Q&A and discussions
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');
const slugify = require('slugify');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  maxTitleLength: 200,
  maxContentLength: 10000,
  maxTagsPerPost: 5,
  postsPerPage: 20,
  repliesPerPage: 50,
};

/**
 * Forum categories
 */
const FORUM_CATEGORIES = {
  GENERAL: { name: 'General Discussion', icon: 'message-circle', color: '#2196F3' },
  PRODUCT_HELP: { name: 'Product Help', icon: 'help-circle', color: '#4CAF50' },
  SOURCING: { name: 'Sourcing & Suppliers', icon: 'search', color: '#FF9800' },
  PRICING: { name: 'Pricing & Quotes', icon: 'dollar-sign', color: '#9C27B0' },
  LOGISTICS: { name: 'Shipping & Logistics', icon: 'truck', color: '#00BCD4' },
  PAYMENTS: { name: 'Payments & Finance', icon: 'credit-card', color: '#E91E63' },
  QUALITY: { name: 'Quality & Compliance', icon: 'shield', color: '#795548' },
  INDUSTRY: { name: 'Industry News', icon: 'trending-up', color: '#607D8B' },
  FEEDBACK: { name: 'Platform Feedback', icon: 'message-square', color: '#3F51B5' },
};

/**
 * Post statuses
 */
const POST_STATUS = {
  DRAFT: 'Draft',
  PUBLISHED: 'Published',
  CLOSED: 'Closed',
  HIDDEN: 'Hidden',
  DELETED: 'Deleted',
};

// =============================================================================
// POST OPERATIONS
// =============================================================================

/**
 * Create a discussion post
 * @param {string} userId - Author user ID
 * @param {Object} data - Post data
 * @returns {Promise<Object>} Created post
 */
exports.createPost = async (userId, data) => {
  try {
    const {
      title,
      content,
      category,
      tags = [],
      attachments = [],
      pollOptions = null,
    } = data;

    // Validate category
    if (category && !FORUM_CATEGORIES[category]) {
      throw new AppError(`Invalid category: ${category}`, 400);
    }

    // Validate tags
    if (tags.length > CONFIG.maxTagsPerPost) {
      throw new AppError(`Maximum ${CONFIG.maxTagsPerPost} tags allowed`, 400);
    }

    // Generate slug
    const slug = await generateUniqueSlug(title);

    // Create post
    const post = await prisma.forumPost.create({
      data: {
        authorId: userId,
        title,
        slug,
        content,
        category: category || 'GENERAL',
        tags,
        attachments,
        status: 'PUBLISHED',
        poll: pollOptions ? {
          create: {
            question: pollOptions.question,
            options: pollOptions.options.map((opt, i) => ({
              id: i + 1,
              text: opt,
              votes: 0,
            })),
            endsAt: pollOptions.endsAt ? new Date(pollOptions.endsAt) : null,
          },
        } : undefined,
      },
      include: {
        author: {
          select: { id: true, firstName: true, lastName: true, avatar: true },
        },
        poll: true,
      },
    });

    logger.info('Forum post created', { postId: post.id, userId });

    return {
      ...post,
      categoryInfo: FORUM_CATEGORIES[post.category],
    };
  } catch (error) {
    logger.error('Create post error', { error: error.message, userId });
    throw error;
  }
};

/**
 * Get post by ID or slug
 * @param {string} identifier - Post ID or slug
 * @param {string} userId - Viewer user ID (optional)
 * @returns {Promise<Object>} Post with details
 */
exports.getPost = async (identifier, userId = null) => {
  const post = await prisma.forumPost.findFirst({
    where: {
      OR: [{ id: identifier }, { slug: identifier }],
      status: { not: 'DELETED' },
    },
    include: {
      author: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          avatar: true,
          role: true,
          business: { select: { businessName: true, verificationStatus: true } },
        },
      },
      poll: true,
      _count: {
        select: { replies: true, likes: true },
      },
    },
  });

  if (!post) {
    throw new AppError('Post not found', 404);
  }

  // Increment view count
  await prisma.forumPost.update({
    where: { id: post.id },
    data: { viewCount: { increment: 1 } },
  });

  // Check if user has liked
  let hasLiked = false;
  if (userId) {
    const like = await prisma.forumPostLike.findFirst({
      where: { postId: post.id, userId },
    });
    hasLiked = !!like;
  }

  return {
    ...post,
    categoryInfo: FORUM_CATEGORIES[post.category],
    hasLiked,
  };
};

/**
 * Get posts with filters
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated posts
 */
exports.getPosts = async (options = {}) => {
  const {
    page = 1,
    limit = CONFIG.postsPerPage,
    category = null,
    tag = null,
    search = null,
    authorId = null,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = options;

  const skip = (page - 1) * limit;

  const where = { status: 'PUBLISHED' };

  if (category) where.category = category;
  if (tag) where.tags = { has: tag };
  if (authorId) where.authorId = authorId;

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { content: { contains: search, mode: 'insensitive' } },
      { tags: { has: search.toLowerCase() } },
    ];
  }

  const [posts, total] = await Promise.all([
    prisma.forumPost.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        author: {
          select: { id: true, firstName: true, lastName: true, avatar: true },
        },
        _count: {
          select: { replies: true, likes: true },
        },
      },
    }),
    prisma.forumPost.count({ where }),
  ]);

  return {
    posts: posts.map((p) => ({
      ...p,
      categoryInfo: FORUM_CATEGORIES[p.category],
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Update post
 * @param {string} postId - Post ID
 * @param {string} userId - Author user ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated post
 */
exports.updatePost = async (postId, userId, data) => {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
  });

  if (!post) {
    throw new AppError('Post not found', 404);
  }

  if (post.authorId !== userId) {
    throw new AppError('Not authorized to edit this post', 403);
  }

  const updateData = {};
  const allowedFields = ['title', 'content', 'category', 'tags', 'attachments'];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updateData[field] = data[field];
    }
  }

  if (data.title && data.title !== post.title) {
    updateData.slug = await generateUniqueSlug(data.title, postId);
  }

  updateData.editedAt = new Date();

  const updated = await prisma.forumPost.update({
    where: { id: postId },
    data: updateData,
  });

  logger.info('Forum post updated', { postId, userId });

  return updated;
};

/**
 * Delete post
 * @param {string} postId - Post ID
 * @param {string} userId - User ID
 * @param {boolean} isAdmin - Is admin user
 * @returns {Promise<Object>} Deletion result
 */
exports.deletePost = async (postId, userId, isAdmin = false) => {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
  });

  if (!post) {
    throw new AppError('Post not found', 404);
  }

  if (post.authorId !== userId && !isAdmin) {
    throw new AppError('Not authorized', 403);
  }

  await prisma.forumPost.update({
    where: { id: postId },
    data: { status: 'DELETED', deletedAt: new Date() },
  });

  logger.info('Forum post deleted', { postId, userId });

  return { success: true };
};

// =============================================================================
// REPLY OPERATIONS
// =============================================================================

/**
 * Add reply to post
 * @param {string} postId - Post ID
 * @param {string} userId - Author user ID
 * @param {Object} data - Reply data
 * @returns {Promise<Object>} Created reply
 */
exports.addReply = async (postId, userId, data) => {
  const { content, parentReplyId = null, attachments = [] } = data;

  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
  });

  if (!post) {
    throw new AppError('Post not found', 404);
  }

  if (post.status !== 'PUBLISHED') {
    throw new AppError('Cannot reply to this post', 400);
  }

  // Validate parent reply if provided
  if (parentReplyId) {
    const parentReply = await prisma.forumReply.findUnique({
      where: { id: parentReplyId },
    });

    if (!parentReply || parentReply.postId !== postId) {
      throw new AppError('Parent reply not found', 404);
    }
  }

  const reply = await prisma.forumReply.create({
    data: {
      postId,
      authorId: userId,
      content,
      parentReplyId,
      attachments,
    },
    include: {
      author: {
        select: { id: true, firstName: true, lastName: true, avatar: true },
      },
    },
  });

  // Update post reply count
  await prisma.forumPost.update({
    where: { id: postId },
    data: { lastActivityAt: new Date() },
  });

  logger.info('Forum reply added', { postId, replyId: reply.id, userId });

  return reply;
};

/**
 * Get replies for a post
 * @param {string} postId - Post ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated replies
 */
exports.getReplies = async (postId, options = {}) => {
  const {
    page = 1,
    limit = CONFIG.repliesPerPage,
    sortBy = 'createdAt',
    sortOrder = 'asc',
  } = options;

  const skip = (page - 1) * limit;

  // Get top-level replies
  const [replies, total] = await Promise.all([
    prisma.forumReply.findMany({
      where: {
        postId,
        parentReplyId: null,
        status: 'ACTIVE',
      },
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        author: {
          select: { id: true, firstName: true, lastName: true, avatar: true },
        },
        children: {
          where: { status: 'ACTIVE' },
          include: {
            author: {
              select: { id: true, firstName: true, lastName: true, avatar: true },
            },
          },
          orderBy: { createdAt: 'asc' },
        },
        _count: { select: { likes: true } },
      },
    }),
    prisma.forumReply.count({
      where: { postId, parentReplyId: null, status: 'ACTIVE' },
    }),
  ]);

  return {
    replies,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Update reply
 * @param {string} replyId - Reply ID
 * @param {string} userId - User ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated reply
 */
exports.updateReply = async (replyId, userId, data) => {
  const reply = await prisma.forumReply.findUnique({
    where: { id: replyId },
  });

  if (!reply) {
    throw new AppError('Reply not found', 404);
  }

  if (reply.authorId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  const updated = await prisma.forumReply.update({
    where: { id: replyId },
    data: {
      content: data.content,
      attachments: data.attachments,
      editedAt: new Date(),
    },
  });

  return updated;
};

/**
 * Delete reply
 * @param {string} replyId - Reply ID
 * @param {string} userId - User ID
 * @param {boolean} isAdmin - Is admin
 * @returns {Promise<Object>} Deletion result
 */
exports.deleteReply = async (replyId, userId, isAdmin = false) => {
  const reply = await prisma.forumReply.findUnique({
    where: { id: replyId },
  });

  if (!reply) {
    throw new AppError('Reply not found', 404);
  }

  if (reply.authorId !== userId && !isAdmin) {
    throw new AppError('Not authorized', 403);
  }

  await prisma.forumReply.update({
    where: { id: replyId },
    data: { status: 'DELETED' },
  });

  return { success: true };
};

/**
 * Mark reply as best answer
 * @param {string} postId - Post ID
 * @param {string} replyId - Reply ID
 * @param {string} userId - Post author user ID
 * @returns {Promise<Object>} Updated reply
 */
exports.markBestAnswer = async (postId, replyId, userId) => {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
  });

  if (!post) {
    throw new AppError('Post not found', 404);
  }

  if (post.authorId !== userId) {
    throw new AppError('Only post author can mark best answer', 403);
  }

  const reply = await prisma.forumReply.findUnique({
    where: { id: replyId },
  });

  if (!reply || reply.postId !== postId) {
    throw new AppError('Reply not found', 404);
  }

  // Remove previous best answer if any
  await prisma.forumReply.updateMany({
    where: { postId, isBestAnswer: true },
    data: { isBestAnswer: false },
  });

  // Mark new best answer
  const updated = await prisma.forumReply.update({
    where: { id: replyId },
    data: { isBestAnswer: true },
  });

  // Update post
  await prisma.forumPost.update({
    where: { id: postId },
    data: { hasAcceptedAnswer: true },
  });

  logger.info('Best answer marked', { postId, replyId });

  return updated;
};

// =============================================================================
// ENGAGEMENT OPERATIONS
// =============================================================================

/**
 * Like/unlike post
 * @param {string} postId - Post ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Like result
 */
exports.likePost = async (postId, userId) => {
  const existing = await prisma.forumPostLike.findFirst({
    where: { postId, userId },
  });

  if (existing) {
    await prisma.forumPostLike.delete({ where: { id: existing.id } });
    await prisma.forumPost.update({
      where: { id: postId },
      data: { likeCount: { decrement: 1 } },
    });
    return { liked: false };
  }

  await prisma.forumPostLike.create({
    data: { postId, userId },
  });
  await prisma.forumPost.update({
    where: { id: postId },
    data: { likeCount: { increment: 1 } },
  });

  return { liked: true };
};

/**
 * Like/unlike reply
 * @param {string} replyId - Reply ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Like result
 */
exports.likeReply = async (replyId, userId) => {
  const existing = await prisma.forumReplyLike.findFirst({
    where: { replyId, userId },
  });

  if (existing) {
    await prisma.forumReplyLike.delete({ where: { id: existing.id } });
    return { liked: false };
  }

  await prisma.forumReplyLike.create({
    data: { replyId, userId },
  });

  return { liked: true };
};

/**
 * Vote on poll
 * @param {string} pollId - Poll ID
 * @param {string} userId - User ID
 * @param {number} optionId - Option ID
 * @returns {Promise<Object>} Vote result
 */
exports.votePoll = async (pollId, userId, optionId) => {
  const poll = await prisma.forumPoll.findUnique({
    where: { id: pollId },
  });

  if (!poll) {
    throw new AppError('Poll not found', 404);
  }

  if (poll.endsAt && poll.endsAt < new Date()) {
    throw new AppError('Poll has ended', 400);
  }

  // Check if user already voted
  const existingVote = await prisma.forumPollVote.findFirst({
    where: { pollId, userId },
  });

  if (existingVote) {
    throw new AppError('Already voted on this poll', 400);
  }

  // Validate option
  const options = poll.options;
  const option = options.find((o) => o.id === optionId);

  if (!option) {
    throw new AppError('Invalid option', 400);
  }

  // Record vote
  await prisma.forumPollVote.create({
    data: { pollId, userId, optionId },
  });

  // Update vote count
  option.votes += 1;
  await prisma.forumPoll.update({
    where: { id: pollId },
    data: {
      options,
      totalVotes: { increment: 1 },
    },
  });

  return { success: true, options };
};

// =============================================================================
// MODERATION
// =============================================================================

/**
 * Report content
 * @param {string} entityType - post or reply
 * @param {string} entityId - Entity ID
 * @param {string} userId - Reporter user ID
 * @param {string} reason - Report reason
 * @returns {Promise<Object>} Report result
 */
exports.reportContent = async (entityType, entityId, userId, reason) => {
  const report = await prisma.forumReport.create({
    data: {
      entityType,
      entityId,
      reporterId: userId,
      reason,
      status: 'PENDING',
    },
  });

  logger.info('Content reported', { entityType, entityId, userId });

  return report;
};

/**
 * Close post (by author or admin)
 * @param {string} postId - Post ID
 * @param {string} userId - User ID
 * @param {boolean} isAdmin - Is admin
 * @returns {Promise<Object>} Closed post
 */
exports.closePost = async (postId, userId, isAdmin = false) => {
  const post = await prisma.forumPost.findUnique({
    where: { id: postId },
  });

  if (!post) {
    throw new AppError('Post not found', 404);
  }

  if (post.authorId !== userId && !isAdmin) {
    throw new AppError('Not authorized', 403);
  }

  const updated = await prisma.forumPost.update({
    where: { id: postId },
    data: { status: 'CLOSED' },
  });

  return updated;
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate unique slug
 */
async function generateUniqueSlug(title, excludeId = null) {
  let baseSlug = slugify(title, { lower: true, strict: true }).substring(0, 100);
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await prisma.forumPost.findFirst({
      where: {
        slug,
        id: excludeId ? { not: excludeId } : undefined,
      },
    });

    if (!existing) break;

    slug = `${baseSlug}-${counter}`;
    counter++;
  }

  return slug;
}

// =============================================================================
// STATISTICS
// =============================================================================

/**
 * Get forum statistics
 * @returns {Promise<Object>} Forum stats
 */
exports.getForumStats = async () => {
  const [totalPosts, totalReplies, categoryCounts] = await Promise.all([
    prisma.forumPost.count({ where: { status: 'PUBLISHED' } }),
    prisma.forumReply.count({ where: { status: 'ACTIVE' } }),
    prisma.forumPost.groupBy({
      by: ['category'],
      where: { status: 'PUBLISHED' },
      _count: true,
    }),
  ]);

  return {
    totalPosts,
    totalReplies,
    byCategory: categoryCounts.reduce((acc, c) => {
      acc[c.category] = {
        count: c._count,
        ...FORUM_CATEGORIES[c.category],
      };
      return acc;
    }, {}),
  };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  FORUM_CATEGORIES,
  POST_STATUS,
};



