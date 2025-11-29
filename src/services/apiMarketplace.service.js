// =============================================================================
// AIRAVAT B2B MARKETPLACE - API MARKETPLACE SERVICE
// Public API management, keys, rate limiting, and monetization
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError, BadRequestError, NotFoundError } = require('../utils/errors');
const crypto = require('crypto');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * API plans and pricing
 */
const API_PLANS = {
  FREE: {
    id: 'free',
    name: 'Free',
    description: 'For testing and development',
    monthlyPrice: 0,
    requestsPerMonth: 1000,
    requestsPerMinute: 10,
    features: {
      products: { read: true, write: false },
      orders: { read: true, write: false },
      analytics: false,
      webhooks: false,
      support: 'community',
    },
  },
  STARTER: {
    id: 'starter',
    name: 'Starter',
    description: 'For small integrations',
    monthlyPrice: 1999,
    requestsPerMonth: 50000,
    requestsPerMinute: 60,
    features: {
      products: { read: true, write: true },
      orders: { read: true, write: true },
      analytics: true,
      webhooks: true,
      support: 'email',
    },
  },
  PROFESSIONAL: {
    id: 'professional',
    name: 'Professional',
    description: 'For production applications',
    monthlyPrice: 9999,
    requestsPerMonth: 500000,
    requestsPerMinute: 300,
    features: {
      products: { read: true, write: true },
      orders: { read: true, write: true },
      analytics: true,
      webhooks: true,
      support: 'priority',
    },
  },
  ENTERPRISE: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'For high-volume applications',
    monthlyPrice: null, // Custom pricing
    requestsPerMonth: -1, // Unlimited
    requestsPerMinute: 1000,
    features: {
      products: { read: true, write: true },
      orders: { read: true, write: true },
      analytics: true,
      webhooks: true,
      support: 'dedicated',
      sla: '99.9%',
      customIntegration: true,
    },
  },
};

/**
 * API endpoints available
 */
const API_ENDPOINTS = {
  '/products': { 
    method: 'GET', 
    description: 'List products',
    rateWeight: 1,
    category: 'products',
  },
  '/products/:id': { 
    method: 'GET', 
    description: 'Get product details',
    rateWeight: 1,
    category: 'products',
  },
  '/products': { 
    method: 'POST', 
    description: 'Create product',
    rateWeight: 2,
    category: 'products',
  },
  '/orders': { 
    method: 'GET', 
    description: 'List orders',
    rateWeight: 1,
    category: 'orders',
  },
  '/orders/:id': { 
    method: 'GET', 
    description: 'Get order details',
    rateWeight: 1,
    category: 'orders',
  },
  '/orders': { 
    method: 'POST', 
    description: 'Create order',
    rateWeight: 3,
    category: 'orders',
  },
  '/analytics/sales': { 
    method: 'GET', 
    description: 'Get sales analytics',
    rateWeight: 5,
    category: 'analytics',
  },
  '/webhooks': { 
    method: 'POST', 
    description: 'Create webhook',
    rateWeight: 2,
    category: 'webhooks',
  },
};

// =============================================================================
// API KEY MANAGEMENT
// =============================================================================

/**
 * Generate an API key
 * @param {string} businessId - Business ID
 * @param {Object} options - Key options
 * @returns {Promise<Object>} API key details
 */
exports.generateApiKey = async (businessId, options = {}) => {
  try {
    const { name, planId = 'FREE', scopes = ['read'], expiresAt = null } = options;

    const plan = API_PLANS[planId.toUpperCase()];
    if (!plan) {
      throw new BadRequestError('Invalid API plan');
    }

    // Check existing keys limit
    const existingKeys = await prisma.apiKey.count({
      where: { businessId, status: 'ACTIVE' },
    });

    if (existingKeys >= 5) {
      throw new BadRequestError('Maximum 5 active API keys allowed');
    }

    // Generate key
    const keyPrefix = 'ak_live_';
    const keyValue = crypto.randomBytes(24).toString('hex');
    const fullKey = `${keyPrefix}${keyValue}`;
    const keyHash = hashApiKey(fullKey);

    const apiKey = await prisma.apiKey.create({
      data: {
        businessId,
        name: name || `API Key ${existingKeys + 1}`,
        keyPrefix,
        keyHash,
        planId: plan.id,
        scopes,
        expiresAt: expiresAt ? new Date(expiresAt) : null,
        status: 'ACTIVE',
        rateLimit: {
          requestsPerMonth: plan.requestsPerMonth,
          requestsPerMinute: plan.requestsPerMinute,
        },
      },
    });

    logger.info('API key generated', { keyId: apiKey.id, businessId });

    return {
      id: apiKey.id,
      key: fullKey, // Only returned once
      name: apiKey.name,
      plan: plan.name,
      scopes: apiKey.scopes,
      expiresAt: apiKey.expiresAt,
      createdAt: apiKey.createdAt,
      message: 'Store this key securely. It will not be shown again.',
    };
  } catch (error) {
    logger.error('Generate API key error', { error: error.message, businessId });
    throw error;
  }
};

