// =============================================================================
// AIRAVAT B2B MARKETPLACE - SEARCH CONTROLLER
// Product and business search with Elasticsearch
// =============================================================================

const elasticsearchService = require('../services/elasticsearch.service');
const recommendationService = require('../services/recommendation.service');
const analyticsService = require('../services/analytics.service');
const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const { successResponse } = require('../utils/response');
const logger = require('../config/logger');

class SearchController {
  // =============================================================================
  // PRODUCT SEARCH
  // =============================================================================

  /**
   * Search products
   */
  async searchProducts(req, res, next) {
    try {
      const {
        q: query,
        category,
        brand,
        minPrice,
        maxPrice,
        rating,
        verified,
        inStock,
        city,
        state,
        country,
        sort = 'relevance',
        page = 1,
        limit = 20,
      } = req.query;

      // Track search analytics
      if (query && req.user?.businessId) {
        analyticsService.trackSearch(req.user.businessId, query, {
          category,
          filters: { brand, minPrice, maxPrice, rating },
        });
      }

      // Try Elasticsearch first
      try {
        const results = await elasticsearchService.searchProducts({
          query,
          category,
          brand: brand?.split(','),
          minPrice: minPrice ? parseFloat(minPrice) : undefined,
          maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
          rating: rating ? parseFloat(rating) : undefined,
          verified: verified === 'true',
          inStock: inStock === 'true',
          city,
          state,
          country,
          sort,
          page: parseInt(page),
          limit: parseInt(limit),
        });

        return successResponse(res, {
          products: results.products,
          total: results.total,
          filters: results.aggregations,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: results.total,
            pages: Math.ceil(results.total / limit),
          },
        });
      } catch (esError) {
        // Fallback to database search
        logger.warn('Elasticsearch unavailable, using database search', { error: esError.message });
        return this.databaseSearch(req, res, next);
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Database fallback search
   */
  async databaseSearch(req, res, next) {
    try {
      const {
        q: query,
        category,
        brand,
        minPrice,
        maxPrice,
        rating,
        verified,
        inStock,
        sort = 'relevance',
        page = 1,
        limit = 20,
      } = req.query;

      const skip = (page - 1) * limit;

      // Build where clause
      const where = { status: 'ACTIVE' };

      if (query) {
        where.OR = [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
          { brand: { contains: query, mode: 'insensitive' } },
          { tags: { hasSome: query.split(' ') } },
        ];
      }

      if (category) {
        where.categoryId = category;
      }

      if (brand) {
        where.brand = { in: brand.split(',') };
      }

      if (minPrice) {
        where.minPrice = { gte: parseFloat(minPrice) };
      }

      if (maxPrice) {
        where.maxPrice = { lte: parseFloat(maxPrice) };
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

      // Sort order
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
            category: {
              select: { id: true, name: true, slug: true },
            },
            variants: {
              where: { isActive: true },
              take: 1,
              select: {
                id: true,
                basePrice: true,
                salePrice: true,
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

      return successResponse(res, {
        products,
        total,
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
  // AUTOCOMPLETE & SUGGESTIONS
  // =============================================================================

  /**
   * Get autocomplete suggestions
   */
  async getAutocomplete(req, res, next) {
    try {
      const { q: query } = req.query;

      if (!query || query.length < 2) {
        return successResponse(res, { products: [], categories: [], brands: [] });
      }

      const suggestions = await elasticsearchService.getAutocompleteSuggestions(query);

      return successResponse(res, suggestions);
    } catch (error) {
      // Fallback to database
      const query = req.query.q;

      const [products, categories] = await Promise.all([
        prisma.product.findMany({
          where: {
            status: 'ACTIVE',
            name: { contains: query, mode: 'insensitive' },
          },
          select: { name: true, slug: true, images: true, minPrice: true },
          take: 5,
        }),
        prisma.category.findMany({
          where: {
            isActive: true,
            name: { contains: query, mode: 'insensitive' },
          },
          select: { name: true, slug: true },
          take: 3,
        }),
      ]);

      return successResponse(res, { products, categories, brands: [] });
    }
  }

  /**
   * Get trending searches
   */
  async getTrendingSearches(req, res, next) {
    try {
      const cached = await cache.get('trending:searches');
      if (cached) {
        return successResponse(res, cached);
      }

      // Get most frequent searches in last 7 days
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

      const trending = await prisma.analyticsEvent.groupBy({
        by: ['properties'],
        where: {
          eventType: 'search',
          createdAt: { gte: sevenDaysAgo },
        },
        _count: true,
        orderBy: { _count: { _all: 'desc' } },
        take: 10,
      });

      const searches = trending
        .map((t) => t.properties?.query)
        .filter(Boolean);

      // Cache for 1 hour
      await cache.set('trending:searches', searches, 3600);

      return successResponse(res, searches);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get popular categories
   */
  async getPopularCategories(req, res, next) {
    try {
      const { limit = 10 } = req.query;

      const cached = await cache.get('popular:categories');
      if (cached) {
        return successResponse(res, cached);
      }

      const categories = await prisma.category.findMany({
        where: { isActive: true, parentId: null },
        include: {
          _count: { select: { products: true } },
        },
        orderBy: { products: { _count: 'desc' } },
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

      await cache.set('popular:categories', result, 3600);

      return successResponse(res, result);
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // BUSINESS SEARCH
  // =============================================================================

  /**
   * Search businesses/sellers
   */
  async searchBusinesses(req, res, next) {
    try {
      const {
        q: query,
        city,
        state,
        country,
        verified,
        category,
        sort = 'relevance',
        page = 1,
        limit = 20,
      } = req.query;

      try {
        const results = await elasticsearchService.searchBusinesses({
          query,
          city,
          state,
          country,
          verified: verified === 'true',
          category,
          sort,
          page: parseInt(page),
          limit: parseInt(limit),
        });

        return successResponse(res, {
          businesses: results.businesses,
          total: results.total,
          pagination: {
            page: parseInt(page),
            limit: parseInt(limit),
            total: results.total,
            pages: Math.ceil(results.total / limit),
          },
        });
      } catch (esError) {
        // Fallback to database
        return this.databaseBusinessSearch(req, res, next);
      }
    } catch (error) {
      next(error);
    }
  }

  /**
   * Database business search fallback
   */
  async databaseBusinessSearch(req, res, next) {
    try {
      const {
        q: query,
        city,
        state,
        country,
        verified,
        category,
        sort,
        page = 1,
        limit = 20,
      } = req.query;

      const skip = (page - 1) * limit;

      const where = {};

      if (query) {
        where.OR = [
          { businessName: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ];
      }

      if (city) where.city = city;
      if (state) where.state = state;
      if (country) where.country = country;
      if (verified === 'true') where.verificationStatus = 'VERIFIED';

      if (category) {
        where.categories = {
          some: { categoryId: category },
        };
      }

      let orderBy;
      switch (sort) {
        case 'rating':
          orderBy = { averageRating: 'desc' };
          break;
        case 'reviews':
          orderBy = { totalReviews: 'desc' };
          break;
        default:
          orderBy = { trustScore: 'desc' };
      }

      const [businesses, total] = await Promise.all([
        prisma.business.findMany({
          where,
          select: {
            id: true,
            businessName: true,
            slug: true,
            description: true,
            logo: true,
            city: true,
            state: true,
            country: true,
            verificationStatus: true,
            trustScore: true,
            averageRating: true,
            totalReviews: true,
            establishedYear: true,
            _count: { select: { products: true } },
          },
          orderBy,
          skip,
          take: parseInt(limit),
        }),
        prisma.business.count({ where }),
      ]);

      return successResponse(res, {
        businesses: businesses.map((b) => ({
          ...b,
          productCount: b._count.products,
          _count: undefined,
        })),
        total,
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
  // RECOMMENDATIONS
  // =============================================================================

  /**
   * Get similar products
   */
  async getSimilarProducts(req, res, next) {
    try {
      const { productId } = req.params;
      const { limit = 10 } = req.query;

      const products = await recommendationService.getSimilarProducts(productId, parseInt(limit));

      return successResponse(res, products);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get personalized recommendations
   */
  async getRecommendations(req, res, next) {
    try {
      const businessId = req.user?.businessId;
      const { limit = 10 } = req.query;

      let products;

      if (businessId) {
        products = await recommendationService.getPersonalizedRecommendations(
          businessId,
          parseInt(limit)
        );
      } else {
        products = await recommendationService.getPopularProducts(parseInt(limit));
      }

      return successResponse(res, products);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get frequently bought together
   */
  async getFrequentlyBoughtTogether(req, res, next) {
    try {
      const { productId } = req.params;
      const { limit = 5 } = req.query;

      const products = await recommendationService.getFrequentlyBoughtTogether(
        productId,
        parseInt(limit)
      );

      return successResponse(res, products);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get trending products
   */
  async getTrendingProducts(req, res, next) {
    try {
      const { limit = 10, period = 7 } = req.query;

      const products = await recommendationService.getTrendingProducts(
        parseInt(limit),
        parseInt(period)
      );

      return successResponse(res, products);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get new arrivals
   */
  async getNewArrivals(req, res, next) {
    try {
      const { limit = 10, category } = req.query;

      const products = await recommendationService.getNewArrivals(
        parseInt(limit),
        category
      );

      return successResponse(res, products);
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // FILTERS
  // =============================================================================

  /**
   * Get available filters for search
   */
  async getSearchFilters(req, res, next) {
    try {
      const { category } = req.query;

      const where = { status: 'ACTIVE' };
      if (category) {
        where.categoryId = category;
      }

      const [brands, priceStats, cities, states] = await Promise.all([
        prisma.product.groupBy({
          by: ['brand'],
          where: { ...where, brand: { not: null } },
          _count: true,
          orderBy: { _count: { brand: 'desc' } },
          take: 30,
        }),
        prisma.product.aggregate({
          where,
          _min: { minPrice: true },
          _max: { maxPrice: true },
        }),
        prisma.product.groupBy({
          by: ['business'],
          where,
          _count: true,
        }),
        prisma.business.groupBy({
          by: ['state'],
          _count: true,
          orderBy: { _count: { state: 'desc' } },
        }),
      ]);

      return successResponse(res, {
        brands: brands.map((b) => ({ name: b.brand, count: b._count })).filter((b) => b.name),
        priceRange: {
          min: priceStats._min.minPrice || 0,
          max: priceStats._max.maxPrice || 0,
        },
        states: states.map((s) => ({ name: s.state, count: s._count })).filter((s) => s.name),
        ratings: [5, 4, 3, 2, 1],
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new SearchController();
