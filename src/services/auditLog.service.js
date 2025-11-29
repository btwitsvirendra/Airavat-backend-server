// =============================================================================
// AIRAVAT B2B MARKETPLACE - AUDIT LOG SERVICE
// Comprehensive Activity Logging & Compliance Tracking
// =============================================================================

const { prisma } = require('../config/database');
const { cache, getPublisher } = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} = require('../utils/errors');

// =============================================================================
// CONSTANTS
// =============================================================================

const AUDIT_CATEGORY = {
  AUTH: 'AUTH',
  USER: 'USER',
  BUSINESS: 'BUSINESS',
  ORDER: 'ORDER',
  PRODUCT: 'PRODUCT',
  PAYMENT: 'PAYMENT',
  DOCUMENT: 'DOCUMENT',
  SETTINGS: 'SETTINGS',
  SECURITY: 'SECURITY',
  ADMIN: 'ADMIN',
  SYSTEM: 'SYSTEM',
};

const AUDIT_ACTION = {
  // Auth
  LOGIN: 'LOGIN',
  LOGOUT: 'LOGOUT',
  LOGIN_FAILED: 'LOGIN_FAILED',
  PASSWORD_CHANGED: 'PASSWORD_CHANGED',
  PASSWORD_RESET: 'PASSWORD_RESET',
  TWO_FA_ENABLED: 'TWO_FA_ENABLED',
  TWO_FA_DISABLED: 'TWO_FA_DISABLED',
  // User
  USER_CREATED: 'USER_CREATED',
  USER_UPDATED: 'USER_UPDATED',
  USER_DELETED: 'USER_DELETED',
  PROFILE_UPDATED: 'PROFILE_UPDATED',
  EMAIL_VERIFIED: 'EMAIL_VERIFIED',
  PHONE_VERIFIED: 'PHONE_VERIFIED',
  // Business
  BUSINESS_CREATED: 'BUSINESS_CREATED',
  BUSINESS_UPDATED: 'BUSINESS_UPDATED',
  BUSINESS_VERIFIED: 'BUSINESS_VERIFIED',
  BUSINESS_SUSPENDED: 'BUSINESS_SUSPENDED',
  // Order
  ORDER_CREATED: 'ORDER_CREATED',
  ORDER_UPDATED: 'ORDER_UPDATED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  ORDER_COMPLETED: 'ORDER_COMPLETED',
  // Product
  PRODUCT_CREATED: 'PRODUCT_CREATED',
  PRODUCT_UPDATED: 'PRODUCT_UPDATED',
  PRODUCT_DELETED: 'PRODUCT_DELETED',
  PRODUCT_PUBLISHED: 'PRODUCT_PUBLISHED',
  // Payment
  PAYMENT_INITIATED: 'PAYMENT_INITIATED',
  PAYMENT_COMPLETED: 'PAYMENT_COMPLETED',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  REFUND_INITIATED: 'REFUND_INITIATED',
  REFUND_COMPLETED: 'REFUND_COMPLETED',
  // Document
  DOCUMENT_UPLOADED: 'DOCUMENT_UPLOADED',
  DOCUMENT_VIEWED: 'DOCUMENT_VIEWED',
  DOCUMENT_DOWNLOADED: 'DOCUMENT_DOWNLOADED',
  DOCUMENT_DELETED: 'DOCUMENT_DELETED',
  DOCUMENT_SHARED: 'DOCUMENT_SHARED',
  // Settings
  SETTINGS_UPDATED: 'SETTINGS_UPDATED',
  PERMISSIONS_CHANGED: 'PERMISSIONS_CHANGED',
  // Security
  IP_BLOCKED: 'IP_BLOCKED',
  IP_UNBLOCKED: 'IP_UNBLOCKED',
  SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
  ACCOUNT_LOCKED: 'ACCOUNT_LOCKED',
  ACCOUNT_UNLOCKED: 'ACCOUNT_UNLOCKED',
  // Admin
  ADMIN_ACTION: 'ADMIN_ACTION',
  DATA_EXPORT: 'DATA_EXPORT',
  BULK_OPERATION: 'BULK_OPERATION',
};

const SEVERITY = {
  INFO: 'INFO',
  WARNING: 'WARNING',
  ERROR: 'ERROR',
  CRITICAL: 'CRITICAL',
};

