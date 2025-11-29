// =============================================================================
// AIRAVAT B2B MARKETPLACE - HEALTH CHECK SERVICE
// Comprehensive health checks for all dependencies
// =============================================================================

const { prisma } = require('../config/database');
const { cache, redis } = require('../config/redis');
const logger = require('../config/logger');
const os = require('os');

/**
 * Health check status
 */
const STATUS = {
  HEALTHY: 'healthy',
  DEGRADED: 'degraded',
  UNHEALTHY: 'unhealthy',
};

/**
 * Health check thresholds
 */
const THRESHOLDS = {
  database: {
    latency: { warn: 100, critical: 500 },
  },
  redis: {
    latency: { warn: 50, critical: 200 },
  },
  memory: {
    usage: { warn: 80, critical: 95 },
  },
  cpu: {
    load: { warn: 70, critical: 90 },
  },
  disk: {
    usage: { warn: 80, critical: 95 },
  },
};

class HealthCheckService {
  constructor() {
    this.checks = new Map();
    this.lastCheckResults = new Map();
    this.checkInterval = null;
  }

  /**
   * Register a health check
   */
  registerCheck(name, checkFn, options = {}) {
    this.checks.set(name, {
      fn: checkFn,
      critical: options.critical ?? true,
      timeout: options.timeout ?? 5000,
      interval: options.interval ?? 30000,
    });
  }

  /**
   * Run all health checks
   */
  async runAllChecks() {
    const results = {
      status: STATUS.HEALTHY,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: process.uptime(),
      checks: {},
    };

    const checkPromises = [];

    for (const [name, check] of this.checks) {
      checkPromises.push(
        this.runSingleCheck(name, check)
          .then((result) => {
            results.checks[name] = result;
          })
          .catch((error) => {
            results.checks[name] = {
              status: STATUS.UNHEALTHY,
              error: error.message,
            };
          })
      );
    }

    await Promise.all(checkPromises);

    // Determine overall status
    let hasCriticalFailure = false;
    let hasDegraded = false;

    for (const [name, result] of Object.entries(results.checks)) {
      const check = this.checks.get(name);
      
      if (result.status === STATUS.UNHEALTHY) {
        if (check?.critical) {
          hasCriticalFailure = true;
        } else {
          hasDegraded = true;
        }
      } else if (result.status === STATUS.DEGRADED) {
        hasDegraded = true;
      }
    }

    if (hasCriticalFailure) {
      results.status = STATUS.UNHEALTHY;
    } else if (hasDegraded) {
      results.status = STATUS.DEGRADED;
    }

    // Cache results
    this.lastCheckResults = new Map(Object.entries(results.checks));

    return results;
  }

  /**
   * Run a single health check with timeout
   */
  async runSingleCheck(name, check) {
    const startTime = Date.now();

    try {
      const result = await Promise.race([
        check.fn(),
        new Promise((_, reject) =>
          setTimeout(() => reject(new Error('Health check timeout')), check.timeout)
        ),
      ]);

      return {
        status: result.status || STATUS.HEALTHY,
        latency: Date.now() - startTime,
        ...result,
      };
    } catch (error) {
      return {
        status: STATUS.UNHEALTHY,
        error: error.message,
        latency: Date.now() - startTime,
      };
    }
  }

  /**
   * Get cached results (for liveness probe)
   */
  getCachedResults() {
    return Object.fromEntries(this.lastCheckResults);
  }

  /**
   * Start periodic health checks
   */
  startPeriodicChecks(interval = 30000) {
    this.checkInterval = setInterval(() => {
      this.runAllChecks().catch((error) => {
        logger.error('Health check failed', { error: error.message });
      });
    }, interval);

    // Run initial check
    this.runAllChecks();
  }

  /**
   * Stop periodic health checks
   */
  stopPeriodicChecks() {
    if (this.checkInterval) {
      clearInterval(this.checkInterval);
      this.checkInterval = null;
    }
  }

  // ===========================================================================
  // BUILT-IN CHECKS
  // ===========================================================================

  /**
   * Database health check
   */
  async checkDatabase() {
    const startTime = Date.now();

    try {
      await prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - startTime;

      let status = STATUS.HEALTHY;
      if (latency > THRESHOLDS.database.latency.critical) {
        status = STATUS.UNHEALTHY;
      } else if (latency > THRESHOLDS.database.latency.warn) {
        status = STATUS.DEGRADED;
      }

      return {
        status,
        latency,
        message: 'Database connection is healthy',
      };
    } catch (error) {
      return {
        status: STATUS.UNHEALTHY,
        error: error.message,
        latency: Date.now() - startTime,
      };
    }
  }

  /**
   * Redis health check
   */
  async checkRedis() {
    const startTime = Date.now();

    try {
      await redis.ping();
      const latency = Date.now() - startTime;

      // Get additional Redis info
      const info = await redis.info('memory');
      const memoryUsed = parseInt(info.match(/used_memory:(\d+)/)?.[1] || 0);

      let status = STATUS.HEALTHY;
      if (latency > THRESHOLDS.redis.latency.critical) {
        status = STATUS.UNHEALTHY;
      } else if (latency > THRESHOLDS.redis.latency.warn) {
        status = STATUS.DEGRADED;
      }

      return {
        status,
        latency,
        memoryUsed,
        message: 'Redis connection is healthy',
      };
    } catch (error) {
      return {
        status: STATUS.UNHEALTHY,
        error: error.message,
        latency: Date.now() - startTime,
      };
    }
  }

