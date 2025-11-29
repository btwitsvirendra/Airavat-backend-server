// =============================================================================
// AIRAVAT B2B MARKETPLACE - PROMOTION ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, requireBusiness, requireVerifiedBusiness, adminOnly } = require('../middleware/auth');
const { prisma } = require('../config/database');
const { success, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/errorHandler');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

// Get my promotions
router.get(
  '/my-promotions',
  authenticate,
  requireBusiness,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { status } = req.query;
    
    const where = {
      businessId: req.business.id,
      ...(status && { status }),
    };
    
    const [promotions, total] = await Promise.all([
      prisma.promotion.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.promotion.count({ where }),
    ]);
    
    paginated(res, promotions, { page, limit, total });
  })
);

// Create promotion
router.post(
  '/',
  authenticate,
  requireBusiness,
  requireVerifiedBusiness,
  asyncHandler(async (req, res) => {
    const { type, name, productIds, categoryIds, budgetType, budgetAmount, 
            bidType, bidAmount, startsAt, endsAt, creativeUrl, targetUrl } = req.body;
    
    if (!type || !name || !budgetAmount || !startsAt) {
      throw new BadRequestError('Type, name, budget, and start date are required');
    }
    
    const promotion = await prisma.promotion.create({
      data: {
        businessId: req.business.id,
        type,
        name,
        productIds: productIds || [],
        categoryIds: categoryIds || [],
        budgetType: budgetType || 'daily',
        budgetAmount,
        bidType,
        bidAmount,
        startsAt: new Date(startsAt),
        endsAt: endsAt ? new Date(endsAt) : null,
        creativeUrl,
        targetUrl,
        status: 'pending',
      },
    });
    
    created(res, { promotion }, 'Promotion created and pending approval');
  })
);

// Get promotion by ID
router.get(
  '/:promotionId',
  authenticate,
  requireBusiness,
  asyncHandler(async (req, res) => {
    const promotion = await prisma.promotion.findUnique({
      where: { id: req.params.promotionId },
    });
    
    if (!promotion || promotion.businessId !== req.business.id) {
      throw new NotFoundError('Promotion');
    }
    
    success(res, { promotion });
  })
);

// Update promotion
router.patch(
  '/:promotionId',
  authenticate,
  requireBusiness,
  asyncHandler(async (req, res) => {
    const promotion = await prisma.promotion.findUnique({
      where: { id: req.params.promotionId },
    });
    
    if (!promotion || promotion.businessId !== req.business.id) {
      throw new ForbiddenError('Access denied');
    }
    
    const updatedPromotion = await prisma.promotion.update({
      where: { id: req.params.promotionId },
      data: req.body,
    });
    
    success(res, { promotion: updatedPromotion }, 'Promotion updated');
  })
);

// Pause promotion
router.post(
  '/:promotionId/pause',
  authenticate,
  requireBusiness,
  asyncHandler(async (req, res) => {
    const promotion = await prisma.promotion.findUnique({
      where: { id: req.params.promotionId },
    });
    
    if (!promotion || promotion.businessId !== req.business.id) {
      throw new ForbiddenError('Access denied');
    }
    
    const updatedPromotion = await prisma.promotion.update({
      where: { id: req.params.promotionId },
      data: { status: 'paused' },
    });
    
    success(res, { promotion: updatedPromotion }, 'Promotion paused');
  })
);

// Resume promotion
router.post(
  '/:promotionId/resume',
  authenticate,
  requireBusiness,
  asyncHandler(async (req, res) => {
    const promotion = await prisma.promotion.findUnique({
      where: { id: req.params.promotionId },
    });
    
    if (!promotion || promotion.businessId !== req.business.id) {
      throw new ForbiddenError('Access denied');
    }
    
    const updatedPromotion = await prisma.promotion.update({
      where: { id: req.params.promotionId },
      data: { status: 'active' },
    });
    
    success(res, { promotion: updatedPromotion }, 'Promotion resumed');
  })
);

// Get promotion analytics
router.get(
  '/:promotionId/analytics',
  authenticate,
  requireBusiness,
  asyncHandler(async (req, res) => {
    const promotion = await prisma.promotion.findUnique({
      where: { id: req.params.promotionId },
    });
    
    if (!promotion || promotion.businessId !== req.business.id) {
      throw new ForbiddenError('Access denied');
    }
    
    // Calculate analytics
    const analytics = {
      impressions: promotion.impressions,
      clicks: promotion.clicks,
      conversions: promotion.conversions,
      revenue: promotion.revenue,
      ctr: promotion.impressions > 0 ? (promotion.clicks / promotion.impressions) * 100 : 0,
      cvr: promotion.clicks > 0 ? (promotion.conversions / promotion.clicks) * 100 : 0,
      spent: promotion.spentAmount,
      remaining: parseFloat(promotion.budgetAmount) - parseFloat(promotion.spentAmount),
    };
    
    success(res, { analytics });
  })
);

module.exports = router;
