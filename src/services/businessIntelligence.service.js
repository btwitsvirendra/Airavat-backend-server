// =============================================================================
// AIRAVAT B2B MARKETPLACE - BUSINESS INTELLIGENCE SERVICE
// Advanced analytics, cohort analysis, forecasting, and reporting
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');
const Decimal = require('decimal.js');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Report types
 */
const REPORT_TYPES = {
  SALES: 'Sales Report',
  REVENUE: 'Revenue Report',
  PRODUCTS: 'Product Performance',
  CUSTOMERS: 'Customer Analysis',
  ORDERS: 'Order Analytics',
  INVENTORY: 'Inventory Report',
  FINANCIAL: 'Financial Summary',
  COHORT: 'Cohort Analysis',
  FORECAST: 'Sales Forecast',
};

/**
 * Time periods
 */
const TIME_PERIODS = {
  TODAY: 'today',
  YESTERDAY: 'yesterday',
  LAST_7_DAYS: 'last7days',
  LAST_30_DAYS: 'last30days',
  THIS_MONTH: 'thisMonth',
  LAST_MONTH: 'lastMonth',
  THIS_QUARTER: 'thisQuarter',
  THIS_YEAR: 'thisYear',
  CUSTOM: 'custom',
};

// =============================================================================
// DASHBOARD ANALYTICS
// =============================================================================

/**
 * Get executive dashboard data
 * @param {string} businessId - Business ID (null for platform-wide)
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Dashboard data
 */
exports.getExecutiveDashboard = async (businessId = null, options = {}) => {
  try {
    const { period = 'LAST_30_DAYS', compareWithPrevious = true } = options;
    const { startDate, endDate, previousStart, previousEnd } = getDateRange(period);

    const where = businessId ? { sellerId: businessId } : {};
    const whereWithDate = { ...where, createdAt: { gte: startDate, lte: endDate } };
    const wherePrevious = { ...where, createdAt: { gte: previousStart, lte: previousEnd } };

    // Current period metrics
    const [
      currentOrders,
      currentRevenue,
      currentCustomers,
      currentProducts,
      previousOrders,
      previousRevenue,
    ] = await Promise.all([
      // Current orders
      prisma.order.aggregate({
        where: whereWithDate,
        _count: true,
        _sum: { total: true },
      }),

      // Current revenue
      prisma.order.aggregate({
        where: { ...whereWithDate, status: { in: ['DELIVERED', 'COMPLETED'] } },
        _sum: { total: true },
      }),

      // Current unique customers
      prisma.order.groupBy({
        by: ['buyerId'],
        where: whereWithDate,
        _count: true,
      }),

      // Products sold
      prisma.orderItem.aggregate({
        where: { order: whereWithDate },
        _sum: { quantity: true },
        _count: true,
      }),

      // Previous period orders
      compareWithPrevious ? prisma.order.aggregate({
        where: wherePrevious,
        _count: true,
        _sum: { total: true },
      }) : null,

      // Previous period revenue
      compareWithPrevious ? prisma.order.aggregate({
        where: { ...wherePrevious, status: { in: ['DELIVERED', 'COMPLETED'] } },
        _sum: { total: true },
      }) : null,
    ]);

    const metrics = {
      orders: {
        total: currentOrders._count || 0,
        value: currentOrders._sum.total || 0,
        change: compareWithPrevious 
          ? calculateChange(currentOrders._count, previousOrders?._count)
          : null,
      },
      revenue: {
        total: currentRevenue._sum.total || 0,
        change: compareWithPrevious
          ? calculateChange(currentRevenue._sum.total, previousRevenue?._sum.total)
          : null,
      },
      customers: {
        total: currentCustomers.length,
        avgOrderValue: currentCustomers.length > 0
          ? (currentOrders._sum.total || 0) / currentCustomers.length
          : 0,
      },
      products: {
        unitsSold: currentProducts._sum.quantity || 0,
        uniqueProducts: currentProducts._count || 0,
      },
    };

    // Top products
    const topProducts = await getTopProducts(whereWithDate, 5);

    // Top customers
    const topCustomers = await getTopCustomers(whereWithDate, 5);

    // Daily trend
    const dailyTrend = await getDailyTrend(where, startDate, endDate);

    return {
      period: { startDate, endDate },
      metrics,
      topProducts,
      topCustomers,
      dailyTrend,
    };
  } catch (error) {
    logger.error('Get executive dashboard error', { error: error.message });
    throw error;
  }
};

