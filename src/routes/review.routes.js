// =============================================================================
// AIRAVAT B2B MARKETPLACE - REVIEW ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth, requireBusiness } = require('../middleware/auth');
const { prisma } = require('../config/database');
const { success, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/errorHandler');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

// Get reviews for product
router.get(
  '/product/:productId',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { rating, sort = 'recent' } = req.query;
    
    const where = {
      productId: req.params.productId,
      isApproved: true,
      isHidden: false,
    };
    
    if (rating) {
      where.rating = parseInt(rating);
    }
    
    const orderBy = sort === 'helpful' 
      ? { helpfulCount: 'desc' }
      : { createdAt: 'desc' };
    
    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy,
        include: {
          author: {
            select: { firstName: true, lastName: true, avatar: true },
          },
        },
      }),
      prisma.review.count({ where }),
    ]);
    
    // Get rating stats
    const stats = await prisma.review.groupBy({
      by: ['rating'],
      where: { productId: req.params.productId, isApproved: true },
      _count: true,
    });
    
    paginated(res, { reviews, stats }, { page, limit, total });
  })
);

// Get reviews for business
router.get(
  '/business/:businessId',
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    
    const where = {
      businessId: req.params.businessId,
      isApproved: true,
      isHidden: false,
    };
    
    const [reviews, total] = await Promise.all([
      prisma.review.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          author: {
            select: { firstName: true, lastName: true, avatar: true },
          },
          product: {
            select: { name: true, slug: true, images: true },
          },
        },
      }),
      prisma.review.count({ where }),
    ]);
    
    paginated(res, reviews, { page, limit, total });
  })
);

// Create review
router.post(
  '/',
  authenticate,
  requireBusiness,
  asyncHandler(async (req, res) => {
    const { businessId, productId, orderId, rating, title, content, images, videos,
            qualityRating, communicationRating, deliveryRating, valueRating } = req.body;
    
    if (!businessId || !rating) {
      throw new BadRequestError('Business ID and rating are required');
    }
    
    // Verify purchase if orderId provided
    let isVerifiedPurchase = false;
    if (orderId) {
      const order = await prisma.order.findFirst({
        where: {
          id: orderId,
          buyerId: req.business.id,
          sellerId: businessId,
          status: { in: ['DELIVERED', 'COMPLETED'] },
        },
      });
      isVerifiedPurchase = !!order;
    }
    
    // Check if already reviewed
    const existingReview = await prisma.review.findFirst({
      where: {
        authorId: req.user.id,
        businessId,
        productId: productId || undefined,
      },
    });
    
    if (existingReview) {
      throw new BadRequestError('You have already reviewed this');
    }
    
    const review = await prisma.review.create({
      data: {
        businessId,
        productId,
        orderId,
        authorId: req.user.id,
        authorBusinessId: req.business.id,
        rating,
        title,
        content,
        images: images || [],
        videos: videos || [],
        qualityRating,
        communicationRating,
        deliveryRating,
        valueRating,
        isVerifiedPurchase,
        isApproved: true, // Auto-approve for now
      },
    });
    
    // Update business/product rating
    await updateAverageRating(businessId, productId);
    
    created(res, { review }, 'Review submitted');
  })
);

// Update review
router.patch(
  '/:reviewId',
  authenticate,
  asyncHandler(async (req, res) => {
    const review = await prisma.review.findUnique({
      where: { id: req.params.reviewId },
    });
    
    if (!review || review.authorId !== req.user.id) {
      throw new ForbiddenError('You can only edit your own reviews');
    }
    
    const updatedReview = await prisma.review.update({
      where: { id: req.params.reviewId },
      data: {
        rating: req.body.rating,
        title: req.body.title,
        content: req.body.content,
        images: req.body.images,
        videos: req.body.videos,
        qualityRating: req.body.qualityRating,
        communicationRating: req.body.communicationRating,
        deliveryRating: req.body.deliveryRating,
        valueRating: req.body.valueRating,
      },
    });
    
    await updateAverageRating(review.businessId, review.productId);
    
    success(res, { review: updatedReview }, 'Review updated');
  })
);

// Delete review
router.delete(
  '/:reviewId',
  authenticate,
  asyncHandler(async (req, res) => {
    const review = await prisma.review.findUnique({
      where: { id: req.params.reviewId },
    });
    
    if (!review || review.authorId !== req.user.id) {
      throw new ForbiddenError('You can only delete your own reviews');
    }
    
    await prisma.review.delete({
      where: { id: req.params.reviewId },
    });
    
    await updateAverageRating(review.businessId, review.productId);
    
    success(res, null, 'Review deleted');
  })
);

// Mark review helpful
router.post(
  '/:reviewId/helpful',
  authenticate,
  asyncHandler(async (req, res) => {
    await prisma.review.update({
      where: { id: req.params.reviewId },
      data: { helpfulCount: { increment: 1 } },
    });
    
    success(res, null, 'Marked as helpful');
  })
);

// Seller respond to review
router.post(
  '/:reviewId/respond',
  authenticate,
  requireBusiness,
  asyncHandler(async (req, res) => {
    const { response } = req.body;
    
    if (!response) {
      throw new BadRequestError('Response is required');
    }
    
    const review = await prisma.review.findUnique({
      where: { id: req.params.reviewId },
    });
    
    if (!review || review.businessId !== req.business.id) {
      throw new ForbiddenError('You can only respond to reviews of your business');
    }
    
    const updatedReview = await prisma.review.update({
      where: { id: req.params.reviewId },
      data: {
        sellerResponse: response,
        respondedAt: new Date(),
      },
    });
    
    success(res, { review: updatedReview }, 'Response added');
  })
);

// Helper function to update average rating
async function updateAverageRating(businessId, productId) {
  // Update business rating
  const businessStats = await prisma.review.aggregate({
    where: { businessId, isApproved: true },
    _avg: { rating: true },
    _count: true,
  });
  
  await prisma.business.update({
    where: { id: businessId },
    data: {
      averageRating: businessStats._avg.rating || 0,
      totalReviews: businessStats._count,
    },
  });
  
  // Update product rating if applicable
  if (productId) {
    const productStats = await prisma.review.aggregate({
      where: { productId, isApproved: true },
      _avg: { rating: true },
      _count: true,
    });
    
    await prisma.product.update({
      where: { id: productId },
      data: {
        averageRating: productStats._avg.rating || 0,
        reviewCount: productStats._count,
      },
    });
  }
}

module.exports = router;
