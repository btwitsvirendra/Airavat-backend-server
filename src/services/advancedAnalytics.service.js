// =============================================================================
// AIRAVAT B2B MARKETPLACE - ADVANCED ANALYTICS SERVICE
// Sales Forecasting, Business Insights, and Predictions
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const { NotFoundError } = require('../utils/errors');
const { formatCurrency } = require('../utils/helpers');

// =============================================================================
// CONSTANTS
// =============================================================================

const CACHE_TTL = { ANALYTICS: 300, FORECAST: 600, TOP_PRODUCTS: 300 };
const ORDER_STATUSES = { COMPLETED: ['COMPLETED', 'DELIVERED'], ACTIVE: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED'] };

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const calculateGrowth = (current, previous) => {
  if (previous === 0) return current > 0 ? '100.00' : '0.00';
  return (((current - previous) / previous) * 100).toFixed(2);
};

const calculateMovingAverage = (data, window) => {
  const result = [];
  for (let i = 0; i < data.length; i++) {
    const start = Math.max(0, i - window + 1);
    const values = data.slice(start, i + 1);
    result.push(values.reduce((a, b) => a + b, 0) / values.length);
  }
  return result;
};

const calculateTrend = (data) => {
  if (data.length < 2) return 0;
  const n = data.length;
  const sumX = (n * (n - 1)) / 2;
  const sumY = data.reduce((a, b) => a + b, 0);
  const sumXY = data.reduce((sum, y, x) => sum + x * y, 0);
  const sumX2 = (n * (n - 1) * (2 * n - 1)) / 6;
  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const avgY = sumY / n;
  return avgY !== 0 ? slope / avgY : 0;
};

// =============================================================================
// DASHBOARD ANALYTICS
// =============================================================================

const getBusinessAnalytics = async (businessId, dateRange = {}) => {
  const cacheKey = `analytics:${businessId}:${JSON.stringify(dateRange)}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const startDate = dateRange.start ? new Date(dateRange.start) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const endDate = dateRange.end ? new Date(dateRange.end) : new Date();
  const previousStart = new Date(startDate.getTime() - (endDate - startDate));

  const business = await prisma.business.findUnique({ where: { id: businessId } });
  if (!business) throw new NotFoundError('Business');

  const isSeller = ['MANUFACTURER', 'WHOLESALER', 'DISTRIBUTOR'].includes(business.businessType);

  const [current, previous, topProducts, customerInsights, categoryBreakdown] = await Promise.all([
    getPeriodMetrics(businessId, startDate, endDate, isSeller),
    getPeriodMetrics(businessId, previousStart, startDate, isSeller),
    isSeller ? getTopProducts(businessId, startDate, endDate) : getTopSuppliers(businessId, startDate, endDate),
    isSeller ? getCustomerInsights(businessId, startDate, endDate) : getPurchaseInsights(businessId, startDate, endDate),
    getCategoryBreakdown(businessId, startDate, endDate, isSeller),
  ]);

  const growth = {
    revenue: calculateGrowth(current.revenue, previous.revenue),
    orders: calculateGrowth(current.orderCount, previous.orderCount),
    avgOrderValue: calculateGrowth(current.avgOrderValue, previous.avgOrderValue),
    customers: calculateGrowth(current.uniqueCustomers, previous.uniqueCustomers),
  };

  const result = {
    summary: {
      current: { ...current, formattedRevenue: formatCurrency(current.revenue), formattedAvgOrderValue: formatCurrency(current.avgOrderValue) },
      previous: { ...previous, formattedRevenue: formatCurrency(previous.revenue) },
      growth,
    },
    topProducts, customerInsights, categoryBreakdown, period: { startDate, endDate }, isSeller,
  };

  await cache.set(cacheKey, result, CACHE_TTL.ANALYTICS);
  return result;
};

const getPeriodMetrics = async (businessId, startDate, endDate, isSeller) => {
  const whereClause = { createdAt: { gte: startDate, lte: endDate }, status: { in: ORDER_STATUSES.COMPLETED } };
  if (isSeller) whereClause.sellerId = businessId;
  else whereClause.buyerId = businessId;

  const orders = await prisma.order.findMany({ where: whereClause, select: { totalAmount: true, buyerId: true, sellerId: true } });
  const revenue = orders.reduce((sum, o) => sum + parseFloat(o.totalAmount), 0);
  const uniqueCustomers = new Set(orders.map((o) => (isSeller ? o.buyerId : o.sellerId))).size;

  return { revenue, orderCount: orders.length, avgOrderValue: orders.length > 0 ? revenue / orders.length : 0, uniqueCustomers };
};

// =============================================================================
// SALES FORECASTING
// =============================================================================

const generateSalesForecast = async (businessId, forecastDays = 30) => {
  const cacheKey = `forecast:${businessId}:${forecastDays}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const historicalDays = 90;
  const startDate = new Date(Date.now() - historicalDays * 24 * 60 * 60 * 1000);

  const orders = await prisma.order.findMany({
    where: { sellerId: businessId, status: { in: ORDER_STATUSES.COMPLETED }, createdAt: { gte: startDate } },
    select: { totalAmount: true, createdAt: true },
    orderBy: { createdAt: 'asc' },
  });

  const dailySales = {};
  orders.forEach((order) => {
    const day = order.createdAt.toISOString().split('T')[0];
    dailySales[day] = (dailySales[day] || 0) + parseFloat(order.totalAmount);
  });

  const salesArray = Object.entries(dailySales).sort((a, b) => a[0].localeCompare(b[0]));
  const salesValues = salesArray.map((s) => s[1]);
  const trend = calculateTrend(salesValues);
  const avgDaily = salesValues.length > 0 ? salesValues.reduce((a, b) => a + b, 0) / salesValues.length : 0;

  const forecast = [];
  for (let i = 1; i <= forecastDays; i++) {
    const date = new Date();
    date.setDate(date.getDate() + i);
    const dayOfWeek = date.getDay();
    const weekdayMultiplier = dayOfWeek === 0 || dayOfWeek === 6 ? 0.7 : 1.1;
    const forecastValue = avgDaily * (1 + (trend * i) / 30) * weekdayMultiplier;
    const confidence = Math.max(0.5, 0.95 - i * 0.01);

    forecast.push({
      date: date.toISOString().split('T')[0], predicted: Math.max(0, Math.round(forecastValue)),
      formattedPredicted: formatCurrency(Math.max(0, forecastValue)), confidence: parseFloat(confidence.toFixed(2)),
      lowerBound: Math.round(forecastValue * (1 - (1 - confidence))), upperBound: Math.round(forecastValue * (1 + (1 - confidence))),
    });
  }

  const totalForecast = forecast.reduce((sum, f) => sum + f.predicted, 0);

  const result = {
    forecast,
    summary: {
      totalForecast, formattedTotalForecast: formatCurrency(totalForecast), avgDailyForecast: totalForecast / forecastDays,
      trend: trend > 0.01 ? 'GROWING' : trend < -0.01 ? 'DECLINING' : 'STABLE', trendPercentage: (trend * 100).toFixed(2),
    },
    historical: { avgDaily, formattedAvgDaily: formatCurrency(avgDaily), dataPoints: salesArray.length },
    methodology: { model: 'Linear trend with weekly seasonality', historicalPeriod: `${historicalDays} days`, forecastPeriod: `${forecastDays} days` },
  };

  await cache.set(cacheKey, result, CACHE_TTL.FORECAST);
  return result;
};

// =============================================================================
// PRODUCT ANALYTICS
// =============================================================================

const getTopProducts = async (businessId, startDate, endDate, limit = 10) => {
  const orderItems = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: { order: { sellerId: businessId, createdAt: { gte: startDate, lte: endDate }, status: { in: ORDER_STATUSES.COMPLETED } } },
    _sum: { quantity: true, totalPrice: true }, _count: true, orderBy: { _sum: { totalPrice: 'desc' } }, take: limit,
  });

  const productIds = orderItems.map((i) => i.productId).filter(Boolean);
  const products = await prisma.product.findMany({ where: { id: { in: productIds } }, select: { id: true, name: true, images: true, sku: true } });
  const productMap = new Map(products.map((p) => [p.id, p]));

  return orderItems.map((item, index) => ({
    rank: index + 1, product: productMap.get(item.productId), revenue: item._sum.totalPrice || 0,
    formattedRevenue: formatCurrency(item._sum.totalPrice || 0), unitsSold: item._sum.quantity || 0, orderCount: item._count,
  }));
};

