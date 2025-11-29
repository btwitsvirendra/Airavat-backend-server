// =============================================================================
// AIRAVAT B2B MARKETPLACE - AI RECOMMENDATION SERVICE
// Personalized Product Recommendations & "Customers Also Bought"
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const { formatCurrency } = require('../utils/helpers');

// =============================================================================
// CONSTANTS
// =============================================================================

const CACHE_TTL = { RECOMMENDATIONS: 300, TRENDING: 600, ALSO_BOUGHT: 3600 };
const COMPLETED_STATUSES = ['COMPLETED', 'DELIVERED'];

// =============================================================================
// PERSONALIZED RECOMMENDATIONS
// =============================================================================

const getPersonalizedRecommendations = async (userId, businessId, limit = 12) => {
  const cacheKey = `reco:personal:${businessId}:${limit}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const orderHistory = await prisma.order.findMany({
    where: { buyerId: businessId, status: { in: COMPLETED_STATUSES } },
    include: { items: { include: { product: { select: { id: true, categoryId: true, businessId: true } } } } },
    take: 20, orderBy: { createdAt: 'desc' },
  });

  const purchasedCategories = new Set();
  const purchasedSellers = new Set();
  const purchasedProducts = new Set();

  orderHistory.forEach((order) => {
    order.items.forEach((item) => {
      if (item.product) {
        purchasedProducts.add(item.product.id);
        if (item.product.categoryId) purchasedCategories.add(item.product.categoryId);
        if (item.product.businessId) purchasedSellers.add(item.product.businessId);
      }
    });
  });

  let recommendations = [];
  if (purchasedCategories.size > 0 || purchasedSellers.size > 0) {
    recommendations = await prisma.product.findMany({
      where: {
        status: 'ACTIVE', id: { notIn: Array.from(purchasedProducts) },
        OR: [{ categoryId: { in: Array.from(purchasedCategories) } }, { businessId: { in: Array.from(purchasedSellers) } }],
      },
      include: { business: { select: { businessName: true, trustScore: true } }, category: { select: { name: true } }, images: { take: 1 } },
      orderBy: [{ featured: 'desc' }, { averageRating: 'desc' }, { totalReviews: 'desc' }], take: limit,
    });
  }

  if (recommendations.length < limit) {
    const trendingProducts = await getTrendingProducts(limit - recommendations.length, Array.from(purchasedProducts));
    recommendations.push(...trendingProducts);
  }

  const result = {
    recommendations: recommendations.map((p) => ({ ...p, formattedPrice: formatCurrency(p.minPrice) })),
    basedOn: { categories: purchasedCategories.size, sellers: purchasedSellers.size, purchaseHistory: orderHistory.length },
  };

  await cache.set(cacheKey, result, CACHE_TTL.RECOMMENDATIONS);
  return result;
};

const getAlsoBought = async (productId, limit = 8) => {
  const cacheKey = `reco:also:${productId}:${limit}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const ordersWithProduct = await prisma.orderItem.findMany({ where: { productId }, select: { orderId: true }, take: 100 });
  const orderIds = ordersWithProduct.map((o) => o.orderId);

  if (orderIds.length === 0) return getSimilarProducts(productId, limit);

  const otherProducts = await prisma.orderItem.groupBy({
    by: ['productId'], where: { orderId: { in: orderIds }, productId: { not: productId } },
    _count: true, orderBy: { _count: { productId: 'desc' } }, take: limit,
  });

  const productIds = otherProducts.map((p) => p.productId).filter(Boolean);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, status: 'ACTIVE' },
    include: { business: { select: { businessName: true } }, images: { take: 1 } },
  });

  const frequencyMap = new Map(otherProducts.map((p) => [p.productId, p._count]));
  products.sort((a, b) => (frequencyMap.get(b.id) || 0) - (frequencyMap.get(a.id) || 0));

  const result = products.map((p) => ({ ...p, formattedPrice: formatCurrency(p.minPrice), coFrequency: frequencyMap.get(p.id) || 0 }));
  await cache.set(cacheKey, result, CACHE_TTL.ALSO_BOUGHT);
  return result;
};

