// =============================================================================
// AIRAVAT B2B MARKETPLACE - ADVANCED RATE LIMITER
// Tiered rate limiting with sliding window, burst handling, and bypass rules
// =============================================================================

const { RateLimiterRedis, RateLimiterMemory } = require('rate-limiter-flexible');
const { redis } = require('../config/redis');
const logger = require('../config/logger');

/**
 * Rate limit tiers based on subscription
 */
const RATE_LIMIT_TIERS = {
  anonymous: {
    points: 30,        // requests
    duration: 60,      // per minute
    blockDuration: 60, // block for 1 minute
  },
  free: {
    points: 60,
    duration: 60,
    blockDuration: 60,
  },
  basic: {
    points: 120,
    duration: 60,
    blockDuration: 30,
  },
  professional: {
    points: 300,
    duration: 60,
    blockDuration: 15,
  },
  enterprise: {
    points: 1000,
    duration: 60,
    blockDuration: 0,
  },
  admin: {
    points: 5000,
    duration: 60,
    blockDuration: 0,
  },
};

/**
 * Endpoint-specific rate limits
 */
const ENDPOINT_LIMITS = {
  // Auth endpoints (stricter)
  '/api/v1/auth/login': { points: 5, duration: 60, blockDuration: 300 },
  '/api/v1/auth/register': { points: 3, duration: 60, blockDuration: 600 },
  '/api/v1/auth/forgot-password': { points: 3, duration: 300, blockDuration: 600 },
  '/api/v1/auth/verify-otp': { points: 5, duration: 60, blockDuration: 300 },
  
  // Search endpoints (moderate)
  '/api/v1/search': { points: 30, duration: 60 },
  '/api/v1/products': { points: 60, duration: 60 },
  
  // Write operations (moderate)
  '/api/v1/orders': { points: 20, duration: 60 },
  '/api/v1/rfq': { points: 10, duration: 60 },
  
  // Upload endpoints (strict)
  '/api/v1/upload': { points: 10, duration: 60, blockDuration: 300 },
  
  // Webhooks (lenient for external services)
  '/api/v1/webhooks': { points: 100, duration: 60 },
};

/**
 * Create rate limiter instance
 */
function createRateLimiter(options) {
  const { keyPrefix, points, duration, blockDuration = 0 } = options;

  try {
    // Try Redis first
    return new RateLimiterRedis({
      storeClient: redis,
      keyPrefix: `ratelimit:${keyPrefix}`,
      points,
      duration,
      blockDuration,
      inmemoryBlockOnConsumed: points + 1,
      inmemoryBlockDuration: blockDuration || 60,
      insuranceLimiter: new RateLimiterMemory({
        points,
        duration,
      }),
    });
  } catch (error) {
    logger.warn('Redis rate limiter failed, using memory', { error: error.message });
    return new RateLimiterMemory({
      keyPrefix,
      points,
      duration,
      blockDuration,
    });
  }
}

// Create rate limiters for each tier
const tierLimiters = {};
for (const [tier, config] of Object.entries(RATE_LIMIT_TIERS)) {
  tierLimiters[tier] = createRateLimiter({
    keyPrefix: `tier:${tier}`,
    ...config,
  });
}

