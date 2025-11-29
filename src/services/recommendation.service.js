// =============================================================================
// AIRAVAT B2B MARKETPLACE - RECOMMENDATION SERVICE
// Product recommendations, personalization, and cross-selling
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const elasticsearchService = require('./elasticsearch.service');
const logger = require('../config/logger');

class RecommendationService {
  // =============================================================================
  // PRODUCT RECOMMENDATIONS
  // =============================================================================
  
  /**
   * Get personalized recommendations for a user/business
   */
  async getPersonalizedRecommendations(businessId, limit = 10) {
    const cacheKey = `recommendations:personalized:${businessId}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
    
    try {
      // Get user's order history
      const orderHistory = await prisma.order.findMany({
        where: { buyerId: businessId },
        include: {
          items: {
            include: {
              product: {
                include: { category: true },
              },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        take: 20,
      });
      
      // Extract purchased products and categories
      const purchasedProductIds = new Set();
      const categoryWeights = {};
      const brandWeights = {};
      const sellerWeights = {};
      
      orderHistory.forEach((order) => {
        order.items.forEach((item) => {
          purchasedProductIds.add(item.productId);
          
          // Weight categories by recency and quantity
          const categoryId = item.product.categoryId;
          categoryWeights[categoryId] = (categoryWeights[categoryId] || 0) + item.quantity;
          
          // Track brand preferences
          if (item.product.brand) {
            brandWeights[item.product.brand] = (brandWeights[item.product.brand] || 0) + 1;
          }
          
          // Track seller preferences
          sellerWeights[order.sellerId] = (sellerWeights[order.sellerId] || 0) + 1;
        });
      });
      
      // Get view history
      const viewHistory = await prisma.analyticsEvent.findMany({
        where: {
          businessId,
          eventType: 'product_view',
          createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) }, // Last 30 days
        },
        orderBy: { createdAt: 'desc' },
        take: 50,
      });
      
      viewHistory.forEach((event) => {
        const productId = event.properties?.productId;
        if (productId) {
          purchasedProductIds.add(productId); // Exclude viewed products too
        }
      });
      
      // Sort categories by weight
      const topCategories = Object.entries(categoryWeights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([id]) => id);
      
      const topBrands = Object.entries(brandWeights)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5)
        .map(([brand]) => brand);
      
      // Get recommended products
      const recommendations = await prisma.product.findMany({
        where: {
          status: 'ACTIVE',
          id: { notIn: Array.from(purchasedProductIds) },
          OR: [
            { categoryId: { in: topCategories } },
            { brand: { in: topBrands } },
          ],
        },
        include: {
          business: {
            select: { id: true, businessName: true, verificationStatus: true },
          },
          category: {
            select: { id: true, name: true },
          },
          variants: {
            where: { isActive: true, stockQuantity: { gt: 0 } },
            take: 1,
            select: { basePrice: true },
          },
        },
        orderBy: [
          { organicScore: 'desc' },
          { averageRating: 'desc' },
        ],
        take: limit * 2, // Get extra for diversity
      });
      
      // Diversify results
      const diversified = this.diversifyRecommendations(recommendations, limit);
      
      // Cache for 1 hour
      await cache.set(cacheKey, diversified, 3600);
      
      return diversified;
    } catch (error) {
      logger.error('Failed to get personalized recommendations', { businessId, error: error.message });
      return this.getPopularProducts(limit);
    }
  }
  
  /**
   * Get "Frequently Bought Together" products
   */
  async getFrequentlyBoughtTogether(productId, limit = 5) {
    const cacheKey = `recommendations:fbt:${productId}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
    
    try {
      // Find orders containing this product
      const ordersWithProduct = await prisma.orderItem.findMany({
        where: { productId },
        select: { orderId: true },
        take: 100,
      });
      
      const orderIds = ordersWithProduct.map((o) => o.orderId);
      
      // Find other products in those orders
      const coProducts = await prisma.orderItem.groupBy({
        by: ['productId'],
        where: {
          orderId: { in: orderIds },
          productId: { not: productId },
        },
        _count: { productId: true },
        orderBy: { _count: { productId: 'desc' } },
        take: limit,
      });
      
      // Get product details
      const productIds = coProducts.map((p) => p.productId);
      const products = await prisma.product.findMany({
        where: {
          id: { in: productIds },
          status: 'ACTIVE',
        },
        include: {
          variants: {
            where: { isActive: true, stockQuantity: { gt: 0 } },
            take: 1,
            select: { basePrice: true },
          },
        },
      });
      
      // Sort by co-occurrence count
      const sorted = productIds
        .map((id) => products.find((p) => p.id === id))
        .filter(Boolean);
      
      // Cache for 6 hours
      await cache.set(cacheKey, sorted, 21600);
      
      return sorted;
    } catch (error) {
      logger.error('Failed to get FBT products', { productId, error: error.message });
      return [];
    }
  }
  