/**
 * Validate an API key
 * @param {string} apiKey - API key
 * @returns {Promise<Object>} Validation result
 */
exports.validateApiKey = async (apiKey) => {
  if (!apiKey || !apiKey.startsWith('ak_')) {
    return { valid: false, error: 'Invalid API key format' };
  }

  const keyHash = hashApiKey(apiKey);

  const key = await prisma.apiKey.findFirst({
    where: {
      keyHash,
      status: 'ACTIVE',
    },
    include: {
      business: {
        select: {
          id: true,
          businessName: true,
          status: true,
        },
      },
    },
  });

  if (!key) {
    return { valid: false, error: 'API key not found or inactive' };
  }

  if (key.expiresAt && new Date(key.expiresAt) < new Date()) {
    return { valid: false, error: 'API key has expired' };
  }

  if (key.business?.status !== 'ACTIVE') {
    return { valid: false, error: 'Business account is not active' };
  }

  // Update last used
  await prisma.apiKey.update({
    where: { id: key.id },
    data: {
      lastUsedAt: new Date(),
      usageCount: { increment: 1 },
    },
  });

  const plan = API_PLANS[key.planId.toUpperCase()] || API_PLANS.FREE;

  return {
    valid: true,
    keyId: key.id,
    businessId: key.businessId,
    businessName: key.business?.businessName,
    plan,
    scopes: key.scopes,
    rateLimit: key.rateLimit,
  };
};

/**
 * Revoke an API key
 * @param {string} keyId - API key ID
 * @param {string} businessId - Business ID
 * @returns {Promise<void>}
 */
exports.revokeApiKey = async (keyId, businessId) => {
  const key = await prisma.apiKey.findFirst({
    where: { id: keyId, businessId },
  });

  if (!key) {
    throw new NotFoundError('API key not found');
  }

  await prisma.apiKey.update({
    where: { id: keyId },
    data: {
      status: 'REVOKED',
      revokedAt: new Date(),
    },
  });

  logger.info('API key revoked', { keyId });
};

/**
 * List API keys for a business
 * @param {string} businessId - Business ID
 * @returns {Promise<Object[]>} API keys
 */
