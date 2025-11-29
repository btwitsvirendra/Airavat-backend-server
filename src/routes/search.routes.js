// =============================================================================
// AIRAVAT B2B MARKETPLACE - SEARCH ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const { optionalAuth } = require('../middleware/auth');
const { searchLimiter } = require('../middleware/rateLimiter');
const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const { success, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/errorHandler');

// =============================================================================
// MAIN SEARCH
// =============================================================================

// Global search (products, businesses, categories)
router.get(
  '/',
  optionalAuth,
  searchLimiter,
  asyncHandler(async (req, res) => {
    const { q, type = 'all' } = req.query;
    const { page, limit, skip } = parsePagination(req.query);
    
    if (!q || q.length < 2) {
      return success(res, { results: [], suggestions: [] });
    }
    
    const searchTerm = q.toLowerCase().trim();
    const results = {};
    
    // Search products
    if (type === 'all' || type === 'products') {
      const products = await prisma.product.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { description: { contains: searchTerm, mode: 'insensitive' } },
            { brand: { contains: searchTerm, mode: 'insensitive' } },
            { tags: { hasSome: [searchTerm] } },
          ],
        },
        include: {
          business: {
            select: { id: true, businessName: true, slug: true, verificationStatus: true },
          },
          category: {
            select: { id: true, name: true, slug: true },
          },
        },
        skip: type === 'products' ? skip : 0,
        take: type === 'products' ? limit : 5,
        orderBy: [
          { organicScore: 'desc' },
          { averageRating: 'desc' },
        ],
      });
      
      results.products = products;
    }
    
    // Search businesses
    if (type === 'all' || type === 'businesses') {
      const businesses = await prisma.business.findMany({
        where: {
          verificationStatus: 'VERIFIED',
          OR: [
            { businessName: { contains: searchTerm, mode: 'insensitive' } },
            { description: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        select: {
          id: true,
          businessName: true,
          slug: true,
          shortDescription: true,
          logo: true,
          city: true,
          state: true,
          averageRating: true,
          totalReviews: true,
          verificationStatus: true,
        },
        skip: type === 'businesses' ? skip : 0,
        take: type === 'businesses' ? limit : 5,
        orderBy: { trustScore: 'desc' },
      });
      
      results.businesses = businesses;
    }
    
    // Search categories
    if (type === 'all' || type === 'categories') {
      const categories = await prisma.category.findMany({
        where: {
          isActive: true,
          OR: [
            { name: { contains: searchTerm, mode: 'insensitive' } },
            { description: { contains: searchTerm, mode: 'insensitive' } },
          ],
        },
        take: type === 'categories' ? limit : 5,
      });
      
      results.categories = categories;
    }
    
    // Get search suggestions
    const suggestions = await getSearchSuggestions(searchTerm);
    
    // Track search query
    await trackSearch(searchTerm, req.user?.id);
    
    success(res, { results, suggestions, query: q });
  })
);

// Search products with filters
router.get(
  '/products',
  optionalAuth,
  searchLimiter,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { 
      q, 
      category, 
      minPrice, 
      maxPrice, 
      brands, 
      rating,
      verified,
      inStock,
      sort = 'relevance',
      city,
      state,
    } = req.query;
    
    // Build where clause
    const where = {
      status: 'ACTIVE',
    };
    
    if (q) {
      where.OR = [
        { name: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
        { brand: { contains: q, mode: 'insensitive' } },
      ];
    }
    
    if (category) {
      where.category = {
        OR: [
          { slug: category },
          { parent: { slug: category } },
        ],
      };
    }
    
    if (minPrice) where.minPrice = { gte: parseFloat(minPrice) };
    if (maxPrice) where.maxPrice = { lte: parseFloat(maxPrice) };
    
    if (brands) {
      where.brand = { in: brands.split(',') };
    }
    
    if (rating) {
      where.averageRating = { gte: parseFloat(rating) };
    }
    
    if (verified === 'true') {
      where.business = { verificationStatus: 'VERIFIED' };
    }
    
    if (inStock === 'true') {
      where.variants = {
        some: {
          stockQuantity: { gt: 0 },
          isActive: true,
        },
      };
    }
    
    if (city || state) {
      where.business = {
        ...where.business,
        ...(city && { city: { contains: city, mode: 'insensitive' } }),
        ...(state && { state: { contains: state, mode: 'insensitive' } }),
      };
    }
    
    // Build order by
    let orderBy;
    switch (sort) {
      case 'price_low':
        orderBy = { minPrice: 'asc' };
        break;
      case 'price_high':
        orderBy = { minPrice: 'desc' };
        break;
      case 'rating':
        orderBy = { averageRating: 'desc' };
        break;
      case 'newest':
        orderBy = { createdAt: 'desc' };
        break;
      case 'popular':
        orderBy = { orderCount: 'desc' };
        break;
      default:
        orderBy = [{ organicScore: 'desc' }, { averageRating: 'desc' }];
    }
    
    const [products, total] = await Promise.all([
      prisma.product.findMany({
        where,
        include: {
          business: {
            select: { id: true, businessName: true, slug: true, verificationStatus: true, city: true },
          },
          category: {
            select: { id: true, name: true, slug: true },
          },
          variants: {
            where: { isActive: true },
            take: 1,
            select: { basePrice: true, stockQuantity: true },
          },
        },
        skip,
        take: limit,
        orderBy,
      }),
      prisma.product.count({ where }),
    ]);
    
    // Get aggregations for filters
    const aggregations = await getSearchAggregations(where);
    
    paginated(res, { products, aggregations }, { page, limit, total });
  })
);