  /**
   * Get "Customers Also Viewed" products
   */
  async getCustomersAlsoViewed(productId, limit = 10) {
    const cacheKey = `recommendations:cav:${productId}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
    
    try {
      // Get users who viewed this product
      const viewers = await prisma.analyticsEvent.findMany({
        where: {
          eventType: 'product_view',
          properties: { path: ['productId'], equals: productId },
        },
        select: { sessionId: true, userId: true },
        take: 100,
      });
      
      const sessionIds = viewers.map((v) => v.sessionId).filter(Boolean);
      const userIds = viewers.map((v) => v.userId).filter(Boolean);
      
      // Find other products viewed by same users
      const otherViews = await prisma.analyticsEvent.groupBy({
        by: ['properties'],
        where: {
          eventType: 'product_view',
          OR: [
            { sessionId: { in: sessionIds } },
            { userId: { in: userIds } },
          ],
        },
        _count: true,
        orderBy: { _count: { _all: 'desc' } },
        take: limit * 2,
      });
      
      // Extract product IDs and filter out current product
      const viewedProductIds = otherViews
        .map((v) => v.properties?.productId)
        .filter((id) => id && id !== productId);
      
      const products = await prisma.product.findMany({
        where: {
          id: { in: viewedProductIds.slice(0, limit) },
          status: 'ACTIVE',
        },
        include: {
          variants: {
            where: { isActive: true },
            take: 1,
            select: { basePrice: true },
          },
        },
      });
      
      // Cache for 2 hours
      await cache.set(cacheKey, products, 7200);
      
      return products;
    } catch (error) {
      logger.error('Failed to get CAV products', { productId, error: error.message });
      return [];
    }
  }
  
  /**
   * Get similar products using Elasticsearch
   */
  async getSimilarProducts(productId, limit = 10) {
    try {
      return await elasticsearchService.getSimilarProducts(productId, limit);
    } catch (error) {
      // Fallback to database-based similarity
      return this.getSimilarProductsFromDB(productId, limit);
    }
  }
  
  /**
   * Database-based similar products (fallback)
   */
  async getSimilarProductsFromDB(productId, limit = 10) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { category: true },
    });
    
    if (!product) return [];
    
    return prisma.product.findMany({
      where: {
        id: { not: productId },
        status: 'ACTIVE',
        OR: [
          { categoryId: product.categoryId },
          { brand: product.brand },
          { tags: { hasSome: product.tags } },
        ],
      },
      include: {
        variants: {
          where: { isActive: true },
          take: 1,
        },
      },
      orderBy: { organicScore: 'desc' },
      take: limit,
    });
  }
  
  /**
   * Get popular products
   */
  async getPopularProducts(limit = 10, categoryId = null) {
    const cacheKey = `recommendations:popular:${categoryId || 'all'}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
    
    const products = await prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        ...(categoryId && { categoryId }),
      },
      include: {
        business: {
          select: { id: true, businessName: true, verificationStatus: true },
        },
        variants: {
          where: { isActive: true, stockQuantity: { gt: 0 } },
          take: 1,
        },
      },
      orderBy: [
        { orderCount: 'desc' },
        { viewCount: 'desc' },
        { averageRating: 'desc' },
      ],
      take: limit,
    });
    
    // Cache for 1 hour
    await cache.set(cacheKey, products, 3600);
    
    return products;
  }
  
  /**
   * Get trending products
   */
  async getTrendingProducts(limit = 10, period = 7) {
    const cacheKey = `recommendations:trending:${period}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
    
    const startDate = new Date(Date.now() - period * 24 * 60 * 60 * 1000);
    
    // Get products with most orders in the period
    const trending = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          createdAt: { gte: startDate },
          status: { notIn: ['CANCELLED', 'REFUNDED'] },
        },
      },
      _count: { productId: true },
      _sum: { quantity: true },
      orderBy: { _count: { productId: 'desc' } },
      take: limit,
    });
    
    const productIds = trending.map((t) => t.productId);
    
    const products = await prisma.product.findMany({
      where: {
        id: { in: productIds },
        status: 'ACTIVE',
      },
      include: {
        business: {
          select: { id: true, businessName: true },
        },
        variants: {
          where: { isActive: true },
          take: 1,
        },
      },
    });
    
    // Sort by trending order
    const sorted = productIds
      .map((id) => products.find((p) => p.id === id))
      .filter(Boolean);
    
    // Cache for 1 hour
    await cache.set(cacheKey, sorted, 3600);
    
    return sorted;
  }
  
  /**
   * Get new arrivals
   */
  async getNewArrivals(limit = 10, categoryId = null) {
    return prisma.product.findMany({
      where: {
        status: 'ACTIVE',
        ...(categoryId && { categoryId }),
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      include: {
        business: {
          select: { id: true, businessName: true, verificationStatus: true },
        },
        variants: {
          where: { isActive: true, stockQuantity: { gt: 0 } },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }
  
  // =============================================================================
  // SELLER RECOMMENDATIONS
  // =============================================================================
  
  /**
   * Get recommended sellers for a buyer
   */
  async getRecommendedSellers(buyerId, limit = 10) {
    const cacheKey = `recommendations:sellers:${buyerId}`;
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
    
    // Get buyer's purchase categories
    const orders = await prisma.order.findMany({
      where: { buyerId },
      include: {
        items: {
          include: {
            product: { select: { categoryId: true } },
          },
        },
      },
      take: 20,
    });
    
    const categoryIds = new Set();
    orders.forEach((order) => {
      order.items.forEach((item) => {
        categoryIds.add(item.product.categoryId);
      });
    });
    
    // Find sellers in those categories that buyer hasn't ordered from
    const orderedSellerIds = orders.map((o) => o.sellerId);
    
    const sellers = await prisma.business.findMany({
      where: {
        verificationStatus: 'VERIFIED',
        id: { notIn: orderedSellerIds },
        categories: {
          some: {
            categoryId: { in: Array.from(categoryIds) },
          },
        },
      },
      orderBy: [
        { trustScore: 'desc' },
        { averageRating: 'desc' },
        { totalReviews: 'desc' },
      ],
      take: limit,
    });
    
    // Cache for 2 hours
    await cache.set(cacheKey, sellers, 7200);
    
    return sellers;
  }
  
  // =============================================================================
  // CATEGORY RECOMMENDATIONS
  // =============================================================================
  
  /**
   * Get recommended categories for a user
   */
  async getRecommendedCategories(businessId, limit = 6) {
    // Get user's browsing and purchase history
    const [orderCategories, viewCategories] = await Promise.all([
      prisma.orderItem.findMany({
        where: { order: { buyerId: businessId } },
        include: { product: { select: { categoryId: true } } },
        take: 50,
      }),
      prisma.analyticsEvent.findMany({
        where: { businessId, eventType: 'category_view' },
        select: { properties: true },
        take: 50,
      }),
    ]);
    
    const categoryWeights = {};
    
    orderCategories.forEach((item) => {
      const catId = item.product.categoryId;
      categoryWeights[catId] = (categoryWeights[catId] || 0) + 3; // Higher weight for purchases
    });
    
    viewCategories.forEach((event) => {
      const catId = event.properties?.categoryId;
      if (catId) {
        categoryWeights[catId] = (categoryWeights[catId] || 0) + 1;
      }
    });
    
    // Get top categories
    const topCategoryIds = Object.entries(categoryWeights)
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);
    
    // Get category details with related categories
    const categories = await prisma.category.findMany({
      where: {
        OR: [
          { id: { in: topCategoryIds } },
          { parentId: { in: topCategoryIds } },
        ],
        isActive: true,
      },
      orderBy: { productCount: 'desc' },
      take: limit,
    });
    
    return categories;
  }
  
  // =============================================================================
  // HELPER METHODS
  // =============================================================================
  
  /**
   * Diversify recommendations to avoid showing too many similar products
   */
  diversifyRecommendations(products, limit) {
    const diversified = [];
    const seenCategories = {};
    const seenBrands = {};
    
    for (const product of products) {
      if (diversified.length >= limit) break;
      
      const categoryCount = seenCategories[product.categoryId] || 0;
      const brandCount = seenBrands[product.brand] || 0;
      
      // Limit products from same category/brand
      if (categoryCount >= 3 || brandCount >= 2) {
        continue;
      }
      
      diversified.push(product);
      seenCategories[product.categoryId] = categoryCount + 1;
      if (product.brand) {
        seenBrands[product.brand] = brandCount + 1;
      }
    }
    
    return diversified;
  }
  
  /**
   * Calculate recommendation score
   */
  calculateRecommendationScore(product, userPreferences) {
    let score = 0;
    
    // Category match
    if (userPreferences.categories?.includes(product.categoryId)) {
      score += 30;
    }
    
    // Brand match
    if (userPreferences.brands?.includes(product.brand)) {
      score += 20;
    }
    
    // Price range match
    const price = parseFloat(product.minPrice);
    if (price >= userPreferences.minPrice && price <= userPreferences.maxPrice) {
      score += 15;
    }
    
    // Rating bonus
    score += (product.averageRating || 0) * 5;
    
    // Verified seller bonus
    if (product.business?.verificationStatus === 'VERIFIED') {
      score += 10;
    }
    
    // Organic score contribution
    score += (product.organicScore || 0) * 0.2;
    
    return score;
  }
}

module.exports = new RecommendationService();
