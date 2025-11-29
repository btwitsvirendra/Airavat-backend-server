// =============================================================================
// AIRAVAT B2B MARKETPLACE - RATE LIMITING MIDDLEWARE
// Redis-backed rate limiting for API protection
// =============================================================================

const { rateLimit: redisRateLimit } = require('../config/redis');
const { RateLimitError } = require('../utils/errors');
const config = require('../config');

/**
 * Create rate limiter middleware
 * Uses Redis for distributed rate limiting
 */
const createRateLimiter = (options = {}) => {
  const {
    windowMs = config.rateLimit.windowMs,      // 15 minutes
    maxRequests = config.rateLimit.maxRequests, // 100 requests
    keyGenerator = (req) => req.ip,             // Default: by IP
    skipSuccessfulRequests = false,
    skipFailedRequests = false,
    message = 'Too many requests, please try again later.',
    skip = () => false,                         // Skip certain requests
  } = options;

  return async (req, res, next) => {
    try {
      // Check if should skip this request
      if (skip(req)) {
        return next();
      }

      const key = keyGenerator(req);
      const windowSeconds = Math.ceil(windowMs / 1000);

      const { allowed, remaining, resetTime } = await redisRateLimit.check(
        key,
        maxRequests,
        windowSeconds
      );

      // Set rate limit headers
      res.set({
        'X-RateLimit-Limit': maxRequests,
        'X-RateLimit-Remaining': remaining,
        'X-RateLimit-Reset': resetTime,
      });

      if (!allowed) {
        const retryAfter = Math.ceil((resetTime - Date.now()) / 1000);
        res.set('Retry-After', retryAfter);
        throw new RateLimitError(retryAfter);
      }

      next();
    } catch (error) {
      if (error instanceof RateLimitError) {
        return next(error);
      }
      // If Redis fails, allow the request (fail open)
      console.error('Rate limiter error:', error.message);
      next();
    }
  };
};

/**
 * General API rate limiter
 */
const apiLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 100,
  keyGenerator: (req) => `api:${req.user?.id || req.ip}`,
});

/**
 * Strict rate limiter for auth endpoints
 */
const authLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000, // 15 minutes
  maxRequests: 10,
  keyGenerator: (req) => `auth:${req.ip}`,
  message: 'Too many authentication attempts. Please try again later.',
});

/**
 * OTP rate limiter
 */
const otpLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 5,
  keyGenerator: (req) => `otp:${req.body.phone || req.body.email || req.ip}`,
  message: 'Too many OTP requests. Please try again in an hour.',
});

/**
 * Search rate limiter
 */
const searchLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 30,
  keyGenerator: (req) => `search:${req.user?.id || req.ip}`,
});

/**
 * File upload rate limiter
 */
const uploadLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 50,
  keyGenerator: (req) => `upload:${req.user?.id || req.ip}`,
});

/**
 * Order creation rate limiter (prevent rapid order creation)
 */
const orderLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 10,
  keyGenerator: (req) => `order:${req.user?.id}`,
});

/**
 * RFQ rate limiter
 */
const rfqLimiter = createRateLimiter({
  windowMs: 60 * 60 * 1000, // 1 hour
  maxRequests: 20,
  keyGenerator: (req) => `rfq:${req.business?.id}`,
});

/**
 * Chat message rate limiter
 */
const chatLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 60, // 1 message per second average
  keyGenerator: (req) => `chat:${req.user?.id}`,
});

/**
 * Webhook rate limiter (more lenient)
 */
const webhookLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
  keyGenerator: (req) => `webhook:${req.ip}`,
});

/**
 * Admin rate limiter (more lenient)
 */
const adminLimiter = createRateLimiter({
  windowMs: 15 * 60 * 1000,
  maxRequests: 500,
  keyGenerator: (req) => `admin:${req.user?.id}`,
  skip: (req) => !req.user || !['SUPER_ADMIN', 'ADMIN'].includes(req.user.role),
});

module.exports = {
  createRateLimiter,
  apiLimiter,
  authLimiter,
  otpLimiter,
  searchLimiter,
  uploadLimiter,
  orderLimiter,
  rfqLimiter,
  chatLimiter,
  webhookLimiter,
  adminLimiter,
};