const getTopSuppliers = async (businessId, startDate, endDate, limit = 10) => {
  const orders = await prisma.order.groupBy({
    by: ['sellerId'],
    where: { buyerId: businessId, createdAt: { gte: startDate, lte: endDate }, status: { in: ORDER_STATUSES.COMPLETED } },
    _sum: { totalAmount: true }, _count: true, orderBy: { _sum: { totalAmount: 'desc' } }, take: limit,
  });

  const sellerIds = orders.map((o) => o.sellerId);
  const sellers = await prisma.business.findMany({ where: { id: { in: sellerIds } }, select: { id: true, businessName: true, logo: true, trustScore: true } });
  const sellerMap = new Map(sellers.map((s) => [s.id, s]));

  return orders.map((order, index) => ({
    rank: index + 1, supplier: sellerMap.get(order.sellerId), totalSpend: order._sum.totalAmount || 0,
    formattedTotalSpend: formatCurrency(order._sum.totalAmount || 0), orderCount: order._count,
  }));
};

// =============================================================================
// CUSTOMER INSIGHTS
// =============================================================================

const getCustomerInsights = async (businessId, startDate, endDate) => {
  const orders = await prisma.order.findMany({
    where: { sellerId: businessId, createdAt: { gte: startDate, lte: endDate }, status: { in: ORDER_STATUSES.COMPLETED } },
    select: { buyerId: true, totalAmount: true, createdAt: true },
  });

  const customerData = {};
  orders.forEach((order) => {
    if (!customerData[order.buyerId]) customerData[order.buyerId] = { orderCount: 0, totalSpend: 0, lastOrder: order.createdAt };
    customerData[order.buyerId].orderCount++;
    customerData[order.buyerId].totalSpend += parseFloat(order.totalAmount);
    if (order.createdAt > customerData[order.buyerId].lastOrder) customerData[order.buyerId].lastOrder = order.createdAt;
  });

  const segments = { new: 0, returning: 0, loyal: 0, atRisk: 0 };
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  Object.values(customerData).forEach((customer) => {
    if (customer.orderCount === 1) segments.new++;
    else if (customer.orderCount >= 5) segments.loyal++;
    else if (customer.lastOrder < thirtyDaysAgo) segments.atRisk++;
    else segments.returning++;
  });

  const totalCustomers = Object.keys(customerData).length;
  const totalSpend = Object.values(customerData).reduce((sum, c) => sum + c.totalSpend, 0);

  return {
    totalCustomers,
    avgOrdersPerCustomer: totalCustomers > 0 ? (orders.length / totalCustomers).toFixed(2) : '0',
    avgSpendPerCustomer: totalCustomers > 0 ? (totalSpend / totalCustomers).toFixed(2) : '0',
    formattedAvgSpend: formatCurrency(totalCustomers > 0 ? totalSpend / totalCustomers : 0),
    segments,
    retentionRate: totalCustomers > 0 ? (((segments.returning + segments.loyal) / totalCustomers) * 100).toFixed(1) : '0',
  };
};

