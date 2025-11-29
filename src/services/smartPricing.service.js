// =============================================================================
// AIRAVAT B2B MARKETPLACE - SMART PRICING SERVICE
// AI-based dynamic pricing recommendations
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  minPriceAdjustment: 0.01, // 1%
  maxPriceAdjustment: 0.30, // 30%
  recalculationInterval: 24 * 60 * 60 * 1000, // 24 hours
  historicalDays: 90,
  confidenceThreshold: 0.7,
};

/**
 * Pricing strategies
 */
const PRICING_STRATEGIES = {
  COMPETITIVE: {
    name: 'Competitive',
    description: 'Price below market average to gain market share',
    adjustment: -0.05,
    priority: 'VOLUME',
  },
  MARKET: {
    name: 'Market',
    description: 'Match market average pricing',
    adjustment: 0,
    priority: 'BALANCED',
  },
  PREMIUM: {
    name: 'Premium',
    description: 'Price above market for quality positioning',
    adjustment: 0.10,
    priority: 'MARGIN',
  },
  DYNAMIC: {
    name: 'Dynamic',
    description: 'AI-adjusted based on demand and competition',
    adjustment: null,
    priority: 'OPTIMIZED',
  },
  COST_PLUS: {
    name: 'Cost Plus',
    description: 'Fixed markup over cost',
    adjustment: null,
    priority: 'MARGIN',
  },
};

/**
 * Factors affecting price
 */
const PRICING_FACTORS = {
  DEMAND: { weight: 0.25, description: 'Current demand level' },
  COMPETITION: { weight: 0.20, description: 'Competitor pricing' },
  SEASONALITY: { weight: 0.15, description: 'Seasonal trends' },
  INVENTORY: { weight: 0.15, description: 'Stock levels' },
  MARGIN: { weight: 0.10, description: 'Profit margin requirements' },
  HISTORY: { weight: 0.10, description: 'Historical sales performance' },
  MARKET_TRENDS: { weight: 0.05, description: 'Overall market trends' },
};

// =============================================================================
// PRICE RECOMMENDATION
// =============================================================================

/**
 * Get pricing recommendation for a product
 * @param {string} productId - Product ID
 * @param {Object} options - Options
 * @returns {Promise<Object>} Pricing recommendation
 */
exports.getRecommendation = async (productId, options = {}) => {
  try {
    const { strategy = 'DYNAMIC', targetMargin } = options;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: { where: { isDefault: true } },
        category: true,
        business: true,
      },
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    const variant = product.variants[0];
    if (!variant) {
      throw new AppError('No variant found', 400);
    }

    const currentPrice = parseFloat(variant.basePrice);
    const costPrice = parseFloat(variant.costPrice || currentPrice * 0.6);

    // Gather pricing factors
    const factors = await gatherPricingFactors(productId, product.categoryId);

    // Calculate optimal price
    const optimalPrice = calculateOptimalPrice(
      currentPrice,
      costPrice,
      factors,
      PRICING_STRATEGIES[strategy]
    );

    // Get competitor prices
    const competitorPrices = await getCompetitorPrices(productId, product.categoryId);

    // Calculate confidence
    const confidence = calculateConfidence(factors);

    // Generate explanation
    const explanation = generateExplanation(factors, currentPrice, optimalPrice);

    // Store recommendation
    await storePricingRecommendation(productId, {
      currentPrice,
      recommendedPrice: optimalPrice,
      confidence,
      factors,
      strategy,
    });

    logger.info('Pricing recommendation generated', {
      productId,
      currentPrice,
      recommendedPrice: optimalPrice,
      confidence,
    });

    return {
      productId,
      currentPrice,
      recommendedPrice: optimalPrice,
      priceChange: ((optimalPrice - currentPrice) / currentPrice * 100).toFixed(2),
      confidence,
      strategy,
      factors,
      competitorRange: {
        min: competitorPrices.min,
        max: competitorPrices.max,
        avg: competitorPrices.avg,
      },
      explanation,
      projectedImpact: await projectImpact(productId, currentPrice, optimalPrice),
    };
  } catch (error) {
    logger.error('Get recommendation error', { error: error.message, productId });
    throw error;
  }
};

/**
 * Get bulk pricing recommendations
 * @param {string} businessId - Business ID
 * @param {Object} options - Options
 * @returns {Promise<Object[]>} Recommendations for all products
 */
