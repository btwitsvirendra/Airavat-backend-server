// =============================================================================
// AIRAVAT B2B MARKETPLACE - CORS CONFIGURATION
// Dynamic CORS with origin validation and security headers
// =============================================================================

const logger = require('./logger');

/**
 * Allowed origins by environment
 */
const ALLOWED_ORIGINS = {
  development: [
    'http://localhost:3000',
    'http://localhost:3001',
    'http://127.0.0.1:3000',
    'http://localhost:5173', // Vite dev server
    'http://localhost:8080',
  ],
  staging: [
    'https://staging.airavat.com',
    'https://staging-admin.airavat.com',
    'https://staging-seller.airavat.com',
  ],
  production: [
    'https://airavat.com',
    'https://www.airavat.com',
    'https://admin.airavat.com',
    'https://seller.airavat.com',
    'https://app.airavat.com',
  ],
};

/**
 * Get allowed origins based on environment
 */
function getAllowedOrigins() {
  const env = process.env.NODE_ENV || 'development';
  const customOrigins = process.env.CORS_ORIGINS?.split(',').map((o) => o.trim()) || [];

  return [...(ALLOWED_ORIGINS[env] || ALLOWED_ORIGINS.development), ...customOrigins];
}

/**
 * Validate origin
 */
function isOriginAllowed(origin) {
  if (!origin) return true; // Allow requests without origin (e.g., mobile apps)

  const allowedOrigins = getAllowedOrigins();

  // Check exact match
  if (allowedOrigins.includes(origin)) {
    return true;
  }

  // Check wildcard patterns
  for (const allowed of allowedOrigins) {
    if (allowed.includes('*')) {
      const pattern = allowed.replace(/\*/g, '.*');
      if (new RegExp(`^${pattern}$`).test(origin)) {
        return true;
      }
    }
  }

  // Check subdomain patterns
  const allowWildcardSubdomains = process.env.CORS_ALLOW_SUBDOMAINS === 'true';
  if (allowWildcardSubdomains) {
    const baseDomain = process.env.BASE_DOMAIN || 'airavat.com';
    if (origin.endsWith(`.${baseDomain}`) || origin === `https://${baseDomain}`) {
      return true;
    }
  }

  return false;
}

/**
 * CORS configuration object
 */
const corsConfig = {
  origin: (origin, callback) => {
    if (isOriginAllowed(origin)) {
      callback(null, true);
    } else {
      logger.warn('CORS blocked origin', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },

  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],

  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Request-ID',
    'X-Correlation-ID',
    'X-API-Version',
    'X-Client-Version',
    'X-Client-Platform',
    'Accept',
    'Accept-Language',
    'Cache-Control',
  ],

  exposedHeaders: [
    'X-Request-ID',
    'X-Correlation-ID',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
    'X-API-Version',
    'Content-Disposition',
  ],

  credentials: true,

  maxAge: 86400, // 24 hours

  preflightContinue: false,

  optionsSuccessStatus: 204,
};

/**
 * CORS middleware with custom error handling
 */
function corsMiddleware() {
  const cors = require('cors');
  return cors(corsConfig);
}

/**
 * Additional security headers middleware
 */
function securityHeaders() {
  return (req, res, next) => {
    // Strict Transport Security
    if (process.env.NODE_ENV === 'production') {
      res.setHeader(
        'Strict-Transport-Security',
        'max-age=31536000; includeSubDomains; preload'
      );
    }

    // Content Security Policy
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://cdnjs.cloudflare.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "img-src 'self' data: https: blob:",
        "connect-src 'self' https://api.airavat.com wss://api.airavat.com",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "base-uri 'self'",
      ].join('; ')
    );

    // X-Frame-Options (legacy, superseded by CSP frame-ancestors)
    res.setHeader('X-Frame-Options', 'DENY');

    // X-Content-Type-Options
    res.setHeader('X-Content-Type-Options', 'nosniff');

    // X-XSS-Protection (legacy but still useful)
    res.setHeader('X-XSS-Protection', '1; mode=block');

    // Referrer-Policy
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');

    // Permissions-Policy
    res.setHeader(
      'Permissions-Policy',
      'geolocation=(), microphone=(), camera=(), payment=(), usb=()'
    );

    // X-DNS-Prefetch-Control
    res.setHeader('X-DNS-Prefetch-Control', 'on');

    // Remove X-Powered-By
    res.removeHeader('X-Powered-By');

    next();
  };
}

/**
 * CORS error handler
 */
function corsErrorHandler(err, req, res, next) {
  if (err.message === 'Not allowed by CORS') {
    return res.status(403).json({
      success: false,
      error: 'Origin not allowed',
      code: 'CORS_ERROR',
    });
  }
  next(err);
}

/**
 * Preflight request handler for OPTIONS
 */
function preflightHandler(req, res, next) {
  if (req.method === 'OPTIONS') {
    res.sendStatus(204);
    return;
  }
  next();
}

module.exports = {
  corsConfig,
  corsMiddleware,
  securityHeaders,
  corsErrorHandler,
  preflightHandler,
  getAllowedOrigins,
  isOriginAllowed,
  ALLOWED_ORIGINS,
};
