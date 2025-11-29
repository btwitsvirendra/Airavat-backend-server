/**
 * Review Service
 * Handles reviews and ratings for businesses and products
 */

const prisma = require('../config/database');
const { cache } = require('../config/redis');
const { NotFoundError, BadRequestError, ForbiddenError, ConflictError } = require('../utils/errors');
const { parsePagination, buildPaginationMeta } = require('../utils/helpers');
const logger = require('../config/logger');

class ReviewService {
  /**
   * Create a review
   */
  async createReview(authorBusinessId, data, userId) {
    const {
      businessId,
      productId,
      orderId,
      rating,
      qualityRating,
      communicationRating,
      deliveryRating,
      valueRating,
      title,
      content,
      images,
      videos,
    } = data;

    // Must review either business or product
    if (!businessId && !productId) {
      throw new BadRequestError('Either businessId or productId is required');
    }

    // Validate order if provided
    let order = null;
    if (orderId) {
      order = await prisma.order.findUnique({
        where: { id: orderId },
        select: {
          id: true,
          buyerBusinessId: true,
          sellerBusinessId: true,
          status: true,
          deliveredAt: true,
        },
      });

      if (!order) {
        throw new NotFoundError('Order not found');
      }

      if (order.buyerBusinessId !== authorBusinessId) {
        throw new ForbiddenError('You can only review your own orders');
      }

      if (order.status !== 'COMPLETED' && order.status !== 'DELIVERED') {
        throw new BadRequestError('You can only review completed or delivered orders');
      }

      // Auto-set businessId from order if not provided
      if (!businessId && order.sellerBusinessId) {
        data.businessId = order.sellerBusinessId;
      }
    }

    // Check if already reviewed
    const existingReview = await prisma.review.findFirst({
      where: {
        authorBusinessId,
        ...(businessId && { businessId }),
        ...(productId && { productId }),
        ...(orderId && { orderId }),
      },
    });

    if (existingReview) {
      throw new ConflictError('You have already reviewed this item');
    }

    // Validate target business if reviewing a business
    if (businessId) {
      const targetBusiness = await prisma.business.findUnique({
        where: { id: businessId },
        select: { id: true, status: true },
      });

      if (!targetBusiness || targetBusiness.status !== 'VERIFIED') {
        throw new NotFoundError('Business not found');
      }

      // Cannot review own business
      if (businessId === authorBusinessId) {
        throw new BadRequestError('You cannot review your own business');
      }
    }

    // Validate target product if reviewing a product
    if (productId) {
      const product = await prisma.product.findUnique({
        where: { id: productId },
        select: { id: true, status: true, businessId: true },
      });

      if (!product || product.status !== 'ACTIVE') {
        throw new NotFoundError('Product not found');
      }

      // Cannot review own product
      if (product.businessId === authorBusinessId) {
        throw new BadRequestError('You cannot review your own product');
      }
    }

    // Create review
    const review = await prisma.review.create({
      data: {
        authorBusinessId,
        businessId: businessId || null,
        productId: productId || null,
        orderId: orderId || null,
        rating,
        qualityRating,
        communicationRating,
        deliveryRating,
        valueRating,
        title,
        content,
        images: images || [],
        videos: videos || [],
        isVerifiedPurchase: !!orderId,
        isApproved: true, // Auto-approve for now, can add moderation later
      },
      include: {
        authorBusiness: {
          select: {
            id: true,
            legalName: true,
            displayName: true,
            logo: true,
          },
        },
      },
    });

    // Update ratings for target
    if (businessId) {
      await this.updateBusinessRatings(businessId);
    }
    if (productId) {
      await this.updateProductRatings(productId);
    }

    return review;
  }

