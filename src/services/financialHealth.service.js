// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL HEALTH CHECK SERVICE
// Health monitoring for financial services
// =============================================================================

const { prisma } = require('../config/database');
const { redis } = require('../config/redis');
const logger = require('../config/logger');

// =============================================================================
// CONFIGURATION
// =============================================================================

const HEALTH_THRESHOLDS = {
  pendingWithdrawals: {
    warning: 10,
    critical: 50,
  },
  overdueInstallments: {
    warning: 20,
    critical: 100,
  },
  failedTransactions: {
    warning: 5, // percentage
    critical: 10,
  },
  reconciliationMatchRate: {
    warning: 80, // percentage
    critical: 60,
  },
  insuranceClaimsPending: {
    warning: 30,
    critical: 100,
  },
  lcExpiringSoon: {
    warning: 5,
    critical: 20,
  },
};

// =============================================================================
// HEALTH CHECK FUNCTIONS
// =============================================================================

/**
 * Get overall financial system health
 */
exports.getSystemHealth = async () => {
  const checks = await Promise.all([
    checkDatabaseHealth(),
    checkRedisHealth(),
    checkWalletHealth(),
    checkEMIHealth(),
    checkInsuranceHealth(),
    checkTradeFinanceHealth(),
    checkReconciliationHealth(),
  ]);

  const healthStatus = {
    database: checks[0],
    redis: checks[1],
    wallet: checks[2],
    emi: checks[3],
    insurance: checks[4],
    tradeFinance: checks[5],
    reconciliation: checks[6],
  };

  // Determine overall status
  const statuses = Object.values(healthStatus).map(h => h.status);
  let overallStatus = 'healthy';
  if (statuses.includes('critical')) {
    overallStatus = 'critical';
  } else if (statuses.includes('warning')) {
    overallStatus = 'warning';
  }

  return {
    status: overallStatus,
    timestamp: new Date(),
    services: healthStatus,
    summary: {
      healthy: statuses.filter(s => s === 'healthy').length,
      warning: statuses.filter(s => s === 'warning').length,
      critical: statuses.filter(s => s === 'critical').length,
    },
  };
};

/**
 * Check database health
 */
async function checkDatabaseHealth() {
  try {
    const start = Date.now();
    await prisma.$queryRaw`SELECT 1`;
    const latency = Date.now() - start;

    return {
      status: latency < 100 ? 'healthy' : latency < 500 ? 'warning' : 'critical',
      latency,
      message: 'Database connection OK',
    };
  } catch (error) {
    logger.error('Database health check failed', { error: error.message });
    return {
      status: 'critical',
      message: `Database error: ${error.message}`,
    };
  }
}

/**
 * Check Redis health
 */
async function checkRedisHealth() {
  try {
    if (!redis) {
      return {
        status: 'warning',
        message: 'Redis not configured',
      };
    }

    const start = Date.now();
    await redis.ping();
    const latency = Date.now() - start;

    return {
      status: latency < 50 ? 'healthy' : latency < 200 ? 'warning' : 'critical',
      latency,
      message: 'Redis connection OK',
    };
  } catch (error) {
    logger.error('Redis health check failed', { error: error.message });
    return {
      status: 'critical',
      message: `Redis error: ${error.message}`,
    };
  }
}

/**
 * Check wallet service health
 */