exports.getBulkRecommendations = async (businessId, options = {}) => {
  const { limit = 50, category = null, sortBy = 'opportunity' } = options;

  const where = { businessId, status: 'ACTIVE' };
  if (category) where.categoryId = category;

  const products = await prisma.product.findMany({
    where,
    take: limit,
    include: {
      variants: { where: { isDefault: true } },
      category: true,
    },
  });

  const recommendations = await Promise.all(
    products.map(async (product) => {
      try {
        const rec = await exports.getRecommendation(product.id, options);
        return {
          productId: product.id,
          productName: product.name,
          category: product.category?.name,
          ...rec,
          opportunity: calculateOpportunity(rec),
        };
      } catch (error) {
        return {
          productId: product.id,
          productName: product.name,
          error: error.message,
        };
      }
    })
  );

  // Sort by opportunity
  const validRecs = recommendations.filter((r) => !r.error);
  validRecs.sort((a, b) => b.opportunity - a.opportunity);

  return {
    recommendations: validRecs.slice(0, limit),
    errors: recommendations.filter((r) => r.error),
    summary: {
      totalProducts: products.length,
      analyzed: validRecs.length,
      priceIncreaseOpportunities: validRecs.filter((r) => r.priceChange > 0).length,
      priceDecreaseRecommendations: validRecs.filter((r) => r.priceChange < 0).length,
    },
  };
};

// =============================================================================
// PRICING RULES
// =============================================================================

/**
 * Create pricing rule
 * @param {string} businessId - Business ID
 * @param {Object} rule - Rule definition
 * @returns {Promise<Object>} Created rule
 */
exports.createPricingRule = async (businessId, rule) => {
  const {
    name,
    description,
    type,
    conditions,
    adjustment,
    priority = 0,
    isActive = true,
    validFrom,
    validUntil,
    applicableProducts = [],
    applicableCategories = [],
  } = rule;

  const pricingRule = await prisma.pricingRule.create({
    data: {
      businessId,
      name,
      description,
      type,
      conditions,
      adjustment,
      priority,
      isActive,
      validFrom: validFrom ? new Date(validFrom) : null,
      validUntil: validUntil ? new Date(validUntil) : null,
      applicableProducts,
      applicableCategories,
    },
  });

  logger.info('Pricing rule created', { ruleId: pricingRule.id, businessId });

  return pricingRule;
};

/**
 * Get pricing rules for business
 * @param {string} businessId - Business ID
 * @returns {Promise<Object[]>} Pricing rules
 */
exports.getPricingRules = async (businessId) => {
  return prisma.pricingRule.findMany({
    where: { businessId },
    orderBy: { priority: 'desc' },
  });
};

/**
 * Apply pricing rules to a product
 * @param {string} productId - Product ID
 * @param {number} basePrice - Base price
 * @returns {Promise<Object>} Applied price
 */
exports.applyPricingRules = async (productId, basePrice) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { businessId: true, categoryId: true },
  });

  if (!product) {
    return { price: basePrice, appliedRules: [] };
  }

  const now = new Date();
  const rules = await prisma.pricingRule.findMany({
    where: {
      businessId: product.businessId,
      isActive: true,
      OR: [
        { applicableProducts: { has: productId } },
        { applicableCategories: { has: product.categoryId } },
        { applicableProducts: { isEmpty: true }, applicableCategories: { isEmpty: true } },
      ],
      AND: [
        { OR: [{ validFrom: null }, { validFrom: { lte: now } }] },
        { OR: [{ validUntil: null }, { validUntil: { gte: now } }] },
      ],
    },
    orderBy: { priority: 'desc' },
  });

  let adjustedPrice = basePrice;
  const appliedRules = [];

  for (const rule of rules) {
    if (evaluateConditions(rule.conditions, { productId, basePrice, currentPrice: adjustedPrice })) {
      const adjustment = applyAdjustment(adjustedPrice, rule.adjustment);
      appliedRules.push({
        ruleId: rule.id,
        ruleName: rule.name,
        beforePrice: adjustedPrice,
        afterPrice: adjustment,
      });
      adjustedPrice = adjustment;
    }
  }

  return {
    originalPrice: basePrice,
    finalPrice: adjustedPrice,
    appliedRules,
    discount: basePrice - adjustedPrice,
    discountPercent: ((basePrice - adjustedPrice) / basePrice * 100).toFixed(2),
  };
};

// =============================================================================
// PRICE MONITORING
// =============================================================================