exports.listApiKeys = async (businessId) => {
  const keys = await prisma.apiKey.findMany({
    where: { businessId },
    select: {
      id: true,
      name: true,
      keyPrefix: true,
      planId: true,
      scopes: true,
      status: true,
      lastUsedAt: true,
      usageCount: true,
      expiresAt: true,
      createdAt: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  return keys.map((key) => ({
    ...key,
    plan: API_PLANS[key.planId.toUpperCase()]?.name || 'Free',
    maskedKey: `${key.keyPrefix}...`,
  }));
};

// =============================================================================
// USAGE TRACKING
// =============================================================================

/**
 * Track API request
 * @param {string} keyId - API key ID
 * @param {Object} request - Request details
 */
exports.trackRequest = async (keyId, request) => {
  const { endpoint, method, statusCode, responseTime, ipAddress } = request;

  await prisma.apiUsage.create({
    data: {
      apiKeyId: keyId,
      endpoint,
      method,
      statusCode,
      responseTime,
      ipAddress,
      timestamp: new Date(),
    },
  });
};

/**
 * Get usage statistics
 * @param {string} businessId - Business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Usage statistics
 */
exports.getUsageStats = async (businessId, options = {}) => {
  const { keyId, startDate, endDate, groupBy = 'day' } = options;

  const dateFilter = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);

  const where = {
    apiKey: { businessId },
    ...(keyId && { apiKeyId: keyId }),
    ...(Object.keys(dateFilter).length && { timestamp: dateFilter }),
  };

  const [totalRequests, byEndpoint, byStatus, dailyUsage] = await Promise.all([
    // Total requests
    prisma.apiUsage.count({ where }),

    // By endpoint
    prisma.apiUsage.groupBy({
      by: ['endpoint'],
      where,
      _count: true,
      orderBy: { _count: { endpoint: 'desc' } },
      take: 10,
    }),

    // By status
    prisma.apiUsage.groupBy({
      by: ['statusCode'],
      where,
      _count: true,
    }),

    // Daily usage
    prisma.$queryRaw`
      SELECT 
        DATE(timestamp) as date,
        COUNT(*) as requests,
        AVG(response_time) as avg_response_time
      FROM api_usage
      WHERE api_key_id IN (
        SELECT id FROM api_keys WHERE business_id = ${businessId}
      )
      GROUP BY DATE(timestamp)
      ORDER BY date DESC
      LIMIT 30
    `,
  ]);

  // Get current month usage vs limit
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const monthlyUsage = await prisma.apiUsage.count({
    where: {
      apiKey: { businessId },
      timestamp: { gte: startOfMonth },
    },
  });

  return {
    totalRequests,
    monthlyUsage,
    byEndpoint,
    byStatus: byStatus.map((s) => ({
      status: s.statusCode,
      count: s._count,
      category: getStatusCategory(s.statusCode),
    })),
    dailyUsage,
  };
};

/**
 * Check rate limit
 * @param {string} keyId - API key ID
 * @param {Object} limits - Rate limits
 * @returns {Promise<Object>} Rate limit status
 */
exports.checkRateLimit = async (keyId, limits) => {
  const now = new Date();
  const oneMinuteAgo = new Date(now - 60 * 1000);
  const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

  const [minuteCount, monthCount] = await Promise.all([
    prisma.apiUsage.count({
      where: {
        apiKeyId: keyId,
        timestamp: { gte: oneMinuteAgo },
      },
    }),
    prisma.apiUsage.count({
      where: {
        apiKeyId: keyId,
        timestamp: { gte: startOfMonth },
      },
    }),
  ]);

  const minuteLimit = limits.requestsPerMinute || 10;
  const monthLimit = limits.requestsPerMonth || 1000;

  return {
    allowed: minuteCount < minuteLimit && (monthLimit === -1 || monthCount < monthLimit),
    minuteUsage: minuteCount,
    minuteLimit,
    monthUsage: monthCount,
    monthLimit,
    resetIn: 60 - (now.getSeconds()), // seconds until minute reset
  };
};

// =============================================================================
// API DOCUMENTATION
// =============================================================================

/**
 * Get API documentation
 * @returns {Object} API documentation
 */
exports.getApiDocumentation = () => {
  return {
    version: '1.0',
    baseUrl: 'https://api.airavat.com/v1',
    authentication: {
      type: 'Bearer Token',
      header: 'Authorization',
      format: 'Bearer ak_live_xxxxx',
    },
    rateLimiting: {
      headers: {
        'X-RateLimit-Limit': 'Requests per minute allowed',
        'X-RateLimit-Remaining': 'Requests remaining in current window',
        'X-RateLimit-Reset': 'Unix timestamp when limit resets',
      },
    },
    endpoints: Object.entries(API_ENDPOINTS).map(([path, config]) => ({
      path: `/v1${path}`,
      ...config,
    })),
    plans: Object.values(API_PLANS).map((plan) => ({
      id: plan.id,
      name: plan.name,
      description: plan.description,
      price: plan.monthlyPrice ? `₹${plan.monthlyPrice}/month` : 'Free',
      limits: {
        requestsPerMonth: plan.requestsPerMonth === -1 ? 'Unlimited' : plan.requestsPerMonth.toLocaleString(),
        requestsPerMinute: plan.requestsPerMinute,
      },
      features: plan.features,
    })),
    errors: {
      400: { code: 'BAD_REQUEST', description: 'Invalid request parameters' },
      401: { code: 'UNAUTHORIZED', description: 'Invalid or missing API key' },
      403: { code: 'FORBIDDEN', description: 'Insufficient permissions' },
      404: { code: 'NOT_FOUND', description: 'Resource not found' },
      429: { code: 'RATE_LIMITED', description: 'Rate limit exceeded' },
      500: { code: 'INTERNAL_ERROR', description: 'Internal server error' },
    },
    sdks: {
      nodejs: 'npm install airavat-sdk',
      python: 'pip install airavat',
      php: 'composer require airavat/sdk',
    },
  };
};

// =============================================================================
// PLAN MANAGEMENT
// =============================================================================

/**
 * Get available API plans
 * @returns {Object[]} API plans
 */
exports.getApiPlans = () => {
  return Object.values(API_PLANS);
};

/**
 * Upgrade API plan
 * @param {string} keyId - API key ID
 * @param {string} businessId - Business ID
 * @param {string} planId - New plan ID
 * @returns {Promise<Object>} Updated key
 */
exports.upgradePlan = async (keyId, businessId, planId) => {
  const key = await prisma.apiKey.findFirst({
    where: { id: keyId, businessId },
  });

  if (!key) {
    throw new NotFoundError('API key not found');
  }

  const plan = API_PLANS[planId.toUpperCase()];
  if (!plan) {
    throw new BadRequestError('Invalid plan');
  }

  const updated = await prisma.apiKey.update({
    where: { id: keyId },
    data: {
      planId: plan.id,
      rateLimit: {
        requestsPerMonth: plan.requestsPerMonth,
        requestsPerMinute: plan.requestsPerMinute,
      },
    },
  });

  logger.info('API plan upgraded', { keyId, planId });

  return {
    ...updated,
    plan: plan.name,
  };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function hashApiKey(key) {
  return crypto.createHash('sha256').update(key).digest('hex');
}

function getStatusCategory(statusCode) {
  if (statusCode >= 200 && statusCode < 300) return 'success';
  if (statusCode >= 400 && statusCode < 500) return 'client_error';
  if (statusCode >= 500) return 'server_error';
  return 'other';
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  API_PLANS,
  API_ENDPOINTS,
};



