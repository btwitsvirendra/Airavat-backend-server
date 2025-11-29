// =============================================================================
// AIRAVAT B2B MARKETPLACE - ANALYTICS SERVICE
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');

class AnalyticsService {
  /**
   * Track event
   */
  async trackEvent(eventType, data) {
    try {
      await prisma.analyticsEvent.create({
        data: {
          eventType,
          userId: data.userId,
          businessId: data.businessId,
          sessionId: data.sessionId,
          properties: data.properties || {},
          metadata: {
            ip: data.ip,
            userAgent: data.userAgent,
            referrer: data.referrer,
          },
        },
      });
    } catch (error) {
      logger.error('Failed to track event', { error: error.message, eventType });
    }
  }
  
  /**
   * Track page view
   */
  async trackPageView(data) {
    await this.trackEvent('page_view', {
      ...data,
      properties: {
        page: data.page,
        path: data.path,
        title: data.title,
      },
    });
  }
  
  /**
   * Track product view
   */
  async trackProductView(productId, userId, sessionId) {
    await this.trackEvent('product_view', {
      userId,
      sessionId,
      properties: { productId },
    });
    
    // Increment view count
    await prisma.product.update({
      where: { id: productId },
      data: { viewCount: { increment: 1 } },
    });
  }
  
  /**
   * Track search
   */
  async trackSearch(query, results, userId) {
    await this.trackEvent('search', {
      userId,
      properties: {
        query,
        resultCount: results,
      },
    });
  }
  
  /**
   * Track add to cart
   */
  async trackAddToCart(productId, variantId, quantity, userId) {
    await this.trackEvent('add_to_cart', {
      userId,
      properties: { productId, variantId, quantity },
    });
  }
  
  /**
   * Track order
   */
  async trackOrder(order) {
    await this.trackEvent('order_placed', {
      userId: order.buyer.ownerId,
      businessId: order.buyerId,
      properties: {
        orderId: order.id,
        orderNumber: order.orderNumber,
        totalAmount: parseFloat(order.totalAmount),
        itemCount: order.items.length,
        sellerId: order.sellerId,
      },
    });
  }
  
  // =============================================================================
  // DASHBOARD ANALYTICS
  // =============================================================================
  
  /**
   * Get business dashboard analytics
   */
  async getBusinessDashboard(businessId, period = 'last30days') {
    const dateRange = this.getDateRange(period);
    
    const [
      orderStats,
      revenueStats,
      productStats,
      topProducts,
      recentOrders,
      viewsToday,
    ] = await Promise.all([
      this.getOrderStats(businessId, dateRange),
      this.getRevenueStats(businessId, dateRange),
      this.getProductStats(businessId),
      this.getTopProducts(businessId, dateRange),
      this.getRecentOrders(businessId, 5),
      this.getViewsCount(businessId, 'today'),
    ]);
    
    return {
      orders: orderStats,
      revenue: revenueStats,
      products: productStats,
      topProducts,
      recentOrders,
      viewsToday,
    };
  }
  
  /**
   * Get order statistics
   */
  async getOrderStats(businessId, dateRange) {
    const where = {
      sellerId: businessId,
      createdAt: { gte: dateRange.start, lte: dateRange.end },
    };
    
    const [total, pending, confirmed, shipped, delivered, cancelled] = await Promise.all([
      prisma.order.count({ where }),
      prisma.order.count({ where: { ...where, status: { in: ['PENDING_PAYMENT', 'PAID'] } } }),
      prisma.order.count({ where: { ...where, status: 'CONFIRMED' } }),
      prisma.order.count({ where: { ...where, status: 'SHIPPED' } }),
      prisma.order.count({ where: { ...where, status: 'DELIVERED' } }),
      prisma.order.count({ where: { ...where, status: 'CANCELLED' } }),
    ]);
    
    // Get previous period for comparison
    const prevRange = this.getPreviousDateRange(dateRange);
    const prevTotal = await prisma.order.count({
      where: {
        sellerId: businessId,
        createdAt: { gte: prevRange.start, lte: prevRange.end },
      },
    });
    
    const growth = prevTotal > 0 ? ((total - prevTotal) / prevTotal) * 100 : 0;
    
    return {
      total,
      pending,
      confirmed,
      shipped,
      delivered,
      cancelled,
      growth: Math.round(growth * 100) / 100,
    };
  }
  