const getSimilarProducts = async (productId, limit = 8) => {
  const product = await prisma.product.findUnique({ where: { id: productId }, select: { categoryId: true, minPrice: true } });
  if (!product) return [];

  const priceRange = { min: parseFloat(product.minPrice) * 0.5, max: parseFloat(product.minPrice) * 2 };

  return prisma.product.findMany({
    where: { id: { not: productId }, status: 'ACTIVE', categoryId: product.categoryId, minPrice: { gte: priceRange.min, lte: priceRange.max } },
    include: { business: { select: { businessName: true } }, images: { take: 1 } },
    orderBy: [{ averageRating: 'desc' }, { totalReviews: 'desc' }], take: limit,
  });
};

const getFrequentlyBoughtTogether = async (productId, limit = 4) => {
  const cacheKey = `reco:bundle:${productId}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const bundledOrders = await prisma.orderItem.findMany({ where: { productId }, select: { orderId: true }, take: 200 });
  const orderIds = bundledOrders.map((o) => o.orderId);

  const coProducts = await prisma.orderItem.groupBy({
    by: ['productId'], where: { orderId: { in: orderIds }, productId: { not: productId } },
    _count: true, orderBy: { _count: { productId: 'desc' } }, take: limit,
  });

  const productIds = coProducts.map((p) => p.productId).filter(Boolean);
  const products = await prisma.product.findMany({ where: { id: { in: productIds }, status: 'ACTIVE' }, include: { images: { take: 1 } } });
  const mainProduct = await prisma.product.findUnique({ where: { id: productId }, select: { minPrice: true, name: true } });

  const bundlePrice = products.reduce((sum, p) => sum + parseFloat(p.minPrice), 0) + parseFloat(mainProduct?.minPrice || 0);
  const suggestedDiscount = Math.min(15, products.length * 3);

  const result = {
    products: products.map((p) => ({ ...p, formattedPrice: formatCurrency(p.minPrice) })),
    bundle: {
      originalTotal: bundlePrice, formattedOriginalTotal: formatCurrency(bundlePrice), suggestedDiscount,
      discountedTotal: bundlePrice * (1 - suggestedDiscount / 100),
      formattedDiscountedTotal: formatCurrency(bundlePrice * (1 - suggestedDiscount / 100)),
      savings: bundlePrice * (suggestedDiscount / 100), formattedSavings: formatCurrency(bundlePrice * (suggestedDiscount / 100)),
    },
  };

  await cache.set(cacheKey, result, CACHE_TTL.ALSO_BOUGHT);
  return result;
};

// =============================================================================
// TRENDING & POPULAR
// =============================================================================

const getTrendingProducts = async (limit = 12, excludeIds = []) => {
  const cacheKey = `reco:trending:${limit}`;
  const cached = await cache.get(cacheKey);
  if (cached && excludeIds.length === 0) return cached;

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const trending = await prisma.orderItem.groupBy({
    by: ['productId'], where: { order: { createdAt: { gte: sevenDaysAgo } }, productId: { notIn: excludeIds } },
    _count: true, _sum: { quantity: true }, orderBy: { _count: { productId: 'desc' } }, take: limit,
  });

  const productIds = trending.map((t) => t.productId).filter(Boolean);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, status: 'ACTIVE' },
    include: { business: { select: { businessName: true } }, images: { take: 1 } },
  });

  const orderCountMap = new Map(trending.map((t) => [t.productId, t._count]));
  products.sort((a, b) => (orderCountMap.get(b.id) || 0) - (orderCountMap.get(a.id) || 0));

  const result = products.map((p) => ({ ...p, formattedPrice: formatCurrency(p.minPrice), trendingScore: orderCountMap.get(p.id) || 0 }));
  if (excludeIds.length === 0) await cache.set(cacheKey, result, CACHE_TTL.TRENDING);
  return result;
};

const getBestSellers = async (categoryId = null, limit = 12) => {
  const cacheKey = `reco:bestsellers:${categoryId || 'all'}:${limit}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const where = { order: { status: { in: COMPLETED_STATUSES }, createdAt: { gte: thirtyDaysAgo } } };
  if (categoryId) where.product = { categoryId };

  const bestSellers = await prisma.orderItem.groupBy({
    by: ['productId'], where, _sum: { quantity: true, totalPrice: true }, orderBy: { _sum: { totalPrice: 'desc' } }, take: limit,
  });

  const productIds = bestSellers.map((b) => b.productId).filter(Boolean);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds }, status: 'ACTIVE' },
    include: { business: { select: { businessName: true } }, images: { take: 1 } },
  });

  const salesMap = new Map(bestSellers.map((b) => [b.productId, { units: b._sum.quantity, revenue: b._sum.totalPrice }]));
  const result = products.map((p, index) => ({ ...p, formattedPrice: formatCurrency(p.minPrice), rank: index + 1, sales: salesMap.get(p.id) }));
  await cache.set(cacheKey, result, CACHE_TTL.TRENDING);
  return result;
};

