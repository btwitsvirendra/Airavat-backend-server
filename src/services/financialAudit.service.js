// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL AUDIT SERVICE
// Comprehensive audit logging for financial operations
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const crypto = require('crypto');

// =============================================================================
// CONFIGURATION
// =============================================================================

const AUDIT_CONFIG = {
  retentionDays: 2555, // 7 years for financial records
  sensitiveFields: ['cardNumber', 'cvv', 'pin', 'password', 'accountNumber'],
  hashAlgorithm: 'sha256',
  categories: {
    WALLET: 'wallet',
    EMI: 'emi',
    FACTORING: 'factoring',
    TRADE_FINANCE: 'trade_finance',
    CASHBACK: 'cashback',
    VIRTUAL_CARD: 'virtual_card',
    BANK_INTEGRATION: 'bank_integration',
    INSURANCE: 'insurance',
    RECONCILIATION: 'reconciliation',
    ADMIN: 'admin',
  },
  severityLevels: {
    INFO: 'INFO',
    WARNING: 'WARNING',
    CRITICAL: 'CRITICAL',
  },
};

// =============================================================================
// AUDIT LOGGING FUNCTIONS
// =============================================================================

/**
 * Create audit log entry
 */
exports.log = async (params) => {
  const {
    category,
    action,
    entityType,
    entityId,
    userId,
    businessId,
    severity = 'INFO',
    details = {},
    metadata = {},
    ipAddress,
    userAgent,
  } = params;

  try {
    // Mask sensitive fields
    const sanitizedDetails = maskSensitiveData(details);
    const sanitizedMetadata = maskSensitiveData(metadata);

    // Generate integrity hash
    const integrityHash = generateIntegrityHash({
      category,
      action,
      entityType,
      entityId,
      userId,
      details: sanitizedDetails,
      timestamp: new Date().toISOString(),
    });

    const auditEntry = await prisma.financialAuditLog.create({
      data: {
        category,
        action,
        entityType,
        entityId,
        userId,
        businessId,
        severity,
        details: sanitizedDetails,
        metadata: sanitizedMetadata,
        ipAddress,
        userAgent,
        integrityHash,
        createdAt: new Date(),
      },
    });

    // Log to application logger as well
    logger.info('Financial audit log', {
      auditId: auditEntry.id,
      category,
      action,
      entityType,
      entityId,
      userId,
      severity,
    });

    return auditEntry;
  } catch (error) {
    // Never fail silently for audit logs - log error but don't throw
    logger.error('Failed to create audit log', {
      error: error.message,
      params: { category, action, entityType, entityId },
    });
    return null;
  }
};

/**
 * Log wallet operation
 */
exports.logWalletOperation = async (operation, walletId, userId, details, options = {}) => {
  return this.log({
    category: AUDIT_CONFIG.categories.WALLET,
    action: operation,
    entityType: 'wallet',
    entityId: walletId,
    userId,
    severity: getSeverityForOperation(operation),
    details: {
      ...details,
      operation,
      walletId,
    },
    ...options,
  });
};

/**
 * Log EMI operation
 */
exports.logEMIOperation = async (operation, emiOrderId, userId, details, options = {}) => {
  return this.log({
    category: AUDIT_CONFIG.categories.EMI,
    action: operation,
    entityType: 'emi_order',
    entityId: emiOrderId,
    userId,
    severity: getSeverityForOperation(operation),
    details: {
      ...details,
      operation,
      emiOrderId,
    },
    ...options,
  });
};

/**
 * Log factoring operation
 */
exports.logFactoringOperation = async (operation, applicationId, userId, details, options = {}) => {
  return this.log({
    category: AUDIT_CONFIG.categories.FACTORING,
    action: operation,
    entityType: 'factoring_application',
    entityId: applicationId,
    userId,
    severity: getSeverityForOperation(operation),
    details: {
      ...details,
      operation,
      applicationId,
    },
    ...options,
  });
};

/**
 * Log trade finance operation
 */
exports.logTradeFinanceOperation = async (operation, lcId, userId, details, options = {}) => {
  return this.log({
    category: AUDIT_CONFIG.categories.TRADE_FINANCE,
    action: operation,
    entityType: 'letter_of_credit',
    entityId: lcId,
    userId,
    severity: getSeverityForOperation(operation),
    details: {
      ...details,
      operation,
      lcId,
    },
    ...options,
  });
};

/**
 * Log virtual card operation
 */
exports.logCardOperation = async (operation, cardId, userId, details, options = {}) => {
  return this.log({
    category: AUDIT_CONFIG.categories.VIRTUAL_CARD,
    action: operation,
    entityType: 'virtual_card',
    entityId: cardId,
    userId,
    severity: getSeverityForOperation(operation),
    details: {
      ...details,
      operation,
      cardId,
    },
    ...options,
  });
};

/**
 * Log insurance operation
 */
exports.logInsuranceOperation = async (operation, entityId, entityType, userId, details, options = {}) => {
  return this.log({
    category: AUDIT_CONFIG.categories.INSURANCE,
    action: operation,
    entityType,
    entityId,
    userId,
    severity: getSeverityForOperation(operation),
    details: {
      ...details,
      operation,
    },
    ...options,
  });
};