const RETENTION_DAYS = {
  INFO: 90,
  WARNING: 180,
  ERROR: 365,
  CRITICAL: 730, // 2 years
};

// =============================================================================
// AUDIT LOG CREATION
// =============================================================================

/**
 * Create audit log entry
 * @param {Object} logData - Audit log data
 * @returns {Promise<Object>} Created log entry
 */
const log = async (logData) => {
  const {
    userId,
    businessId,
    category,
    action,
    resourceType,
    resourceId,
    description,
    oldValue,
    newValue,
    metadata = {},
    ip,
    userAgent,
    severity = SEVERITY.INFO,
  } = logData;

  // Sanitize sensitive data
  const sanitizedOldValue = sanitizeData(oldValue);
  const sanitizedNewValue = sanitizeData(newValue);

  // Calculate changes
  const changes = oldValue && newValue ? calculateChanges(oldValue, newValue) : null;

  const auditLog = await prisma.auditLog.create({
    data: {
      userId,
      businessId,
      category,
      action,
      resourceType,
      resourceId,
      description: description || `${action} on ${resourceType || 'resource'}`,
      oldValue: sanitizedOldValue,
      newValue: sanitizedNewValue,
      changes,
      metadata,
      ip,
      userAgent,
      severity,
      timestamp: new Date(),
    },
  });

  // Log to application logger for high severity
  if (severity === SEVERITY.ERROR || severity === SEVERITY.CRITICAL) {
    logger.warn('Audit: High severity event', {
      auditId: auditLog.id,
      action,
      category,
      userId,
      businessId,
    });
  }

  // Publish for real-time monitoring
  const publisher = getPublisher();
  if (publisher) {
    publisher.publish('audit:event', JSON.stringify({
      id: auditLog.id,
      action,
      category,
      severity,
      userId,
      businessId,
      timestamp: auditLog.timestamp,
    })).catch(() => {});
  }

  return auditLog;
};

/**
 * Log authentication event
 * @param {Object} eventData - Event data
 * @returns {Promise<Object>} Log entry
 */
const logAuth = async (eventData) => {
  return log({
    ...eventData,
    category: AUDIT_CATEGORY.AUTH,
  });
};

/**
 * Log order event
 * @param {Object} eventData - Event data
 * @returns {Promise<Object>} Log entry
 */
const logOrder = async (eventData) => {
  return log({
    ...eventData,
    category: AUDIT_CATEGORY.ORDER,
    resourceType: 'order',
  });
};

/**
 * Log payment event
 * @param {Object} eventData - Event data
 * @returns {Promise<Object>} Log entry
 */
const logPayment = async (eventData) => {
  return log({
    ...eventData,
    category: AUDIT_CATEGORY.PAYMENT,
    resourceType: 'payment',
    severity: eventData.action.includes('FAILED') ? SEVERITY.ERROR : SEVERITY.INFO,
  });
};

/**
 * Log security event
 * @param {Object} eventData - Event data
 * @returns {Promise<Object>} Log entry
 */
const logSecurity = async (eventData) => {
  return log({
    ...eventData,
    category: AUDIT_CATEGORY.SECURITY,
    severity: SEVERITY.WARNING,
  });
};

/**
 * Log admin action
 * @param {Object} eventData - Event data
 * @returns {Promise<Object>} Log entry
 */
