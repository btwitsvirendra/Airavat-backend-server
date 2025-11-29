// =============================================================================
// AIRAVAT B2B MARKETPLACE - SELLER STORIES SERVICE
// Service for managing seller success stories and case studies
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');
const slugify = require('slugify');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  maxStoriesPerBusiness: 10,
  featuredLimit: 6,
  defaultImagePath: '/images/story-default.jpg',
};

/**
 * Story categories
 */
const STORY_CATEGORIES = {
  SUCCESS: 'Success Story',
  GROWTH: 'Business Growth',
  INNOVATION: 'Innovation',
  PARTNERSHIP: 'Partnership',
  EXPORT: 'Export Success',
  STARTUP: 'Startup Journey',
  TRANSFORMATION: 'Digital Transformation',
  SUSTAINABILITY: 'Sustainable Business',
};

/**
 * Story status
 */
const STORY_STATUS = {
  DRAFT: 'Draft',
  PENDING: 'Pending Review',
  PUBLISHED: 'Published',
  FEATURED: 'Featured',
  ARCHIVED: 'Archived',
};

// =============================================================================
// STORY CRUD OPERATIONS
// =============================================================================

/**
 * Create a new seller story
 * @param {string} businessId - Business ID
 * @param {Object} data - Story data
 * @returns {Promise<Object>} Created story
 */
exports.createStory = async (businessId, data) => {
  try {
    const {
      title,
      subtitle,
      content,
      category,
      coverImage,
      images = [],
      videoUrl,
      metrics = {},
      tags = [],
    } = data;

    // Validate business
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { id: true, businessName: true, slug: true },
    });

    if (!business) {
      throw new AppError('Business not found', 404);
    }

    // Check story limit
    const existingCount = await prisma.sellerStory.count({
      where: { businessId },
    });

    if (existingCount >= CONFIG.maxStoriesPerBusiness) {
      throw new AppError(`Maximum ${CONFIG.maxStoriesPerBusiness} stories allowed per business`, 400);
    }

    // Validate category
    if (category && !STORY_CATEGORIES[category]) {
      throw new AppError(`Invalid category: ${category}`, 400);
    }

    // Generate slug
    const slug = await generateUniqueSlug(title);

    const story = await prisma.sellerStory.create({
      data: {
        businessId,
        title,
        slug,
        subtitle,
        content,
        category: category || 'SUCCESS',
        coverImage: coverImage || CONFIG.defaultImagePath,
        images,
        videoUrl,
        metrics,
        tags,
        status: 'DRAFT',
      },
    });

    logger.info('Seller story created', { storyId: story.id, businessId });

    return story;
  } catch (error) {
    logger.error('Create story error', { error: error.message, businessId });
    throw error;
  }
};

/**
 * Update a seller story
 * @param {string} storyId - Story ID
 * @param {string} businessId - Business ID (for verification)
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated story
 */
exports.updateStory = async (storyId, businessId, data) => {
  try {
    const story = await prisma.sellerStory.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new AppError('Story not found', 404);
    }

    if (story.businessId !== businessId) {
      throw new AppError('Not authorized to update this story', 403);
    }

    const updateData = {};
    const allowedFields = [
      'title', 'subtitle', 'content', 'category', 'coverImage',
      'images', 'videoUrl', 'metrics', 'tags',
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        updateData[field] = data[field];
      }
    }

    // Regenerate slug if title changed
    if (data.title && data.title !== story.title) {
      updateData.slug = await generateUniqueSlug(data.title, storyId);
    }

    updateData.updatedAt = new Date();

    const updated = await prisma.sellerStory.update({
      where: { id: storyId },
      data: updateData,
    });

    logger.info('Seller story updated', { storyId });

    return updated;
  } catch (error) {
    logger.error('Update story error', { error: error.message, storyId });
    throw error;
  }
};

/**
 * Delete a seller story
 * @param {string} storyId - Story ID
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Deletion result
 */
exports.deleteStory = async (storyId, businessId) => {
  try {
    const story = await prisma.sellerStory.findUnique({
      where: { id: storyId },
    });

    if (!story) {
      throw new AppError('Story not found', 404);
    }

    if (story.businessId !== businessId) {
      throw new AppError('Not authorized to delete this story', 403);
    }

    await prisma.sellerStory.delete({
      where: { id: storyId },
    });

    logger.info('Seller story deleted', { storyId, businessId });

    return { success: true };
  } catch (error) {
    logger.error('Delete story error', { error: error.message, storyId });
    throw error;
  }
};

// =============================================================================
// STORY QUERIES
// =============================================================================