/**
 * Log admin action
 */
exports.logAdminAction = async (action, adminId, targetEntity, details, options = {}) => {
  return this.log({
    category: AUDIT_CONFIG.categories.ADMIN,
    action,
    entityType: targetEntity.type,
    entityId: targetEntity.id,
    userId: adminId,
    severity: 'WARNING', // Admin actions are always at least WARNING
    details: {
      ...details,
      adminId,
      targetEntity,
    },
    ...options,
  });
};

// =============================================================================
// QUERY FUNCTIONS
// =============================================================================

/**
 * Get audit logs with filters
 */
exports.getAuditLogs = async (filters = {}, pagination = {}) => {
  const {
    category,
    action,
    entityType,
    entityId,
    userId,
    businessId,
    severity,
    startDate,
    endDate,
    searchTerm,
  } = filters;

  const { page = 1, limit = 50 } = pagination;

  const where = {};

  if (category) where.category = category;
  if (action) where.action = action;
  if (entityType) where.entityType = entityType;
  if (entityId) where.entityId = entityId;
  if (userId) where.userId = userId;
  if (businessId) where.businessId = businessId;
  if (severity) where.severity = severity;

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  // For text search in details (requires JSON search capability)
  if (searchTerm) {
    where.OR = [
      { action: { contains: searchTerm, mode: 'insensitive' } },
      { entityId: { contains: searchTerm, mode: 'insensitive' } },
    ];
  }

  const [logs, total] = await Promise.all([
    prisma.financialAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
      include: {
        user: {
          select: { id: true, name: true, email: true },
        },
      },
    }),
    prisma.financialAuditLog.count({ where }),
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
};

/**
 * Get audit trail for specific entity
 */
exports.getEntityAuditTrail = async (entityType, entityId) => {
  const logs = await prisma.financialAuditLog.findMany({
    where: {
      entityType,
      entityId,
    },
    orderBy: { createdAt: 'desc' },
    include: {
      user: {
        select: { id: true, name: true, email: true },
      },
    },
  });

  return {
    entityType,
    entityId,
    auditTrail: logs,
    firstAction: logs[logs.length - 1],
    lastAction: logs[0],
    totalActions: logs.length,
  };
};

/**
 * Get user activity log
 */
exports.getUserActivityLog = async (userId, options = {}) => {
  const { startDate, endDate, category, page = 1, limit = 50 } = options;

  const where = { userId };

  if (category) where.category = category;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const [logs, total, summary] = await Promise.all([
    prisma.financialAuditLog.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      skip: (page - 1) * limit,
      take: limit,
    }),
    prisma.financialAuditLog.count({ where }),
    prisma.financialAuditLog.groupBy({
      by: ['category', 'action'],
      where,
      _count: true,
    }),
  ]);

  return {
    userId,
    logs,
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    activitySummary: summary.map(s => ({
      category: s.category,
      action: s.action,
      count: s._count,
    })),
  };
};

// =============================================================================
// AUDIT STATISTICS
// =============================================================================

/**
 * Get audit statistics
 */
exports.getAuditStats = async (period = 30) => {
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - period);

  const [
    totalLogs,
    bySeverity,
    byCategory,
    byDay,
    criticalEvents,
  ] = await Promise.all([
    prisma.financialAuditLog.count({
      where: { createdAt: { gte: startDate } },
    }),

    prisma.financialAuditLog.groupBy({
      by: ['severity'],
      where: { createdAt: { gte: startDate } },
      _count: true,
    }),

    prisma.financialAuditLog.groupBy({
      by: ['category'],
      where: { createdAt: { gte: startDate } },
      _count: true,
    }),

    prisma.$queryRaw`
      SELECT DATE(created_at) as date, COUNT(*) as count
      FROM financial_audit_logs
      WHERE created_at >= ${startDate}
      GROUP BY DATE(created_at)
      ORDER BY date DESC
      LIMIT 30
    `,

    prisma.financialAuditLog.findMany({
      where: {
        severity: 'CRITICAL',
        createdAt: { gte: startDate },
      },
      orderBy: { createdAt: 'desc' },
      take: 10,
    }),
  ]);

  return {
    period: { days: period, startDate, endDate: new Date() },
    totalLogs,
    bySeverity: bySeverity.reduce((acc, s) => {
      acc[s.severity] = s._count;
      return acc;
    }, {}),
    byCategory: byCategory.reduce((acc, c) => {
      acc[c.category] = c._count;
      return acc;
    }, {}),
    dailyTrend: byDay,
    recentCriticalEvents: criticalEvents,
  };
};

// =============================================================================
// INTEGRITY VERIFICATION
// =============================================================================

/**
 * Verify audit log integrity
 */
