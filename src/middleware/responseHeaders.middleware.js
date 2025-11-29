// =============================================================================
// AIRAVAT B2B MARKETPLACE - RESPONSE HEADERS MIDDLEWARE
// Comprehensive API response headers for security, caching, and debugging
// =============================================================================

const os = require('os');
const config = require('../config');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Server identification (masked in production)
 */
const SERVER_INFO = {
  name: 'Airavat-API',
  version: config.app.apiVersion,
  node: process.version,
};

/**
 * Cache control presets
 */
const CACHE_PRESETS = {
  // No caching at all
  noCache: 'no-store, no-cache, must-revalidate, proxy-revalidate',
  
  // Private browser cache only
  private: 'private, max-age=0, must-revalidate',
  
  // Short cache for frequently changing data
  short: 'private, max-age=60',
  
  // Medium cache for semi-static data
  medium: 'private, max-age=300',
  
  // Long cache for static data
  long: 'public, max-age=3600',
  
  // Immutable cache for versioned assets
  immutable: 'public, max-age=31536000, immutable',
};

/**
 * Path-based cache rules
 */
const PATH_CACHE_RULES = {
  // Auth endpoints - never cache
  '/api/v1/auth': 'noCache',
  
  // User data - private only
  '/api/v1/users': 'private',
  '/api/v1/cart': 'private',
  '/api/v1/orders': 'private',
  '/api/v1/wallet': 'private',
  
  // Product listings - short cache
  '/api/v1/products': 'short',
  '/api/v1/categories': 'medium',
  
  // Search - very short cache
  '/api/v1/search': 'private',
  
  // Static content - long cache
  '/api/v1/static': 'long',
  '/uploads': 'long',
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get cache control header based on request path
 * @param {string} path - Request path
 * @param {string} method - HTTP method
 * @returns {string} - Cache control header value
 */
function getCacheControl(path, method) {
  // Never cache mutations
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) {
    return CACHE_PRESETS.noCache;
  }

  // Check path rules
  for (const [pathPrefix, preset] of Object.entries(PATH_CACHE_RULES)) {
    if (path.startsWith(pathPrefix)) {
      return CACHE_PRESETS[preset] || CACHE_PRESETS.private;
    }
  }

  // Default to private for API routes
  if (path.startsWith('/api')) {
    return CACHE_PRESETS.private;
  }

  return CACHE_PRESETS.short;
}

/**
 * Generate request ID if not present
 * @param {object} req - Express request
 * @returns {string} - Request ID
 */
function getRequestId(req) {
  return req.id || req.headers['x-request-id'] || `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * Get response time in milliseconds
 * @param {Array} startTime - hrtime tuple
 * @returns {number} - Response time in ms
 */
function getResponseTime(startTime) {
  const diff = process.hrtime(startTime);
  return (diff[0] * 1e3 + diff[1] / 1e6).toFixed(2);
}

// =============================================================================
// MIDDLEWARE
// =============================================================================

/**
 * Standard API response headers
 * Adds common headers for all API responses
 */
function standardHeaders(options = {}) {
  const {
    includeServerInfo = false,
    includeTimingInfo = true,
    customHeaders = {},
  } = options;

  return (req, res, next) => {
    const startTime = process.hrtime();
    const requestId = getRequestId(req);

    // Store request ID for logging
    req.id = requestId;

    // Set request ID header
    res.setHeader('X-Request-Id', requestId);

    // API versioning header
    res.setHeader('X-API-Version', config.app.apiVersion);

    // Server info (only in development)
    if (includeServerInfo && !config.app.isProd) {
      res.setHeader('X-Server', `${SERVER_INFO.name}/${SERVER_INFO.version}`);
      res.setHeader('X-Node-Version', SERVER_INFO.node);
    }

    // Content type options
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // Frame options
    res.setHeader('X-Frame-Options', 'DENY');

    // XSS protection
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Custom headers
    for (const [key, value] of Object.entries(customHeaders)) {
      res.setHeader(key, value);
    }

    // Override res.json to add timing headers
    if (includeTimingInfo) {
      const originalJson = res.json.bind(res);
      res.json = function(data) {
        const responseTime = getResponseTime(startTime);
        res.setHeader('X-Response-Time', `${responseTime}ms`);
        return originalJson(data);
      };
    }

    // Set Cache-Control header
    res.on('finish', () => {
      // Only set if not already set
      if (!res.getHeader('Cache-Control')) {
        res.setHeader('Cache-Control', getCacheControl(req.path, req.method));
      }
    });

    next();
  };
}

/**
 * Security headers middleware
 * Adds comprehensive security headers
 */
function securityHeaders(options = {}) {
  const {
    enableHSTS = true,
    hstsMaxAge = 31536000, // 1 year
    enableCSP = true,
  } = options;

  return (req, res, next) => {
    // HTTP Strict Transport Security
    if (enableHSTS && config.app.isProd) {
      res.setHeader(
        'Strict-Transport-Security',
        `max-age=${hstsMaxAge}; includeSubDomains; preload`
      );
    }

    // Content Security Policy
    if (enableCSP) {
      res.setHeader(
        'Content-Security-Policy',
        "default-src 'self'; " +
        "script-src 'self' 'unsafe-inline'; " +
        "style-src 'self' 'unsafe-inline'; " +
        "img-src 'self' data: https:; " +
        "font-src 'self' https://fonts.gstatic.com; " +
        "connect-src 'self' https://api.airavat.com wss://api.airavat.com; " +
        "frame-ancestors 'none'; " +
        "form-action 'self';"
      );
    }

    // Permissions Policy (formerly Feature-Policy)
    res.setHeader(
      'Permissions-Policy',
      'camera=(), microphone=(), geolocation=(), interest-cohort=()'
    );

    // Cross-Origin policies
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');

    next();
  };
}

/**
 * Pagination headers middleware
 * Adds pagination information to response headers
 */
function paginationHeaders() {
  return (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = function(data) {
      // Check if response includes pagination
      if (data && data.pagination) {
        const { page, limit, total, pages } = data.pagination;

        res.setHeader('X-Page', page);
        res.setHeader('X-Per-Page', limit);
        res.setHeader('X-Total', total);
        res.setHeader('X-Total-Pages', pages);

        // Build Link header for pagination
        const links = [];
        const baseUrl = `${req.protocol}://${req.get('host')}${req.baseUrl}${req.path}`;
        const queryParams = new URLSearchParams(req.query);

        if (page > 1) {
          queryParams.set('page', 1);
          links.push(`<${baseUrl}?${queryParams}>; rel="first"`);
          
          queryParams.set('page', page - 1);
          links.push(`<${baseUrl}?${queryParams}>; rel="prev"`);
        }

        if (page < pages) {
          queryParams.set('page', page + 1);
          links.push(`<${baseUrl}?${queryParams}>; rel="next"`);
          
          queryParams.set('page', pages);
          links.push(`<${baseUrl}?${queryParams}>; rel="last"`);
        }

        if (links.length > 0) {
          res.setHeader('Link', links.join(', '));
        }
      }

      return originalJson(data);
    };

    next();
  };
}

