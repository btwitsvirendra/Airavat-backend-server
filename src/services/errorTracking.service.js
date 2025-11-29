// =============================================================================
// AIRAVAT B2B MARKETPLACE - ERROR TRACKING SERVICE
// Error tracking, monitoring, and alerting integration
// =============================================================================

const logger = require('../config/logger');

/**
 * Error severity levels
 */
const SEVERITY = {
  DEBUG: 'debug',
  INFO: 'info',
  WARNING: 'warning',
  ERROR: 'error',
  FATAL: 'fatal',
};

/**
 * Error categories
 */
const CATEGORIES = {
  AUTHENTICATION: 'authentication',
  AUTHORIZATION: 'authorization',
  VALIDATION: 'validation',
  DATABASE: 'database',
  EXTERNAL_SERVICE: 'external_service',
  PAYMENT: 'payment',
  BUSINESS_LOGIC: 'business_logic',
  SYSTEM: 'system',
  UNKNOWN: 'unknown',
};

class ErrorTrackingService {
  constructor() {
    this.isInitialized = false;
    this.errorQueue = [];
    this.errorCounts = new Map();
    this.samplingRate = parseFloat(process.env.ERROR_SAMPLING_RATE) || 1.0;
    this.maxQueueSize = 100;
    this.flushInterval = null;
  }

  /**
   * Initialize error tracking (Sentry integration)
   */
  init(options = {}) {
    if (this.isInitialized) return;

    const dsn = options.dsn || process.env.SENTRY_DSN;

    if (dsn) {
      try {
        const Sentry = require('@sentry/node');
        const { ProfilingIntegration } = require('@sentry/profiling-node');

        Sentry.init({
          dsn,
          environment: process.env.NODE_ENV || 'development',
          release: process.env.npm_package_version,
          tracesSampleRate: options.tracesSampleRate || 0.1,
          profilesSampleRate: options.profilesSampleRate || 0.1,
          integrations: [
            new ProfilingIntegration(),
          ],
          beforeSend: (event, hint) => {
            return this.beforeSend(event, hint);
          },
        });

        this.sentry = Sentry;
        logger.info('Sentry error tracking initialized');
      } catch (error) {
        logger.warn('Sentry not available, using fallback error tracking', {
          error: error.message,
        });
      }
    }

    // Start flush interval for queued errors
    this.flushInterval = setInterval(() => this.flushQueue(), 60000);

    this.isInitialized = true;
  }

  /**
   * Pre-process error before sending
   */
  beforeSend(event, hint) {
    // Remove sensitive data
    if (event.request?.headers) {
      delete event.request.headers.authorization;
      delete event.request.headers.cookie;
    }

    // Rate limit similar errors
    const errorKey = `${event.exception?.values?.[0]?.type}:${event.exception?.values?.[0]?.value}`;
    const count = this.errorCounts.get(errorKey) || 0;

    if (count > 10) {
      // Sample errors after threshold
      if (Math.random() > 0.1) {
        return null;
      }
    }

    this.errorCounts.set(errorKey, count + 1);

    return event;
  }

  /**
   * Capture an exception
   */
  captureException(error, context = {}) {
    // Apply sampling
    if (Math.random() > this.samplingRate) {
      return;
    }

    const errorData = this.formatError(error, context);

    // Log the error
    logger.error('Exception captured', {
      message: error.message,
      stack: error.stack,
      ...context,
    });

    // Send to Sentry if available
    if (this.sentry) {
      this.sentry.withScope((scope) => {
        // Set context
        if (context.user) {
          scope.setUser({
            id: context.user.id,
            email: context.user.email,
          });
        }

        if (context.tags) {
          Object.entries(context.tags).forEach(([key, value]) => {
            scope.setTag(key, value);
          });
        }

        if (context.extra) {
          Object.entries(context.extra).forEach(([key, value]) => {
            scope.setExtra(key, value);
          });
        }

        scope.setLevel(context.severity || SEVERITY.ERROR);

        this.sentry.captureException(error);
      });
    } else {
      // Queue for batch processing
      this.queueError(errorData);
    }
  }

  /**
   * Capture a message
   */
  captureMessage(message, context = {}) {
    const severity = context.severity || SEVERITY.INFO;

    logger[severity === SEVERITY.ERROR ? 'error' : 'info'](message, context);

    if (this.sentry) {
      this.sentry.withScope((scope) => {
        if (context.tags) {
          Object.entries(context.tags).forEach(([key, value]) => {
            scope.setTag(key, value);
          });
        }

        scope.setLevel(severity);
        this.sentry.captureMessage(message);
      });
    }
  }

  /**
   * Format error for storage/transmission
   */
  formatError(error, context = {}) {
    return {
      id: this.generateErrorId(),
      timestamp: new Date().toISOString(),
      message: error.message,
      name: error.name,
      stack: error.stack,
      code: error.code,
      category: this.categorizeError(error),
      severity: context.severity || SEVERITY.ERROR,
      user: context.user ? {
        id: context.user.id,
        email: context.user.email,
      } : null,
      request: context.request ? {
        method: context.request.method,
        path: context.request.path,
        query: context.request.query,
        ip: context.request.ip,
      } : null,
      tags: context.tags || {},
      extra: context.extra || {},
      environment: process.env.NODE_ENV,
      release: process.env.npm_package_version,
    };
  }

