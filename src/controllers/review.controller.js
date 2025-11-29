// =============================================================================
// AIRAVAT B2B MARKETPLACE - REVIEW CONTROLLER
// Product and seller reviews and ratings
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const { successResponse } = require('../utils/response');
const { NotFoundError, BadRequestError, ForbiddenError } = require('../utils/errors');
const notificationService = require('../services/notification.service');
const logger = require('../config/logger');

class ReviewController {
  // =============================================================================
  // PRODUCT REVIEWS
  // =============================================================================

  /**
   * Get product reviews
   */
  async getProductReviews(req, res, next) {
    try {
      const { productId } = req.params;
      const {
        page = 1,
        limit = 10,
        sort = 'recent',
        rating,
        verified,
        withImages,
      } = req.query;
      const skip = (page - 1) * limit;

      // Build filters
      const where = {
        productId,
        status: 'APPROVED',
      };

      if (rating) {
        where.rating = parseInt(rating);
      }

      if (verified === 'true') {
        where.isVerifiedPurchase = true;
      }

      if (withImages === 'true') {
        where.images = { isEmpty: false };
      }

      // Sort options
      let orderBy;
      switch (sort) {
        case 'highest':
          orderBy = { rating: 'desc' };
          break;
        case 'lowest':
          orderBy = { rating: 'asc' };
          break;
        case 'helpful':
          orderBy = { helpfulCount: 'desc' };
          break;
        default:
          orderBy = { createdAt: 'desc' };
      }

      const [reviews, total] = await Promise.all([
        prisma.review.findMany({
          where,
          include: {
            reviewer: {
              select: {
                id: true,
                businessName: true,
                city: true,
              },
            },
            responses: {
              where: { status: 'APPROVED' },
              include: {
                business: {
                  select: { id: true, businessName: true },
                },
              },
            },
          },
          orderBy,
          skip,
          take: parseInt(limit),
        }),
        prisma.review.count({ where }),
      ]);

      // Get rating summary
      const ratingSummary = await this.getProductRatingSummary(productId);

      return successResponse(res, {
        reviews,
        summary: ratingSummary,
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
   * Create product review
   */
  async createProductReview(req, res, next) {
    try {
      const { productId } = req.params;
      const businessId = req.user.businessId;
      const { rating, title, comment, images, pros, cons } = req.body;

      // Check if product exists
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          business: { select: { id: true, businessName: true, ownerId: true } },
        },
      });

      if (!product) {
        throw new NotFoundError('Product not found');
      }

      // Check if user has ordered this product
      const hasOrdered = await prisma.orderItem.findFirst({
        where: {
          productId,
          order: {
            buyerId: businessId,
            status: 'DELIVERED',
          },
        },
      });

      // Check for existing review
      const existingReview = await prisma.review.findFirst({
        where: {
          productId,
          reviewerId: businessId,
        },
      });

      if (existingReview) {
        throw new BadRequestError('You have already reviewed this product');
      }

      // Create review
      const review = await prisma.review.create({
        data: {
          productId,
          reviewerId: businessId,
          sellerId: product.businessId,
          rating,
          title,
          comment,
          images: images || [],
          pros: pros || [],
          cons: cons || [],
          isVerifiedPurchase: !!hasOrdered,
          status: hasOrdered ? 'APPROVED' : 'PENDING', // Auto-approve verified purchases
        },
        include: {
          reviewer: {
            select: { id: true, businessName: true },
          },
        },
      });

      // Update product rating
      await this.updateProductRating(productId);

      // Notify seller
      await notificationService.notifyNewReview(
        product.business.ownerId,
        product.id,
        product.name,
        rating
      );

      logger.info('Review created', { productId, reviewerId: businessId, rating });

      return successResponse(res, review, 'Review submitted successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update review
   */
  async updateReview(req, res, next) {
    try {
      const { reviewId } = req.params;
      const businessId = req.user.businessId;
      const { rating, title, comment, images, pros, cons } = req.body;

      const review = await prisma.review.findUnique({
        where: { id: reviewId },
      });

      if (!review) {
        throw new NotFoundError('Review not found');
      }

      if (review.reviewerId !== businessId) {
        throw new ForbiddenError('You can only edit your own reviews');
      }

      // Check if review can be edited (within 30 days)
      const daysSinceCreation = (Date.now() - new Date(review.createdAt)) / (1000 * 60 * 60 * 24);
      if (daysSinceCreation > 30) {
        throw new BadRequestError('Reviews can only be edited within 30 days of posting');
      }

      const updatedReview = await prisma.review.update({
        where: { id: reviewId },
        data: {
          rating,
          title,
          comment,
          images,
          pros,
          cons,
          isEdited: true,
          editedAt: new Date(),
          status: review.isVerifiedPurchase ? 'APPROVED' : 'PENDING',
        },
        include: {
          reviewer: {
            select: { id: true, businessName: true },
          },
        },
      });

      // Update product rating
      await this.updateProductRating(review.productId);

      return successResponse(res, updatedReview, 'Review updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete review
   */
  async deleteReview(req, res, next) {
    try {
      const { reviewId } = req.params;
      const businessId = req.user.businessId;

      const review = await prisma.review.findUnique({
        where: { id: reviewId },
      });

      if (!review) {
        throw new NotFoundError('Review not found');
      }

      if (review.reviewerId !== businessId && req.user.role !== 'ADMIN') {
        throw new ForbiddenError('You can only delete your own reviews');
      }

      await prisma.review.delete({ where: { id: reviewId } });

      // Update product rating
      await this.updateProductRating(review.productId);

      return successResponse(res, null, 'Review deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark review as helpful
   */
  async markHelpful(req, res, next) {
    try {
      const { reviewId } = req.params;
      const userId = req.user.id;

      // Check if already marked
      const existing = await prisma.reviewHelpful.findFirst({
        where: { reviewId, userId },
      });

      if (existing) {
        // Remove helpful
        await prisma.reviewHelpful.delete({ where: { id: existing.id } });
        await prisma.review.update({
          where: { id: reviewId },
          data: { helpfulCount: { decrement: 1 } },
        });

        return successResponse(res, { marked: false }, 'Removed helpful mark');
      }

      // Add helpful
      await prisma.reviewHelpful.create({
        data: { reviewId, userId },
      });
      await prisma.review.update({
        where: { id: reviewId },
        data: { helpfulCount: { increment: 1 } },
      });

      return successResponse(res, { marked: true }, 'Marked as helpful');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Report review
   */
  async reportReview(req, res, next) {
    try {
      const { reviewId } = req.params;
      const userId = req.user.id;
      const { reason, details } = req.body;

      const review = await prisma.review.findUnique({ where: { id: reviewId } });

      if (!review) {
        throw new NotFoundError('Review not found');
      }

      await prisma.reviewReport.create({
        data: {
          reviewId,
          reporterId: userId,
          reason,
          details,
        },
      });

      // If multiple reports, flag for moderation
      const reportCount = await prisma.reviewReport.count({
        where: { reviewId },
      });

      if (reportCount >= 3) {
        await prisma.review.update({
          where: { id: reviewId },
          data: { status: 'FLAGGED' },
        });
      }

      return successResponse(res, null, 'Review reported successfully');
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // SELLER REVIEWS
  // =============================================================================

  /**
   * Get seller reviews
   */
  async getSellerReviews(req, res, next) {
    try {
      const { sellerId } = req.params;
      const { page = 1, limit = 10, sort = 'recent' } = req.query;
      const skip = (page - 1) * limit;

      let orderBy;
      switch (sort) {
        case 'highest':
          orderBy = { rating: 'desc' };
          break;
        case 'lowest':
          orderBy = { rating: 'asc' };
          break;
        default:
          orderBy = { createdAt: 'desc' };
      }

      const [reviews, total] = await Promise.all([
        prisma.review.findMany({
          where: {
            sellerId,
            status: 'APPROVED',
          },
          include: {
            reviewer: {
              select: { id: true, businessName: true, city: true },
            },
            product: {
              select: { id: true, name: true, slug: true },
            },
          },
          orderBy,
          skip,
          take: parseInt(limit),
        }),
        prisma.review.count({
          where: { sellerId, status: 'APPROVED' },
        }),
      ]);

      // Get rating summary
      const ratingSummary = await this.getSellerRatingSummary(sellerId);

      return successResponse(res, {
        reviews,
        summary: ratingSummary,
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

  // =============================================================================
  // SELLER RESPONSES
  // =============================================================================

  /**
   * Respond to review (seller)
   */
  async respondToReview(req, res, next) {
    try {
      const { reviewId } = req.params;
      const businessId = req.user.businessId;
      const { response } = req.body;

      const review = await prisma.review.findUnique({
        where: { id: reviewId },
      });

      if (!review) {
        throw new NotFoundError('Review not found');
      }

      if (review.sellerId !== businessId) {
        throw new ForbiddenError('You can only respond to reviews on your products');
      }

      // Check for existing response
      const existingResponse = await prisma.reviewResponse.findFirst({
        where: { reviewId, businessId },
      });

      if (existingResponse) {
        // Update existing
        const updated = await prisma.reviewResponse.update({
          where: { id: existingResponse.id },
          data: { response, updatedAt: new Date() },
        });
        return successResponse(res, updated, 'Response updated');
      }

      // Create new response
      const reviewResponse = await prisma.reviewResponse.create({
        data: {
          reviewId,
          businessId,
          response,
        },
      });

      return successResponse(res, reviewResponse, 'Response added successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // MY REVIEWS
  // =============================================================================

  /**
   * Get my reviews
   */
  async getMyReviews(req, res, next) {
    try {
      const businessId = req.user.businessId;
      const { page = 1, limit = 10 } = req.query;
      const skip = (page - 1) * limit;

      const [reviews, total] = await Promise.all([
        prisma.review.findMany({
          where: { reviewerId: businessId },
          include: {
            product: {
              select: { id: true, name: true, slug: true, images: true },
            },
            seller: {
              select: { id: true, businessName: true },
            },
            responses: true,
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: parseInt(limit),
        }),
        prisma.review.count({ where: { reviewerId: businessId } }),
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
   * Get reviews for my products (seller)
   */
  async getReviewsForMyProducts(req, res, next) {
    try {
      const businessId = req.user.businessId;
      const { page = 1, limit = 10, status, rating } = req.query;
      const skip = (page - 1) * limit;

      const where = { sellerId: businessId };
      if (status) where.status = status;
      if (rating) where.rating = parseInt(rating);

      const [reviews, total] = await Promise.all([
        prisma.review.findMany({
          where,
          include: {
            product: {
              select: { id: true, name: true, slug: true },
            },
            reviewer: {
              select: { id: true, businessName: true },
            },
            responses: {
              where: { businessId },
            },
          },
          orderBy: { createdAt: 'desc' },
          skip,
          take: parseInt(limit),
        }),
        prisma.review.count({ where }),
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

  // =============================================================================
  // HELPER METHODS
  // =============================================================================

  async getProductRatingSummary(productId) {
    const ratings = await prisma.review.groupBy({
      by: ['rating'],
      where: { productId, status: 'APPROVED' },
      _count: true,
    });

    const stats = await prisma.review.aggregate({
      where: { productId, status: 'APPROVED' },
      _avg: { rating: true },
      _count: true,
    });

    const distribution = {};
    for (let i = 1; i <= 5; i++) {
      const found = ratings.find((r) => r.rating === i);
      distribution[i] = found?._count || 0;
    }

    return {
      averageRating: Math.round((stats._avg.rating || 0) * 10) / 10,
      totalReviews: stats._count,
      distribution,
    };
  }

  async getSellerRatingSummary(sellerId) {
    const stats = await prisma.review.aggregate({
      where: { sellerId, status: 'APPROVED' },
      _avg: { rating: true },
      _count: true,
    });

    return {
      averageRating: Math.round((stats._avg.rating || 0) * 10) / 10,
      totalReviews: stats._count,
    };
  }

  async updateProductRating(productId) {
    const stats = await prisma.review.aggregate({
      where: { productId, status: 'APPROVED' },
      _avg: { rating: true },
      _count: true,
    });

    await prisma.product.update({
      where: { id: productId },
      data: {
        averageRating: stats._avg.rating || 0,
        reviewCount: stats._count,
      },
    });

    // Also update seller rating
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: { businessId: true },
    });

    if (product) {
      const sellerStats = await prisma.review.aggregate({
        where: { sellerId: product.businessId, status: 'APPROVED' },
        _avg: { rating: true },
        _count: true,
      });

      await prisma.business.update({
        where: { id: product.businessId },
        data: {
          averageRating: sellerStats._avg.rating || 0,
          totalReviews: sellerStats._count,
        },
      });
    }
  }
}

module.exports = new ReviewController();
