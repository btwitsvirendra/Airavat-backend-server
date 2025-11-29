// =============================================================================
// AIRAVAT B2B MARKETPLACE - SECURITY MIDDLEWARE
// Security headers, CORS, and protection middleware
// =============================================================================

const helmet = require('helmet');
const cors = require('cors');
const hpp = require('hpp');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss-clean');
const config = require('../config');
const logger = require('../config/logger');

// =============================================================================
// HELMET SECURITY HEADERS
// =============================================================================

const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://checkout.razorpay.com'],
      connectSrc: ["'self'", 'https://api.razorpay.com', 'wss:', 'ws:'],
      frameSrc: ["'self'", 'https://api.razorpay.com'],
      objectSrc: ["'none'"],
      upgradeInsecureRequests: [],
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  dnsPrefetchControl: { allow: false },
  frameguard: { action: 'deny' },
  hidePoweredBy: true,
  hsts: {
    maxAge: 31536000, // 1 year
    includeSubDomains: true,
    preload: true,
  },
  ieNoOpen: true,
  noSniff: true,
  originAgentCluster: true,
  permittedCrossDomainPolicies: { permittedPolicies: 'none' },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  xssFilter: true,
});

// =============================================================================
// CORS CONFIGURATION
// =============================================================================

const allowedOrigins = [
  'http://localhost:3000',
  'http://localhost:3001',
  'https://airavat.com',
  'https://www.airavat.com',
  'https://app.airavat.com',
  'https://seller.airavat.com',
  'https://admin.airavat.com',
  ...(config.cors?.allowedOrigins || []),
];

const corsConfig = cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) return callback(null, true);

    if (allowedOrigins.includes(origin) || config.nodeEnv === 'development') {
      callback(null, true);
    } else {
      logger.warn('CORS blocked request', { origin });
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: [
    'Content-Type',
    'Authorization',
    'X-Requested-With',
    'X-Request-ID',
    'X-API-Key',
    'X-Device-ID',
    'X-Session-ID',
  ],
  exposedHeaders: [
    'X-Request-ID',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
  ],
  maxAge: 86400, // 24 hours
});

// =============================================================================
// HTTP PARAMETER POLLUTION PROTECTION
// =============================================================================

const hppConfig = hpp({
  whitelist: [
    'sort',
    'page',
    'limit',
    'category',
    'brand',
    'rating',
    'price',
    'status',
  ],
});

// =============================================================================
// REQUEST ID MIDDLEWARE
// =============================================================================

const requestId = (req, res, next) => {
  const id = req.headers['x-request-id'] || 
    `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
};

// =============================================================================
// IP EXTRACTION
// =============================================================================

const extractIP = (req, res, next) => {
  req.clientIP = 
    req.headers['cf-connecting-ip'] || // Cloudflare
    req.headers['x-real-ip'] || // Nginx
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip;
  next();
};

// =============================================================================
// API KEY VALIDATION
// =============================================================================

const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return next();
  }

  // Validate API key format and existence
  // This would be checked against database in production
  if (apiKey.length < 32) {
    return res.status(401).json({
      success: false,
      message: 'Invalid API key format',
    });
  }

  req.apiKey = apiKey;
  next();
};

// =============================================================================
// SUSPICIOUS REQUEST DETECTION
// =============================================================================

const suspiciousPatterns = [
  /(\%27)|(\')|(\-\-)|(\%23)|(#)/i, // SQL Injection
  /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, // XSS
  /\.\.\//g, // Directory traversal
  /etc\/passwd/i, // Path traversal
  /\bselect\b.*\bfrom\b/i, // SQL
  /\bunion\b.*\bselect\b/i, // SQL
  /\binsert\b.*\binto\b/i, // SQL
  /\bdelete\b.*\bfrom\b/i, // SQL
  /\bdrop\b.*\btable\b/i, // SQL
];

const detectSuspiciousRequest = (req, res, next) => {
  const checkValue = (value) => {
    if (typeof value === 'string') {
      return suspiciousPatterns.some((pattern) => pattern.test(value));
    }
    if (typeof value === 'object' && value !== null) {
      return Object.values(value).some(checkValue);
    }
    return false;
  };

  const isSuspicious = 
    checkValue(req.query) || 
    checkValue(req.body) || 
    checkValue(req.params);

  if (isSuspicious) {
    logger.warn('Suspicious request detected', {
      ip: req.clientIP,
      path: req.path,
      method: req.method,
      requestId: req.requestId,
    });

    // In production, you might want to block or flag this
    // For now, we just log and continue
  }

  next();
};

// =============================================================================
// PAYLOAD SIZE LIMITER
// =============================================================================

const payloadLimiter = (maxSize = '10mb') => {
  return (req, res, next) => {
    const contentLength = parseInt(req.headers['content-length'] || '0', 10);
    const maxBytes = parseSize(maxSize);

    if (contentLength > maxBytes) {
      return res.status(413).json({
        success: false,
        message: `Payload too large. Maximum size is ${maxSize}`,
      });
    }

    next();
  };
};

const parseSize = (size) => {
  const units = { b: 1, kb: 1024, mb: 1024 * 1024, gb: 1024 * 1024 * 1024 };
  const match = size.toLowerCase().match(/^(\d+)(b|kb|mb|gb)?$/);
  if (!match) return 10 * 1024 * 1024; // Default 10MB
  return parseInt(match[1], 10) * (units[match[2]] || 1);
};

// =============================================================================
// BOT DETECTION
// =============================================================================

const knownBots = [
  'googlebot', 'bingbot', 'slurp', 'duckduckbot', 'baiduspider',
  'yandexbot', 'facebot', 'ia_archiver', 'semrushbot', 'dotbot',
];

const detectBot = (req, res, next) => {
  const userAgent = (req.headers['user-agent'] || '').toLowerCase();
  req.isBot = knownBots.some((bot) => userAgent.includes(bot));
  next();
};

// =============================================================================
// SECURE HEADERS FOR API RESPONSES
// =============================================================================

const secureApiHeaders = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Surrogate-Control', 'no-store');
  next();
};

// =============================================================================
// COMBINE ALL SECURITY MIDDLEWARE
// =============================================================================

const security = [
  requestId,
  extractIP,
  helmetConfig,
  corsConfig,
  hppConfig,
  xss(),
  mongoSanitize(),
  detectBot,
  detectSuspiciousRequest,
  secureApiHeaders,
];

module.exports = {
  security,
  helmetConfig,
  corsConfig,
  hppConfig,
  requestId,
  extractIP,
  validateApiKey,
  detectSuspiciousRequest,
  payloadLimiter,
  detectBot,
  secureApiHeaders,
};