const getNewArrivals = async (categoryId = null, limit = 12) => {
  const where = { status: 'ACTIVE', createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) } };
  if (categoryId) where.categoryId = categoryId;

  const products = await prisma.product.findMany({
    where, include: { business: { select: { businessName: true } }, images: { take: 1 } },
    orderBy: { createdAt: 'desc' }, take: limit,
  });

  return products.map((p) => ({ ...p, formattedPrice: formatCurrency(p.minPrice) }));
};

// =============================================================================
// REORDER SUGGESTIONS
// =============================================================================

const getReorderSuggestions = async (businessId, limit = 10) => {
  const cacheKey = `reco:reorder:${businessId}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const orders = await prisma.order.findMany({
    where: { buyerId: businessId, status: { in: COMPLETED_STATUSES } },
    include: { items: { include: { product: { select: { id: true, name: true } } } } },
    orderBy: { createdAt: 'desc' }, take: 100,
  });

  const productPurchases = {};
  orders.forEach((order) => {
    order.items.forEach((item) => {
      if (!item.product) return;
      const productId = item.product.id;
      if (!productPurchases[productId]) productPurchases[productId] = { product: item.product, purchases: [], totalQuantity: 0 };
      productPurchases[productId].purchases.push({ date: order.createdAt, quantity: item.quantity });
      productPurchases[productId].totalQuantity += item.quantity;
    });
  });

  const suggestions = [];
  const now = Date.now();

  for (const [productId, data] of Object.entries(productPurchases)) {
    if (data.purchases.length < 2) continue;

    const sortedPurchases = data.purchases.sort((a, b) => new Date(a.date) - new Date(b.date));
    let totalInterval = 0;
    for (let i = 1; i < sortedPurchases.length; i++) {
      totalInterval += new Date(sortedPurchases[i].date) - new Date(sortedPurchases[i - 1].date);
    }

    const avgInterval = totalInterval / (sortedPurchases.length - 1);
    const lastPurchase = new Date(sortedPurchases[sortedPurchases.length - 1].date);
    const daysSinceLastPurchase = (now - lastPurchase) / (1000 * 60 * 60 * 24);
    const avgIntervalDays = avgInterval / (1000 * 60 * 60 * 24);

    if (daysSinceLastPurchase >= avgIntervalDays * 0.8) {
      const avgQuantity = Math.round(data.totalQuantity / data.purchases.length);
      suggestions.push({
        productId, product: data.product, lastPurchased: lastPurchase,
        daysSinceLastPurchase: Math.round(daysSinceLastPurchase), avgPurchaseInterval: Math.round(avgIntervalDays),
        suggestedQuantity: avgQuantity, urgency: daysSinceLastPurchase > avgIntervalDays ? 'HIGH' : 'MEDIUM',
      });
    }
  }

  suggestions.sort((a, b) => {
    if (a.urgency !== b.urgency) return a.urgency === 'HIGH' ? -1 : 1;
    return b.daysSinceLastPurchase - a.daysSinceLastPurchase;
  });

  const productIds = suggestions.slice(0, limit).map((s) => s.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } }, include: { images: { take: 1 }, business: { select: { businessName: true } } },
  });
  const productMap = new Map(products.map((p) => [p.id, p]));

  const result = suggestions.slice(0, limit).map((s) => ({
    ...s, product: productMap.get(s.productId) || s.product, formattedPrice: formatCurrency(productMap.get(s.productId)?.minPrice || 0),
  }));

  await cache.set(cacheKey, result, CACHE_TTL.RECOMMENDATIONS);
  return result;
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  getPersonalizedRecommendations, getAlsoBought, getSimilarProducts, getFrequentlyBoughtTogether,
  getTrendingProducts, getBestSellers, getNewArrivals, getReorderSuggestions,
};
