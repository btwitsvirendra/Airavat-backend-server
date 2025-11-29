// =============================================================================
// AIRAVAT B2B MARKETPLACE - SECURITY MIDDLEWARE
// Comprehensive security headers and protections
// =============================================================================

const helmet = require('helmet');
const cors = require('cors');
const hpp = require('hpp');
const mongoSanitize = require('express-mongo-sanitize');
const xss = require('xss');
const config = require('../config');
const logger = require('../config/logger');

// =============================================================================
// CORS CONFIGURATION
// =============================================================================

const corsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = config.cors?.allowedOrigins || [
      'http://localhost:3000',
      'http://localhost:3001',
      'https://airavat.com',
      'https://www.airavat.com',
      'https://app.airavat.com',
      'https://seller.airavat.com',
    ];

    // Allow requests with no origin (mobile apps, Postman, etc.)
    if (!origin) {
      return callback(null, true);
    }

    if (allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
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
    'X-Device-ID',
    'X-App-Version',
    'X-Platform',
  ],
  exposedHeaders: [
    'X-Request-ID',
    'X-RateLimit-Limit',
    'X-RateLimit-Remaining',
    'X-RateLimit-Reset',
  ],
  maxAge: 86400, // 24 hours
};

// =============================================================================
// HELMET CONFIGURATION
// =============================================================================

const helmetConfig = helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://checkout.razorpay.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'https:', 'blob:'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      connectSrc: [
        "'self'",
        'https://api.razorpay.com',
        'https://lumberjack.razorpay.com',
        config.aws?.s3Bucket ? `https://${config.aws.s3Bucket}.s3.amazonaws.com` : '',
      ].filter(Boolean),
      frameSrc: ["'self'", 'https://api.razorpay.com'],
      objectSrc: ["'none'"],
      mediaSrc: ["'self'", 'https:'],
      upgradeInsecureRequests: config.env === 'production' ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: 'cross-origin' },
  dnsPrefetchControl: { allow: true },
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
// XSS SANITIZATION
// =============================================================================

const sanitizeInput = (obj) => {
  if (typeof obj === 'string') {
    return xss(obj, {
      whiteList: {},
      stripIgnoreTag: true,
      stripIgnoreTagBody: ['script'],
    });
  }
  
  if (Array.isArray(obj)) {
    return obj.map(sanitizeInput);
  }
  
  if (obj && typeof obj === 'object') {
    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      sanitized[key] = sanitizeInput(value);
    }
    return sanitized;
  }
  
  return obj;
};

const xssSanitizer = (req, res, next) => {
  if (req.body) {
    req.body = sanitizeInput(req.body);
  }
  if (req.query) {
    req.query = sanitizeInput(req.query);
  }
  if (req.params) {
    req.params = sanitizeInput(req.params);
  }
  next();
};

// =============================================================================
// SQL INJECTION PREVENTION
// =============================================================================

const sqlInjectionPatterns = [
  /(\s|^)(SELECT|INSERT|UPDATE|DELETE|DROP|UNION|ALTER|CREATE|TRUNCATE|EXEC|EXECUTE)(\s|$)/i,
  /(\s|^)(OR|AND)\s+[\d\w]+=[\d\w]+/i,
  /--/,
  /;.*$/,
  /\/\*.*\*\//,
  /'.*OR.*'/i,
  /".*OR.*"/i,
];

const sqlInjectionChecker = (req, res, next) => {
  const checkValue = (value, path) => {
    if (typeof value === 'string') {
      for (const pattern of sqlInjectionPatterns) {
        if (pattern.test(value)) {
          logger.warn('Potential SQL injection detected', {
            path,
            value: value.substring(0, 100),
            ip: req.ip,
          });
          return true;
        }
      }
    }
    return false;
  };

  const checkObject = (obj, prefix = '') => {
    for (const [key, value] of Object.entries(obj)) {
      const path = prefix ? `${prefix}.${key}` : key;
      if (typeof value === 'object' && value !== null) {
        if (checkObject(value, path)) return true;
      } else if (checkValue(value, path)) {
        return true;
      }
    }
    return false;
  };

  // Check query, body, and params
  if (
    (req.query && checkObject(req.query, 'query')) ||
    (req.body && checkObject(req.body, 'body')) ||
    (req.params && checkObject(req.params, 'params'))
  ) {
    return res.status(400).json({
      success: false,
      message: 'Invalid input detected',
    });
  }

  next();
};