/**
 * Set up price monitoring for competitors
 * @param {string} productId - Product ID
 * @param {Object[]} competitors - Competitor products to monitor
 * @returns {Promise<Object>} Monitoring setup
 */
exports.setupPriceMonitoring = async (productId, competitors) => {
  const monitoring = await prisma.priceMonitoring.create({
    data: {
      productId,
      competitors: competitors.map((c) => ({
        url: c.url,
        name: c.name,
        platform: c.platform,
      })),
      isActive: true,
      frequency: 'DAILY',
    },
  });

  return monitoring;
};

/**
 * Get price history
 * @param {string} productId - Product ID
 * @param {number} days - Number of days
 * @returns {Promise<Object[]>} Price history
 */
exports.getPriceHistory = async (productId, days = 30) => {
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const history = await prisma.priceHistory.findMany({
    where: {
      productId,
      createdAt: { gte: startDate },
    },
    orderBy: { createdAt: 'asc' },
  });

  return history;
};

/**
 * Compare price with competitors
 * @param {string} productId - Product ID
 * @returns {Promise<Object>} Price comparison
 */
exports.comparePrices = async (productId) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      variants: { where: { isDefault: true } },
      category: true,
    },
  });

  if (!product) {
    throw new AppError('Product not found', 404);
  }

  const currentPrice = parseFloat(product.variants[0]?.basePrice || 0);
  const competitorPrices = await getCompetitorPrices(productId, product.categoryId);

  return {
    productId,
    productName: product.name,
    yourPrice: currentPrice,
    market: {
      lowest: competitorPrices.min,
      highest: competitorPrices.max,
      average: competitorPrices.avg,
    },
    position: getPricePosition(currentPrice, competitorPrices),
    recommendations: generateCompetitiveRecommendations(currentPrice, competitorPrices),
  };
};

// =============================================================================
// ANALYTICS
// =============================================================================

/**
 * Get pricing analytics
 * @param {string} businessId - Business ID
 * @param {Object} options - Options
 * @returns {Promise<Object>} Pricing analytics
 */
exports.getPricingAnalytics = async (businessId, options = {}) => {
  const { startDate, endDate, categoryId } = options;

  const where = { businessId };
  if (categoryId) where.categoryId = categoryId;

  // Get products with pricing data
  const products = await prisma.product.findMany({
    where,
    include: {
      variants: true,
      _count: { select: { orderItems: true } },
    },
  });

  // Analyze pricing distribution
  const prices = products
    .flatMap((p) => p.variants.map((v) => parseFloat(v.basePrice)))
    .filter((p) => p > 0);

  const avgPrice = prices.reduce((sum, p) => sum + p, 0) / prices.length;
  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);

  // Get recommendations applied
  const recommendations = await prisma.pricingRecommendation.findMany({
    where: {
      product: { businessId },
      createdAt: {
        gte: startDate ? new Date(startDate) : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
      },
    },
  });

  return {
    summary: {
      totalProducts: products.length,
      avgPrice,
      minPrice,
      maxPrice,
      priceRange: maxPrice - minPrice,
    },
    recommendations: {
      total: recommendations.length,
      applied: recommendations.filter((r) => r.applied).length,
      ignored: recommendations.filter((r) => !r.applied).length,
      avgConfidence: recommendations.reduce((sum, r) => sum + r.confidence, 0) / recommendations.length,
    },
    distribution: calculatePriceDistribution(prices),
  };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function gatherPricingFactors(productId, categoryId) {
  const now = new Date();
  const historyStart = new Date(now - CONFIG.historicalDays * 24 * 60 * 60 * 1000);

  // Get sales data
  const salesData = await prisma.orderItem.aggregate({
    where: {
      productId,
      createdAt: { gte: historyStart },
    },
    _sum: { quantity: true },
    _avg: { unitPrice: true },
  });

  // Get inventory level
  const variant = await prisma.productVariant.findFirst({
    where: { productId, isDefault: true },
    select: { stockQuantity: true },
  });

  // Get recent views
  const viewCount = await prisma.productView.count({
    where: {
      productId,
      createdAt: { gte: new Date(now - 7 * 24 * 60 * 60 * 1000) },
    },
  });

  // Calculate demand score
  const demandScore = calculateDemandScore(salesData._sum.quantity, viewCount);

  // Get competitor data
  const competitorData = await getCompetitorPrices(productId, categoryId);

  // Calculate seasonality
  const seasonalityFactor = calculateSeasonality(now.getMonth());

  return {
    demand: { score: demandScore, weight: PRICING_FACTORS.DEMAND.weight },
    competition: { 
      score: competitorData.avg > 0 ? 0.5 : 0.5,
      marketAvg: competitorData.avg,
      weight: PRICING_FACTORS.COMPETITION.weight,
    },
    seasonality: { score: seasonalityFactor, weight: PRICING_FACTORS.SEASONALITY.weight },
    inventory: {
      level: variant?.stockQuantity || 0,
      score: calculateInventoryScore(variant?.stockQuantity || 0),
      weight: PRICING_FACTORS.INVENTORY.weight,
    },
    history: {
      avgSalePrice: salesData._avg.unitPrice || 0,
      totalSold: salesData._sum.quantity || 0,
      weight: PRICING_FACTORS.HISTORY.weight,
    },
  };
}

