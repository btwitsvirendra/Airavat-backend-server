// =============================================================================
// AIRAVAT B2B MARKETPLACE - ADMIN METRICS ROUTES
// Expose monitoring and metrics endpoints for admins
// =============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, authorize } = require('../middleware/auth');
const performanceMonitor = require('../services/performance.service');
const { healthCheck } = require('../services/healthCheck.service');
const { errorTracking } = require('../services/errorTracking.service');
const { jobQueue, QUEUES } = require('../services/jobQueue.service');
const cacheManager = require('../services/cacheManager.service');
const dbOptimizer = require('../utils/dbOptimizer');
const logger = require('../config/logger');

// All routes require admin authentication
router.use(authenticate);
router.use(authorize('ADMIN', 'SUPER_ADMIN'));

// ===========================================================================
// SYSTEM METRICS
// ===========================================================================

/**
 * Get system overview
 */
router.get('/overview', async (req, res) => {
  try {
    const [health, performance, queues, cacheStats, dbStats] = await Promise.all([
      healthCheck.runAllChecks(),
      performanceMonitor.getMetrics(),
      jobQueue.getAllQueuesStatus(),
      cacheManager.getStats(),
      dbOptimizer.getHealthCheck(),
    ]);

    res.json({
      success: true,
      data: {
        health,
        performance: {
          requests: performance.requests,
          latency: performance.latency,
          memory: performance.memory,
          cpu: performance.cpu,
        },
        queues,
        cache: cacheStats,
        database: dbStats,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    logger.error('Failed to get system overview', { error: error.message });
    res.status(500).json({
      success: false,
      error: 'Failed to get system overview',
    });
  }
});

/**
 * Get performance metrics
 */
router.get('/performance', async (req, res) => {
  try {
    const metrics = await performanceMonitor.getMetrics();

    res.json({
      success: true,
      data: {
        ...metrics,
        timestamp: new Date().toISOString(),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get performance metrics',
    });
  }
});

/**
 * Get endpoint metrics
 */
router.get('/endpoints', async (req, res) => {
  try {
    const { slow, errors, all } = req.query;

    let endpoints = performanceMonitor.getEndpointMetrics();

    if (slow === 'true') {
      endpoints = performanceMonitor.getSlowEndpoints(
        parseInt(req.query.threshold) || 1000
      );
    }

    if (errors === 'true') {
      endpoints = performanceMonitor.getHighErrorEndpoints(
        parseFloat(req.query.threshold) || 0.05
      );
    }

    res.json({
      success: true,
      data: {
        endpoints,
        count: Object.keys(endpoints).length,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get endpoint metrics',
    });
  }
});

// ===========================================================================
// JOB QUEUE METRICS
// ===========================================================================

/**
 * Get queue status
 */
router.get('/queues', async (req, res) => {
  try {
    const statuses = await jobQueue.getAllQueuesStatus();

    res.json({
      success: true,
      data: {
        queues: statuses,
        availableQueues: Object.keys(QUEUES),
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get queue status',
    });
  }
});

/**
 * Get specific queue status
 */
router.get('/queues/:queueName', async (req, res) => {
  try {
    const { queueName } = req.params;
    const status = await jobQueue.getQueueStatus(queueName);

    if (!status) {
      return res.status(404).json({
        success: false,
        error: 'Queue not found',
      });
    }

    res.json({
      success: true,
      data: status,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get queue status',
    });
  }
});

/**
 * Pause a queue
 */
router.post('/queues/:queueName/pause', async (req, res) => {
  try {
    const { queueName } = req.params;
    await jobQueue.pauseQueue(queueName);

    res.json({
      success: true,
      message: `Queue ${queueName} paused`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to pause queue',
    });
  }
});

/**
 * Resume a queue
 */
router.post('/queues/:queueName/resume', async (req, res) => {
  try {
    const { queueName } = req.params;
    await jobQueue.resumeQueue(queueName);

    res.json({
      success: true,
      message: `Queue ${queueName} resumed`,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to resume queue',
    });
  }
});

/**
 * Retry failed jobs in a queue
 */
router.post('/queues/:queueName/retry-failed', async (req, res) => {
  try {
    const { queueName } = req.params;
    const count = await jobQueue.retryFailedJobs(queueName);

    res.json({
      success: true,
      message: `Retried ${count} failed jobs`,
      count,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to retry jobs',
    });
  }
});

/**
 * Clean a queue
 */
router.post('/queues/:queueName/clean', async (req, res) => {
  try {
    const { queueName } = req.params;
    const { type = 'completed', grace = 0 } = req.body;

    const count = await jobQueue.cleanQueue(queueName, grace, type);

    res.json({
      success: true,
      message: `Cleaned ${count} ${type} jobs`,
      count,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to clean queue',
    });
  }
});

// ===========================================================================
// CACHE METRICS
// ===========================================================================

/**
 * Get cache statistics
 */
router.get('/cache', async (req, res) => {
  try {
    const stats = await cacheManager.getStats();
    const info = await cacheManager.getRedisInfo();

    res.json({
      success: true,
      data: {
        stats,
        redisInfo: info,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get cache stats',
    });
  }
});

/**
 * Clear cache
 */
router.post('/cache/clear', async (req, res) => {
  try {
    const { pattern } = req.body;

    if (pattern) {
      await cacheManager.deletePattern(pattern);
    } else {
      await cacheManager.flush();
    }

    res.json({
      success: true,
      message: pattern ? `Cleared cache matching: ${pattern}` : 'Cache cleared',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to clear cache',
    });
  }
});

/**
 * Warm cache
 */
router.post('/cache/warm', async (req, res) => {
  try {
    await cacheManager.warmCache();

    res.json({
      success: true,
      message: 'Cache warmed successfully',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to warm cache',
    });
  }
});

// ===========================================================================
// DATABASE METRICS
// ===========================================================================

/**
 * Get database statistics
 */
router.get('/database', async (req, res) => {
  try {
    const health = await dbOptimizer.getHealthCheck();
    const queryStats = dbOptimizer.getQueryStats();
    const tableStats = await dbOptimizer.getTableStats();
    const indexUsage = await dbOptimizer.getIndexUsage();

    res.json({
      success: true,
      data: {
        health,
        queryStats,
        tableStats,
        indexUsage,
      },
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get database stats',
    });
  }
});

/**
 * Get slow query recommendations
 */
router.get('/database/recommendations', async (req, res) => {
  try {
    const recommendations = dbOptimizer.getIndexRecommendations();

    res.json({
      success: true,
      data: recommendations,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get recommendations',
    });
  }
});

/**
 * Reset query statistics
 */
router.post('/database/stats/reset', async (req, res) => {
  try {
    dbOptimizer.resetStats();

    res.json({
      success: true,
      message: 'Query statistics reset',
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to reset stats',
    });
  }
});

// ===========================================================================
// ERROR TRACKING
// ===========================================================================

/**
 * Get error statistics
 */
router.get('/errors', async (req, res) => {
  try {
    const days = parseInt(req.query.days) || 7;
    const stats = await errorTracking.getStatistics(days);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get error stats',
    });
  }
});

/**
 * Cleanup old error logs
 */
router.post('/errors/cleanup', async (req, res) => {
  try {
    const daysToKeep = parseInt(req.body.daysToKeep) || 30;
    const count = await errorTracking.cleanup(daysToKeep);

    res.json({
      success: true,
      message: `Cleaned up ${count} old error logs`,
      count,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to cleanup errors',
    });
  }
});

// ===========================================================================
// REAL-TIME METRICS (SSE)
// ===========================================================================

/**
 * Stream real-time metrics
 */
router.get('/stream', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });

  const sendMetrics = async () => {
    try {
      const metrics = await performanceMonitor.getMetrics();
      res.write(`data: ${JSON.stringify(metrics)}\n\n`);
    } catch (error) {
      res.write(`data: ${JSON.stringify({ error: error.message })}\n\n`);
    }
  };

  // Send initial metrics
  sendMetrics();

  // Send metrics every 5 seconds
  const interval = setInterval(sendMetrics, 5000);

  // Cleanup on connection close
  req.on('close', () => {
    clearInterval(interval);
  });
});

// ===========================================================================
// FEATURE FLAGS
// ===========================================================================

/**
 * Get all feature flags
 */
router.get('/feature-flags', async (req, res) => {
  try {
    const { prisma } = require('../config/database');
    const flags = await prisma.featureFlag.findMany({
      orderBy: { name: 'asc' },
    });

    res.json({
      success: true,
      data: flags,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to get feature flags',
    });
  }
});

/**
 * Toggle feature flag
 */
router.patch('/feature-flags/:flagId', async (req, res) => {
  try {
    const { flagId } = req.params;
    const { enabled, rolloutPercentage } = req.body;
    const { prisma } = require('../config/database');

    const flag = await prisma.featureFlag.update({
      where: { id: flagId },
      data: {
        enabled: enabled !== undefined ? enabled : undefined,
        rolloutPercentage: rolloutPercentage !== undefined ? rolloutPercentage : undefined,
        updatedAt: new Date(),
      },
    });

    // Clear feature flag cache
    await cacheManager.deletePattern('feature-flag:*');

    res.json({
      success: true,
      data: flag,
    });
  } catch (error) {
    res.status(500).json({
      success: false,
      error: 'Failed to update feature flag',
    });
  }
});

module.exports = router;