const logAdmin = async (eventData) => {
  return log({
    ...eventData,
    category: AUDIT_CATEGORY.ADMIN,
    severity: SEVERITY.WARNING,
  });
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Sanitize sensitive data
 * @param {any} data - Data to sanitize
 * @returns {any} Sanitized data
 */
const sanitizeData = (data) => {
  if (!data) return null;

  const sensitiveFields = [
    'password',
    'passwordHash',
    'token',
    'secret',
    'apiKey',
    'encryptionKey',
    'cardNumber',
    'cvv',
    'pan',
    'aadhaar',
  ];

  const sanitize = (obj) => {
    if (typeof obj !== 'object' || obj === null) {
      return obj;
    }

    if (Array.isArray(obj)) {
      return obj.map(sanitize);
    }

    const sanitized = {};
    for (const [key, value] of Object.entries(obj)) {
      if (sensitiveFields.some((f) => key.toLowerCase().includes(f.toLowerCase()))) {
        sanitized[key] = '[REDACTED]';
      } else if (typeof value === 'object') {
        sanitized[key] = sanitize(value);
      } else {
        sanitized[key] = value;
      }
    }
    return sanitized;
  };

  return sanitize(data);
};

/**
 * Calculate changes between old and new values
 * @param {Object} oldValue - Old value
 * @param {Object} newValue - New value
 * @returns {Array} Changes array
 */
const calculateChanges = (oldValue, newValue) => {
  const changes = [];

  if (typeof oldValue !== 'object' || typeof newValue !== 'object') {
    return [{ field: 'value', from: oldValue, to: newValue }];
  }

  const allKeys = new Set([...Object.keys(oldValue || {}), ...Object.keys(newValue || {})]);

  for (const key of allKeys) {
    const oldVal = oldValue?.[key];
    const newVal = newValue?.[key];

    if (JSON.stringify(oldVal) !== JSON.stringify(newVal)) {
      changes.push({
        field: key,
        from: oldVal,
        to: newVal,
      });
    }
  }

  return changes;
};

// =============================================================================
// AUDIT LOG QUERIES
// =============================================================================

/**
 * Get audit logs
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated audit logs
 */
const getLogs = async (options = {}) => {
  const {
    page = 1,
    limit = 50,
    userId,
    businessId,
    category,
    action,
    resourceType,
    resourceId,
    severity,
    startDate,
    endDate,
    search,
  } = options;
  const skip = (page - 1) * limit;

  const where = {};

  if (userId) where.userId = userId;
  if (businessId) where.businessId = businessId;
  if (category) where.category = category;
  if (action) where.action = action;
  if (resourceType) where.resourceType = resourceType;
  if (resourceId) where.resourceId = resourceId;
  if (severity) where.severity = severity;

  if (startDate || endDate) {
    where.timestamp = {};
    if (startDate) where.timestamp.gte = new Date(startDate);
    if (endDate) where.timestamp.lte = new Date(endDate);
  }

  if (search) {
    where.OR = [
      { description: { contains: search, mode: 'insensitive' } },
      { action: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [logs, total] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true, email: true } },
        business: { select: { businessName: true } },
      },
      skip,
      take: limit,
      orderBy: { timestamp: 'desc' },
    }),
    prisma.auditLog.count({ where }),
  ]);

  return {
    logs,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get audit log by ID
 * @param {string} logId - Audit log ID
 * @returns {Promise<Object>} Audit log
 */
const getLog = async (logId) => {
  const log = await prisma.auditLog.findUnique({
    where: { id: logId },
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      business: { select: { businessName: true } },
    },
  });

  if (!log) {
    throw new NotFoundError('Audit log');
  }

  return log;
};

/**
 * Get logs for a specific resource
 * @param {string} resourceType - Resource type
 * @param {string} resourceId - Resource ID
 * @param {Object} options - Query options
 * @returns {Promise<Array>} Audit logs
 */
const getResourceLogs = async (resourceType, resourceId, options = {}) => {
  const { limit = 50 } = options;

  return prisma.auditLog.findMany({
    where: { resourceType, resourceId },
    include: {
      user: { select: { firstName: true, lastName: true } },
    },
    take: limit,
    orderBy: { timestamp: 'desc' },
  });
};

/**
 * Get user activity
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} User activity logs
 */