exports.verifyIntegrity = async (auditLogId) => {
  const log = await prisma.financialAuditLog.findUnique({
    where: { id: auditLogId },
  });

  if (!log) {
    return { valid: false, reason: 'Log not found' };
  }

  const computedHash = generateIntegrityHash({
    category: log.category,
    action: log.action,
    entityType: log.entityType,
    entityId: log.entityId,
    userId: log.userId,
    details: log.details,
    timestamp: log.createdAt.toISOString(),
  });

  const isValid = computedHash === log.integrityHash;

  return {
    valid: isValid,
    auditLogId,
    storedHash: log.integrityHash,
    computedHash,
    reason: isValid ? 'Integrity verified' : 'Hash mismatch - possible tampering',
  };
};

/**
 * Verify integrity of all logs in a date range
 */
exports.verifyBulkIntegrity = async (startDate, endDate) => {
  const logs = await prisma.financialAuditLog.findMany({
    where: {
      createdAt: {
        gte: new Date(startDate),
        lte: new Date(endDate),
      },
    },
    select: {
      id: true,
      category: true,
      action: true,
      entityType: true,
      entityId: true,
      userId: true,
      details: true,
      createdAt: true,
      integrityHash: true,
    },
  });

  let valid = 0;
  let invalid = 0;
  const invalidLogs = [];

  for (const log of logs) {
    const computedHash = generateIntegrityHash({
      category: log.category,
      action: log.action,
      entityType: log.entityType,
      entityId: log.entityId,
      userId: log.userId,
      details: log.details,
      timestamp: log.createdAt.toISOString(),
    });

    if (computedHash === log.integrityHash) {
      valid++;
    } else {
      invalid++;
      invalidLogs.push(log.id);
    }
  }

  return {
    period: { startDate, endDate },
    totalChecked: logs.length,
    valid,
    invalid,
    integrityRate: logs.length > 0 ? Math.round((valid / logs.length) * 100) : 100,
    invalidLogIds: invalidLogs,
  };
};

// =============================================================================
// CLEANUP FUNCTIONS
// =============================================================================

/**
 * Archive old audit logs
 */
exports.archiveOldLogs = async () => {
  const retentionDate = new Date();
  retentionDate.setDate(retentionDate.getDate() - AUDIT_CONFIG.retentionDays);

  // In production, you would move these to cold storage before deletion
  const oldLogs = await prisma.financialAuditLog.findMany({
    where: { createdAt: { lt: retentionDate } },
    select: { id: true },
  });

  if (oldLogs.length === 0) {
    return { archived: 0 };
  }

  // Log the archival action
  await this.log({
    category: AUDIT_CONFIG.categories.ADMIN,
    action: 'AUDIT_LOG_ARCHIVE',
    entityType: 'system',
    entityId: 'financial_audit_logs',
    severity: 'WARNING',
    details: {
      logsToArchive: oldLogs.length,
      retentionDate,
    },
  });

  logger.info('Archived old audit logs', { count: oldLogs.length });

  return { archived: oldLogs.length };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Mask sensitive data in object
 */
function maskSensitiveData(obj) {
  if (!obj || typeof obj !== 'object') return obj;

  const masked = Array.isArray(obj) ? [...obj] : { ...obj };

  for (const key of Object.keys(masked)) {
    if (AUDIT_CONFIG.sensitiveFields.some(f => key.toLowerCase().includes(f.toLowerCase()))) {
      if (typeof masked[key] === 'string') {
        masked[key] = maskString(masked[key]);
      } else {
        masked[key] = '***MASKED***';
      }
    } else if (typeof masked[key] === 'object' && masked[key] !== null) {
      masked[key] = maskSensitiveData(masked[key]);
    }
  }

  return masked;
}

/**
 * Mask string keeping first and last chars
 */
function maskString(str) {
  if (!str || str.length < 4) return '****';
  return `${str.slice(0, 2)}${'*'.repeat(str.length - 4)}${str.slice(-2)}`;
}

/**
 * Generate integrity hash for audit entry
 */
function generateIntegrityHash(data) {
  const payload = JSON.stringify(data, Object.keys(data).sort());
  return crypto
    .createHash(AUDIT_CONFIG.hashAlgorithm)
    .update(payload)
    .digest('hex');
}

/**
 * Get severity level for operation type
 */
function getSeverityForOperation(operation) {
  const criticalOps = [
    'WITHDRAWAL', 'LARGE_TRANSFER', 'CARD_DEACTIVATE', 'POLICY_CANCEL',
    'CLAIM_SETTLE', 'LC_PAYMENT', 'FORECLOSURE', 'LIMIT_OVERRIDE',
  ];

  const warningOps = [
    'TRANSFER', 'DEBIT', 'CREATE', 'UPDATE', 'DELETE', 'APPROVE',
    'REJECT', 'LOCK', 'UNLOCK', 'AMENDMENT',
  ];

  if (criticalOps.includes(operation.toUpperCase())) {
    return AUDIT_CONFIG.severityLevels.CRITICAL;
  }
  if (warningOps.includes(operation.toUpperCase())) {
    return AUDIT_CONFIG.severityLevels.WARNING;
  }
  return AUDIT_CONFIG.severityLevels.INFO;
}

module.exports = exports;