async function checkWalletHealth() {
  try {
    const [pendingWithdrawals, failedTransactions, totalTransactions] = await Promise.all([
      prisma.walletTransaction.count({
        where: {
          type: 'WITHDRAWAL',
          status: 'PENDING',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.walletTransaction.count({
        where: {
          status: 'FAILED',
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
      prisma.walletTransaction.count({
        where: {
          createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const failedRate = totalTransactions > 0 ? (failedTransactions / totalTransactions) * 100 : 0;

    let status = 'healthy';
    const issues = [];

    if (pendingWithdrawals >= HEALTH_THRESHOLDS.pendingWithdrawals.critical) {
      status = 'critical';
      issues.push(`${pendingWithdrawals} pending withdrawals`);
    } else if (pendingWithdrawals >= HEALTH_THRESHOLDS.pendingWithdrawals.warning) {
      status = 'warning';
      issues.push(`${pendingWithdrawals} pending withdrawals`);
    }

    if (failedRate >= HEALTH_THRESHOLDS.failedTransactions.critical) {
      status = 'critical';
      issues.push(`${failedRate.toFixed(1)}% failed transactions`);
    } else if (failedRate >= HEALTH_THRESHOLDS.failedTransactions.warning) {
      if (status !== 'critical') status = 'warning';
      issues.push(`${failedRate.toFixed(1)}% failed transactions`);
    }

    return {
      status,
      metrics: {
        pendingWithdrawals,
        failedTransactions,
        totalTransactions,
        failedRate: `${failedRate.toFixed(2)}%`,
      },
      issues: issues.length > 0 ? issues : undefined,
      message: issues.length > 0 ? issues.join(', ') : 'Wallet service healthy',
    };
  } catch (error) {
    logger.error('Wallet health check failed', { error: error.message });
    return {
      status: 'critical',
      message: `Wallet check error: ${error.message}`,
    };
  }
}

/**
 * Check EMI service health
 */
async function checkEMIHealth() {
  try {
    const [overdueCount, activeOrders, defaultedOrders] = await Promise.all([
      prisma.eMIInstallment.count({
        where: { status: 'OVERDUE' },
      }),
      prisma.eMIOrder.count({
        where: { status: 'ACTIVE' },
      }),
      prisma.eMIOrder.count({
        where: { status: 'DEFAULTED' },
      }),
    ]);

    let status = 'healthy';
    const issues = [];

    if (overdueCount >= HEALTH_THRESHOLDS.overdueInstallments.critical) {
      status = 'critical';
      issues.push(`${overdueCount} overdue installments`);
    } else if (overdueCount >= HEALTH_THRESHOLDS.overdueInstallments.warning) {
      status = 'warning';
      issues.push(`${overdueCount} overdue installments`);
    }

    return {
      status,
      metrics: {
        overdueInstallments: overdueCount,
        activeOrders,
        defaultedOrders,
      },
      issues: issues.length > 0 ? issues : undefined,
      message: issues.length > 0 ? issues.join(', ') : 'EMI service healthy',
    };
  } catch (error) {
    logger.error('EMI health check failed', { error: error.message });
    return {
      status: 'critical',
      message: `EMI check error: ${error.message}`,
    };
  }
}

/**
 * Check insurance service health
 */
async function checkInsuranceHealth() {
  try {
    const [pendingClaims, activePolicies, expiringPolicies] = await Promise.all([
      prisma.insuranceClaim.count({
        where: { status: { in: ['SUBMITTED', 'UNDER_REVIEW'] } },
      }),
      prisma.creditInsurancePolicy.count({
        where: { status: 'ACTIVE' },
      }),
      prisma.creditInsurancePolicy.count({
        where: {
          status: 'ACTIVE',
          endDate: {
            lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
            gte: new Date(),
          },
        },
      }),
    ]);

    let status = 'healthy';
    const issues = [];

    if (pendingClaims >= HEALTH_THRESHOLDS.insuranceClaimsPending.critical) {
      status = 'critical';
      issues.push(`${pendingClaims} pending claims`);
    } else if (pendingClaims >= HEALTH_THRESHOLDS.insuranceClaimsPending.warning) {
      status = 'warning';
      issues.push(`${pendingClaims} pending claims`);
    }

    return {
      status,
      metrics: {
        pendingClaims,
        activePolicies,
        expiringPolicies,
      },
      issues: issues.length > 0 ? issues : undefined,
      message: issues.length > 0 ? issues.join(', ') : 'Insurance service healthy',
    };
  } catch (error) {
    logger.error('Insurance health check failed', { error: error.message });
    return {
      status: 'critical',
      message: `Insurance check error: ${error.message}`,
    };
  }
}

/**
 * Check trade finance service health
 */
async function checkTradeFinanceHealth() {
  try {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

    const [activeLCs, expiringSoon, pendingAmendments] = await Promise.all([
      prisma.letterOfCredit.count({
        where: { status: { in: ['ISSUED', 'ADVISED', 'CONFIRMED'] } },
      }),
      prisma.letterOfCredit.count({
        where: {
          status: { notIn: ['EXPIRED', 'PAID', 'CANCELLED'] },
          expiryDate: { lte: sevenDaysFromNow, gte: new Date() },
        },
      }),
      prisma.lCAmendment.count({
        where: { status: 'REQUESTED' },
      }),
    ]);

    let status = 'healthy';
    const issues = [];

    if (expiringSoon >= HEALTH_THRESHOLDS.lcExpiringSoon.critical) {
      status = 'critical';
      issues.push(`${expiringSoon} LCs expiring within 7 days`);
    } else if (expiringSoon >= HEALTH_THRESHOLDS.lcExpiringSoon.warning) {
      status = 'warning';
      issues.push(`${expiringSoon} LCs expiring within 7 days`);
    }

    return {
      status,
      metrics: {
        activeLCs,
        expiringSoon,
        pendingAmendments,
      },
      issues: issues.length > 0 ? issues : undefined,
      message: issues.length > 0 ? issues.join(', ') : 'Trade finance service healthy',
    };
  } catch (error) {
    logger.error('Trade finance health check failed', { error: error.message });
    return {
      status: 'critical',
      message: `Trade finance check error: ${error.message}`,
    };
  }
}

/**
 * Check reconciliation service health
 */
async function checkReconciliationHealth() {
  try {
    const [recentBatches, unmatchedItems] = await Promise.all([
      prisma.reconciliationBatch.findMany({
        where: { status: 'COMPLETED' },
        orderBy: { completedAt: 'desc' },
        take: 5,
        select: { matchRate: true },
      }),
      prisma.reconciliationItem.count({
        where: { status: 'UNMATCHED' },
      }),
    ]);

    const avgMatchRate = recentBatches.length > 0
      ? recentBatches.reduce((sum, b) => sum + parseFloat(b.matchRate || 0), 0) / recentBatches.length
      : 100;

    let status = 'healthy';
    const issues = [];

    if (avgMatchRate < HEALTH_THRESHOLDS.reconciliationMatchRate.critical) {
      status = 'critical';
      issues.push(`Low match rate: ${avgMatchRate.toFixed(1)}%`);
    } else if (avgMatchRate < HEALTH_THRESHOLDS.reconciliationMatchRate.warning) {
      status = 'warning';
      issues.push(`Match rate below target: ${avgMatchRate.toFixed(1)}%`);
    }

    return {
      status,
      metrics: {
        averageMatchRate: `${avgMatchRate.toFixed(1)}%`,
        unmatchedItems,
        recentBatchesAnalyzed: recentBatches.length,
      },
      issues: issues.length > 0 ? issues : undefined,
      message: issues.length > 0 ? issues.join(', ') : 'Reconciliation service healthy',
    };
  } catch (error) {
    logger.error('Reconciliation health check failed', { error: error.message });
    return {
      status: 'critical',
      message: `Reconciliation check error: ${error.message}`,
    };
  }
}

// =============================================================================
// MONITORING ENDPOINTS
// =============================================================================

/**
 * Get critical alerts
 */
exports.getCriticalAlerts = async () => {
  const alerts = [];

  // Check for suspended wallets with balance
  const suspendedWalletsWithBalance = await prisma.wallet.count({
    where: {
      status: 'SUSPENDED',
      balance: { gt: 0 },
    },
  });
  if (suspendedWalletsWithBalance > 0) {
    alerts.push({
      type: 'SUSPENDED_WALLETS_WITH_BALANCE',
      severity: 'high',
      count: suspendedWalletsWithBalance,
      message: `${suspendedWalletsWithBalance} suspended wallets have balance`,
    });
  }

  // Check for long-pending withdrawals
  const longPendingWithdrawals = await prisma.walletTransaction.count({
    where: {
      type: 'WITHDRAWAL',
      status: 'PENDING',
      createdAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) },
    },
  });
  if (longPendingWithdrawals > 0) {
    alerts.push({
      type: 'LONG_PENDING_WITHDRAWALS',
      severity: 'high',
      count: longPendingWithdrawals,
      message: `${longPendingWithdrawals} withdrawals pending for over 24 hours`,
    });
  }

  // Check for defaulted EMI orders
  const recentDefaults = await prisma.eMIOrder.count({
    where: {
      status: 'DEFAULTED',
      updatedAt: { gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000) },
    },
  });
  if (recentDefaults > 0) {
    alerts.push({
      type: 'RECENT_EMI_DEFAULTS',
      severity: 'medium',
      count: recentDefaults,
      message: `${recentDefaults} EMI orders defaulted in past 7 days`,
    });
  }

  // Check for expired LCs not marked
  const expiredUnmarked = await prisma.letterOfCredit.count({
    where: {
      status: { notIn: ['EXPIRED', 'PAID', 'CANCELLED'] },
      expiryDate: { lt: new Date() },
    },
  });
  if (expiredUnmarked > 0) {
    alerts.push({
      type: 'EXPIRED_LCS_NOT_MARKED',
      severity: 'high',
      count: expiredUnmarked,
      message: `${expiredUnmarked} LCs are expired but not marked`,
    });
  }

  return {
    totalAlerts: alerts.length,
    alerts,
    timestamp: new Date(),
  };
};

/**
 * Get financial metrics summary
 */
exports.getMetricsSummary = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [
    todayTransactions,
    todayVolume,
    activeWallets,
    totalBalance,
    activeEMIs,
    activePolicies,
    activeLCs,
  ] = await Promise.all([
    prisma.walletTransaction.count({
      where: { createdAt: { gte: today } },
    }),
    prisma.walletTransaction.aggregate({
      where: { createdAt: { gte: today }, status: 'COMPLETED' },
      _sum: { amount: true },
    }),
    prisma.wallet.count({ where: { status: 'ACTIVE' } }),
    prisma.wallet.aggregate({
      where: { status: 'ACTIVE' },
      _sum: { balance: true },
    }),
    prisma.eMIOrder.count({ where: { status: 'ACTIVE' } }),
    prisma.creditInsurancePolicy.count({ where: { status: 'ACTIVE' } }),
    prisma.letterOfCredit.count({
      where: { status: { in: ['ISSUED', 'ADVISED', 'CONFIRMED'] } },
    }),
  ]);

  return {
    today: {
      transactions: todayTransactions,
      volume: parseFloat(todayVolume._sum.amount || 0),
    },
    wallet: {
      activeCount: activeWallets,
      totalBalance: parseFloat(totalBalance._sum.balance || 0),
    },
    emi: {
      activeOrders: activeEMIs,
    },
    insurance: {
      activePolicies,
    },
    tradeFinance: {
      activeLCs,
    },
    timestamp: new Date(),
  };
};

module.exports = exports;