/**
 * Rate limit headers middleware
 * Adds rate limiting information to response headers
 * Note: Main rate limiting is done by advancedRateLimiter
 */
function rateLimitHeaders() {
  return (req, res, next) => {
    // These headers are typically set by the rate limiter
    // This middleware ensures they're always present

    res.on('finish', () => {
      if (!res.getHeader('X-RateLimit-Limit')) {
        // Set defaults if not already set by rate limiter
        res.setHeader('X-RateLimit-Limit', '100');
        res.setHeader('X-RateLimit-Remaining', '99');
        res.setHeader('X-RateLimit-Reset', new Date(Date.now() + 60000).toISOString());
      }
    });

    next();
  };
}

/**
 * Debug headers middleware (development only)
 * Adds debugging information to responses
 */
function debugHeaders(options = {}) {
  return (req, res, next) => {
    if (config.app.isProd) {
      return next();
    }

    const startTime = process.hrtime();
    const startMem = process.memoryUsage();

    const originalEnd = res.end.bind(res);
    res.end = function(...args) {
      const endTime = process.hrtime(startTime);
      const endMem = process.memoryUsage();

      // Timing info
      const responseTime = (endTime[0] * 1000 + endTime[1] / 1e6).toFixed(2);
      res.setHeader('X-Debug-Time', `${responseTime}ms`);

      // Memory info
      const memDiff = (endMem.heapUsed - startMem.heapUsed) / 1024 / 1024;
      res.setHeader('X-Debug-Memory', `${memDiff.toFixed(2)}MB`);

      // Server info
      res.setHeader('X-Debug-Hostname', os.hostname());
      res.setHeader('X-Debug-PID', process.pid);

      return originalEnd(...args);
    };

    next();
  };
}

/**
 * CORS preflight headers
 * Enhanced CORS handling for preflight requests
 */
function corsPreflightHeaders(options = {}) {
  const {
    allowedMethods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders = [
      'Content-Type',
      'Authorization',
      'X-Requested-With',
      'X-API-Version',
      'X-Request-Id',
    ],
    maxAge = 86400, // 24 hours
  } = options;

  return (req, res, next) => {
    if (req.method === 'OPTIONS') {
      res.setHeader('Access-Control-Allow-Methods', allowedMethods.join(', '));
      res.setHeader('Access-Control-Allow-Headers', allowedHeaders.join(', '));
      res.setHeader('Access-Control-Max-Age', maxAge);
      res.setHeader('Access-Control-Allow-Credentials', 'true');
      
      return res.status(204).end();
    }

    next();
  };
}

/**
 * ETag headers middleware
 * Adds ETag support for conditional requests
 */
function etagHeaders() {
  const crypto = require('crypto');

  return (req, res, next) => {
    const originalJson = res.json.bind(res);

    res.json = function(data) {
      // Generate ETag from response body
      const jsonString = JSON.stringify(data);
      const hash = crypto.createHash('md5').update(jsonString).digest('hex');
      const etag = `"${hash}"`;

      res.setHeader('ETag', etag);

      // Check If-None-Match header
      const ifNoneMatch = req.headers['if-none-match'];
      if (ifNoneMatch === etag) {
        return res.status(304).end();
      }

      return originalJson(data);
    };

    next();
  };
}

/**
 * Combined response headers middleware
 * Applies all standard headers in one middleware
 */
function responseHeaders(options = {}) {
  const standard = standardHeaders(options);
  const security = securityHeaders(options);
  const pagination = paginationHeaders();

  return (req, res, next) => {
    standard(req, res, () => {
      security(req, res, () => {
        pagination(req, res, next);
      });
    });
  };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  standardHeaders,
  securityHeaders,
  paginationHeaders,
  rateLimitHeaders,
  debugHeaders,
  corsPreflightHeaders,
  etagHeaders,
  responseHeaders,
  getCacheControl,
  getRequestId,
  CACHE_PRESETS,
  PATH_CACHE_RULES,
};



