// =============================================================================
// AIRAVAT B2B MARKETPLACE - CATEGORY ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, adminOnly } = require('../middleware/auth');
const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const { success, created } = require('../utils/response');
const { asyncHandler } = require('../middleware/errorHandler');
const { generateSlug } = require('../utils/helpers');
const { BadRequestError, NotFoundError } = require('../utils/errors');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

// Get all categories (tree structure)
router.get(
  '/',
  asyncHandler(async (req, res) => {
    // Try cache first
    const cached = await cache.get('categories:tree');
    if (cached) {
      return success(res, { categories: cached });
    }
    
    const categories = await prisma.category.findMany({
      where: { 
        isActive: true,
        parentId: null, // Top-level categories
      },
      include: {
        children: {
          where: { isActive: true },
          include: {
            children: {
              where: { isActive: true },
            },
          },
        },
      },
      orderBy: { displayOrder: 'asc' },
    });
    
    // Cache for 1 hour
    await cache.set('categories:tree', categories, 3600);
    
    success(res, { categories });
  })
);

// Get category by slug
router.get(
  '/slug/:slug',
  asyncHandler(async (req, res) => {
    const category = await prisma.category.findUnique({
      where: { slug: req.params.slug },
      include: {
        parent: true,
        children: {
          where: { isActive: true },
          orderBy: { displayOrder: 'asc' },
        },
      },
    });
    
    if (!category) {
      throw new NotFoundError('Category');
    }
    
    success(res, { category });
  })
);

// Get category by ID
router.get(
  '/:categoryId',
  asyncHandler(async (req, res) => {
    const category = await prisma.category.findUnique({
      where: { id: req.params.categoryId },
      include: {
        parent: true,
        children: {
          where: { isActive: true },
        },
      },
    });
    
    if (!category) {
      throw new NotFoundError('Category');
    }
    
    success(res, { category });
  })
);

// Get featured categories
router.get(
  '/featured/list',
  asyncHandler(async (req, res) => {
    const cached = await cache.get('categories:featured');
    if (cached) {
      return success(res, { categories: cached });
    }
    
    const categories = await prisma.category.findMany({
      where: { 
        isActive: true,
        isFeatured: true,
      },
      orderBy: { displayOrder: 'asc' },
      take: 12,
    });
    
    await cache.set('categories:featured', categories, 3600);
    
    success(res, { categories });
  })
);

// Get popular categories (by product count)
router.get(
  '/popular/list',
  asyncHandler(async (req, res) => {
    const { limit = 10 } = req.query;
    
    const categories = await prisma.category.findMany({
      where: { isActive: true },
      orderBy: { productCount: 'desc' },
      take: parseInt(limit),
    });
    
    success(res, { categories });
  })
);

// Get category breadcrumb
router.get(
  '/:categoryId/breadcrumb',
  asyncHandler(async (req, res) => {
    const breadcrumb = [];
    let currentId = req.params.categoryId;
    
    while (currentId) {
      const category = await prisma.category.findUnique({
        where: { id: currentId },
        select: { id: true, name: true, slug: true, parentId: true },
      });
      
      if (!category) break;
      
      breadcrumb.unshift(category);
      currentId = category.parentId;
    }
    
    success(res, { breadcrumb });
  })
);

// =============================================================================
// ADMIN ROUTES
// =============================================================================

// Create category
router.post(
  '/',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { name, parentId, description, icon, image, metaTitle, metaDescription, commissionRate } = req.body;
    
    if (!name) {
      throw new BadRequestError('Category name is required');
    }
    
    const category = await prisma.category.create({
      data: {
        name,
        slug: generateSlug(name),
        parentId,
        description,
        icon,
        image,
        metaTitle: metaTitle || name,
        metaDescription,
        commissionRate: commissionRate || 5,
      },
    });
    
    // Clear cache
    await cache.delPattern('categories:*');
    
    created(res, { category }, 'Category created');
  })
);

// Update category
router.patch(
  '/:categoryId',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const category = await prisma.category.update({
      where: { id: req.params.categoryId },
      data: req.body,
    });
    
    // Clear cache
    await cache.delPattern('categories:*');
    
    success(res, { category }, 'Category updated');
  })
);

// Delete category (soft - just deactivate)
router.delete(
  '/:categoryId',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    // Check if category has products
    const productCount = await prisma.product.count({
      where: { categoryId: req.params.categoryId },
    });
    
    if (productCount > 0) {
      throw new BadRequestError(`Cannot delete category with ${productCount} products`);
    }
    
    await prisma.category.update({
      where: { id: req.params.categoryId },
      data: { isActive: false },
    });
    
    // Clear cache
    await cache.delPattern('categories:*');
    
    success(res, null, 'Category deleted');
  })
);

// Reorder categories
router.post(
  '/reorder',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { orders } = req.body;
    
    if (!Array.isArray(orders)) {
      throw new BadRequestError('Orders array is required');
    }
    
    await prisma.$transaction(
      orders.map((item) =>
        prisma.category.update({
          where: { id: item.id },
          data: { displayOrder: item.order },
        })
      )
    );
    
    // Clear cache
    await cache.delPattern('categories:*');
    
    success(res, null, 'Categories reordered');
  })
);

// Get category attributes schema
router.get(
  '/:categoryId/attributes',
  asyncHandler(async (req, res) => {
    const category = await prisma.category.findUnique({
      where: { id: req.params.categoryId },
      select: { attributeSchema: true },
    });
    
    if (!category) {
      throw new NotFoundError('Category');
    }
    
    success(res, { attributes: category.attributeSchema || {} });
  })
);

// Update category attributes schema
router.put(
  '/:categoryId/attributes',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const { attributes } = req.body;
    
    const category = await prisma.category.update({
      where: { id: req.params.categoryId },
      data: { attributeSchema: attributes },
    });
    
    success(res, { attributes: category.attributeSchema }, 'Attributes updated');
  })
);

module.exports = router;
