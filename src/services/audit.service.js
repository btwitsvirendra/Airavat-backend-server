// =============================================================================
// AIRAVAT B2B MARKETPLACE - AUDIT LOGGING SERVICE
// Comprehensive audit trail for compliance and security
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');

class AuditService {
  // ===========================================================================
  // AUDIT EVENT TYPES
  // ===========================================================================
  
  static EVENTS = {
    // Authentication
    AUTH_LOGIN: 'auth.login',
    AUTH_LOGOUT: 'auth.logout',
    AUTH_FAILED_LOGIN: 'auth.failed_login',
    AUTH_PASSWORD_CHANGE: 'auth.password_change',
    AUTH_PASSWORD_RESET: 'auth.password_reset',
    AUTH_2FA_ENABLED: 'auth.2fa_enabled',
    AUTH_2FA_DISABLED: 'auth.2fa_disabled',
    
    // User
    USER_CREATED: 'user.created',
    USER_UPDATED: 'user.updated',
    USER_DELETED: 'user.deleted',
    USER_SUSPENDED: 'user.suspended',
    USER_ACTIVATED: 'user.activated',
    
    // Business
    BUSINESS_CREATED: 'business.created',
    BUSINESS_UPDATED: 'business.updated',
    BUSINESS_VERIFIED: 'business.verified',
    BUSINESS_REJECTED: 'business.rejected',
    BUSINESS_SUSPENDED: 'business.suspended',
    
    // Product
    PRODUCT_CREATED: 'product.created',
    PRODUCT_UPDATED: 'product.updated',
    PRODUCT_DELETED: 'product.deleted',
    PRODUCT_PUBLISHED: 'product.published',
    PRODUCT_UNPUBLISHED: 'product.unpublished',
    
    // Order
    ORDER_CREATED: 'order.created',
    ORDER_UPDATED: 'order.updated',
    ORDER_CANCELLED: 'order.cancelled',
    ORDER_SHIPPED: 'order.shipped',
    ORDER_DELIVERED: 'order.delivered',
    ORDER_REFUNDED: 'order.refunded',
    
    // Payment
    PAYMENT_INITIATED: 'payment.initiated',
    PAYMENT_COMPLETED: 'payment.completed',
    PAYMENT_FAILED: 'payment.failed',
    PAYMENT_REFUNDED: 'payment.refunded',
    
    // Admin
    ADMIN_USER_UPDATE: 'admin.user_update',
    ADMIN_BUSINESS_UPDATE: 'admin.business_update',
    ADMIN_PRODUCT_MODERATION: 'admin.product_moderation',
    ADMIN_REVIEW_MODERATION: 'admin.review_moderation',
    ADMIN_SETTINGS_CHANGE: 'admin.settings_change',
    
    // Security
    SECURITY_SUSPICIOUS_ACTIVITY: 'security.suspicious_activity',
    SECURITY_BLOCKED_REQUEST: 'security.blocked_request',
    SECURITY_API_KEY_CREATED: 'security.api_key_created',
    SECURITY_API_KEY_REVOKED: 'security.api_key_revoked',
    
    // Data
    DATA_EXPORT: 'data.export',
    DATA_IMPORT: 'data.import',
    DATA_DELETE: 'data.delete',
  };

  // ===========================================================================
  // LOG AUDIT EVENT
  // ===========================================================================

  /**
   * Log an audit event
   */
  async log(event, data = {}) {
    try {
      const {
        userId,
        businessId,
        resourceType,
        resourceId,
        action,
        oldValue,
        newValue,
        ip,
        userAgent,
        metadata = {},
      } = data;

      const auditLog = await prisma.auditLog.create({
        data: {
          event,
          userId,
          businessId,
          resourceType,
          resourceId,
          action,
          oldValue: oldValue ? JSON.stringify(oldValue) : null,
          newValue: newValue ? JSON.stringify(newValue) : null,
          ip,
          userAgent,
          metadata,
          timestamp: new Date(),
        },
      });

      // Also log to Winston for real-time monitoring
      logger.info('Audit event', {
        event,
        userId,
        resourceType,
        resourceId,
        action,
      });

      return auditLog;
    } catch (error) {
      logger.error('Failed to create audit log', { error: error.message, event });
      // Don't throw - audit logging should not break the main flow
    }
  }

  /**
   * Log from request context
   */
  async logFromRequest(req, event, data = {}) {
    return this.log(event, {
      ...data,
      userId: req.user?.id,
      businessId: req.user?.businessId,
      ip: req.clientIP || req.ip,
      userAgent: req.headers['user-agent'],
    });
  }

