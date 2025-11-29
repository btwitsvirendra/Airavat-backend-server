// =============================================================================
// AIRAVAT B2B MARKETPLACE - REQUEST LOGGING MIDDLEWARE
// Structured request logging with correlation IDs and metrics
// =============================================================================

const { v4: uuidv4 } = require('uuid');
const logger = require('../config/logger');
const performanceMonitor = require('../services/performance.service');

/**
 * Headers for request tracking
 */
const HEADERS = {
  REQUEST_ID: 'X-Request-ID',
  CORRELATION_ID: 'X-Correlation-ID',
  CLIENT_VERSION: 'X-Client-Version',
  CLIENT_PLATFORM: 'X-Client-Platform',
};

/**
 * Request logging configuration
 */
const CONFIG = {
  // Fields to exclude from logging
  excludeBody: ['password', 'token', 'secret', 'creditCard', 'cvv', 'apiKey'],
  excludePaths: ['/health', '/health/live', '/health/ready', '/favicon.ico'],
  
  // Max body size to log (in characters)
  maxBodySize: 10000,
  
  // Log response body for errors
  logErrorResponse: true,
  
  // Slow request threshold (ms)
  slowRequestThreshold: 5000,
};

/**
 * Sanitize request body for logging
 */
function sanitizeBody(body) {
  if (!body) return undefined;

  const sanitize = (obj) => {
    if (typeof obj !== 'object' || obj === null) return obj;

    const sanitized = Array.isArray(obj) ? [] : {};

    for (const [key, value] of Object.entries(obj)) {
      if (CONFIG.excludeBody.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        sanitized[key] = sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }

    return sanitized;
  };

  const sanitized = sanitize(body);
  const stringified = JSON.stringify(sanitized);

  if (stringified.length > CONFIG.maxBodySize) {
    return { truncated: true, size: stringified.length };
  }

  return sanitized;
}

/**
 * Get client IP address
 */
function getClientIP(req) {
  return (
    req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
    req.headers['x-real-ip'] ||
    req.connection?.remoteAddress ||
    req.socket?.remoteAddress ||
    req.ip
  );
}

/**
 * Get user agent info
 */
function getUserAgentInfo(req) {
  const userAgent = req.headers['user-agent'] || '';

  // Basic parsing
  const isMobile = /mobile|android|iphone|ipad/i.test(userAgent);
  const isBot = /bot|crawler|spider|googlebot|bingbot/i.test(userAgent);

  return {
    raw: userAgent.substring(0, 200),
    isMobile,
    isBot,
    platform: req.headers[HEADERS.CLIENT_PLATFORM.toLowerCase()],
    version: req.headers[HEADERS.CLIENT_VERSION.toLowerCase()],
  };
}

/**
 * Request logging middleware
 */
function requestLogger(options = {}) {
  const config = { ...CONFIG, ...options };

  return (req, res, next) => {
    // Skip excluded paths
    if (config.excludePaths.some((p) => req.path.startsWith(p))) {
      return next();
    }

    // Generate/extract request ID
    const requestId = req.headers[HEADERS.REQUEST_ID.toLowerCase()] || uuidv4();
    const correlationId = req.headers[HEADERS.CORRELATION_ID.toLowerCase()] || requestId;

    // Attach to request
    req.requestId = requestId;
    req.correlationId = correlationId;
    req.clientIP = getClientIP(req);
    req.startTime = Date.now();

    // Set response headers
    res.setHeader(HEADERS.REQUEST_ID, requestId);
    res.setHeader(HEADERS.CORRELATION_ID, correlationId);

    // Log request start
    const requestLog = {
      type: 'request',
      requestId,
      correlationId,
      method: req.method,
      path: req.path,
      query: Object.keys(req.query).length > 0 ? req.query : undefined,
      ip: req.clientIP,
      userAgent: getUserAgentInfo(req),
      userId: req.user?.id,
      businessId: req.user?.businessId,
      contentLength: req.headers['content-length'],
      contentType: req.headers['content-type'],
    };

    // Log request body for non-GET requests
    if (req.method !== 'GET' && req.body) {
      requestLog.body = sanitizeBody(req.body);
    }

    logger.info('Incoming request', requestLog);

    // Capture response
    const originalSend = res.send;
    let responseBody;

    res.send = function (body) {
      responseBody = body;
      return originalSend.call(this, body);
    };

    // Log response when finished
    res.on('finish', () => {
      const duration = Date.now() - req.startTime;
      const isError = res.statusCode >= 400;
      const isSlow = duration > config.slowRequestThreshold;

      const responseLog = {
        type: 'response',
        requestId,
        correlationId,
        method: req.method,
        path: req.path,
        statusCode: res.statusCode,
        duration,
        contentLength: res.get('content-length'),
        userId: req.user?.id,
      };

      // Log error responses
      if (isError && config.logErrorResponse && responseBody) {
        try {
          responseLog.response = typeof responseBody === 'string'
            ? JSON.parse(responseBody)
            : responseBody;
        } catch {
          responseLog.response = responseBody?.toString().substring(0, 500);
        }
      }

      // Determine log level
      let logLevel = 'info';
      if (res.statusCode >= 500) {
        logLevel = 'error';
      } else if (res.statusCode >= 400) {
        logLevel = 'warn';
      } else if (isSlow) {
        logLevel = 'warn';
        responseLog.slow = true;
      }

      logger[logLevel]('Request completed', responseLog);

      // Record metrics
      performanceMonitor.recordRequest(
        duration,
        res.statusCode,
        req.route?.path || req.path,
        req.method
      );
    });

    next();
  };
}

/**
 * Error logging middleware
 */
function errorLogger(options = {}) {
  return (error, req, res, next) => {
    const errorLog = {
      type: 'error',
      requestId: req.requestId,
      correlationId: req.correlationId,
      method: req.method,
      path: req.path,
      userId: req.user?.id,
      error: {
        name: error.name,
        message: error.message,
        code: error.code,
        statusCode: error.statusCode || error.status,
        stack: process.env.NODE_ENV !== 'production' ? error.stack : undefined,
      },
    };

    logger.error('Request error', errorLog);

    next(error);
  };
}

/**
 * Access log format for reverse proxy
 */
function accessLogFormat(tokens, req, res) {
  return [
    tokens['remote-addr'](req, res),
    '-',
    tokens['remote-user'](req, res),
    `[${tokens.date(req, res, 'clf')}]`,
    `"${tokens.method(req, res)} ${tokens.url(req, res)} HTTP/${tokens['http-version'](req, res)}"`,
    tokens.status(req, res),
    tokens.res(req, res, 'content-length'),
    `"${tokens.referrer(req, res)}"`,
    `"${tokens['user-agent'](req, res)}"`,
    tokens['response-time'](req, res),
    'ms',
    req.requestId || '-',
  ].join(' ');
}

/**
 * Audit log middleware for sensitive operations
 */
function auditLogger(options = {}) {
  const { operations = [], auditService } = options;

  return async (req, res, next) => {
    const shouldAudit = operations.some((op) => {
      const [method, path] = op.split(' ');
      return req.method === method && req.path.match(new RegExp(path));
    });

    if (!shouldAudit) {
      return next();
    }

    // Capture response for audit
    const originalSend = res.send;

    res.send = async function (body) {
      // Log audit event
      if (auditService && res.statusCode < 400) {
        try {
          await auditService.logFromRequest(req, `api.${req.method.toLowerCase()}`, {
            resourceType: req.path.split('/')[3], // e.g., /api/v1/users -> users
            resourceId: req.params.id,
            action: req.method,
            metadata: {
              query: req.query,
              body: sanitizeBody(req.body),
            },
          });
        } catch (error) {
          logger.error('Audit logging failed', { error: error.message });
        }
      }

      return originalSend.call(this, body);
    };

    next();
  };
}

/**
 * Request context middleware
 */
function requestContext() {
  return (req, res, next) => {
    // Build request context object
    req.context = {
      requestId: req.requestId,
      correlationId: req.correlationId,
      timestamp: new Date().toISOString(),
      ip: req.clientIP,
      userAgent: req.headers['user-agent'],
      userId: req.user?.id,
      businessId: req.user?.businessId,
      sessionId: req.sessionID,
    };

    // Helper to get logger with context
    req.logger = {
      info: (message, meta = {}) => logger.info(message, { ...req.context, ...meta }),
      warn: (message, meta = {}) => logger.warn(message, { ...req.context, ...meta }),
      error: (message, meta = {}) => logger.error(message, { ...req.context, ...meta }),
      debug: (message, meta = {}) => logger.debug(message, { ...req.context, ...meta }),
    };

    next();
  };
}

module.exports = {
  requestLogger,
  errorLogger,
  accessLogFormat,
  auditLogger,
  requestContext,
  getClientIP,
  sanitizeBody,
  HEADERS,
};
