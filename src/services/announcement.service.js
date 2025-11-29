// =============================================================================
// AIRAVAT B2B MARKETPLACE - SYSTEM ANNOUNCEMENTS SERVICE
// Service for managing platform-wide announcements and notifications
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');
const { redis } = require('../config/redis');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  cacheKey: 'announcements:active',
  cacheTTL: 300, // 5 minutes
  maxActiveAnnouncements: 5,
};

/**
 * Announcement types
 */
const ANNOUNCEMENT_TYPES = {
  INFO: { icon: 'info', color: '#2196F3', priority: 1 },
  SUCCESS: { icon: 'check-circle', color: '#4CAF50', priority: 2 },
  WARNING: { icon: 'alert-triangle', color: '#FF9800', priority: 3 },
  ERROR: { icon: 'alert-circle', color: '#F44336', priority: 4 },
  MAINTENANCE: { icon: 'wrench', color: '#9C27B0', priority: 5 },
  PROMOTION: { icon: 'gift', color: '#E91E63', priority: 2 },
  UPDATE: { icon: 'refresh', color: '#00BCD4', priority: 3 },
};

/**
 * Target audiences
 */
const TARGET_AUDIENCES = {
  ALL: 'All users',
  BUYERS: 'Buyers only',
  SELLERS: 'Sellers only',
  PREMIUM: 'Premium subscribers',
  ADMINS: 'Administrators',
  VERIFIED: 'Verified businesses',
};

// =============================================================================
// ANNOUNCEMENT MANAGEMENT
// =============================================================================

/**
 * Create a new announcement
 * @param {Object} data - Announcement data
 * @param {string} createdBy - Admin user ID
 * @returns {Promise<Object>} Created announcement
 */
exports.createAnnouncement = async (data, createdBy) => {
  try {
    const {
      title,
      message,
      type = 'INFO',
      targetAudience = 'ALL',
      startDate = new Date(),
      endDate,
      priority = 0,
      link = null,
      linkText = null,
      dismissible = true,
      sticky = false,
    } = data;

    // Validate type
    if (!ANNOUNCEMENT_TYPES[type]) {
      throw new AppError(`Invalid announcement type: ${type}`, 400);
    }

    // Validate target audience
    if (!TARGET_AUDIENCES[targetAudience]) {
      throw new AppError(`Invalid target audience: ${targetAudience}`, 400);
    }

    // Validate dates
    if (endDate && new Date(endDate) < new Date(startDate)) {
      throw new AppError('End date must be after start date', 400);
    }

    const announcement = await prisma.announcement.create({
      data: {
        title,
        message,
        type,
        targetAudience,
        startDate: new Date(startDate),
        endDate: endDate ? new Date(endDate) : null,
        priority,
        link,
        linkText,
        dismissible,
        sticky,
        status: 'ACTIVE',
        createdBy,
      },
    });

    // Invalidate cache
    await invalidateCache();

    logger.info('Announcement created', {
      id: announcement.id,
      title,
      type,
      createdBy,
    });

    return announcement;
  } catch (error) {
    logger.error('Create announcement error', { error: error.message });
    throw error;
  }
};

/**
 * Update an announcement
 * @param {string} id - Announcement ID
 * @param {Object} data - Update data
 * @param {string} updatedBy - Admin user ID
 * @returns {Promise<Object>} Updated announcement
 */
exports.updateAnnouncement = async (id, data, updatedBy) => {
  try {
    const existing = await prisma.announcement.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new AppError('Announcement not found', 404);
    }

    const updateData = {};
    const allowedFields = [
      'title', 'message', 'type', 'targetAudience',
      'startDate', 'endDate', 'priority', 'link',
      'linkText', 'dismissible', 'sticky', 'status',
    ];

    for (const field of allowedFields) {
      if (data[field] !== undefined) {
        if (field === 'startDate' || field === 'endDate') {
          updateData[field] = data[field] ? new Date(data[field]) : null;
        } else {
          updateData[field] = data[field];
        }
      }
    }

    updateData.updatedBy = updatedBy;
    updateData.updatedAt = new Date();

    const updated = await prisma.announcement.update({
      where: { id },
      data: updateData,
    });

    await invalidateCache();

    logger.info('Announcement updated', { id, updatedBy });

    return updated;
  } catch (error) {
    logger.error('Update announcement error', { error: error.message, id });
    throw error;
  }
};

/**
 * Delete an announcement
 * @param {string} id - Announcement ID
 * @param {string} deletedBy - Admin user ID
 * @returns {Promise<Object>} Deletion result
 */
