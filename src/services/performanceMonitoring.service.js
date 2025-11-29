// =============================================================================
// AIRAVAT B2B MARKETPLACE - PERFORMANCE MONITORING SERVICE
// APM, error tracking, and system health monitoring
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const os = require('os');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Performance thresholds
 */
const THRESHOLDS = {
  RESPONSE_TIME: {
    GOOD: 200,      // < 200ms
    ACCEPTABLE: 500, // 200-500ms
    SLOW: 1000,     // 500-1000ms
    CRITICAL: 3000, // > 3000ms
  },
  CPU: {
    NORMAL: 70,     // < 70%
    HIGH: 85,       // 70-85%
    CRITICAL: 95,   // > 95%
  },
  MEMORY: {
    NORMAL: 70,
    HIGH: 85,
    CRITICAL: 95,
  },
  ERROR_RATE: {
    NORMAL: 1,      // < 1%
    HIGH: 5,        // 1-5%
    CRITICAL: 10,   // > 10%
  },
};

/**
 * Metrics storage (in-memory for speed, persist periodically)
 */
const metricsBuffer = {
  requests: [],
  errors: [],
  dbQueries: [],
  cacheHits: 0,
  cacheMisses: 0,
};

// =============================================================================
// REQUEST TRACKING
// =============================================================================

/**
 * Track a request
 * @param {Object} data - Request data
 */
exports.trackRequest = (data) => {
  const {
    requestId,
    method,
    path,
    statusCode,
    responseTime,
    userId,
    businessId,
    ip,
    userAgent,
  } = data;

  const metric = {
    requestId,
    method,
    path,
    statusCode,
    responseTime,
    userId,
    businessId,
    ip,
    userAgent,
    timestamp: new Date(),
  };

  metricsBuffer.requests.push(metric);

  // Keep buffer size manageable
  if (metricsBuffer.requests.length > 10000) {
    metricsBuffer.requests = metricsBuffer.requests.slice(-5000);
  }

  // Log slow requests
  if (responseTime > THRESHOLDS.RESPONSE_TIME.SLOW) {
    logger.warn('Slow request detected', {
      path,
      method,
      responseTime,
      requestId,
    });
  }
};

/**
 * Track an error
 * @param {Object} data - Error data
 */
exports.trackError = (data) => {
  const {
    requestId,
    error,
    stack,
    path,
    method,
    userId,
    severity = 'error',
  } = data;

  const errorMetric = {
    requestId,
    error: error?.message || String(error),
    stack,
    path,
    method,
    userId,
    severity,
    timestamp: new Date(),
  };

  metricsBuffer.errors.push(errorMetric);

  // Keep buffer size manageable
  if (metricsBuffer.errors.length > 1000) {
    metricsBuffer.errors = metricsBuffer.errors.slice(-500);
  }
};

/**
 * Track database query
 * @param {Object} data - Query data
 */
exports.trackDbQuery = (data) => {
  const { query, duration, model } = data;

  metricsBuffer.dbQueries.push({
    query: query?.substring(0, 100),
    duration,
    model,
    timestamp: new Date(),
  });

  // Keep buffer size manageable
  if (metricsBuffer.dbQueries.length > 1000) {
    metricsBuffer.dbQueries = metricsBuffer.dbQueries.slice(-500);
  }

  // Log slow queries
  if (duration > 1000) {
    logger.warn('Slow database query', { model, duration });
  }
};

/**
 * Track cache hit/miss
 * @param {boolean} hit - Was it a hit
 */
exports.trackCache = (hit) => {
  if (hit) {
    metricsBuffer.cacheHits++;
  } else {
    metricsBuffer.cacheMisses++;
  }
};

// =============================================================================
// SYSTEM METRICS
// =============================================================================

/**
 * Get system health
 * @returns {Object} System health metrics
 */