  /**
   * Generate unique error ID
   */
  generateErrorId() {
    return `err_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * Categorize error
   */
  categorizeError(error) {
    const message = error.message?.toLowerCase() || '';
    const name = error.name?.toLowerCase() || '';

    if (name.includes('authentication') || message.includes('unauthorized')) {
      return CATEGORIES.AUTHENTICATION;
    }

    if (name.includes('authorization') || message.includes('forbidden')) {
      return CATEGORIES.AUTHORIZATION;
    }

    if (name.includes('validation') || error.isJoi) {
      return CATEGORIES.VALIDATION;
    }

    if (name.includes('prisma') || message.includes('database')) {
      return CATEGORIES.DATABASE;
    }

    if (message.includes('timeout') || message.includes('econnrefused')) {
      return CATEGORIES.EXTERNAL_SERVICE;
    }

    if (message.includes('payment') || message.includes('razorpay')) {
      return CATEGORIES.PAYMENT;
    }

    return CATEGORIES.UNKNOWN;
  }

  /**
   * Queue error for batch processing
   */
  queueError(errorData) {
    this.errorQueue.push(errorData);

    if (this.errorQueue.length >= this.maxQueueSize) {
      this.flushQueue();
    }
  }

  /**
   * Flush error queue
   */
  async flushQueue() {
    if (this.errorQueue.length === 0) return;

    const errors = this.errorQueue.splice(0, this.maxQueueSize);

    try {
      // Store errors in database
      const { prisma } = require('../config/database');
      await prisma.errorLog.createMany({
        data: errors.map((err) => ({
          errorId: err.id,
          message: err.message,
          stack: err.stack,
          category: err.category,
          severity: err.severity,
          userId: err.user?.id,
          metadata: {
            request: err.request,
            tags: err.tags,
            extra: err.extra,
          },
          timestamp: new Date(err.timestamp),
        })),
        skipDuplicates: true,
      });
    } catch (error) {
      logger.error('Failed to flush error queue', { error: error.message });
      // Re-queue errors
      this.errorQueue.unshift(...errors);
    }
  }

  /**
   * Set user context
   */
  setUser(user) {
    if (this.sentry) {
      this.sentry.setUser({
        id: user.id,
        email: user.email,
        username: user.email,
      });
    }
  }

  /**
   * Clear user context
   */
  clearUser() {
    if (this.sentry) {
      this.sentry.setUser(null);
    }
  }

  /**
   * Set tag
   */
  setTag(key, value) {
    if (this.sentry) {
      this.sentry.setTag(key, value);
    }
  }

  /**
   * Add breadcrumb
   */
  addBreadcrumb(breadcrumb) {
    if (this.sentry) {
      this.sentry.addBreadcrumb(breadcrumb);
    }
  }

  /**
   * Start transaction (for performance monitoring)
   */
  startTransaction(options) {
    if (this.sentry) {
      return this.sentry.startTransaction(options);
    }
    return null;
  }

  /**
   * Express error handler middleware
   */
  errorHandler() {
    return (error, req, res, next) => {
      this.captureException(error, {
        user: req.user,
        request: req,
        tags: {
          path: req.path,
          method: req.method,
        },
      });

      next(error);
    };
  }

  /**
   * Express request handler middleware
   */
  requestHandler() {
    if (this.sentry) {
      return this.sentry.Handlers.requestHandler();
    }
    return (req, res, next) => next();
  }

  /**
   * Express tracing middleware
   */
  tracingHandler() {
    if (this.sentry) {
      return this.sentry.Handlers.tracingHandler();
    }
    return (req, res, next) => next();
  }

  /**
   * Get error statistics
   */
  async getStatistics(days = 7) {
    try {
      const { prisma } = require('../config/database');
      const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

      const [total, byCategory, bySeverity, topErrors] = await Promise.all([
        prisma.errorLog.count({
          where: { timestamp: { gte: since } },
        }),
        prisma.errorLog.groupBy({
          by: ['category'],
          where: { timestamp: { gte: since } },
          _count: true,
        }),
        prisma.errorLog.groupBy({
          by: ['severity'],
          where: { timestamp: { gte: since } },
          _count: true,
        }),
        prisma.errorLog.groupBy({
          by: ['message'],
          where: { timestamp: { gte: since } },
          _count: true,
          orderBy: { _count: { message: 'desc' } },
          take: 10,
        }),
      ]);

      return {
        period: `${days} days`,
        total,
        byCategory: byCategory.reduce((acc, c) => ({ ...acc, [c.category]: c._count }), {}),
        bySeverity: bySeverity.reduce((acc, s) => ({ ...acc, [s.severity]: s._count }), {}),
        topErrors: topErrors.map((e) => ({ message: e.message, count: e._count })),
      };
    } catch (error) {
      logger.error('Failed to get error statistics', { error: error.message });
      return { error: 'Statistics unavailable' };
    }
  }

  /**
   * Clean up old error logs
   */
  async cleanup(daysToKeep = 30) {
    try {
      const { prisma } = require('../config/database');
      const cutoff = new Date(Date.now() - daysToKeep * 24 * 60 * 60 * 1000);

      const result = await prisma.errorLog.deleteMany({
        where: { timestamp: { lt: cutoff } },
      });

      logger.info(`Cleaned up ${result.count} old error logs`);
      return result.count;
    } catch (error) {
      logger.error('Failed to cleanup error logs', { error: error.message });
      return 0;
    }
  }

  /**
   * Shutdown
   */
  async shutdown() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }

    // Flush remaining errors
    await this.flushQueue();

    if (this.sentry) {
      await this.sentry.close(2000);
    }

    // Clear error counts
    this.errorCounts.clear();
  }
}

// Export singleton
const errorTracking = new ErrorTrackingService();

module.exports = {
  errorTracking,
  SEVERITY,
  CATEGORIES,
};