  /**
   * Get revenue statistics
   */
  async getRevenueStats(businessId, dateRange) {
    const where = {
      sellerId: businessId,
      status: { in: ['PAID', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'COMPLETED'] },
      createdAt: { gte: dateRange.start, lte: dateRange.end },
    };
    
    const result = await prisma.order.aggregate({
      where,
      _sum: {
        totalAmount: true,
        platformFee: true,
      },
      _avg: {
        totalAmount: true,
      },
    });
    
    // Get previous period
    const prevRange = this.getPreviousDateRange(dateRange);
    const prevResult = await prisma.order.aggregate({
      where: {
        ...where,
        createdAt: { gte: prevRange.start, lte: prevRange.end },
      },
      _sum: { totalAmount: true },
    });
    
    const totalRevenue = parseFloat(result._sum.totalAmount || 0);
    const prevRevenue = parseFloat(prevResult._sum.totalAmount || 0);
    const growth = prevRevenue > 0 ? ((totalRevenue - prevRevenue) / prevRevenue) * 100 : 0;
    
    // Get daily breakdown
    const dailyRevenue = await this.getDailyRevenue(businessId, dateRange);
    
    return {
      total: totalRevenue,
      platformFee: parseFloat(result._sum.platformFee || 0),
      netRevenue: totalRevenue - parseFloat(result._sum.platformFee || 0),
      averageOrderValue: parseFloat(result._avg.totalAmount || 0),
      growth: Math.round(growth * 100) / 100,
      daily: dailyRevenue,
    };
  }
  
  /**
   * Get daily revenue breakdown
   */
  async getDailyRevenue(businessId, dateRange) {
    // This is simplified - in production use raw SQL for proper date grouping
    const orders = await prisma.order.findMany({
      where: {
        sellerId: businessId,
        status: { in: ['PAID', 'CONFIRMED', 'SHIPPED', 'DELIVERED', 'COMPLETED'] },
        createdAt: { gte: dateRange.start, lte: dateRange.end },
      },
      select: {
        createdAt: true,
        totalAmount: true,
      },
      orderBy: { createdAt: 'asc' },
    });
    
    // Group by date
    const daily = {};
    orders.forEach((order) => {
      const date = order.createdAt.toISOString().split('T')[0];
      daily[date] = (daily[date] || 0) + parseFloat(order.totalAmount);
    });
    
    return Object.entries(daily).map(([date, amount]) => ({ date, amount }));
  }
  
  /**
   * Get product statistics
   */
  async getProductStats(businessId) {
    const [total, active, outOfStock, lowStock] = await Promise.all([
      prisma.product.count({ where: { businessId } }),
      prisma.product.count({ where: { businessId, status: 'ACTIVE' } }),
      prisma.productVariant.count({
        where: {
          product: { businessId },
          trackInventory: true,
          stockQuantity: 0,
        },
      }),
      prisma.productVariant.count({
        where: {
          product: { businessId },
          trackInventory: true,
          stockQuantity: { gt: 0, lte: 10 }, // Assuming 10 is low stock
        },
      }),
    ]);
    
    return { total, active, outOfStock, lowStock };
  }
  