// Create endpoint-specific limiters
const endpointLimiters = {};
for (const [endpoint, config] of Object.entries(ENDPOINT_LIMITS)) {
  const key = endpoint.replace(/\//g, ':');
  endpointLimiters[endpoint] = createRateLimiter({
    keyPrefix: `endpoint:${key}`,
    ...config,
  });
}

// Global rate limiter (DDoS protection)
const globalLimiter = createRateLimiter({
  keyPrefix: 'global',
  points: 10000,
  duration: 1,
  blockDuration: 60,
});

// Burst limiter (short-term spikes)
const burstLimiter = createRateLimiter({
  keyPrefix: 'burst',
  points: 20,
  duration: 1,
  blockDuration: 10,
});

/**
 * Get rate limit key for request
 */
function getRateLimitKey(req) {
  // Prefer user ID, fallback to IP
  if (req.user?.id) {
    return `user:${req.user.id}`;
  }
  return `ip:${req.clientIP || req.ip}`;
}

/**
 * Get user's rate limit tier
 */
function getUserTier(req) {
  if (!req.user) return 'anonymous';
  
  // Check for admin
  if (req.user.role === 'ADMIN' || req.user.role === 'SUPER_ADMIN') {
    return 'admin';
  }

  // Check subscription tier
  const subscription = req.user.subscription?.plan?.tier;
  if (subscription && RATE_LIMIT_TIERS[subscription]) {
    return subscription;
  }

  return 'free';
}

/**
 * Find matching endpoint limiter
 */
function findEndpointLimiter(path) {
  // Exact match
  if (endpointLimiters[path]) {
    return endpointLimiters[path];
  }

  // Pattern match
  for (const [endpoint, limiter] of Object.entries(endpointLimiters)) {
    const pattern = endpoint.replace(/:[^/]+/g, '[^/]+');
    const regex = new RegExp(`^${pattern}$`);
    if (regex.test(path)) {
      return limiter;
    }
  }

  return null;
}

/**
 * Set rate limit headers
 */
function setRateLimitHeaders(res, rateLimiterRes, limit) {
  res.set({
    'X-RateLimit-Limit': limit,
    'X-RateLimit-Remaining': Math.max(0, rateLimiterRes.remainingPoints),
    'X-RateLimit-Reset': new Date(Date.now() + rateLimiterRes.msBeforeNext).toISOString(),
    'Retry-After': Math.ceil(rateLimiterRes.msBeforeNext / 1000),
  });
}

/**
 * Rate limit response
 */
function rateLimitResponse(res, rateLimiterRes, tier) {
  const retryAfter = Math.ceil(rateLimiterRes.msBeforeNext / 1000);

  return res.status(429).json({
    success: false,
    error: 'Too many requests',
    code: 'RATE_LIMIT_EXCEEDED',
    tier,
    retryAfter,
    message: `Rate limit exceeded. Please retry after ${retryAfter} seconds.`,
  });
}

/**
 * Advanced rate limiting middleware
 */
function advancedRateLimiter(options = {}) {
  const {
    skipPaths = ['/health', '/api/v1/webhooks'],
    skipIPs = [],
    skipUserIds = [],
    enableBurstProtection = true,
    enableGlobalProtection = true,
  } = options;

  return async (req, res, next) => {
    // Skip certain paths
    if (skipPaths.some((p) => req.path.startsWith(p))) {
      return next();
    }

    const key = getRateLimitKey(req);
    const ip = req.clientIP || req.ip;

    // Skip whitelisted IPs
    if (skipIPs.includes(ip)) {
      return next();
    }

    // Skip whitelisted users
    if (req.user?.id && skipUserIds.includes(req.user.id)) {
      return next();
    }

    try {
      // 1. Global rate limit (DDoS protection)
      if (enableGlobalProtection) {
        try {
          await globalLimiter.consume(ip, 1);
        } catch (error) {
          logger.warn('Global rate limit exceeded', { ip });
          return res.status(429).json({
            success: false,
            error: 'Service temporarily unavailable',
            code: 'GLOBAL_RATE_LIMIT',
            retryAfter: Math.ceil(error.msBeforeNext / 1000),
          });
        }
      }

      // 2. Burst protection
      if (enableBurstProtection) {
        try {
          await burstLimiter.consume(key, 1);
        } catch (error) {
          logger.warn('Burst rate limit exceeded', { key });
          setRateLimitHeaders(res, error, 20);
          return rateLimitResponse(res, error, 'burst');
        }
      }

      // 3. Endpoint-specific rate limit
      const endpointLimiter = findEndpointLimiter(req.path);
      if (endpointLimiter) {
        try {
          const result = await endpointLimiter.consume(key, 1);
          const config = ENDPOINT_LIMITS[req.path] || { points: 60 };
          setRateLimitHeaders(res, result, config.points);
        } catch (error) {
          const config = ENDPOINT_LIMITS[req.path] || { points: 60 };
          setRateLimitHeaders(res, error, config.points);
          return rateLimitResponse(res, error, 'endpoint');
        }
      }

      // 4. Tier-based rate limit
      const tier = getUserTier(req);
      const tierLimiter = tierLimiters[tier];
      const tierConfig = RATE_LIMIT_TIERS[tier];

      try {
        const result = await tierLimiter.consume(key, 1);
        setRateLimitHeaders(res, result, tierConfig.points);
      } catch (error) {
        setRateLimitHeaders(res, error, tierConfig.points);
        
        logger.warn('Rate limit exceeded', {
          key,
          tier,
          path: req.path,
          method: req.method,
        });

        return rateLimitResponse(res, error, tier);
      }

      next();
    } catch (error) {
      logger.error('Rate limiter error', { error: error.message });
      // Fail open - allow request on error
      next();
    }
  };
}

/**
 * Custom rate limiter for specific operations
 */
function customRateLimiter(options) {
  const {
    points = 10,
    duration = 60,
    blockDuration = 60,
    keyGenerator = (req) => getRateLimitKey(req),
    skipIf = () => false,
    onLimit = null,
  } = options;

  const limiter = createRateLimiter({
    keyPrefix: 'custom',
    points,
    duration,
    blockDuration,
  });

  return async (req, res, next) => {
    if (skipIf(req)) {
      return next();
    }

    const key = keyGenerator(req);

    try {
      const result = await limiter.consume(key, 1);
      setRateLimitHeaders(res, result, points);
      next();
    } catch (error) {
      setRateLimitHeaders(res, error, points);

      if (onLimit) {
        return onLimit(req, res, error);
      }

      return rateLimitResponse(res, error, 'custom');
    }
  };
}

/**
 * Sliding window rate limiter
 */
class SlidingWindowLimiter {
  constructor(options = {}) {
    this.windowSize = options.windowSize || 60000; // 1 minute
    this.maxRequests = options.maxRequests || 100;
    this.windows = new Map();
  }

  async isAllowed(key) {
    const now = Date.now();
    const windowStart = now - this.windowSize;

    if (!this.windows.has(key)) {
      this.windows.set(key, []);
    }

    const requests = this.windows.get(key);

    // Remove old requests outside the window
    const validRequests = requests.filter((time) => time > windowStart);
    this.windows.set(key, validRequests);

    if (validRequests.length >= this.maxRequests) {
      return {
        allowed: false,
        remaining: 0,
        resetAt: validRequests[0] + this.windowSize,
      };
    }

    // Add current request
    validRequests.push(now);

    return {
      allowed: true,
      remaining: this.maxRequests - validRequests.length,
      resetAt: now + this.windowSize,
    };
  }

  middleware() {
    return async (req, res, next) => {
      const key = getRateLimitKey(req);
      const result = await this.isAllowed(key);

      res.set({
        'X-RateLimit-Limit': this.maxRequests,
        'X-RateLimit-Remaining': result.remaining,
        'X-RateLimit-Reset': new Date(result.resetAt).toISOString(),
      });

      if (!result.allowed) {
        return res.status(429).json({
          success: false,
          error: 'Rate limit exceeded',
          retryAfter: Math.ceil((result.resetAt - Date.now()) / 1000),
        });
      }

      next();
    };
  }
}

/**
 * Token bucket rate limiter
 */
class TokenBucketLimiter {
  constructor(options = {}) {
    this.capacity = options.capacity || 100;
    this.refillRate = options.refillRate || 10; // tokens per second
    this.buckets = new Map();
  }

  async consume(key, tokens = 1) {
    const now = Date.now();

    if (!this.buckets.has(key)) {
      this.buckets.set(key, {
        tokens: this.capacity,
        lastRefill: now,
      });
    }

    const bucket = this.buckets.get(key);

    // Refill tokens based on time passed
    const timePassed = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(
      this.capacity,
      bucket.tokens + timePassed * this.refillRate
    );
    bucket.lastRefill = now;

    if (bucket.tokens < tokens) {
      return {
        allowed: false,
        tokens: bucket.tokens,
        waitTime: ((tokens - bucket.tokens) / this.refillRate) * 1000,
      };
    }

    bucket.tokens -= tokens;

    return {
      allowed: true,
      tokens: bucket.tokens,
    };
  }
}

/**
 * Rate limit by cost (weighted endpoints)
 */
const ENDPOINT_COSTS = {
  'GET': 1,
  'POST': 2,
  'PUT': 2,
  'PATCH': 2,
  'DELETE': 3,
};

function costBasedRateLimiter(options = {}) {
  const { pointsPerMinute = 100 } = options;

  const limiter = createRateLimiter({
    keyPrefix: 'cost',
    points: pointsPerMinute,
    duration: 60,
    blockDuration: 60,
  });

  return async (req, res, next) => {
    const key = getRateLimitKey(req);
    const cost = ENDPOINT_COSTS[req.method] || 1;

    try {
      const result = await limiter.consume(key, cost);
      res.set('X-RateLimit-Cost', cost);
      setRateLimitHeaders(res, result, pointsPerMinute);
      next();
    } catch (error) {
      res.set('X-RateLimit-Cost', cost);
      setRateLimitHeaders(res, error, pointsPerMinute);
      return rateLimitResponse(res, error, 'cost');
    }
  };
}

module.exports = {
  advancedRateLimiter,
  customRateLimiter,
  SlidingWindowLimiter,
  TokenBucketLimiter,
  costBasedRateLimiter,
  RATE_LIMIT_TIERS,
  ENDPOINT_LIMITS,
  getRateLimitKey,
  getUserTier,
};