  /**
   * Memory health check
   */
  async checkMemory() {
    const memUsage = process.memoryUsage();
    const heapUsedMB = Math.round(memUsage.heapUsed / 1024 / 1024);
    const heapTotalMB = Math.round(memUsage.heapTotal / 1024 / 1024);
    const rssMB = Math.round(memUsage.rss / 1024 / 1024);
    const heapUsagePercent = (memUsage.heapUsed / memUsage.heapTotal) * 100;

    let status = STATUS.HEALTHY;
    if (heapUsagePercent > THRESHOLDS.memory.usage.critical) {
      status = STATUS.UNHEALTHY;
    } else if (heapUsagePercent > THRESHOLDS.memory.usage.warn) {
      status = STATUS.DEGRADED;
    }

    return {
      status,
      heapUsed: heapUsedMB,
      heapTotal: heapTotalMB,
      rss: rssMB,
      heapUsagePercent: Math.round(heapUsagePercent),
      external: Math.round(memUsage.external / 1024 / 1024),
    };
  }

  /**
   * CPU health check
   */
  async checkCPU() {
    const cpus = os.cpus();
    const loadAvg = os.loadavg();
    const cpuCount = cpus.length;
    const loadPercent = (loadAvg[0] / cpuCount) * 100;

    let status = STATUS.HEALTHY;
    if (loadPercent > THRESHOLDS.cpu.load.critical) {
      status = STATUS.UNHEALTHY;
    } else if (loadPercent > THRESHOLDS.cpu.load.warn) {
      status = STATUS.DEGRADED;
    }

    return {
      status,
      loadAverage: {
        '1m': loadAvg[0].toFixed(2),
        '5m': loadAvg[1].toFixed(2),
        '15m': loadAvg[2].toFixed(2),
      },
      loadPercent: Math.round(loadPercent),
      cpuCount,
    };
  }

  /**
   * Disk health check
   */
  async checkDisk() {
    const { execSync } = require('child_process');

    try {
      // Get disk usage (Linux/Mac)
      const output = execSync("df -h / | tail -1 | awk '{print $5}'").toString().trim();
      const usagePercent = parseInt(output.replace('%', ''));

      let status = STATUS.HEALTHY;
      if (usagePercent > THRESHOLDS.disk.usage.critical) {
        status = STATUS.UNHEALTHY;
      } else if (usagePercent > THRESHOLDS.disk.usage.warn) {
        status = STATUS.DEGRADED;
      }

      return {
        status,
        usagePercent,
        message: `Disk usage is ${usagePercent}%`,
      };
    } catch (error) {
      return {
        status: STATUS.HEALTHY,
        message: 'Disk check not available',
      };
    }
  }

  /**
   * External service health check
   */
  async checkExternalService(name, url, timeout = 5000) {
    const axios = require('axios');
    const startTime = Date.now();

    try {
      await axios.get(url, { timeout });
      return {
        status: STATUS.HEALTHY,
        latency: Date.now() - startTime,
        service: name,
      };
    } catch (error) {
      return {
        status: STATUS.UNHEALTHY,
        error: error.message,
        latency: Date.now() - startTime,
        service: name,
      };
    }
  }

  /**
   * Elasticsearch health check
   */
  async checkElasticsearch() {
    try {
      const elasticsearchService = require('./elasticsearch.service');
      const health = await elasticsearchService.checkHealth();

      return {
        status: health.status === 'green' ? STATUS.HEALTHY :
                health.status === 'yellow' ? STATUS.DEGRADED : STATUS.UNHEALTHY,
        clusterName: health.clusterName,
        clusterStatus: health.status,
        nodeCount: health.nodeCount,
      };
    } catch (error) {
      return {
        status: STATUS.DEGRADED, // Non-critical
        error: error.message,
      };
    }
  }
}

// Create singleton instance
const healthCheck = new HealthCheckService();

// Register default checks
healthCheck.registerCheck('database', () => healthCheck.checkDatabase(), {
  critical: true,
  timeout: 5000,
});

healthCheck.registerCheck('redis', () => healthCheck.checkRedis(), {
  critical: true,
  timeout: 3000,
});

healthCheck.registerCheck('memory', () => healthCheck.checkMemory(), {
  critical: false,
  timeout: 1000,
});

healthCheck.registerCheck('cpu', () => healthCheck.checkCPU(), {
  critical: false,
  timeout: 1000,
});

healthCheck.registerCheck('elasticsearch', () => healthCheck.checkElasticsearch(), {
  critical: false,
  timeout: 5000,
});

/**
 * Express router for health endpoints
 */
const express = require('express');
const router = express.Router();

// Liveness probe (is the app running?)
router.get('/live', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
  });
});

// Readiness probe (is the app ready to serve traffic?)
router.get('/ready', async (req, res) => {
  const results = await healthCheck.runAllChecks();

  const statusCode = results.status === STATUS.HEALTHY ? 200 :
                     results.status === STATUS.DEGRADED ? 200 : 503;

  res.status(statusCode).json(results);
});

// Full health check
router.get('/', async (req, res) => {
  const results = await healthCheck.runAllChecks();

  const statusCode = results.status === STATUS.HEALTHY ? 200 :
                     results.status === STATUS.DEGRADED ? 200 : 503;

  res.status(statusCode).json(results);
});

// Individual check
router.get('/:check', async (req, res) => {
  const { check } = req.params;

  if (!healthCheck.checks.has(check)) {
    return res.status(404).json({ error: 'Health check not found' });
  }

  const checkConfig = healthCheck.checks.get(check);
  const result = await healthCheck.runSingleCheck(check, checkConfig);

  const statusCode = result.status === STATUS.HEALTHY ? 200 :
                     result.status === STATUS.DEGRADED ? 200 : 503;

  res.status(statusCode).json({ [check]: result });
});

module.exports = {
  healthCheck,
  router,
  STATUS,
  THRESHOLDS,
};
