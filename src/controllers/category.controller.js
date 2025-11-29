// =============================================================================
// AIRAVAT B2B MARKETPLACE - CATEGORY CONTROLLER
// Category listing, hierarchy, and management
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const { successResponse } = require('../utils/response');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const logger = require('../config/logger');

class CategoryController {
  // =============================================================================
  // PUBLIC ENDPOINTS
  // =============================================================================

  /**
   * Get all categories (hierarchical)
   */
  async getAllCategories(req, res, next) {
    try {
      const { flat = 'false' } = req.query;

      // Try cache first
      const cacheKey = `categories:all:${flat}`;
      const cached = await cache.get(cacheKey);
      if (cached) {
        return successResponse(res, cached, 'Categories retrieved from cache');
      }

      const categories = await prisma.category.findMany({
        where: { isActive: true },
        include: {
          _count: {
            select: { products: true },
          },
        },
        orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }],
      });

      let result;
      if (flat === 'true') {
        result = categories.map((cat) => ({
          ...cat,
          productCount: cat._count.products,
          _count: undefined,
        }));
      } else {
        // Build hierarchy
        result = this.buildCategoryTree(categories);
      }

      // Cache for 1 hour
      await cache.set(cacheKey, result, 3600);

      return successResponse(res, result, 'Categories retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get category by ID or slug
   */
  async getCategory(req, res, next) {
    try {
      const { identifier } = req.params;
      const { includeProducts = 'false', productsLimit = 10 } = req.query;

      const category = await prisma.category.findFirst({
        where: {
          OR: [{ id: identifier }, { slug: identifier }],
          isActive: true,
        },
        include: {
          parent: {
            select: { id: true, name: true, slug: true },
          },
          children: {
            where: { isActive: true },
            select: {
              id: true,
              name: true,
              slug: true,
              icon: true,
              image: true,
              _count: { select: { products: true } },
            },
          },
          _count: {
            select: { products: true },
          },
          ...(includeProducts === 'true' && {
            products: {
              where: { status: 'ACTIVE' },
              take: parseInt(productsLimit),
              orderBy: { organicScore: 'desc' },
              include: {
                business: {
                  select: { id: true, businessName: true, verificationStatus: true },
                },
                variants: {
                  where: { isActive: true },
                  take: 1,
                  select: { basePrice: true },
                },
              },
            },
          }),
        },
      });

      if (!category) {
        throw new NotFoundError('Category not found');
      }

      // Get breadcrumb path
      const breadcrumb = await this.getCategoryBreadcrumb(category.id);

      return successResponse(res, {
        ...category,
        productCount: category._count.products,
        breadcrumb,
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get top/featured categories
   */
  async getFeaturedCategories(req, res, next) {
    try {
      const { limit = 8 } = req.query;

      const cached = await cache.get('categories:featured');
      if (cached) {
        return successResponse(res, cached);
      }

      const categories = await prisma.category.findMany({
        where: {
          isActive: true,
          isFeatured: true,
          parentId: null, // Top-level only
        },
        include: {
          _count: { select: { products: true } },
        },
        orderBy: { displayOrder: 'asc' },
        take: parseInt(limit),
      });

      const result = categories.map((cat) => ({
        id: cat.id,
        name: cat.name,
        slug: cat.slug,
        icon: cat.icon,
        image: cat.image,
        productCount: cat._count.products,
      }));

      await cache.set('categories:featured', result, 3600);

      return successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get category products with filters
   */
  async getCategoryProducts(req, res, next) {
    try {
      const { identifier } = req.params;
      const {
        page = 1,
        limit = 20,
        sort = 'relevance',
        minPrice,
        maxPrice,
        brand,
        rating,
        verified,
        inStock,
      } = req.query;

      const skip = (page - 1) * limit;

      // Find category
      const category = await prisma.category.findFirst({
        where: {
          OR: [{ id: identifier }, { slug: identifier }],
          isActive: true,
        },
        include: {
          children: { select: { id: true } },
        },
      });

      if (!category) {
        throw new NotFoundError('Category not found');
      }

      // Include products from subcategories
      const categoryIds = [category.id, ...category.children.map((c) => c.id)];

      // Build filters
      const where = {
        categoryId: { in: categoryIds },
        status: 'ACTIVE',
      };

      if (minPrice) {
        where.minPrice = { gte: parseFloat(minPrice) };
      }
      if (maxPrice) {
        where.maxPrice = { lte: parseFloat(maxPrice) };
      }
      if (brand) {
        where.brand = { in: brand.split(',') };
      }
      if (rating) {
        where.averageRating = { gte: parseFloat(rating) };
      }
      if (verified === 'true') {
        where.business = { verificationStatus: 'VERIFIED' };
      }
      if (inStock === 'true') {
        where.variants = { some: { stockQuantity: { gt: 0 } } };
      }

      // Determine sort order
      let orderBy;
      switch (sort) {
        case 'price_low':
          orderBy = { minPrice: 'asc' };
          break;
        case 'price_high':
          orderBy = { minPrice: 'desc' };
          break;
        case 'newest':
          orderBy = { createdAt: 'desc' };
          break;
        case 'rating':
          orderBy = [{ averageRating: 'desc' }, { reviewCount: 'desc' }];
          break;
        case 'popular':
          orderBy = [{ orderCount: 'desc' }, { viewCount: 'desc' }];
          break;
        default:
          orderBy = [{ organicScore: 'desc' }, { averageRating: 'desc' }];
      }

      const [products, total] = await Promise.all([
        prisma.product.findMany({
          where,
          include: {
            business: {
              select: {
                id: true,
                businessName: true,
                slug: true,
                verificationStatus: true,
                city: true,
              },
            },
            variants: {
              where: { isActive: true },
              take: 1,
              select: {
                id: true,
                basePrice: true,
                stockQuantity: true,
              },
            },
          },
          orderBy,
          skip,
          take: parseInt(limit),
        }),
        prisma.product.count({ where }),
      ]);

      // Get filter aggregations
      const aggregations = await this.getCategoryAggregations(categoryIds);

      return successResponse(res, {
        category: {
          id: category.id,
          name: category.name,
          slug: category.slug,
        },
        products,
        filters: aggregations,
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
  // ADMIN ENDPOINTS
  // =============================================================================

  /**
   * Create category (Admin)
   */
  async createCategory(req, res, next) {
    try {
      const {
        name,
        slug,
        description,
        icon,
        image,
        parentId,
        displayOrder,
        metaTitle,
        metaDescription,
        isFeatured,
      } = req.body;

      // Check slug uniqueness
      const existing = await prisma.category.findUnique({ where: { slug } });
      if (existing) {
        throw new BadRequestError('Category slug already exists');
      }

      // If parent specified, verify it exists
      if (parentId) {
        const parent = await prisma.category.findUnique({ where: { id: parentId } });
        if (!parent) {
          throw new BadRequestError('Parent category not found');
        }
      }

      const category = await prisma.category.create({
        data: {
          name,
          slug,
          description,
          icon,
          image,
          parentId,
          displayOrder: displayOrder || 0,
          metaTitle,
          metaDescription,
          isFeatured: isFeatured || false,
          isActive: true,
        },
      });

      // Clear cache
      await this.clearCategoryCache();

      logger.info('Category created', { categoryId: category.id, name });

      return successResponse(res, category, 'Category created successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update category (Admin)
   */
  async updateCategory(req, res, next) {
    try {
      const { categoryId } = req.params;
      const updateData = req.body;

      // Check if category exists
      const existing = await prisma.category.findUnique({ where: { id: categoryId } });
      if (!existing) {
        throw new NotFoundError('Category not found');
      }

      // Check slug uniqueness if changing
      if (updateData.slug && updateData.slug !== existing.slug) {
        const slugExists = await prisma.category.findUnique({ where: { slug: updateData.slug } });
        if (slugExists) {
          throw new BadRequestError('Category slug already exists');
        }
      }

      // Prevent circular parent reference
      if (updateData.parentId === categoryId) {
        throw new BadRequestError('Category cannot be its own parent');
      }

      const category = await prisma.category.update({
        where: { id: categoryId },
        data: updateData,
      });

      // Clear cache
      await this.clearCategoryCache();

      logger.info('Category updated', { categoryId });

      return successResponse(res, category, 'Category updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete category (Admin)
   */
  async deleteCategory(req, res, next) {
    try {
      const { categoryId } = req.params;
      const { moveProductsTo } = req.body;

      const category = await prisma.category.findUnique({
        where: { id: categoryId },
        include: {
          _count: {
            select: { products: true, children: true },
          },
        },
      });

      if (!category) {
        throw new NotFoundError('Category not found');
      }

      // Check for subcategories
      if (category._count.children > 0) {
        throw new BadRequestError(
          'Cannot delete category with subcategories. Delete subcategories first.'
        );
      }

      // Handle products
      if (category._count.products > 0) {
        if (moveProductsTo) {
          await prisma.product.updateMany({
            where: { categoryId },
            data: { categoryId: moveProductsTo },
          });
        } else {
          throw new BadRequestError(
            `Category has ${category._count.products} products. Specify moveProductsTo or remove products first.`
          );
        }
      }

      await prisma.category.delete({ where: { id: categoryId } });

      // Clear cache
      await this.clearCategoryCache();

      logger.info('Category deleted', { categoryId });

      return successResponse(res, null, 'Category deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Reorder categories (Admin)
   */
  async reorderCategories(req, res, next) {
    try {
      const { categories } = req.body; // Array of { id, displayOrder }

      await prisma.$transaction(
        categories.map(({ id, displayOrder }) =>
          prisma.category.update({
            where: { id },
            data: { displayOrder },
          })
        )
      );

      // Clear cache
      await this.clearCategoryCache();

      return successResponse(res, null, 'Categories reordered successfully');
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // HELPER METHODS
  // =============================================================================

  /**
   * Build category tree from flat list
   */
  buildCategoryTree(categories) {
    const map = {};
    const roots = [];

    // First pass: create map
    categories.forEach((cat) => {
      map[cat.id] = {
        ...cat,
        productCount: cat._count?.products || 0,
        _count: undefined,
        children: [],
      };
    });

    // Second pass: build tree
    categories.forEach((cat) => {
      if (cat.parentId && map[cat.parentId]) {
        map[cat.parentId].children.push(map[cat.id]);
      } else if (!cat.parentId) {
        roots.push(map[cat.id]);
      }
    });

    return roots;
  }

  /**
   * Get category breadcrumb path
   */
  async getCategoryBreadcrumb(categoryId) {
    const breadcrumb = [];
    let currentId = categoryId;

    while (currentId) {
      const category = await prisma.category.findUnique({
        where: { id: currentId },
        select: { id: true, name: true, slug: true, parentId: true },
      });

      if (!category) break;

      breadcrumb.unshift({
        id: category.id,
        name: category.name,
        slug: category.slug,
      });

      currentId = category.parentId;
    }

    return breadcrumb;
  }

  /**
   * Get filter aggregations for category
   */
  async getCategoryAggregations(categoryIds) {
    const [brands, priceStats, ratings] = await Promise.all([
      // Brands
      prisma.product.groupBy({
        by: ['brand'],
        where: {
          categoryId: { in: categoryIds },
          status: 'ACTIVE',
          brand: { not: null },
        },
        _count: true,
        orderBy: { _count: { brand: 'desc' } },
        take: 20,
      }),
      // Price range
      prisma.product.aggregate({
        where: {
          categoryId: { in: categoryIds },
          status: 'ACTIVE',
        },
        _min: { minPrice: true },
        _max: { maxPrice: true },
      }),
      // Ratings distribution
      prisma.product.groupBy({
        by: ['averageRating'],
        where: {
          categoryId: { in: categoryIds },
          status: 'ACTIVE',
        },
        _count: true,
      }),
    ]);

    return {
      brands: brands.map((b) => ({ name: b.brand, count: b._count })).filter((b) => b.name),
      priceRange: {
        min: priceStats._min.minPrice || 0,
        max: priceStats._max.maxPrice || 0,
      },
      ratings: ratings,
    };
  }

  /**
   * Clear category cache
   */
  async clearCategoryCache() {
    const keys = await cache.keys('categories:*');
    if (keys.length > 0) {
      await Promise.all(keys.map((key) => cache.del(key)));
    }
  }
}

module.exports = new CategoryController();