exports.getSystemHealth = () => {
  const cpuUsage = getCpuUsage();
  const memoryUsage = getMemoryUsage();
  const uptime = process.uptime();

  return {
    status: determineHealthStatus(cpuUsage, memoryUsage),
    timestamp: new Date().toISOString(),
    system: {
      platform: os.platform(),
      arch: os.arch(),
      nodeVersion: process.version,
      uptime: formatUptime(uptime),
      uptimeSeconds: uptime,
    },
    cpu: {
      usage: cpuUsage,
      cores: os.cpus().length,
      model: os.cpus()[0]?.model,
      status: getCpuStatus(cpuUsage),
    },
    memory: {
      used: memoryUsage.used,
      total: memoryUsage.total,
      percentage: memoryUsage.percentage,
      status: getMemoryStatus(memoryUsage.percentage),
    },
    process: {
      pid: process.pid,
      memoryUsage: process.memoryUsage(),
      heapUsed: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotal: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
    },
  };
};

/**
 * Get API metrics
 * @param {Object} options - Query options
 * @returns {Object} API metrics
 */
exports.getApiMetrics = (options = {}) => {
  const { period = '1h' } = options;
  const cutoff = getCutoffTime(period);

  const recentRequests = metricsBuffer.requests.filter(
    (r) => new Date(r.timestamp) >= cutoff
  );
  const recentErrors = metricsBuffer.errors.filter(
    (e) => new Date(e.timestamp) >= cutoff
  );

  const totalRequests = recentRequests.length;
  const totalErrors = recentErrors.length;
  const errorRate = totalRequests > 0 ? (totalErrors / totalRequests) * 100 : 0;

  // Response time stats
  const responseTimes = recentRequests.map((r) => r.responseTime);
  const avgResponseTime = responseTimes.length > 0
    ? responseTimes.reduce((a, b) => a + b, 0) / responseTimes.length
    : 0;
  const p95ResponseTime = getPercentile(responseTimes, 95);
  const p99ResponseTime = getPercentile(responseTimes, 99);

  // Status code breakdown
  const statusCodes = recentRequests.reduce((acc, r) => {
    const category = Math.floor(r.statusCode / 100) + 'xx';
    acc[category] = (acc[category] || 0) + 1;
    return acc;
  }, {});

  // Top endpoints
  const endpointCounts = recentRequests.reduce((acc, r) => {
    const key = `${r.method} ${r.path}`;
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const topEndpoints = Object.entries(endpointCounts)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([endpoint, count]) => ({ endpoint, count }));

  // Cache stats
  const cacheTotal = metricsBuffer.cacheHits + metricsBuffer.cacheMisses;
  const cacheHitRate = cacheTotal > 0
    ? (metricsBuffer.cacheHits / cacheTotal) * 100
    : 0;

  return {
    period,
    timestamp: new Date().toISOString(),
    requests: {
      total: totalRequests,
      perMinute: totalRequests / getPeriodMinutes(period),
    },
    responseTime: {
      average: Math.round(avgResponseTime),
      p95: Math.round(p95ResponseTime),
      p99: Math.round(p99ResponseTime),
      status: getResponseTimeStatus(avgResponseTime),
    },
    errors: {
      total: totalErrors,
      rate: errorRate.toFixed(2),
      status: getErrorRateStatus(errorRate),
    },
    statusCodes,
    topEndpoints,
    cache: {
      hits: metricsBuffer.cacheHits,
      misses: metricsBuffer.cacheMisses,
      hitRate: cacheHitRate.toFixed(2),
    },
    database: {
      totalQueries: metricsBuffer.dbQueries.length,
      avgDuration: getAverageDbQueryTime(),
    },
  };
};

/**
 * Get error summary
 * @param {Object} options - Query options
 * @returns {Object} Error summary
 */
exports.getErrorSummary = (options = {}) => {
  const { period = '24h', groupBy = 'error' } = options;
  const cutoff = getCutoffTime(period);

  const recentErrors = metricsBuffer.errors.filter(
    (e) => new Date(e.timestamp) >= cutoff
  );

  // Group errors
  const grouped = recentErrors.reduce((acc, e) => {
    const key = groupBy === 'path' ? `${e.method} ${e.path}` : e.error;
    if (!acc[key]) {
      acc[key] = { count: 0, lastOccurred: null, sample: null };
    }
    acc[key].count++;
    acc[key].lastOccurred = e.timestamp;
    if (!acc[key].sample) {
      acc[key].sample = e;
    }
    return acc;
  }, {});

  const sortedErrors = Object.entries(grouped)
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, 20)
    .map(([key, data]) => ({
      [groupBy]: key,
      count: data.count,
      lastOccurred: data.lastOccurred,
      severity: data.sample?.severity,
    }));

  return {
    period,
    totalErrors: recentErrors.length,
    uniqueErrors: Object.keys(grouped).length,
    errors: sortedErrors,
    bySeverity: recentErrors.reduce((acc, e) => {
      acc[e.severity] = (acc[e.severity] || 0) + 1;
      return acc;
    }, {}),
  };
};