function calculateOptimalPrice(currentPrice, costPrice, factors, strategy) {
  const minPrice = costPrice * 1.1; // Minimum 10% margin
  const maxPrice = currentPrice * (1 + CONFIG.maxPriceAdjustment);

  // Calculate weighted adjustment
  let totalAdjustment = 0;
  let totalWeight = 0;

  // Demand factor
  if (factors.demand.score > 0.7) {
    totalAdjustment += 0.05; // Increase price for high demand
  } else if (factors.demand.score < 0.3) {
    totalAdjustment -= 0.05; // Decrease for low demand
  }
  totalWeight += factors.demand.weight;

  // Competition factor
  if (factors.competition.marketAvg > 0) {
    const competitiveGap = (currentPrice - factors.competition.marketAvg) / factors.competition.marketAvg;
    if (competitiveGap > 0.1) {
      totalAdjustment -= 0.03; // Too expensive
    } else if (competitiveGap < -0.1) {
      totalAdjustment += 0.03; // Too cheap
    }
  }
  totalWeight += factors.competition.weight;

  // Inventory factor
  if (factors.inventory.score < 0.2) {
    totalAdjustment += 0.05; // Low stock, increase price
  } else if (factors.inventory.score > 0.8) {
    totalAdjustment -= 0.05; // Overstock, decrease price
  }
  totalWeight += factors.inventory.weight;

  // Apply strategy adjustment
  if (strategy && strategy.adjustment !== null) {
    totalAdjustment += strategy.adjustment;
  }

  // Calculate new price
  let newPrice = currentPrice * (1 + totalAdjustment);

  // Apply bounds
  newPrice = Math.max(minPrice, Math.min(maxPrice, newPrice));

  return Math.round(newPrice * 100) / 100;
}

async function getCompetitorPrices(productId, categoryId) {
  // Get similar products in the same category
  const similarProducts = await prisma.product.findMany({
    where: {
      categoryId,
      id: { not: productId },
      status: 'ACTIVE',
    },
    include: {
      variants: { where: { isDefault: true } },
    },
    take: 20,
  });

  const prices = similarProducts
    .map((p) => parseFloat(p.variants[0]?.basePrice || 0))
    .filter((p) => p > 0);

  if (prices.length === 0) {
    return { min: 0, max: 0, avg: 0 };
  }

  return {
    min: Math.min(...prices),
    max: Math.max(...prices),
    avg: prices.reduce((sum, p) => sum + p, 0) / prices.length,
  };
}

function calculateConfidence(factors) {
  // Higher confidence with more data
  let confidence = 0.5;

  if (factors.history.totalSold > 10) confidence += 0.1;
  if (factors.history.totalSold > 50) confidence += 0.1;
  if (factors.competition.marketAvg > 0) confidence += 0.1;
  if (factors.demand.score > 0) confidence += 0.1;

  return Math.min(0.95, confidence);
}

function generateExplanation(factors, currentPrice, recommendedPrice) {
  const explanations = [];
  const priceDiff = recommendedPrice - currentPrice;
  const direction = priceDiff > 0 ? 'increase' : 'decrease';

  if (factors.demand.score > 0.7) {
    explanations.push(`High demand (${Math.round(factors.demand.score * 100)}%) supports higher pricing`);
  } else if (factors.demand.score < 0.3) {
    explanations.push(`Low demand suggests competitive pricing may help`);
  }

  if (factors.inventory.score < 0.2) {
    explanations.push(`Limited stock allows for premium pricing`);
  } else if (factors.inventory.score > 0.8) {
    explanations.push(`High inventory levels suggest price adjustment to increase sales velocity`);
  }

  if (factors.competition.marketAvg > 0) {
    const position = currentPrice > factors.competition.marketAvg ? 'above' : 'below';
    explanations.push(`Current price is ${position} market average of ₹${factors.competition.marketAvg.toFixed(2)}`);
  }

  return {
    summary: `Recommended ${Math.abs(priceDiff / currentPrice * 100).toFixed(1)}% price ${direction}`,
    factors: explanations,
  };
}