/**
 * Get real-time metrics
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Real-time data
 */
exports.getRealTimeMetrics = async (businessId = null) => {
  const now = new Date();
  const todayStart = new Date(now.setHours(0, 0, 0, 0));
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);

  const where = businessId ? { sellerId: businessId } : {};

  const [todayOrders, lastHourOrders, activeUsers, pendingOrders] = await Promise.all([
    prisma.order.aggregate({
      where: { ...where, createdAt: { gte: todayStart } },
      _count: true,
      _sum: { total: true },
    }),
    prisma.order.count({
      where: { ...where, createdAt: { gte: hourAgo } },
    }),
    prisma.user.count({
      where: { lastActiveAt: { gte: hourAgo } },
    }),
    prisma.order.count({
      where: { ...where, status: 'PENDING' },
    }),
  ]);

  return {
    today: {
      orders: todayOrders._count || 0,
      revenue: todayOrders._sum.total || 0,
    },
    lastHour: {
      orders: lastHourOrders,
    },
    activeUsers,
    pendingOrders,
    timestamp: new Date().toISOString(),
  };
};

// =============================================================================
// COHORT ANALYSIS
// =============================================================================

/**
 * Perform cohort analysis
 * @param {string} businessId - Business ID
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} Cohort data
 */
exports.getCohortAnalysis = async (businessId = null, options = {}) => {
  try {
    const { cohortType = 'monthly', metric = 'retention', months = 6 } = options;

    const startDate = new Date();
    startDate.setMonth(startDate.getMonth() - months);

    // Get users by registration month (cohorts)
    const users = await prisma.user.findMany({
      where: {
        createdAt: { gte: startDate },
        ...(businessId && { orders: { some: { sellerId: businessId } } }),
      },
      select: {
        id: true,
        createdAt: true,
        orders: {
          where: businessId ? { sellerId: businessId } : undefined,
          select: {
            id: true,
            createdAt: true,
            total: true,
          },
        },
      },
    });

    // Build cohort matrix
    const cohorts = {};
    
    users.forEach((user) => {
      const cohortKey = formatCohortKey(user.createdAt, cohortType);
      
      if (!cohorts[cohortKey]) {
        cohorts[cohortKey] = {
          cohort: cohortKey,
          size: 0,
          periods: {},
        };
      }
      
      cohorts[cohortKey].size++;

      // Track activity in subsequent periods
      user.orders.forEach((order) => {
        const orderPeriod = formatCohortKey(order.createdAt, cohortType);
        const periodDiff = getPeriodDiff(cohortKey, orderPeriod, cohortType);
        
        if (periodDiff >= 0) {
          if (!cohorts[cohortKey].periods[periodDiff]) {
            cohorts[cohortKey].periods[periodDiff] = {
              activeUsers: new Set(),
              revenue: 0,
              orders: 0,
            };
          }
          
          cohorts[cohortKey].periods[periodDiff].activeUsers.add(user.id);
          cohorts[cohortKey].periods[periodDiff].revenue += parseFloat(order.total);
          cohorts[cohortKey].periods[periodDiff].orders++;
        }
      });
    });

    // Format output
    const cohortData = Object.values(cohorts).map((cohort) => ({
      cohort: cohort.cohort,
      size: cohort.size,
      periods: Object.entries(cohort.periods).map(([period, data]) => ({
        period: parseInt(period),
        activeUsers: data.activeUsers.size,
        retentionRate: ((data.activeUsers.size / cohort.size) * 100).toFixed(2),
        revenue: data.revenue.toFixed(2),
        orders: data.orders,
        avgOrderValue: data.orders > 0 ? (data.revenue / data.orders).toFixed(2) : 0,
      })),
    }));

    return {
      type: cohortType,
      metric,
      cohorts: cohortData,
      summary: {
        totalCohorts: cohortData.length,
        avgRetentionMonth1: calculateAvgRetention(cohortData, 1),
        avgRetentionMonth3: calculateAvgRetention(cohortData, 3),
      },
    };
  } catch (error) {
    logger.error('Cohort analysis error', { error: error.message });
    throw error;
  }
};

