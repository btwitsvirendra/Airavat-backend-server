// =============================================================================
// AIRAVAT B2B MARKETPLACE - ADMIN CONTROLLER
// Platform administration, moderation, and analytics
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const { successResponse } = require('../utils/response');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const notificationService = require('../services/notification.service');
const elasticsearchService = require('../services/elasticsearch.service');
const logger = require('../config/logger');

class AdminController {
  // =============================================================================
  // DASHBOARD
  // =============================================================================

  /**
   * Get admin dashboard stats
   */
  async getDashboard(req, res, next) {
    try {
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

      const [
        totalUsers,
        totalBusinesses,
        totalProducts,
        totalOrders,
        todayOrders,
        monthlyRevenue,
        pendingVerifications,
        pendingReviews,
        recentOrders,
        topSellers,
      ] = await Promise.all([
        prisma.user.count({ where: { status: 'ACTIVE' } }),
        prisma.business.count(),
        prisma.product.count({ where: { status: 'ACTIVE' } }),
        prisma.order.count(),
        prisma.order.count({ where: { createdAt: { gte: today } } }),
        prisma.order.aggregate({
          where: { createdAt: { gte: thirtyDaysAgo }, status: { not: 'CANCELLED' } },
          _sum: { totalAmount: true },
        }),
        prisma.business.count({ where: { verificationStatus: 'PENDING' } }),
        prisma.review.count({ where: { status: 'PENDING' } }),
        prisma.order.findMany({
          include: {
            buyer: { select: { businessName: true } },
            seller: { select: { businessName: true } },
          },
          orderBy: { createdAt: 'desc' },
          take: 10,
        }),
        prisma.business.findMany({
          where: { verificationStatus: 'VERIFIED' },
          orderBy: { trustScore: 'desc' },
          take: 5,
          select: {
            id: true,
            businessName: true,
            trustScore: true,
            _count: { select: { products: true, orders: true } },
          },
        }),
      ]);

      // Calculate growth
      const previousPeriod = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
      const previousMonthOrders = await prisma.order.count({
        where: {
          createdAt: { gte: previousPeriod, lt: thirtyDaysAgo },
        },
      });

      const currentMonthOrders = await prisma.order.count({
        where: { createdAt: { gte: thirtyDaysAgo } },
      });

      const orderGrowth = previousMonthOrders > 0
        ? ((currentMonthOrders - previousMonthOrders) / previousMonthOrders) * 100
        : 0;

      return successResponse(res, {
        overview: {
          totalUsers,
          totalBusinesses,
          totalProducts,
          totalOrders,
          todayOrders,
          monthlyRevenue: monthlyRevenue._sum.totalAmount || 0,
          orderGrowth: Math.round(orderGrowth * 10) / 10,
        },
        pending: {
          verifications: pendingVerifications,
          reviews: pendingReviews,
        },
        recentOrders,
        topSellers: topSellers.map((s) => ({
          ...s,
          productCount: s._count.products,
          orderCount: s._count.orders,
          _count: undefined,
        })),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get platform analytics
   */
  async getAnalytics(req, res, next) {
    try {
      const { period = 30 } = req.query;
      const startDate = new Date(Date.now() - period * 24 * 60 * 60 * 1000);

      // Daily orders
      const dailyOrders = await prisma.$queryRaw`
        SELECT DATE(created_at) as date, COUNT(*) as orders, SUM(total_amount) as revenue
        FROM orders
        WHERE created_at >= ${startDate}
        GROUP BY DATE(created_at)
        ORDER BY date
      `;

      // User registrations
      const dailyUsers = await prisma.$queryRaw`
        SELECT DATE(created_at) as date, COUNT(*) as users
        FROM users
        WHERE created_at >= ${startDate}
        GROUP BY DATE(created_at)
        ORDER BY date
      `;

      // Top categories
      const topCategories = await prisma.orderItem.groupBy({
        by: ['productId'],
        where: { order: { createdAt: { gte: startDate } } },
        _sum: { quantity: true, totalPrice: true },
        orderBy: { _sum: { totalPrice: 'desc' } },
        take: 10,
      });

      // Order status distribution
      const orderStatus = await prisma.order.groupBy({
        by: ['status'],
        where: { createdAt: { gte: startDate } },
        _count: true,
      });

      return successResponse(res, {
        dailyOrders,
        dailyUsers,
        topCategories,
        orderStatus: orderStatus.map((s) => ({ status: s.status, count: s._count })),
      });
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // USER MANAGEMENT
  // =============================================================================

  /**
   * List all users
   */
  async listUsers(req, res, next) {
    try {
      const {
        page = 1,
        limit = 20,
        role,
        status,
        search,
        sort = 'createdAt',
        order = 'desc',
      } = req.query;
      const skip = (page - 1) * limit;

      const where = {};
      if (role) where.role = role;
      if (status) where.status = status;
      if (search) {
        where.OR = [
          { email: { contains: search, mode: 'insensitive' } },
          { firstName: { contains: search, mode: 'insensitive' } },
          { lastName: { contains: search, mode: 'insensitive' } },
          { phone: { contains: search } },
        ];
      }

      const [users, total] = await Promise.all([
        prisma.user.findMany({
          where,
          select: {
            id: true,
            email: true,
            phone: true,
            firstName: true,
            lastName: true,
            role: true,
            status: true,
            isEmailVerified: true,
            isPhoneVerified: true,
            createdAt: true,
            lastLoginAt: true,
            _count: { select: { businesses: true } },
          },
          orderBy: { [sort]: order },
          skip,
          take: parseInt(limit),
        }),
        prisma.user.count({ where }),
      ]);

      return successResponse(res, {
        users,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update user status
   */
  async updateUserStatus(req, res, next) {
    try {
      const { userId } = req.params;
      const { status, reason } = req.body;

      const user = await prisma.user.findUnique({ where: { id: userId } });
      if (!user) {
        throw new NotFoundError('User not found');
      }

      await prisma.user.update({
        where: { id: userId },
        data: { status },
      });

      // Log action
      await prisma.adminAction.create({
        data: {
          adminId: req.user.id,
          action: 'UPDATE_USER_STATUS',
          targetType: 'USER',
          targetId: userId,
          details: { oldStatus: user.status, newStatus: status, reason },
        },
      });

      // Notify user
      if (status === 'SUSPENDED') {
        await notificationService.send(userId, {
          type: 'ACCOUNT_SUSPENDED',
          title: 'Account Suspended',
          message: `Your account has been suspended. Reason: ${reason}`,
        });
      }

      logger.info('User status updated', { adminId: req.user.id, userId, status });

      return successResponse(res, null, 'User status updated');
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // BUSINESS VERIFICATION
  // =============================================================================

  /**
   * List pending verifications
   */
  async listPendingVerifications(req, res, next) {
    try {
      const { page = 1, limit = 20, status = 'PENDING' } = req.query;
      const skip = (page - 1) * limit;

      const where = { verificationStatus: status };

      const [businesses, total] = await Promise.all([
        prisma.business.findMany({
          where,
          include: {
            owner: {
              select: { id: true, email: true, firstName: true, lastName: true },
            },
            documents: true,
          },
          orderBy: { createdAt: 'asc' },
          skip,
          take: parseInt(limit),
        }),
        prisma.business.count({ where }),
      ]);

      return successResponse(res, {
        businesses,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Approve or reject business verification
   */
  async processVerification(req, res, next) {
    try {
      const { businessId } = req.params;
      const { action, reason, notes } = req.body; // action: 'approve' | 'reject'

      const business = await prisma.business.findUnique({
        where: { id: businessId },
        include: { owner: true },
      });

      if (!business) {
        throw new NotFoundError('Business not found');
      }

      const newStatus = action === 'approve' ? 'VERIFIED' : 'REJECTED';

      await prisma.business.update({
        where: { id: businessId },
        data: {
          verificationStatus: newStatus,
          verifiedAt: action === 'approve' ? new Date() : undefined,
          verifiedBy: req.user.id,
          verificationNotes: notes,
          rejectionReason: action === 'reject' ? reason : undefined,
        },
      });

      // Log action
      await prisma.adminAction.create({
        data: {
          adminId: req.user.id,
          action: `BUSINESS_${action.toUpperCase()}`,
          targetType: 'BUSINESS',
          targetId: businessId,
          details: { reason, notes },
        },
      });

      // Notify business owner
      if (action === 'approve') {
        await notificationService.notifyVerificationApproved(
          business.owner.id,
          business.businessName
        );
      } else {
        await notificationService.notifyVerificationRejected(
          business.owner.id,
          business.businessName,
          reason
        );
      }

      logger.info('Business verification processed', {
        adminId: req.user.id,
        businessId,
        action,
      });

      return successResponse(res, null, `Business ${action}d successfully`);
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // CONTENT MODERATION
  // =============================================================================

  /**
   * List flagged reviews
   */
  async listFlaggedReviews(req, res, next) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const skip = (page - 1) * limit;

      const [reviews, total] = await Promise.all([
        prisma.review.findMany({
          where: { status: { in: ['PENDING', 'FLAGGED'] } },
          include: {
            product: { select: { id: true, name: true, slug: true } },
            reviewer: { select: { id: true, businessName: true } },
            reports: {
              include: {
                reporter: { select: { id: true, email: true } },
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: parseInt(limit),
        }),
        prisma.review.count({ where: { status: { in: ['PENDING', 'FLAGGED'] } } }),
      ]);

      return successResponse(res, {
        reviews,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Moderate review
   */
  async moderateReview(req, res, next) {
    try {
      const { reviewId } = req.params;
      const { action, reason } = req.body; // action: 'approve' | 'reject' | 'remove'

      const review = await prisma.review.findUnique({ where: { id: reviewId } });
      if (!review) {
        throw new NotFoundError('Review not found');
      }

      let newStatus;
      switch (action) {
        case 'approve':
          newStatus = 'APPROVED';
          break;
        case 'reject':
        case 'remove':
          newStatus = 'REMOVED';
          break;
        default:
          throw new BadRequestError('Invalid action');
      }

      await prisma.review.update({
        where: { id: reviewId },
        data: {
          status: newStatus,
          moderatedAt: new Date(),
          moderatedBy: req.user.id,
          moderationReason: reason,
        },
      });

      // Log action
      await prisma.adminAction.create({
        data: {
          adminId: req.user.id,
          action: `REVIEW_${action.toUpperCase()}`,
          targetType: 'REVIEW',
          targetId: reviewId,
          details: { reason },
        },
      });

      logger.info('Review moderated', { adminId: req.user.id, reviewId, action });

      return successResponse(res, null, `Review ${action}d`);
    } catch (error) {
      next(error);
    }
  }

  /**
   * List flagged products
   */
  async listFlaggedProducts(req, res, next) {
    try {
      const { page = 1, limit = 20 } = req.query;
      const skip = (page - 1) * limit;

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where: { status: 'FLAGGED' },
          include: {
            business: { select: { id: true, businessName: true } },
            category: { select: { id: true, name: true } },
          },
          orderBy: { updatedAt: 'desc' },
          skip,
          take: parseInt(limit),
        }),
        prisma.product.count({ where: { status: 'FLAGGED' } }),
      ]);

      return successResponse(res, {
        products,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Moderate product
   */
  async moderateProduct(req, res, next) {
    try {
      const { productId } = req.params;
      const { action, reason } = req.body;

      const product = await prisma.product.findUnique({ where: { id: productId } });
      if (!product) {
        throw new NotFoundError('Product not found');
      }

      let newStatus;
      switch (action) {
        case 'approve':
          newStatus = 'ACTIVE';
          break;
        case 'reject':
        case 'remove':
          newStatus = 'REMOVED';
          break;
        default:
          throw new BadRequestError('Invalid action');
      }

      await prisma.product.update({
        where: { id: productId },
        data: {
          status: newStatus,
          moderatedAt: new Date(),
          moderatedBy: req.user.id,
          moderationReason: reason,
        },
      });

      // Update search index
      if (newStatus === 'REMOVED') {
        await elasticsearchService.deleteProduct(productId);
      }

      logger.info('Product moderated', { adminId: req.user.id, productId, action });

      return successResponse(res, null, `Product ${action}d`);
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // SYSTEM MANAGEMENT
  // =============================================================================

  /**
   * Get system health
   */
  async getSystemHealth(req, res, next) {
    try {
      const [dbHealth, cacheHealth, esHealth] = await Promise.all([
        prisma.$queryRaw`SELECT 1`.then(() => ({ status: 'healthy' })).catch((e) => ({ status: 'unhealthy', error: e.message })),
        cache.ping().then(() => ({ status: 'healthy' })).catch((e) => ({ status: 'unhealthy', error: e.message })),
        elasticsearchService.healthCheck().catch((e) => ({ status: 'unhealthy', error: e.message })),
      ]);

      return successResponse(res, {
        database: dbHealth,
        cache: cacheHealth,
        search: esHealth,
        timestamp: new Date().toISOString(),
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Clear cache
   */
  async clearCache(req, res, next) {
    try {
      const { pattern } = req.body;

      if (pattern) {
        const keys = await cache.keys(pattern);
        if (keys.length > 0) {
          await Promise.all(keys.map((k) => cache.del(k)));
        }
        logger.info('Cache cleared', { pattern, count: keys.length, adminId: req.user.id });
        return successResponse(res, { cleared: keys.length }, 'Cache cleared');
      }

      await cache.flushAll();
      logger.info('All cache cleared', { adminId: req.user.id });
      return successResponse(res, null, 'All cache cleared');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reindex search
   */
  async reindexSearch(req, res, next) {
    try {
      const count = await elasticsearchService.reindexAllProducts();
      
      logger.info('Search reindexed', { count, adminId: req.user.id });
      
      return successResponse(res, { indexed: count }, 'Search index rebuilt');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get admin action logs
   */
  async getActionLogs(req, res, next) {
    try {
      const { page = 1, limit = 50, adminId, action, targetType } = req.query;
      const skip = (page - 1) * limit;

      const where = {};
      if (adminId) where.adminId = adminId;
      if (action) where.action = action;
      if (targetType) where.targetType = targetType;

      const [logs, total] = await Promise.all([
        prisma.adminAction.findMany({
          where,
          include: {
            admin: {
              select: { id: true, email: true, firstName: true, lastName: true },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: parseInt(limit),
        }),
        prisma.adminAction.count({ where }),
      ]);

      return successResponse(res, {
        logs,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new AdminController();