async function projectImpact(productId, currentPrice, newPrice) {
  // Simple projection based on price elasticity
  const elasticity = -1.5; // Typical B2B elasticity
  const priceChange = (newPrice - currentPrice) / currentPrice;
  const volumeChange = priceChange * elasticity;

  const currentVolume = 100; // Baseline
  const projectedVolume = currentVolume * (1 + volumeChange);

  return {
    currentRevenue: currentPrice * currentVolume,
    projectedRevenue: newPrice * projectedVolume,
    revenueChange: ((newPrice * projectedVolume) - (currentPrice * currentVolume)),
    volumeImpact: `${(volumeChange * 100).toFixed(1)}%`,
  };
}

async function storePricingRecommendation(productId, data) {
  await prisma.pricingRecommendation.create({
    data: {
      productId,
      currentPrice: data.currentPrice,
      recommendedPrice: data.recommendedPrice,
      confidence: data.confidence,
      factors: data.factors,
      strategy: data.strategy,
    },
  });
}

function calculateDemandScore(salesQuantity, viewCount) {
  const salesScore = Math.min(1, (salesQuantity || 0) / 100);
  const viewScore = Math.min(1, (viewCount || 0) / 1000);
  return (salesScore * 0.6 + viewScore * 0.4);
}

function calculateInventoryScore(quantity) {
  if (quantity <= 0) return 0;
  if (quantity < 10) return 0.1;
  if (quantity < 50) return 0.3;
  if (quantity < 100) return 0.5;
  if (quantity < 500) return 0.7;
  return 0.9;
}

function calculateSeasonality(month) {
  // B2B typically has Q4 peaks
  const seasonalFactors = [0.8, 0.7, 0.9, 1.0, 0.9, 0.8, 0.7, 0.8, 1.0, 1.1, 1.2, 1.0];
  return seasonalFactors[month] || 1.0;
}

function calculateOpportunity(recommendation) {
  const priceChangeAbs = Math.abs(parseFloat(recommendation.priceChange));
  const confidence = recommendation.confidence;
  return priceChangeAbs * confidence;
}

function getPricePosition(price, competitors) {
  if (price < competitors.min) return 'LOWEST';
  if (price > competitors.max) return 'HIGHEST';
  if (price < competitors.avg) return 'BELOW_AVERAGE';
  if (price > competitors.avg) return 'ABOVE_AVERAGE';
  return 'AVERAGE';
}

function generateCompetitiveRecommendations(currentPrice, competitors) {
  const recommendations = [];

  if (currentPrice > competitors.max * 1.1) {
    recommendations.push({
      type: 'PRICE_TOO_HIGH',
      message: 'Consider reducing price to be more competitive',
      suggestedPrice: competitors.avg,
    });
  }

  if (currentPrice < competitors.min * 0.9) {
    recommendations.push({
      type: 'MARGIN_OPPORTUNITY',
      message: 'Room to increase price while remaining competitive',
      suggestedPrice: competitors.min,
    });
  }

  return recommendations;
}

function evaluateConditions(conditions, context) {
  if (!conditions || Object.keys(conditions).length === 0) return true;
  // Implement condition evaluation logic
  return true;
}

function applyAdjustment(price, adjustment) {
  if (adjustment.type === 'PERCENTAGE') {
    return price * (1 + adjustment.value / 100);
  }
  if (adjustment.type === 'FIXED') {
    return price + adjustment.value;
  }
  return price;
}

function calculatePriceDistribution(prices) {
  const ranges = [
    { range: '0-100', count: 0 },
    { range: '100-500', count: 0 },
    { range: '500-1000', count: 0 },
    { range: '1000-5000', count: 0 },
    { range: '5000+', count: 0 },
  ];

  prices.forEach((p) => {
    if (p < 100) ranges[0].count++;
    else if (p < 500) ranges[1].count++;
    else if (p < 1000) ranges[2].count++;
    else if (p < 5000) ranges[3].count++;
    else ranges[4].count++;
  });

  return ranges;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  PRICING_STRATEGIES,
  PRICING_FACTORS,
  CONFIG,
};