  /**
   * Get top performing products
   */
  async getTopProducts(businessId, dateRange, limit = 5) {
    const topProducts = await prisma.orderItem.groupBy({
      by: ['productId'],
      where: {
        order: {
          sellerId: businessId,
          createdAt: { gte: dateRange.start, lte: dateRange.end },
          status: { notIn: ['CANCELLED', 'REFUNDED'] },
        },
      },
      _sum: {
        quantity: true,
        totalPrice: true,
      },
      orderBy: {
        _sum: { totalPrice: 'desc' },
      },
      take: limit,
    });
    
    // Get product details
    const productIds = topProducts.map((p) => p.productId);
    const products = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: { id: true, name: true, images: true },
    });
    
    return topProducts.map((item) => {
      const product = products.find((p) => p.id === item.productId);
      return {
        productId: item.productId,
        name: product?.name,
        image: product?.images?.[0],
        unitsSold: item._sum.quantity,
        revenue: parseFloat(item._sum.totalPrice),
      };
    });
  }
  
  /**
   * Get recent orders
   */
  async getRecentOrders(businessId, limit = 5) {
    return prisma.order.findMany({
      where: { sellerId: businessId },
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        buyer: {
          select: { businessName: true },
        },
      },
    });
  }
  
  /**
   * Get views count
   */
  async getViewsCount(businessId, period = 'today') {
    const dateRange = this.getDateRange(period);
    
    const productViews = await prisma.analyticsEvent.count({
      where: {
        eventType: 'product_view',
        createdAt: { gte: dateRange.start, lte: dateRange.end },
        properties: {
          path: ['productId'],
          equals: businessId, // This would need to be adjusted
        },
      },
    });
    
    const businessViews = await prisma.analyticsEvent.count({
      where: {
        eventType: 'business_view',
        businessId,
        createdAt: { gte: dateRange.start, lte: dateRange.end },
      },
    });
    
    return { productViews, businessViews };
  }
  
  // =============================================================================
  // CUSTOMER ANALYTICS
  // =============================================================================
  
  /**
   * Get customer analytics
   */
  async getCustomerAnalytics(businessId, dateRange) {
    // Total customers who have ordered
    const totalCustomers = await prisma.order.groupBy({
      by: ['buyerId'],
      where: {
        sellerId: businessId,
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
    });
    
    // New customers in period
    const newCustomers = await prisma.order.groupBy({
      by: ['buyerId'],
      where: {
        sellerId: businessId,
        createdAt: { gte: dateRange.start, lte: dateRange.end },
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
    });
    
    // Repeat customers
    const repeatCustomers = await prisma.$queryRaw`
      SELECT "buyerId", COUNT(*) as order_count
      FROM "Order"
      WHERE "sellerId" = ${businessId}
      AND status NOT IN ('CANCELLED', 'REFUNDED')
      GROUP BY "buyerId"
      HAVING COUNT(*) > 1
    `;
    
    return {
      total: totalCustomers.length,
      new: newCustomers.length,
      repeat: repeatCustomers.length,
      repeatRate: totalCustomers.length > 0 
        ? (repeatCustomers.length / totalCustomers.length) * 100 
        : 0,
    };
  }
  
  /**
   * Get top customers
   */
  async getTopCustomers(businessId, limit = 10) {
    const topCustomers = await prisma.order.groupBy({
      by: ['buyerId'],
      where: {
        sellerId: businessId,
        status: { notIn: ['CANCELLED', 'REFUNDED'] },
      },
      _sum: { totalAmount: true },
      _count: true,
      orderBy: { _sum: { totalAmount: 'desc' } },
      take: limit,
    });
    
    const buyerIds = topCustomers.map((c) => c.buyerId);
    const buyers = await prisma.business.findMany({
      where: { id: { in: buyerIds } },
      select: { id: true, businessName: true, city: true },
    });
    
    return topCustomers.map((item) => {
      const buyer = buyers.find((b) => b.id === item.buyerId);
      return {
        businessId: item.buyerId,
        businessName: buyer?.businessName,
        city: buyer?.city,
        orderCount: item._count,
        totalSpent: parseFloat(item._sum.totalAmount),
      };
    });
  }
  
  // =============================================================================
  // HELPER METHODS
  // =============================================================================
  
  /**
   * Get date range from period string
   */
  getDateRange(period) {
    const now = new Date();
    let start;
    
    switch (period) {
      case 'today':
        start = new Date(now.setHours(0, 0, 0, 0));
        break;
      case 'yesterday':
        start = new Date(now.setDate(now.getDate() - 1));
        start.setHours(0, 0, 0, 0);
        break;
      case 'last7days':
        start = new Date(now.setDate(now.getDate() - 7));
        break;
      case 'last30days':
        start = new Date(now.setDate(now.getDate() - 30));
        break;
      case 'last90days':
        start = new Date(now.setDate(now.getDate() - 90));
        break;
      case 'thisMonth':
        start = new Date(now.getFullYear(), now.getMonth(), 1);
        break;
      case 'lastMonth':
        start = new Date(now.getFullYear(), now.getMonth() - 1, 1);
        break;
      case 'thisYear':
        start = new Date(now.getFullYear(), 0, 1);
        break;
      default:
        start = new Date(now.setDate(now.getDate() - 30));
    }
    
    return { start, end: new Date() };
  }
  
  /**
   * Get previous date range for comparison
   */
  getPreviousDateRange(currentRange) {
    const duration = currentRange.end - currentRange.start;
    return {
      start: new Date(currentRange.start.getTime() - duration),
      end: new Date(currentRange.start.getTime() - 1),
    };
  }
}

module.exports = new AnalyticsService();