const getUserActivity = async (userId, options = {}) => {
  const { page = 1, limit = 50, days = 30 } = options;
  const skip = (page - 1) * limit;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const where = {
    userId,
    timestamp: { gte: startDate },
  };

  const [logs, total, summary] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      skip,
      take: limit,
      orderBy: { timestamp: 'desc' },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({
      by: ['action'],
      where,
      _count: true,
    }),
  ]);

  return {
    logs,
    summary: summary.map((s) => ({ action: s.action, count: s._count })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get business activity
 * @param {string} businessId - Business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Business activity logs
 */
const getBusinessActivity = async (businessId, options = {}) => {
  const { page = 1, limit = 50, days = 30 } = options;
  const skip = (page - 1) * limit;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const where = {
    businessId,
    timestamp: { gte: startDate },
  };

  const [logs, total, byCategory] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: {
        user: { select: { firstName: true, lastName: true } },
      },
      skip,
      take: limit,
      orderBy: { timestamp: 'desc' },
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({
      by: ['category'],
      where,
      _count: true,
    }),
  ]);

  return {
    logs,
    byCategory: byCategory.map((c) => ({ category: c.category, count: c._count })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// =============================================================================
// ANALYTICS & REPORTING
// =============================================================================

/**
 * Get audit statistics
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Audit statistics
 */
const getStatistics = async (options = {}) => {
  const { days = 30, businessId } = options;
  const startDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const where = {
    timestamp: { gte: startDate },
  };
  if (businessId) where.businessId = businessId;

  const [total, bySeverity, byCategory, byDay] = await Promise.all([
    prisma.auditLog.count({ where }),
    prisma.auditLog.groupBy({
      by: ['severity'],
      where,
      _count: true,
    }),
    prisma.auditLog.groupBy({
      by: ['category'],
      where,
      _count: true,
    }),
    prisma.$queryRaw`
      SELECT DATE(timestamp) as date, COUNT(*) as count
      FROM "AuditLog"
      WHERE timestamp >= ${startDate}
      ${businessId ? `AND "businessId" = ${businessId}` : ''}
      GROUP BY DATE(timestamp)
      ORDER BY date DESC
    `.catch(() => []),
  ]);

  return {
    total,
    bySeverity: bySeverity.reduce((acc, s) => ({ ...acc, [s.severity]: s._count }), {}),
    byCategory: byCategory.reduce((acc, c) => ({ ...acc, [c.category]: c._count }), {}),
    byDay,
    period: { days, startDate, endDate: new Date() },
  };
};

/**
 * Export audit logs
 * @param {Object} options - Export options
 * @returns {Promise<Object>} Export result
 */
const exportLogs = async (options) => {
  const { format = 'json', ...queryOptions } = options;

  // Get logs without pagination
  const logs = await prisma.auditLog.findMany({
    where: buildWhereClause(queryOptions),
    include: {
      user: { select: { firstName: true, lastName: true, email: true } },
      business: { select: { businessName: true } },
    },
    orderBy: { timestamp: 'desc' },
    take: 10000, // Limit for export
  });

  // Log export action
  await logAdmin({
    userId: options.exportedBy,
    action: AUDIT_ACTION.DATA_EXPORT,
    description: `Exported ${logs.length} audit logs`,
    metadata: { format, count: logs.length, filters: queryOptions },
  });

  return {
    count: logs.length,
    logs,
    format,
    exportedAt: new Date(),
  };
};

/**
 * Build where clause from options
 * @param {Object} options - Query options
 * @returns {Object} Prisma where clause
 */
const buildWhereClause = (options) => {
  const where = {};

  if (options.userId) where.userId = options.userId;
  if (options.businessId) where.businessId = options.businessId;
  if (options.category) where.category = options.category;
  if (options.action) where.action = options.action;
  if (options.severity) where.severity = options.severity;

  if (options.startDate || options.endDate) {
    where.timestamp = {};
    if (options.startDate) where.timestamp.gte = new Date(options.startDate);
    if (options.endDate) where.timestamp.lte = new Date(options.endDate);
  }

  return where;
};

// =============================================================================
// CLEANUP
// =============================================================================

/**
 * Cleanup old audit logs based on retention policy
 * @returns {Promise<Object>} Cleanup result
 */
const cleanup = async () => {
  const results = {};

  for (const [severity, days] of Object.entries(RETENTION_DAYS)) {
    const cutoffDate = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const deleted = await prisma.auditLog.deleteMany({
      where: {
        severity,
        timestamp: { lt: cutoffDate },
      },
    });

    results[severity] = deleted.count;
  }

  const total = Object.values(results).reduce((a, b) => a + b, 0);

  logger.info('Audit log cleanup completed', { deleted: total, details: results });

  return { deleted: total, details: results };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  // Constants
  AUDIT_CATEGORY,
  AUDIT_ACTION,
  SEVERITY,
  // Logging
  log,
  logAuth,
  logOrder,
  logPayment,
  logSecurity,
  logAdmin,
  // Queries
  getLogs,
  getLog,
  getResourceLogs,
  getUserActivity,
  getBusinessActivity,
  // Analytics
  getStatistics,
  exportLogs,
  // Cleanup
  cleanup,
  // Helpers
  sanitizeData,
  calculateChanges,
};