/**
 * Get story by ID or slug
 * @param {string} identifier - Story ID or slug
 * @returns {Promise<Object>} Story with details
 */
exports.getStory = async (identifier) => {
  const story = await prisma.sellerStory.findFirst({
    where: {
      OR: [
        { id: identifier },
        { slug: identifier },
      ],
    },
    include: {
      business: {
        select: {
          id: true,
          businessName: true,
          slug: true,
          logo: true,
          verificationStatus: true,
          badges: { where: { status: 'ACTIVE' }, take: 5 },
        },
      },
    },
  });

  if (!story) {
    throw new AppError('Story not found', 404);
  }

  // Increment view count
  await prisma.sellerStory.update({
    where: { id: story.id },
    data: { viewCount: { increment: 1 } },
  });

  return {
    ...story,
    categoryInfo: STORY_CATEGORIES[story.category],
    statusInfo: STORY_STATUS[story.status],
  };
};

/**
 * Get published stories with filters
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated stories
 */
exports.getPublishedStories = async (options = {}) => {
  const {
    page = 1,
    limit = 12,
    category = null,
    tag = null,
    search = null,
    featured = false,
  } = options;

  const skip = (page - 1) * limit;

  const where = {
    status: featured ? 'FEATURED' : { in: ['PUBLISHED', 'FEATURED'] },
  };

  if (category) {
    where.category = category;
  }

  if (tag) {
    where.tags = { has: tag };
  }

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { content: { contains: search, mode: 'insensitive' } },
      { tags: { has: search.toLowerCase() } },
    ];
  }

  const [stories, total] = await Promise.all([
    prisma.sellerStory.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { status: 'desc' }, // Featured first
        { publishedAt: 'desc' },
      ],
      include: {
        business: {
          select: {
            id: true,
            businessName: true,
            slug: true,
            logo: true,
          },
        },
      },
    }),
    prisma.sellerStory.count({ where }),
  ]);

  return {
    stories: stories.map((s) => ({
      ...s,
      categoryInfo: STORY_CATEGORIES[s.category],
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
 * Get featured stories
 * @param {number} limit - Number of stories
 * @returns {Promise<Object[]>} Featured stories
 */
exports.getFeaturedStories = async (limit = CONFIG.featuredLimit) => {
  const stories = await prisma.sellerStory.findMany({
    where: { status: 'FEATURED' },
    take: limit,
    orderBy: { featuredAt: 'desc' },
    include: {
      business: {
        select: {
          id: true,
          businessName: true,
          slug: true,
          logo: true,
        },
      },
    },
  });

  return stories.map((s) => ({
    ...s,
    categoryInfo: STORY_CATEGORIES[s.category],
  }));
};

/**
 * Get stories by business
 * @param {string} businessId - Business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Business stories
 */
exports.getBusinessStories = async (businessId, options = {}) => {
  const { page = 1, limit = 10, status = null } = options;
  const skip = (page - 1) * limit;

  const where = { businessId };
  if (status) {
    where.status = status;
  }

  const [stories, total] = await Promise.all([
    prisma.sellerStory.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.sellerStory.count({ where }),
  ]);

  return {
    stories,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get related stories
 * @param {string} storyId - Current story ID
 * @param {number} limit - Number of related stories
 * @returns {Promise<Object[]>} Related stories
 */
exports.getRelatedStories = async (storyId, limit = 4) => {
  const story = await prisma.sellerStory.findUnique({
    where: { id: storyId },
    select: { category: true, tags: true, businessId: true },
  });

  if (!story) {
    return [];
  }

  const related = await prisma.sellerStory.findMany({
    where: {
      id: { not: storyId },
      status: { in: ['PUBLISHED', 'FEATURED'] },
      OR: [
        { category: story.category },
        { tags: { hasSome: story.tags } },
      ],
    },
    take: limit,
    orderBy: { viewCount: 'desc' },
    include: {
      business: {
        select: { businessName: true, logo: true },
      },
    },
  });

  return related;
};

// =============================================================================
// STORY WORKFLOW
// =============================================================================

/**
 * Submit story for review
 * @param {string} storyId - Story ID
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Updated story
 */
exports.submitForReview = async (storyId, businessId) => {
  const story = await prisma.sellerStory.findUnique({
    where: { id: storyId },
  });

  if (!story) {
    throw new AppError('Story not found', 404);
  }

  if (story.businessId !== businessId) {
    throw new AppError('Not authorized', 403);
  }

  if (story.status !== 'DRAFT') {
    throw new AppError('Only draft stories can be submitted for review', 400);
  }

  const updated = await prisma.sellerStory.update({
    where: { id: storyId },
    data: {
      status: 'PENDING',
      submittedAt: new Date(),
    },
  });

  logger.info('Story submitted for review', { storyId });

  return updated;
};

/**
 * Publish story (Admin)
 * @param {string} storyId - Story ID
 * @param {string} adminId - Admin user ID
 * @returns {Promise<Object>} Published story
 */
exports.publishStory = async (storyId, adminId) => {
  const story = await prisma.sellerStory.findUnique({
    where: { id: storyId },
  });

  if (!story) {
    throw new AppError('Story not found', 404);
  }

  const updated = await prisma.sellerStory.update({
    where: { id: storyId },
    data: {
      status: 'PUBLISHED',
      publishedAt: new Date(),
      approvedBy: adminId,
    },
  });

  logger.info('Story published', { storyId, adminId });

  return updated;
};

/**
 * Feature story (Admin)
 * @param {string} storyId - Story ID
 * @param {string} adminId - Admin user ID
 * @returns {Promise<Object>} Featured story
 */
exports.featureStory = async (storyId, adminId) => {
  const story = await prisma.sellerStory.findUnique({
    where: { id: storyId },
  });

  if (!story) {
    throw new AppError('Story not found', 404);
  }

  if (story.status !== 'PUBLISHED' && story.status !== 'FEATURED') {
    throw new AppError('Story must be published before featuring', 400);
  }

  const updated = await prisma.sellerStory.update({
    where: { id: storyId },
    data: {
      status: 'FEATURED',
      featuredAt: new Date(),
      featuredBy: adminId,
    },
  });

  logger.info('Story featured', { storyId, adminId });

  return updated;
};

/**
 * Reject story (Admin)
 * @param {string} storyId - Story ID
 * @param {string} adminId - Admin user ID
 * @param {string} reason - Rejection reason
 * @returns {Promise<Object>} Rejected story
 */
exports.rejectStory = async (storyId, adminId, reason) => {
  const story = await prisma.sellerStory.findUnique({
    where: { id: storyId },
  });

  if (!story) {
    throw new AppError('Story not found', 404);
  }

  const updated = await prisma.sellerStory.update({
    where: { id: storyId },
    data: {
      status: 'DRAFT',
      rejectedAt: new Date(),
      rejectedBy: adminId,
      rejectionReason: reason,
    },
  });

  logger.info('Story rejected', { storyId, adminId, reason });

  return updated;
};

/**
 * Archive story
 * @param {string} storyId - Story ID
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Archived story
 */
exports.archiveStory = async (storyId, businessId) => {
  const story = await prisma.sellerStory.findUnique({
    where: { id: storyId },
  });

  if (!story) {
    throw new AppError('Story not found', 404);
  }

  if (story.businessId !== businessId) {
    throw new AppError('Not authorized', 403);
  }

  const updated = await prisma.sellerStory.update({
    where: { id: storyId },
    data: {
      status: 'ARCHIVED',
      archivedAt: new Date(),
    },
  });

  logger.info('Story archived', { storyId });

  return updated;
};

// =============================================================================
// ENGAGEMENT
// =============================================================================

/**
 * Like a story
 * @param {string} storyId - Story ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Like result
 */
exports.likeStory = async (storyId, userId) => {
  const existing = await prisma.storyLike.findFirst({
    where: { storyId, userId },
  });

  if (existing) {
    // Unlike
    await prisma.storyLike.delete({ where: { id: existing.id } });
    await prisma.sellerStory.update({
      where: { id: storyId },
      data: { likeCount: { decrement: 1 } },
    });
    return { liked: false };
  }

  // Like
  await prisma.storyLike.create({
    data: { storyId, userId },
  });
  await prisma.sellerStory.update({
    where: { id: storyId },
    data: { likeCount: { increment: 1 } },
  });

  return { liked: true };
};

/**
 * Get story engagement stats
 * @param {string} storyId - Story ID
 * @returns {Promise<Object>} Engagement stats
 */
exports.getEngagementStats = async (storyId) => {
  const story = await prisma.sellerStory.findUnique({
    where: { id: storyId },
    select: { viewCount: true, likeCount: true, shareCount: true },
  });

  if (!story) {
    throw new AppError('Story not found', 404);
  }

  return story;
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate unique slug for story
 */
async function generateUniqueSlug(title, excludeId = null) {
  let baseSlug = slugify(title, { lower: true, strict: true });
  let slug = baseSlug;
  let counter = 1;

  while (true) {
    const existing = await prisma.sellerStory.findFirst({
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
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  STORY_CATEGORIES,
  STORY_STATUS,
};