// =============================================================================
// REQUEST ID MIDDLEWARE
// =============================================================================

const requestId = (req, res, next) => {
  const id = req.headers['x-request-id'] || require('crypto').randomUUID();
  req.requestId = id;
  res.setHeader('X-Request-ID', id);
  next();
};

// =============================================================================
// IP EXTRACTION
// =============================================================================

const extractIP = (req, res, next) => {
  req.clientIP =
    req.headers['cf-connecting-ip'] ||
    req.headers['x-real-ip'] ||
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.socket?.remoteAddress ||
    req.ip;
  next();
};

// =============================================================================
// DEVICE INFO EXTRACTION
// =============================================================================

const extractDeviceInfo = (req, res, next) => {
  const userAgent = req.headers['user-agent'] || '';
  
  req.deviceInfo = {
    userAgent,
    deviceId: req.headers['x-device-id'],
    appVersion: req.headers['x-app-version'],
    platform: req.headers['x-platform'] || detectPlatform(userAgent),
    browser: detectBrowser(userAgent),
    os: detectOS(userAgent),
  };
  
  next();
};

const detectPlatform = (ua) => {
  if (/mobile/i.test(ua)) return 'mobile';
  if (/tablet/i.test(ua)) return 'tablet';
  return 'desktop';
};

const detectBrowser = (ua) => {
  if (/chrome/i.test(ua)) return 'Chrome';
  if (/firefox/i.test(ua)) return 'Firefox';
  if (/safari/i.test(ua)) return 'Safari';
  if (/edge/i.test(ua)) return 'Edge';
  if (/msie|trident/i.test(ua)) return 'IE';
  return 'Unknown';
};

const detectOS = (ua) => {
  if (/windows/i.test(ua)) return 'Windows';
  if (/macintosh|mac os/i.test(ua)) return 'MacOS';
  if (/linux/i.test(ua)) return 'Linux';
  if (/android/i.test(ua)) return 'Android';
  if (/iphone|ipad/i.test(ua)) return 'iOS';
  return 'Unknown';
};

// =============================================================================
// API KEY VALIDATION (for external integrations)
// =============================================================================

const validateApiKey = (req, res, next) => {
  const apiKey = req.headers['x-api-key'];
  
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      message: 'API key required',
    });
  }

  // Validate against stored API keys
  // This would typically check against a database or cache
  const validKeys = config.apiKeys || [];
  
  if (!validKeys.includes(apiKey)) {
    logger.warn('Invalid API key attempt', { apiKey: apiKey.substring(0, 8) + '...', ip: req.clientIP });
    return res.status(401).json({
      success: false,
      message: 'Invalid API key',
    });
  }

  next();
};

// =============================================================================
// MAINTENANCE MODE
// =============================================================================

const maintenanceMode = (req, res, next) => {
  if (config.maintenanceMode && !req.path.startsWith('/health')) {
    return res.status(503).json({
      success: false,
      message: 'Service temporarily unavailable for maintenance',
      retryAfter: config.maintenanceEndTime,
    });
  }
  next();
};

// =============================================================================
// REQUEST SIZE LIMITER
// =============================================================================

const requestSizeLimiter = (maxSize = '10mb') => {
  const express = require('express');
  return [
    express.json({ limit: maxSize }),
    express.urlencoded({ extended: true, limit: maxSize }),
  ];
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  cors: cors(corsOptions),
  helmet: helmetConfig,
  hpp: hpp(),
  mongoSanitize: mongoSanitize(),
  xssSanitizer,
  sqlInjectionChecker,
  requestId,
  extractIP,
  extractDeviceInfo,
  validateApiKey,
  maintenanceMode,
  requestSizeLimiter,
  
  // Apply all security middleware
  applySecurityMiddleware: (app) => {
    app.use(requestId);
    app.use(extractIP);
    app.use(extractDeviceInfo);
    app.use(helmetConfig);
    app.use(cors(corsOptions));
    app.use(hpp());
    app.use(mongoSanitize());
    app.use(xssSanitizer);
    // app.use(sqlInjectionChecker); // Enable if needed
    app.use(maintenanceMode);
  },
};