const getPurchaseInsights = async (businessId, startDate, endDate) => {
  const orders = await prisma.order.findMany({
    where: { buyerId: businessId, createdAt: { gte: startDate, lte: endDate } },
    select: { totalAmount: true, status: true },
  });

  const completed = orders.filter((o) => ORDER_STATUSES.COMPLETED.includes(o.status));
  const pending = orders.filter((o) => ORDER_STATUSES.ACTIVE.includes(o.status));
  const cancelled = orders.filter((o) => o.status === 'CANCELLED');
  const totalSpend = completed.reduce((sum, o) => sum + parseFloat(o.totalAmount), 0);

  return {
    totalOrders: orders.length, completedOrders: completed.length, pendingOrders: pending.length, cancelledOrders: cancelled.length,
    totalSpend, formattedTotalSpend: formatCurrency(totalSpend),
    avgOrderValue: completed.length > 0 ? (totalSpend / completed.length).toFixed(2) : '0',
    formattedAvgOrderValue: formatCurrency(completed.length > 0 ? totalSpend / completed.length : 0),
    completionRate: orders.length > 0 ? ((completed.length / orders.length) * 100).toFixed(1) : '0',
  };
};

// =============================================================================
// CATEGORY ANALYTICS
// =============================================================================

const getCategoryBreakdown = async (businessId, startDate, endDate, isSeller) => {
  const whereClause = { createdAt: { gte: startDate, lte: endDate }, status: { in: ORDER_STATUSES.COMPLETED } };
  if (isSeller) whereClause.sellerId = businessId;
  else whereClause.buyerId = businessId;

  const orders = await prisma.order.findMany({
    where: whereClause, include: { items: { include: { product: { select: { categoryId: true } } } } },
  });

  const categoryData = {};
  orders.forEach((order) => {
    order.items.forEach((item) => {
      const categoryId = item.product?.categoryId || 'uncategorized';
      if (!categoryData[categoryId]) categoryData[categoryId] = { revenue: 0, units: 0, orders: 0 };
      categoryData[categoryId].revenue += parseFloat(item.totalPrice);
      categoryData[categoryId].units += item.quantity;
      categoryData[categoryId].orders++;
    });
  });

  const categoryIds = Object.keys(categoryData).filter((id) => id !== 'uncategorized');
  const categories = await prisma.category.findMany({ where: { id: { in: categoryIds } }, select: { id: true, name: true } });
  const categoryMap = new Map(categories.map((c) => [c.id, c.name]));
  const totalRevenue = Object.values(categoryData).reduce((sum, c) => sum + c.revenue, 0);

  return Object.entries(categoryData).map(([id, data]) => ({
    categoryId: id, categoryName: id === 'uncategorized' ? 'Uncategorized' : categoryMap.get(id) || 'Unknown',
    revenue: data.revenue, formattedRevenue: formatCurrency(data.revenue), units: data.units, orders: data.orders,
    percentage: totalRevenue > 0 ? ((data.revenue / totalRevenue) * 100).toFixed(1) : '0',
  })).sort((a, b) => b.revenue - a.revenue);
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  getBusinessAnalytics, getPeriodMetrics, generateSalesForecast, calculateMovingAverage, calculateTrend,
  getTopProducts, getTopSuppliers, getCustomerInsights, getPurchaseInsights, getCategoryBreakdown, calculateGrowth,
};