/**
 * Get slow endpoints
 * @returns {Object[]} Slow endpoints
 */
exports.getSlowEndpoints = () => {
  const endpointStats = {};

  metricsBuffer.requests.forEach((r) => {
    const key = `${r.method} ${r.path}`;
    if (!endpointStats[key]) {
      endpointStats[key] = { times: [], count: 0 };
    }
    endpointStats[key].times.push(r.responseTime);
    endpointStats[key].count++;
  });

  return Object.entries(endpointStats)
    .map(([endpoint, data]) => ({
      endpoint,
      count: data.count,
      avgResponseTime: Math.round(
        data.times.reduce((a, b) => a + b, 0) / data.times.length
      ),
      p95ResponseTime: Math.round(getPercentile(data.times, 95)),
      maxResponseTime: Math.max(...data.times),
    }))
    .sort((a, b) => b.avgResponseTime - a.avgResponseTime)
    .slice(0, 10);
};

// =============================================================================
// ALERTING
// =============================================================================

/**
 * Get active alerts
 * @returns {Object[]} Active alerts
 */
exports.getActiveAlerts = () => {
  const alerts = [];
  const metrics = exports.getApiMetrics({ period: '5m' });
  const health = exports.getSystemHealth();

  // High error rate
  if (parseFloat(metrics.errors.rate) > THRESHOLDS.ERROR_RATE.HIGH) {
    alerts.push({
      type: 'ERROR_RATE',
      severity: parseFloat(metrics.errors.rate) > THRESHOLDS.ERROR_RATE.CRITICAL 
        ? 'critical' 
        : 'warning',
      message: `High error rate: ${metrics.errors.rate}%`,
      value: metrics.errors.rate,
      threshold: THRESHOLDS.ERROR_RATE.HIGH,
    });
  }

  // Slow response time
  if (metrics.responseTime.average > THRESHOLDS.RESPONSE_TIME.SLOW) {
    alerts.push({
      type: 'RESPONSE_TIME',
      severity: metrics.responseTime.average > THRESHOLDS.RESPONSE_TIME.CRITICAL 
        ? 'critical' 
        : 'warning',
      message: `Slow response time: ${metrics.responseTime.average}ms`,
      value: metrics.responseTime.average,
      threshold: THRESHOLDS.RESPONSE_TIME.SLOW,
    });
  }

  // High CPU
  if (health.cpu.usage > THRESHOLDS.CPU.HIGH) {
    alerts.push({
      type: 'CPU',
      severity: health.cpu.usage > THRESHOLDS.CPU.CRITICAL ? 'critical' : 'warning',
      message: `High CPU usage: ${health.cpu.usage}%`,
      value: health.cpu.usage,
      threshold: THRESHOLDS.CPU.HIGH,
    });
  }

  // High memory
  if (health.memory.percentage > THRESHOLDS.MEMORY.HIGH) {
    alerts.push({
      type: 'MEMORY',
      severity: health.memory.percentage > THRESHOLDS.MEMORY.CRITICAL 
        ? 'critical' 
        : 'warning',
      message: `High memory usage: ${health.memory.percentage}%`,
      value: health.memory.percentage,
      threshold: THRESHOLDS.MEMORY.HIGH,
    });
  }

  return alerts;
};

// =============================================================================
// PERSISTENCE
// =============================================================================

/**
 * Persist metrics to database
 * @returns {Promise<void>}
 */