exports.deleteAnnouncement = async (id, deletedBy) => {
  try {
    const existing = await prisma.announcement.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new AppError('Announcement not found', 404);
    }

    await prisma.announcement.delete({
      where: { id },
    });

    await invalidateCache();

    logger.info('Announcement deleted', { id, deletedBy });

    return { success: true };
  } catch (error) {
    logger.error('Delete announcement error', { error: error.message, id });
    throw error;
  }
};

// =============================================================================
// ANNOUNCEMENT QUERIES
// =============================================================================

/**
 * Get active announcements for a user
 * @param {Object} user - User object
 * @returns {Promise<Object[]>} Active announcements
 */
exports.getActiveAnnouncements = async (user = null) => {
  try {
    // Try cache first
    const cached = await getCachedAnnouncements();
    if (cached && !user) {
      return cached;
    }

    const now = new Date();

    // Build target audience filter
    const audienceFilter = ['ALL'];
    if (user) {
      if (user.role === 'BUYER') audienceFilter.push('BUYERS');
      if (user.role === 'SELLER') audienceFilter.push('SELLERS');
      if (user.role === 'ADMIN') audienceFilter.push('ADMINS');
      if (user.isPremium) audienceFilter.push('PREMIUM');
      if (user.isVerified) audienceFilter.push('VERIFIED');
    }

    const announcements = await prisma.announcement.findMany({
      where: {
        status: 'ACTIVE',
        startDate: { lte: now },
        OR: [
          { endDate: null },
          { endDate: { gte: now } },
        ],
        targetAudience: { in: audienceFilter },
      },
      orderBy: [
        { sticky: 'desc' },
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
      take: CONFIG.maxActiveAnnouncements,
    });

    // Filter out dismissed announcements for authenticated users
    let filteredAnnouncements = announcements;
    if (user) {
      const dismissedIds = await getDismissedAnnouncementIds(user.id);
      filteredAnnouncements = announcements.filter(
        (a) => !dismissedIds.includes(a.id) || !a.dismissible
      );
    }

    // Add type info
    const enrichedAnnouncements = filteredAnnouncements.map((a) => ({
      ...a,
      typeInfo: ANNOUNCEMENT_TYPES[a.type],
    }));

    // Cache if no user filter
    if (!user) {
      await cacheAnnouncements(enrichedAnnouncements);
    }

    return enrichedAnnouncements;
  } catch (error) {
    logger.error('Get active announcements error', { error: error.message });
    throw error;
  }
};

/**
 * Get all announcements (Admin)
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated announcements
 */
exports.getAllAnnouncements = async (options = {}) => {
  const {
    page = 1,
    limit = 20,
    status = null,
    type = null,
    search = null,
  } = options;

  const skip = (page - 1) * limit;
  const where = {};

  if (status) where.status = status;
  if (type) where.type = type;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { message: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [announcements, total] = await Promise.all([
    prisma.announcement.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.announcement.count({ where }),
  ]);

  return {
    announcements,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get announcement by ID
 * @param {string} id - Announcement ID
 * @returns {Promise<Object>} Announcement
 */
exports.getAnnouncementById = async (id) => {
  const announcement = await prisma.announcement.findUnique({
    where: { id },
    include: {
      _count: {
        select: {
          dismissals: true,
          views: true,
        },
      },
    },
  });

  if (!announcement) {
    throw new AppError('Announcement not found', 404);
  }

  return {
    ...announcement,
    typeInfo: ANNOUNCEMENT_TYPES[announcement.type],
  };
};

// =============================================================================
// USER INTERACTIONS
// =============================================================================

/**
 * Dismiss an announcement for a user
 * @param {string} announcementId - Announcement ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Dismissal result
 */
exports.dismissAnnouncement = async (announcementId, userId) => {
  try {
    const announcement = await prisma.announcement.findUnique({
      where: { id: announcementId },
    });

    if (!announcement) {
      throw new AppError('Announcement not found', 404);
    }

    if (!announcement.dismissible) {
      throw new AppError('This announcement cannot be dismissed', 400);
    }

    // Check if already dismissed
    const existing = await prisma.announcementDismissal.findFirst({
      where: {
        announcementId,
        userId,
      },
    });

    if (existing) {
      return { success: true, alreadyDismissed: true };
    }

    await prisma.announcementDismissal.create({
      data: {
        announcementId,
        userId,
      },
    });

    logger.debug('Announcement dismissed', { announcementId, userId });

    return { success: true };
  } catch (error) {
    logger.error('Dismiss announcement error', { error: error.message });
    throw error;
  }
};

/**
 * Track announcement view
 * @param {string} announcementId - Announcement ID
 * @param {string} userId - User ID (optional)
 * @returns {Promise<Object>} View tracking result
 */
exports.trackView = async (announcementId, userId = null) => {
  try {
    await prisma.announcementView.create({
      data: {
        announcementId,
        userId,
        viewedAt: new Date(),
      },
    });

    return { tracked: true };
  } catch (error) {
    // Don't throw - view tracking is non-critical
    logger.warn('Track view error', { error: error.message });
    return { tracked: false };
  }
};

/**
 * Track announcement click
 * @param {string} announcementId - Announcement ID
 * @param {string} userId - User ID (optional)
 * @returns {Promise<Object>} Click tracking result
 */
exports.trackClick = async (announcementId, userId = null) => {
  try {
    await prisma.announcementClick.create({
      data: {
        announcementId,
        userId,
        clickedAt: new Date(),
      },
    });

    return { tracked: true };
  } catch (error) {
    logger.warn('Track click error', { error: error.message });
    return { tracked: false };
  }
};

// =============================================================================
// ANALYTICS
// =============================================================================

/**
 * Get announcement analytics
 * @param {string} id - Announcement ID
 * @returns {Promise<Object>} Analytics data
 */
exports.getAnnouncementAnalytics = async (id) => {
  const announcement = await prisma.announcement.findUnique({
    where: { id },
  });

  if (!announcement) {
    throw new AppError('Announcement not found', 404);
  }

  const [views, clicks, dismissals, viewsByDay] = await Promise.all([
    prisma.announcementView.count({ where: { announcementId: id } }),
    prisma.announcementClick.count({ where: { announcementId: id } }),
    prisma.announcementDismissal.count({ where: { announcementId: id } }),
    prisma.$queryRaw`
      SELECT DATE(viewed_at) as date, COUNT(*) as count
      FROM announcement_views
      WHERE announcement_id = ${id}
      GROUP BY DATE(viewed_at)
      ORDER BY date DESC
      LIMIT 30
    `,
  ]);

  return {
    announcementId: id,
    title: announcement.title,
    metrics: {
      views,
      clicks,
      dismissals,
      clickRate: views > 0 ? ((clicks / views) * 100).toFixed(2) : 0,
      dismissRate: views > 0 ? ((dismissals / views) * 100).toFixed(2) : 0,
    },
    viewsByDay,
  };
};

// =============================================================================
// SCHEDULED OPERATIONS
// =============================================================================

/**
 * Expire old announcements
 * @returns {Promise<Object>} Expiration result
 */
exports.expireAnnouncements = async () => {
  const now = new Date();

  const result = await prisma.announcement.updateMany({
    where: {
      status: 'ACTIVE',
      endDate: { lt: now },
    },
    data: {
      status: 'EXPIRED',
    },
  });

  if (result.count > 0) {
    await invalidateCache();
    logger.info('Announcements expired', { count: result.count });
  }

  return { expired: result.count };
};

/**
 * Activate scheduled announcements
 * @returns {Promise<Object>} Activation result
 */
exports.activateScheduledAnnouncements = async () => {
  const now = new Date();

  const result = await prisma.announcement.updateMany({
    where: {
      status: 'SCHEDULED',
      startDate: { lte: now },
    },
    data: {
      status: 'ACTIVE',
    },
  });

  if (result.count > 0) {
    await invalidateCache();
    logger.info('Announcements activated', { count: result.count });
  }

  return { activated: result.count };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get cached announcements
 */
async function getCachedAnnouncements() {
  try {
    const cached = await redis.get(CONFIG.cacheKey);
    return cached ? JSON.parse(cached) : null;
  } catch (error) {
    return null;
  }
}

/**
 * Cache announcements
 */
async function cacheAnnouncements(announcements) {
  try {
    await redis.setex(CONFIG.cacheKey, CONFIG.cacheTTL, JSON.stringify(announcements));
  } catch (error) {
    logger.warn('Cache announcements error', { error: error.message });
  }
}

/**
 * Invalidate announcements cache
 */
async function invalidateCache() {
  try {
    await redis.del(CONFIG.cacheKey);
  } catch (error) {
    logger.warn('Invalidate cache error', { error: error.message });
  }
}

/**
 * Get dismissed announcement IDs for a user
 */
async function getDismissedAnnouncementIds(userId) {
  const dismissals = await prisma.announcementDismissal.findMany({
    where: { userId },
    select: { announcementId: true },
  });
  return dismissals.map((d) => d.announcementId);
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  ANNOUNCEMENT_TYPES,
  TARGET_AUDIENCES,
};