// =============================================================================
// SALES FORECASTING
// =============================================================================

/**
 * Generate sales forecast
 * @param {string} businessId - Business ID
 * @param {Object} options - Forecast options
 * @returns {Promise<Object>} Forecast data
 */
exports.getSalesForecast = async (businessId = null, options = {}) => {
  try {
    const { forecastDays = 30, method = 'moving_average' } = options;

    // Get historical data (last 90 days)
    const historicalDays = 90;
    const startDate = new Date(Date.now() - historicalDays * 24 * 60 * 60 * 1000);

    const where = businessId ? { sellerId: businessId } : {};

    const dailySales = await prisma.$queryRaw`
      SELECT 
        DATE(created_at) as date,
        COUNT(*) as orders,
        COALESCE(SUM(total), 0) as revenue
      FROM orders
      WHERE created_at >= ${startDate}
      ${businessId ? prisma.raw(`AND seller_id = '${businessId}'`) : prisma.raw('')}
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;

    // Fill missing dates with zero
    const filledData = fillMissingDates(dailySales, startDate, new Date());

    // Calculate forecast based on method
    let forecast;
    switch (method) {
      case 'moving_average':
        forecast = calculateMovingAverageForecast(filledData, forecastDays);
        break;
      case 'exponential_smoothing':
        forecast = calculateExponentialSmoothingForecast(filledData, forecastDays);
        break;
      case 'linear_regression':
        forecast = calculateLinearRegressionForecast(filledData, forecastDays);
        break;
      default:
        forecast = calculateMovingAverageForecast(filledData, forecastDays);
    }

    // Calculate confidence intervals
    const forecastWithConfidence = addConfidenceIntervals(forecast, filledData);

    return {
      method,
      historicalData: filledData.slice(-30), // Last 30 days
      forecast: forecastWithConfidence,
      summary: {
        totalForecastedRevenue: forecastWithConfidence.reduce((sum, f) => sum + f.revenue, 0),
        avgDailyRevenue: forecastWithConfidence.reduce((sum, f) => sum + f.revenue, 0) / forecastDays,
        trend: determineTrend(filledData),
      },
    };
  } catch (error) {
    logger.error('Sales forecast error', { error: error.message });
    throw error;
  }
};

// =============================================================================
// CUSTOMER ANALYTICS
// =============================================================================

/**
 * Calculate Customer Lifetime Value (CLV)
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} CLV analysis
 */
exports.getCustomerLifetimeValue = async (businessId = null) => {
  const where = businessId ? { sellerId: businessId } : {};

  // Get customer purchase history
  const customers = await prisma.user.findMany({
    where: {
      orders: { some: where },
    },
    select: {
      id: true,
      createdAt: true,
      orders: {
        where,
        select: {
          total: true,
          createdAt: true,
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  // Calculate CLV metrics
  const clvData = customers.map((customer) => {
    const orders = customer.orders;
    const totalRevenue = orders.reduce((sum, o) => sum + parseFloat(o.total), 0);
    const orderCount = orders.length;
    const avgOrderValue = orderCount > 0 ? totalRevenue / orderCount : 0;
    
    const firstOrder = orders[0]?.createdAt;
    const lastOrder = orders[orders.length - 1]?.createdAt;
    const lifespanDays = firstOrder && lastOrder 
      ? Math.ceil((new Date(lastOrder) - new Date(firstOrder)) / (24 * 60 * 60 * 1000))
      : 0;
    
    const purchaseFrequency = lifespanDays > 0 ? orderCount / (lifespanDays / 30) : orderCount;

    return {
      customerId: customer.id,
      totalRevenue,
      orderCount,
      avgOrderValue,
      lifespanDays,
      purchaseFrequency,
      clv: totalRevenue, // Simple CLV = total revenue
    };
  });

  // Segment customers
  const clvValues = clvData.map((c) => c.clv).sort((a, b) => b - a);
  const percentile75 = clvValues[Math.floor(clvValues.length * 0.25)] || 0;
  const percentile50 = clvValues[Math.floor(clvValues.length * 0.5)] || 0;
  const percentile25 = clvValues[Math.floor(clvValues.length * 0.75)] || 0;

  const segments = {
    champions: clvData.filter((c) => c.clv >= percentile75).length,
    loyalCustomers: clvData.filter((c) => c.clv >= percentile50 && c.clv < percentile75).length,
    potentialLoyalists: clvData.filter((c) => c.clv >= percentile25 && c.clv < percentile50).length,
    atRisk: clvData.filter((c) => c.clv < percentile25).length,
  };

  return {
    summary: {
      totalCustomers: customers.length,
      avgClv: clvData.length > 0 
        ? clvData.reduce((sum, c) => sum + c.clv, 0) / clvData.length 
        : 0,
      avgOrderValue: clvData.length > 0
        ? clvData.reduce((sum, c) => sum + c.avgOrderValue, 0) / clvData.length
        : 0,
      avgPurchaseFrequency: clvData.length > 0
        ? clvData.reduce((sum, c) => sum + c.purchaseFrequency, 0) / clvData.length
        : 0,
    },
    segments,
    topCustomers: clvData.sort((a, b) => b.clv - a.clv).slice(0, 10),
    thresholds: { percentile75, percentile50, percentile25 },
  };
};

/**
 * Get customer churn analysis
 * @param {string} businessId - Business ID
 * @param {Object} options - Analysis options
 * @returns {Promise<Object>} Churn analysis
 */
exports.getChurnAnalysis = async (businessId = null, options = {}) => {
  const { inactiveDays = 90 } = options;
  const inactiveThreshold = new Date(Date.now() - inactiveDays * 24 * 60 * 60 * 1000);

  const where = businessId ? { sellerId: businessId } : {};

  // Get customers with their last order date
  const customers = await prisma.user.findMany({
    where: {
      orders: { some: where },
    },
    select: {
      id: true,
      createdAt: true,
      orders: {
        where,
        orderBy: { createdAt: 'desc' },
        take: 1,
        select: {
          createdAt: true,
          total: true,
        },
      },
    },
  });

  // Categorize customers
  const active = customers.filter((c) => 
    c.orders[0] && new Date(c.orders[0].createdAt) >= inactiveThreshold
  );
  const churned = customers.filter((c) => 
    c.orders[0] && new Date(c.orders[0].createdAt) < inactiveThreshold
  );

  // Calculate churn rate by month
  const monthlyChurn = await calculateMonthlyChurn(businessId, 6);

  return {
    summary: {
      totalCustomers: customers.length,
      activeCustomers: active.length,
      churnedCustomers: churned.length,
      churnRate: ((churned.length / customers.length) * 100).toFixed(2),
      inactiveDaysThreshold: inactiveDays,
    },
    atRiskCustomers: customers
      .filter((c) => {
        const lastOrder = c.orders[0]?.createdAt;
        if (!lastOrder) return false;
        const daysSinceOrder = (Date.now() - new Date(lastOrder)) / (24 * 60 * 60 * 1000);
        return daysSinceOrder >= inactiveDays * 0.5 && daysSinceOrder < inactiveDays;
      })
      .slice(0, 20),
    monthlyChurn,
  };
};

// =============================================================================
// REPORT GENERATION
// =============================================================================

/**
 * Generate a report
 * @param {string} reportType - Report type
 * @param {string} businessId - Business ID
 * @param {Object} options - Report options
 * @returns {Promise<Object>} Generated report
 */
exports.generateReport = async (reportType, businessId = null, options = {}) => {
  const { startDate, endDate, format = 'json' } = options;

  const reportId = generateReportId();
  
  let reportData;
  switch (reportType) {
    case 'SALES':
      reportData = await generateSalesReport(businessId, startDate, endDate);
      break;
    case 'CUSTOMERS':
      reportData = await exports.getCustomerLifetimeValue(businessId);
      break;
    case 'COHORT':
      reportData = await exports.getCohortAnalysis(businessId, options);
      break;
    case 'FORECAST':
      reportData = await exports.getSalesForecast(businessId, options);
      break;
    default:
      reportData = await exports.getExecutiveDashboard(businessId, options);
  }

  // Save report
  const report = await prisma.generatedReport.create({
    data: {
      reportId,
      type: reportType,
      businessId,
      dateRange: { startDate, endDate },
      data: reportData,
      format,
      status: 'COMPLETED',
      generatedAt: new Date(),
    },
  });

  logger.info('Report generated', { reportId, type: reportType });

  return {
    reportId: report.reportId,
    type: reportType,
    data: reportData,
    generatedAt: report.generatedAt,
  };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getDateRange(period) {
  const now = new Date();
  let startDate, endDate, previousStart, previousEnd;

  switch (period) {
    case 'TODAY':
      startDate = new Date(now.setHours(0, 0, 0, 0));
      endDate = new Date();
      previousStart = new Date(startDate);
      previousStart.setDate(previousStart.getDate() - 1);
      previousEnd = new Date(startDate);
      break;
    case 'LAST_7_DAYS':
      endDate = new Date();
      startDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      previousEnd = new Date(startDate);
      previousStart = new Date(previousEnd - 7 * 24 * 60 * 60 * 1000);
      break;
    case 'LAST_30_DAYS':
    default:
      endDate = new Date();
      startDate = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      previousEnd = new Date(startDate);
      previousStart = new Date(previousEnd - 30 * 24 * 60 * 60 * 1000);
      break;
  }

  return { startDate, endDate, previousStart, previousEnd };
}

function calculateChange(current, previous) {
  if (!previous || previous === 0) return current > 0 ? 100 : 0;
  return (((current - previous) / previous) * 100).toFixed(2);
}

async function getTopProducts(where, limit) {
  return prisma.orderItem.groupBy({
    by: ['productId'],
    where: { order: where },
    _sum: { quantity: true, totalPrice: true },
    orderBy: { _sum: { totalPrice: 'desc' } },
    take: limit,
  });
}

async function getTopCustomers(where, limit) {
  return prisma.order.groupBy({
    by: ['buyerId'],
    where,
    _sum: { total: true },
    _count: true,
    orderBy: { _sum: { total: 'desc' } },
    take: limit,
  });
}

async function getDailyTrend(where, startDate, endDate) {
  return prisma.$queryRaw`
    SELECT 
      DATE(created_at) as date,
      COUNT(*) as orders,
      COALESCE(SUM(total), 0) as revenue
    FROM orders
    WHERE created_at BETWEEN ${startDate} AND ${endDate}
    GROUP BY DATE(created_at)
    ORDER BY date ASC
  `;
}

function formatCohortKey(date, type) {
  const d = new Date(date);
  if (type === 'weekly') {
    const weekStart = new Date(d.setDate(d.getDate() - d.getDay()));
    return weekStart.toISOString().slice(0, 10);
  }
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function getPeriodDiff(cohort, period, type) {
  const [cy, cm] = cohort.split('-').map(Number);
  const [py, pm] = period.split('-').map(Number);
  return (py - cy) * 12 + (pm - cm);
}

function calculateAvgRetention(cohorts, month) {
  const relevant = cohorts
    .map((c) => c.periods.find((p) => p.period === month))
    .filter(Boolean);
  if (relevant.length === 0) return 0;
  return (
    relevant.reduce((sum, p) => sum + parseFloat(p.retentionRate), 0) / relevant.length
  ).toFixed(2);
}

function fillMissingDates(data, startDate, endDate) {
  const filled = [];
  const dateMap = new Map(data.map((d) => [d.date.toISOString().slice(0, 10), d]));
  
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateKey = d.toISOString().slice(0, 10);
    filled.push(dateMap.get(dateKey) || { date: dateKey, orders: 0, revenue: 0 });
  }
  
  return filled;
}

function calculateMovingAverageForecast(data, days, window = 7) {
  const forecast = [];
  const lastNDays = data.slice(-window);
  const avgRevenue = lastNDays.reduce((sum, d) => sum + parseFloat(d.revenue || 0), 0) / window;
  const avgOrders = lastNDays.reduce((sum, d) => sum + parseInt(d.orders || 0), 0) / window;

  for (let i = 1; i <= days; i++) {
    const date = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
    forecast.push({
      date: date.toISOString().slice(0, 10),
      revenue: Math.round(avgRevenue),
      orders: Math.round(avgOrders),
    });
  }

  return forecast;
}

function calculateExponentialSmoothingForecast(data, days, alpha = 0.3) {
  const forecast = [];
  const lastValue = parseFloat(data[data.length - 1]?.revenue || 0);
  let smoothed = lastValue;

  for (let i = 1; i <= days; i++) {
    const date = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
    forecast.push({
      date: date.toISOString().slice(0, 10),
      revenue: Math.round(smoothed),
      orders: Math.round(smoothed / 1000), // Rough estimate
    });
    smoothed = alpha * lastValue + (1 - alpha) * smoothed;
  }

  return forecast;
}

function calculateLinearRegressionForecast(data, days) {
  const n = data.length;
  let sumX = 0, sumY = 0, sumXY = 0, sumX2 = 0;

  data.forEach((d, i) => {
    const revenue = parseFloat(d.revenue || 0);
    sumX += i;
    sumY += revenue;
    sumXY += i * revenue;
    sumX2 += i * i;
  });

  const slope = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX * sumX);
  const intercept = (sumY - slope * sumX) / n;

  const forecast = [];
  for (let i = 1; i <= days; i++) {
    const date = new Date(Date.now() + i * 24 * 60 * 60 * 1000);
    const predictedRevenue = Math.max(0, intercept + slope * (n + i - 1));
    forecast.push({
      date: date.toISOString().slice(0, 10),
      revenue: Math.round(predictedRevenue),
      orders: Math.round(predictedRevenue / 1000),
    });
  }

  return forecast;
}

function addConfidenceIntervals(forecast, historical) {
  const revenues = historical.map((d) => parseFloat(d.revenue || 0));
  const stdDev = calculateStdDev(revenues);

  return forecast.map((f) => ({
    ...f,
    lowerBound: Math.max(0, Math.round(f.revenue - 1.96 * stdDev)),
    upperBound: Math.round(f.revenue + 1.96 * stdDev),
    confidence: 0.95,
  }));
}

function calculateStdDev(values) {
  const n = values.length;
  const mean = values.reduce((sum, v) => sum + v, 0) / n;
  const variance = values.reduce((sum, v) => sum + Math.pow(v - mean, 2), 0) / n;
  return Math.sqrt(variance);
}

function determineTrend(data) {
  const last7 = data.slice(-7);
  const prev7 = data.slice(-14, -7);
  
  const last7Avg = last7.reduce((sum, d) => sum + parseFloat(d.revenue || 0), 0) / 7;
  const prev7Avg = prev7.reduce((sum, d) => sum + parseFloat(d.revenue || 0), 0) / 7;
  
  const change = ((last7Avg - prev7Avg) / prev7Avg) * 100;
  
  if (change > 5) return 'GROWING';
  if (change < -5) return 'DECLINING';
  return 'STABLE';
}

async function calculateMonthlyChurn(businessId, months) {
  // Simplified monthly churn calculation
  return [];
}

async function generateSalesReport(businessId, startDate, endDate) {
  const where = {
    ...(businessId && { sellerId: businessId }),
    createdAt: {
      gte: new Date(startDate || Date.now() - 30 * 24 * 60 * 60 * 1000),
      lte: new Date(endDate || Date.now()),
    },
  };

  const [orders, revenue, topProducts] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.aggregate({ where, _sum: { total: true } }),
    getTopProducts(where, 10),
  ]);

  return {
    totalOrders: orders,
    totalRevenue: revenue._sum.total || 0,
    topProducts,
  };
}

function generateReportId() {
  const date = new Date();
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `RPT${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}-${random}`;
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  REPORT_TYPES,
  TIME_PERIODS,
};