exports.persistMetrics = async () => {
  try {
    const snapshot = {
      timestamp: new Date(),
      requests: metricsBuffer.requests.length,
      errors: metricsBuffer.errors.length,
      avgResponseTime: getAverageResponseTime(),
      errorRate: getErrorRate(),
      cacheHitRate: getCacheHitRate(),
      systemHealth: exports.getSystemHealth(),
    };

    await prisma.performanceSnapshot.create({
      data: {
        data: snapshot,
        timestamp: snapshot.timestamp,
      },
    });

    logger.debug('Performance metrics persisted');
  } catch (error) {
    logger.error('Persist metrics error', { error: error.message });
  }
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getCpuUsage() {
  const cpus = os.cpus();
  let totalIdle = 0;
  let totalTick = 0;

  cpus.forEach((cpu) => {
    for (const type in cpu.times) {
      totalTick += cpu.times[type];
    }
    totalIdle += cpu.times.idle;
  });

  return Math.round(((totalTick - totalIdle) / totalTick) * 100);
}

function getMemoryUsage() {
  const total = os.totalmem();
  const free = os.freemem();
  const used = total - free;

  return {
    total: Math.round(total / 1024 / 1024 / 1024 * 100) / 100, // GB
    used: Math.round(used / 1024 / 1024 / 1024 * 100) / 100,
    free: Math.round(free / 1024 / 1024 / 1024 * 100) / 100,
    percentage: Math.round((used / total) * 100),
  };
}

function formatUptime(seconds) {
  const days = Math.floor(seconds / 86400);
  const hours = Math.floor((seconds % 86400) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${days}d ${hours}h ${minutes}m`;
}

function getCutoffTime(period) {
  const now = Date.now();
  const periods = {
    '5m': 5 * 60 * 1000,
    '1h': 60 * 60 * 1000,
    '24h': 24 * 60 * 60 * 1000,
    '7d': 7 * 24 * 60 * 60 * 1000,
  };
  return new Date(now - (periods[period] || periods['1h']));
}

function getPeriodMinutes(period) {
  const periods = { '5m': 5, '1h': 60, '24h': 1440, '7d': 10080 };
  return periods[period] || 60;
}

function getPercentile(arr, percentile) {
  if (arr.length === 0) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const index = Math.ceil((percentile / 100) * sorted.length) - 1;
  return sorted[Math.max(0, index)];
}

function getAverageResponseTime() {
  if (metricsBuffer.requests.length === 0) return 0;
  const sum = metricsBuffer.requests.reduce((a, r) => a + r.responseTime, 0);
  return Math.round(sum / metricsBuffer.requests.length);
}

function getErrorRate() {
  if (metricsBuffer.requests.length === 0) return 0;
  return (metricsBuffer.errors.length / metricsBuffer.requests.length * 100).toFixed(2);
}

function getCacheHitRate() {
  const total = metricsBuffer.cacheHits + metricsBuffer.cacheMisses;
  return total > 0 ? (metricsBuffer.cacheHits / total * 100).toFixed(2) : 0;
}

function getAverageDbQueryTime() {
  if (metricsBuffer.dbQueries.length === 0) return 0;
  const sum = metricsBuffer.dbQueries.reduce((a, q) => a + q.duration, 0);
  return Math.round(sum / metricsBuffer.dbQueries.length);
}

function determineHealthStatus(cpu, memory) {
  if (cpu > THRESHOLDS.CPU.CRITICAL || memory.percentage > THRESHOLDS.MEMORY.CRITICAL) {
    return 'critical';
  }
  if (cpu > THRESHOLDS.CPU.HIGH || memory.percentage > THRESHOLDS.MEMORY.HIGH) {
    return 'degraded';
  }
  return 'healthy';
}

function getCpuStatus(usage) {
  if (usage > THRESHOLDS.CPU.CRITICAL) return 'critical';
  if (usage > THRESHOLDS.CPU.HIGH) return 'high';
  return 'normal';
}

function getMemoryStatus(usage) {
  if (usage > THRESHOLDS.MEMORY.CRITICAL) return 'critical';
  if (usage > THRESHOLDS.MEMORY.HIGH) return 'high';
  return 'normal';
}

function getResponseTimeStatus(avgTime) {
  if (avgTime > THRESHOLDS.RESPONSE_TIME.CRITICAL) return 'critical';
  if (avgTime > THRESHOLDS.RESPONSE_TIME.SLOW) return 'slow';
  if (avgTime > THRESHOLDS.RESPONSE_TIME.ACCEPTABLE) return 'acceptable';
  return 'good';
}

function getErrorRateStatus(rate) {
  if (rate > THRESHOLDS.ERROR_RATE.CRITICAL) return 'critical';
  if (rate > THRESHOLDS.ERROR_RATE.HIGH) return 'high';
  return 'normal';
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  THRESHOLDS,
};



