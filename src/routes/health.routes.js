// =============================================================================
// AIRAVAT B2B MARKETPLACE - HEALTH CHECK
// System health monitoring endpoints
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const elasticsearchService = require('../services/elasticsearch.service');
const logger = require('../config/logger');

class HealthCheck {
  /**
   * Check database connectivity
   */
  async checkDatabase() {
    const start = Date.now();
    try {
      await prisma.$queryRaw`SELECT 1`;
      return {
        status: 'healthy',
        responseTime: Date.now() - start,
      };
    } catch (error) {
      logger.error('Database health check failed', { error: error.message });
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime: Date.now() - start,
      };
    }
  }

  /**
   * Check Redis connectivity
   */
  async checkRedis() {
    const start = Date.now();
    try {
      await cache.ping();
      return {
        status: 'healthy',
        responseTime: Date.now() - start,
      };
    } catch (error) {
      logger.error('Redis health check failed', { error: error.message });
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime: Date.now() - start,
      };
    }
  }

  /**
   * Check Elasticsearch connectivity
   */
  async checkElasticsearch() {
    const start = Date.now();
    try {
      const health = await elasticsearchService.healthCheck();
      return {
        status: health.status === 'green' || health.status === 'yellow' ? 'healthy' : 'degraded',
        clusterStatus: health.status,
        responseTime: Date.now() - start,
      };
    } catch (error) {
      logger.error('Elasticsearch health check failed', { error: error.message });
      return {
        status: 'unhealthy',
        error: error.message,
        responseTime: Date.now() - start,
      };
    }
  }

  /**
   * Check memory usage
   */
  checkMemory() {
    const used = process.memoryUsage();
    const heapUsedPercent = (used.heapUsed / used.heapTotal) * 100;

    return {
      status: heapUsedPercent < 90 ? 'healthy' : 'degraded',
      heapUsed: Math.round(used.heapUsed / 1024 / 1024),
      heapTotal: Math.round(used.heapTotal / 1024 / 1024),
      heapUsedPercent: Math.round(heapUsedPercent),
      rss: Math.round(used.rss / 1024 / 1024),
      external: Math.round(used.external / 1024 / 1024),
    };
  }

  /**
   * Check CPU usage
   */
  checkCPU() {
    const cpus = require('os').cpus();
    let totalIdle = 0;
    let totalTick = 0;

    cpus.forEach((cpu) => {
      for (const type in cpu.times) {
        totalTick += cpu.times[type];
      }
      totalIdle += cpu.times.idle;
    });

    const idle = totalIdle / cpus.length;
    const total = totalTick / cpus.length;
    const usage = 100 - Math.round((idle / total) * 100);

    return {
      status: usage < 80 ? 'healthy' : 'degraded',
      usage,
      cores: cpus.length,
    };
  }

  /**
   * Check disk space (if available)
   */
  async checkDisk() {
    try {
      const { execSync } = require('child_process');
      const output = execSync("df -h / | tail -1 | awk '{print $5}'").toString().trim();
      const usedPercent = parseInt(output.replace('%', ''), 10);

      return {
        status: usedPercent < 85 ? 'healthy' : 'degraded',
        usedPercent,
      };
    } catch (error) {
      return {
        status: 'unknown',
        error: 'Unable to check disk space',
      };
    }
  }

  /**
   * Get system uptime
   */
  getUptime() {
    return {
      process: Math.round(process.uptime()),
      system: require('os').uptime(),
    };
  }

  /**
   * Full health check
   */
  async getFullHealth() {
    const [database, redis, elasticsearch] = await Promise.all([
      this.checkDatabase(),
      this.checkRedis(),
      this.checkElasticsearch(),
    ]);

    const memory = this.checkMemory();
    const cpu = this.checkCPU();
    const disk = await this.checkDisk();
    const uptime = this.getUptime();

    // Determine overall status
    const statuses = [database.status, redis.status, elasticsearch.status, memory.status, cpu.status];
    let overallStatus = 'healthy';

    if (statuses.includes('unhealthy')) {
      overallStatus = 'unhealthy';
    } else if (statuses.includes('degraded')) {
      overallStatus = 'degraded';
    }

    return {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      version: require('../../package.json').version,
      environment: process.env.NODE_ENV,
      uptime,
      services: {
        database,
        redis,
        elasticsearch,
      },
      system: {
        memory,
        cpu,
        disk,
      },
    };
  }

  /**
   * Simple liveness check
   */
  async getLiveness() {
    return {
      status: 'alive',
      timestamp: new Date().toISOString(),
    };
  }

  /**
   * Readiness check (ready to accept traffic)
   */
  async getReadiness() {
    const database = await this.checkDatabase();

    if (database.status === 'unhealthy') {
      return {
        status: 'not_ready',
        reason: 'Database unavailable',
        timestamp: new Date().toISOString(),
      };
    }

    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  }
}

// Express router for health endpoints
const express = require('express');
const router = express.Router();
const healthCheck = new HealthCheck();

/**
 * @swagger
 * /health:
 *   get:
 *     summary: Full health check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Health status
 */
router.get('/', async (req, res) => {
  const health = await healthCheck.getFullHealth();
  const statusCode = health.status === 'healthy' ? 200 : health.status === 'degraded' ? 200 : 503;
  res.status(statusCode).json(health);
});

/**
 * @swagger
 * /health/live:
 *   get:
 *     summary: Liveness probe
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is alive
 */
router.get('/live', async (req, res) => {
  const liveness = await healthCheck.getLiveness();
  res.json(liveness);
});

/**
 * @swagger
 * /health/ready:
 *   get:
 *     summary: Readiness probe
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Service is ready
 *       503:
 *         description: Service is not ready
 */
router.get('/ready', async (req, res) => {
  const readiness = await healthCheck.getReadiness();
  const statusCode = readiness.status === 'ready' ? 200 : 503;
  res.status(statusCode).json(readiness);
});

module.exports = { router, HealthCheck };