  /**
   * Update a review
   */
  async updateReview(reviewId, authorBusinessId, data) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      throw new NotFoundError('Review not found');
    }

    if (review.authorBusinessId !== authorBusinessId) {
      throw new ForbiddenError('You can only update your own reviews');
    }

    // Only allow updates within 30 days
    const daysSinceCreation = (Date.now() - new Date(review.createdAt).getTime()) / (1000 * 60 * 60 * 24);
    if (daysSinceCreation > 30) {
      throw new BadRequestError('Reviews can only be edited within 30 days of creation');
    }

    const updated = await prisma.review.update({
      where: { id: reviewId },
      data: {
        rating: data.rating,
        qualityRating: data.qualityRating,
        communicationRating: data.communicationRating,
        deliveryRating: data.deliveryRating,
        valueRating: data.valueRating,
        title: data.title,
        content: data.content,
        images: data.images,
        videos: data.videos,
        updatedAt: new Date(),
      },
    });

    // Update ratings
    if (review.businessId) {
      await this.updateBusinessRatings(review.businessId);
    }
    if (review.productId) {
      await this.updateProductRatings(review.productId);
    }

    return updated;
  }

  /**
   * Delete a review
   */
  async deleteReview(reviewId, authorBusinessId) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      throw new NotFoundError('Review not found');
    }

    if (review.authorBusinessId !== authorBusinessId) {
      throw new ForbiddenError('You can only delete your own reviews');
    }

    await prisma.review.delete({
      where: { id: reviewId },
    });

    // Update ratings
    if (review.businessId) {
      await this.updateBusinessRatings(review.businessId);
    }
    if (review.productId) {
      await this.updateProductRatings(review.productId);
    }

    return { message: 'Review deleted successfully' };
  }

  /**
   * Get reviews for a business
   */
  async getBusinessReviews(businessId, filters = {}, pagination = {}) {
    const { page, limit, skip } = parsePagination(pagination);
    const { rating, sortBy, hasMedia } = filters;

    const where = {
      businessId,
      isApproved: true,
      isHidden: false,
      ...(rating && { rating }),
      ...(hasMedia && {
        OR: [
          { images: { isEmpty: false } },
          { videos: { isEmpty: false } },
        ],
      }),
    };

    const orderBy = this.getReviewSortOrder(sortBy);

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          authorBusiness: {
            select: {
              id: true,
              legalName: true,
              displayName: true,
              logo: true,
              city: true,
              state: true,
            },
          },
          order: {
            select: {
              orderNumber: true,
            },
          },
        },
      }),
      prisma.review.count({ where }),
    ]);

    // Get rating distribution
    const ratingDistribution = await this.getRatingDistribution(businessId, 'business');

    return {
      reviews,
      ratingDistribution,
      pagination: buildPaginationMeta(total, page, limit),
    };
  }

  /**
   * Get reviews for a product
   */
  async getProductReviews(productId, filters = {}, pagination = {}) {
    const { page, limit, skip } = parsePagination(pagination);
    const { rating, sortBy, hasMedia, verifiedOnly } = filters;

    const where = {
      productId,
      isApproved: true,
      isHidden: false,
      ...(rating && { rating }),
      ...(verifiedOnly && { isVerifiedPurchase: true }),
      ...(hasMedia && {
        OR: [
          { images: { isEmpty: false } },
          { videos: { isEmpty: false } },
        ],
      }),
    };

    const orderBy = this.getReviewSortOrder(sortBy);

    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          authorBusiness: {
            select: {
              id: true,
              legalName: true,
              displayName: true,
              logo: true,
              city: true,
              state: true,
            },
          },
        },
      }),
      prisma.review.count({ where }),
    ]);

    // Get rating distribution
    const ratingDistribution = await this.getRatingDistribution(productId, 'product');

    return {
      reviews,
      ratingDistribution,
      pagination: buildPaginationMeta(total, page, limit),
    };
  }

  /**
   * Get single review
   */
  async getReviewById(reviewId) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        authorBusiness: {
          select: {
            id: true,
            legalName: true,
            displayName: true,
            logo: true,
            city: true,
            state: true,
          },
        },
        business: {
          select: {
            id: true,
            legalName: true,
            displayName: true,
          },
        },
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            images: true,
          },
        },
        order: {
          select: {
            orderNumber: true,
            createdAt: true,
          },
        },
      },
    });

    if (!review) {
      throw new NotFoundError('Review not found');
    }

    return review;
  }

  /**
   * Add seller response to review
   */
  async addSellerResponse(reviewId, sellerBusinessId, response) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        business: { select: { id: true } },
        product: { select: { businessId: true } },
      },
    });

    if (!review) {
      throw new NotFoundError('Review not found');
    }

    // Check if seller owns the reviewed entity
    const isBusinessOwner = review.business?.id === sellerBusinessId;
    const isProductOwner = review.product?.businessId === sellerBusinessId;

    if (!isBusinessOwner && !isProductOwner) {
      throw new ForbiddenError('You can only respond to reviews of your own business or products');
    }

    if (review.sellerResponse) {
      throw new ConflictError('A response has already been added to this review');
    }

    return prisma.review.update({
      where: { id: reviewId },
      data: {
        sellerResponse: response,
        sellerResponseAt: new Date(),
      },
    });
  }

  /**
   * Update seller response
   */
  async updateSellerResponse(reviewId, sellerBusinessId, response) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
      include: {
        business: { select: { id: true } },
        product: { select: { businessId: true } },
      },
    });

    if (!review) {
      throw new NotFoundError('Review not found');
    }

    const isBusinessOwner = review.business?.id === sellerBusinessId;
    const isProductOwner = review.product?.businessId === sellerBusinessId;

    if (!isBusinessOwner && !isProductOwner) {
      throw new ForbiddenError('You can only update responses to your own reviews');
    }

    return prisma.review.update({
      where: { id: reviewId },
      data: {
        sellerResponse: response,
        sellerResponseAt: new Date(),
      },
    });
  }

  /**
   * Vote review as helpful
   */
  async voteHelpful(reviewId, voterId) {
    // Simple increment for now - could track individual votes to prevent duplicates
    return prisma.review.update({
      where: { id: reviewId },
      data: {
        helpfulVotes: { increment: 1 },
      },
    });
  }

  /**
   * Report review
   */
  async reportReview(reviewId, reporterBusinessId, reason) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      throw new NotFoundError('Review not found');
    }

    // Mark for moderation
    await prisma.review.update({
      where: { id: reviewId },
      data: {
        isApproved: false, // Hide until moderated
      },
    });

    // Log report (could create a separate ReviewReport model)
    logger.info('Review reported', {
      reviewId,
      reporterBusinessId,
      reason,
    });

    return { message: 'Review reported and will be reviewed by our team' };
  }

  /**
   * Get review statistics for a business
   */
  async getBusinessReviewStats(businessId) {
    const reviews = await prisma.review.findMany({
      where: {
        businessId,
        isApproved: true,
        isHidden: false,
      },
      select: {
        rating: true,
        qualityRating: true,
        communicationRating: true,
        deliveryRating: true,
        valueRating: true,
      },
    });

    if (reviews.length === 0) {
      return {
        totalReviews: 0,
        averageRating: 0,
        ratingDistribution: { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 },
        categoryRatings: {
          quality: 0,
          communication: 0,
          delivery: 0,
          value: 0,
        },
      };
    }

    const ratingDistribution = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    let totalRating = 0;
    let totalQuality = 0, qualityCount = 0;
    let totalComm = 0, commCount = 0;
    let totalDelivery = 0, deliveryCount = 0;
    let totalValue = 0, valueCount = 0;

    for (const review of reviews) {
      totalRating += review.rating;
      ratingDistribution[review.rating]++;

      if (review.qualityRating) {
        totalQuality += review.qualityRating;
        qualityCount++;
      }
      if (review.communicationRating) {
        totalComm += review.communicationRating;
        commCount++;
      }
      if (review.deliveryRating) {
        totalDelivery += review.deliveryRating;
        deliveryCount++;
      }
      if (review.valueRating) {
        totalValue += review.valueRating;
        valueCount++;
      }
    }

    return {
      totalReviews: reviews.length,
      averageRating: Number((totalRating / reviews.length).toFixed(1)),
      ratingDistribution,
      categoryRatings: {
        quality: qualityCount ? Number((totalQuality / qualityCount).toFixed(1)) : null,
        communication: commCount ? Number((totalComm / commCount).toFixed(1)) : null,
        delivery: deliveryCount ? Number((totalDelivery / deliveryCount).toFixed(1)) : null,
        value: valueCount ? Number((totalValue / valueCount).toFixed(1)) : null,
      },
    };
  }

  /**
   * Admin: Moderate review
   */
  async moderateReview(reviewId, adminId, action, reason) {
    const review = await prisma.review.findUnique({
      where: { id: reviewId },
    });

    if (!review) {
      throw new NotFoundError('Review not found');
    }

    const updateData = {};

    switch (action) {
      case 'approve':
        updateData.isApproved = true;
        updateData.isHidden = false;
        break;
      case 'hide':
        updateData.isHidden = true;
        break;
      case 'unhide':
        updateData.isHidden = false;
        break;
      case 'reject':
        updateData.isApproved = false;
        updateData.isHidden = true;
        break;
      default:
        throw new BadRequestError('Invalid action');
    }

    const updated = await prisma.review.update({
      where: { id: reviewId },
      data: updateData,
    });

    // Log audit
    await prisma.auditLog.create({
      data: {
        userId: adminId,
        action: `REVIEW_${action.toUpperCase()}`,
        entity: 'Review',
        entityId: reviewId,
        oldValues: { isApproved: review.isApproved, isHidden: review.isHidden },
        newValues: updateData,
        context: { reason },
      },
    });

    // Update ratings if visibility changed
    if (review.businessId) {
      await this.updateBusinessRatings(review.businessId);
    }
    if (review.productId) {
      await this.updateProductRatings(review.productId);
    }

    return updated;
  }

  // Helper methods

  /**
   * Update business ratings aggregate
   */
  async updateBusinessRatings(businessId) {
    const stats = await prisma.review.aggregate({
      where: {
        businessId,
        isApproved: true,
        isHidden: false,
      },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await prisma.business.update({
      where: { id: businessId },
      data: {
        averageRating: stats._avg.rating || 0,
        reviewCount: stats._count.rating || 0,
      },
    });
  }

  /**
   * Update product ratings aggregate
   */
  async updateProductRatings(productId) {
    const stats = await prisma.review.aggregate({
      where: {
        productId,
        isApproved: true,
        isHidden: false,
      },
      _avg: { rating: true },
      _count: { rating: true },
    });

    await prisma.product.update({
      where: { id: productId },
      data: {
        averageRating: stats._avg.rating || 0,
        reviewCount: stats._count.rating || 0,
      },
    });
  }

  /**
   * Get rating distribution
   */
  async getRatingDistribution(entityId, entityType) {
    const field = entityType === 'business' ? 'businessId' : 'productId';
    
    const distribution = await prisma.review.groupBy({
      by: ['rating'],
      where: {
        [field]: entityId,
        isApproved: true,
        isHidden: false,
      },
      _count: { rating: true },
    });

    const result = { 5: 0, 4: 0, 3: 0, 2: 0, 1: 0 };
    distribution.forEach(({ rating, _count }) => {
      result[rating] = _count.rating;
    });

    return result;
  }

  /**
   * Get sort order for reviews
   */
  getReviewSortOrder(sortBy) {
    switch (sortBy) {
      case 'newest':
        return { createdAt: 'desc' };
      case 'oldest':
        return { createdAt: 'asc' };
      case 'highest':
        return { rating: 'desc' };
      case 'lowest':
        return { rating: 'asc' };
      case 'helpful':
        return { helpfulVotes: 'desc' };
      default:
        return [
          { helpfulVotes: 'desc' },
          { createdAt: 'desc' },
        ];
    }
  }
}

module.exports = new ReviewService();