// Search businesses
router.get(
  '/businesses',
  optionalAuth,
  searchLimiter,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { q, type, category, city, state, verified, rating, sort = 'relevance' } = req.query;
    
    const where = {
      verificationStatus: 'VERIFIED',
    };
    
    if (q) {
      where.OR = [
        { businessName: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }
    
    if (type) where.businessType = type;
    if (city) where.city = { contains: city, mode: 'insensitive' };
    if (state) where.state = { contains: state, mode: 'insensitive' };
    if (rating) where.averageRating = { gte: parseFloat(rating) };
    
    if (category) {
      where.categories = {
        some: {
          category: { slug: category },
        },
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
      case 'newest':
        orderBy = { createdAt: 'desc' };
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
          shortDescription: true,
          logo: true,
          businessType: true,
          city: true,
          state: true,
          averageRating: true,
          totalReviews: true,
          responseRate: true,
          responseTime: true,
          totalProducts: true,
          establishedYear: true,
        },
        skip,
        take: limit,
        orderBy,
      }),
      prisma.business.count({ where }),
    ]);
    
    paginated(res, businesses, { page, limit, total });
  })
);

// Autocomplete suggestions
router.get(
  '/autocomplete',
  searchLimiter,
  asyncHandler(async (req, res) => {
    const { q } = req.query;
    
    if (!q || q.length < 2) {
      return success(res, { suggestions: [] });
    }
    
    const suggestions = await getSearchSuggestions(q.toLowerCase().trim());
    
    success(res, { suggestions });
  })
);

// Trending searches
router.get(
  '/trending',
  asyncHandler(async (req, res) => {
    const cached = await cache.get('search:trending');
    
    if (cached) {
      return success(res, { trending: cached });
    }
    
    // In a real implementation, this would come from analytics
    const trending = [
      'Industrial machinery',
      'Packaging materials',
      'Textile raw materials',
      'Chemical supplies',
      'Electronic components',
    ];
    
    await cache.set('search:trending', trending, 3600);
    
    success(res, { trending });
  })
);

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function getSearchSuggestions(term) {
  // Get product name suggestions
  const products = await prisma.product.findMany({
    where: {
      status: 'ACTIVE',
      name: { contains: term, mode: 'insensitive' },
    },
    select: { name: true },
    take: 5,
    distinct: ['name'],
  });
  
  // Get category suggestions
  const categories = await prisma.category.findMany({
    where: {
      isActive: true,
      name: { contains: term, mode: 'insensitive' },
    },
    select: { name: true, slug: true },
    take: 3,
  });
  
  // Get brand suggestions
  const brands = await prisma.product.findMany({
    where: {
      status: 'ACTIVE',
      brand: { contains: term, mode: 'insensitive' },
    },
    select: { brand: true },
    take: 3,
    distinct: ['brand'],
  });
  
  return {
    products: products.map((p) => p.name),
    categories: categories.map((c) => ({ name: c.name, slug: c.slug })),
    brands: brands.map((b) => b.brand).filter(Boolean),
  };
}

async function getSearchAggregations(where) {
  // Get brand aggregation
  const brandCounts = await prisma.product.groupBy({
    by: ['brand'],
    where: { ...where, brand: { not: null } },
    _count: true,
    orderBy: { _count: { brand: 'desc' } },
    take: 20,
  });
  
  // Get category aggregation
  const categoryCounts = await prisma.product.groupBy({
    by: ['categoryId'],
    where,
    _count: true,
  });
  
  // Get price range
  const priceRange = await prisma.product.aggregate({
    where,
    _min: { minPrice: true },
    _max: { maxPrice: true },
  });
  
  return {
    brands: brandCounts.map((b) => ({ name: b.brand, count: b._count })),
    priceRange: {
      min: priceRange._min.minPrice || 0,
      max: priceRange._max.maxPrice || 0,
    },
  };
}

async function trackSearch(query, userId) {
  // Track search for analytics (could use a separate analytics service)
  await prisma.analyticsEvent.create({
    data: {
      eventType: 'search',
      userId,
      properties: { query },
    },
  }).catch(() => {}); // Ignore errors
}

module.exports = router;