  // ===========================================================================
  // QUERY AUDIT LOGS
  // ===========================================================================

  /**
   * Get audit logs with filters
   */
  async getLogs(filters = {}) {
    const {
      event,
      userId,
      businessId,
      resourceType,
      resourceId,
      startDate,
      endDate,
      page = 1,
      limit = 50,
    } = filters;

    const where = {};

    if (event) where.event = event;
    if (userId) where.userId = userId;
    if (businessId) where.businessId = businessId;
    if (resourceType) where.resourceType = resourceType;
    if (resourceId) where.resourceId = resourceId;

    if (startDate || endDate) {
      where.timestamp = {};
      if (startDate) where.timestamp.gte = new Date(startDate);
      if (endDate) where.timestamp.lte = new Date(endDate);
    }

    const [logs, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        include: {
          user: {
            select: { id: true, email: true, firstName: true, lastName: true },
          },
        },
        orderBy: { timestamp: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.auditLog.count({ where }),
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get activity for a specific resource
   */
  async getResourceActivity(resourceType, resourceId, limit = 50) {
    return prisma.auditLog.findMany({
      where: { resourceType, resourceId },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  /**
   * Get user activity
   */
  async getUserActivity(userId, limit = 100) {
    return prisma.auditLog.findMany({
      where: { userId },
      orderBy: { timestamp: 'desc' },
      take: limit,
    });
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Track changes between old and new values
   */
  trackChanges(oldValue, newValue) {
    const changes = {};
    const allKeys = new Set([
      ...Object.keys(oldValue || {}),
      ...Object.keys(newValue || {}),
    ]);

    for (const key of allKeys) {
      if (JSON.stringify(oldValue?.[key]) !== JSON.stringify(newValue?.[key])) {
        changes[key] = {
          from: oldValue?.[key],
          to: newValue?.[key],
        };
      }
    }

    return Object.keys(changes).length > 0 ? changes : null;
  }

  /**
   * Create audit middleware for Express
   */
  middleware(eventType, options = {}) {
    return async (req, res, next) => {
      const originalSend = res.send;
      
      res.send = async function (body) {
        // Log after successful response
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            await auditService.logFromRequest(req, eventType, {
              resourceType: options.resourceType,
              resourceId: req.params.id || options.getResourceId?.(req),
              action: options.action || req.method,
              metadata: options.getMetadata?.(req, body),
            });
          } catch (error) {
            logger.error('Audit middleware error', { error: error.message });
          }
        }
        
        return originalSend.call(this, body);
      };

      next();
    };
  }

  // ===========================================================================
  // COMPLIANCE REPORTS
  // ===========================================================================

  /**
   * Generate compliance report
   */
  async generateComplianceReport(startDate, endDate) {
    const where = {
      timestamp: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    };

    const [
      totalEvents,
      eventsByType,
      securityEvents,
      dataEvents,
      adminActions,
    ] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.groupBy({
        by: ['event'],
        where,
        _count: true,
        orderBy: { _count: { event: 'desc' } },
      }),
      prisma.auditLog.findMany({
        where: {
          ...where,
          event: { startsWith: 'security.' },
        },
        orderBy: { timestamp: 'desc' },
      }),
      prisma.auditLog.findMany({
        where: {
          ...where,
          event: { startsWith: 'data.' },
        },
        orderBy: { timestamp: 'desc' },
      }),
      prisma.auditLog.findMany({
        where: {
          ...where,
          event: { startsWith: 'admin.' },
        },
        include: {
          user: { select: { email: true } },
        },
        orderBy: { timestamp: 'desc' },
      }),
    ]);

    return {
      period: { startDate, endDate },
      summary: {
        totalEvents,
        eventBreakdown: eventsByType,
      },
      securityEvents,
      dataAccessEvents: dataEvents,
      adminActions,
      generatedAt: new Date().toISOString(),
    };
  }

  /**
   * Get login history
   */
  async getLoginHistory(userId, days = 30) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    return prisma.auditLog.findMany({
      where: {
        userId,
        event: { in: [this.EVENTS.AUTH_LOGIN, this.EVENTS.AUTH_FAILED_LOGIN] },
        timestamp: { gte: since },
      },
      orderBy: { timestamp: 'desc' },
    });
  }
}

// Export singleton
const auditService = new AuditService();
module.exports = auditService;
