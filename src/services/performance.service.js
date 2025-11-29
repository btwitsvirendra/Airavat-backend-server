// =============================================================================
// AIRAVAT B2B MARKETPLACE - PERFORMANCE MONITORING SERVICE
// Application performance monitoring, metrics collection, and profiling
// =============================================================================

const os = require('os');
const v8 = require('v8');
const { performance, PerformanceObserver } = require('perf_hooks');
const { cache } = require('../config/redis');
const logger = require('../config/logger');

class PerformanceMonitor {
  constructor() {
    this.metrics = {
      requests: { total: 0, success: 0, error: 0 },
      latency: { samples: [], percentiles: {} },
      memory: {},
      cpu: {},
      eventLoop: { lag: 0 },
    };

    this.histogramBuckets = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];
    this.latencyHistogram = new Array(this.histogramBuckets.length + 1).fill(0);
    this.metricsInterval = null;
    this.eventLoopInterval = null;

    // Performance observers
    this.setupObservers();
  }

  /**
   * Setup performance observers
   */
  setupObservers() {
    // Observe GC events
    try {
      const gcObserver = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          this.recordMetric('gc', {
            kind: entry.kind,
            duration: entry.duration,
          });
        }
      });
      gcObserver.observe({ entryTypes: ['gc'] });
    } catch (error) {
      // GC observation not available
    }
  }

  /**
   * Start collecting metrics
   */
  start(interval = 60000) {
    // Collect system metrics every minute
    this.metricsInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, interval);

    // Monitor event loop lag every second
    this.eventLoopInterval = setInterval(() => {
      this.measureEventLoopLag();
    }, 1000);

    logger.info('Performance monitoring started');
  }

  /**
   * Stop collecting metrics
   */
  stop() {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }
    if (this.eventLoopInterval) {
      clearInterval(this.eventLoopInterval);
    }
    logger.info('Performance monitoring stopped');
  }

  /**
   * Measure event loop lag
   */
  measureEventLoopLag() {
    const start = Date.now();
    setImmediate(() => {
      const lag = Date.now() - start;
      this.metrics.eventLoop.lag = lag;

      if (lag > 100) {
        logger.warn('High event loop lag detected', { lag });
      }
    });
  }

  /**
   * Collect system metrics
   */
  async collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    const heapStats = v8.getHeapStatistics();
    const cpuUsage = process.cpuUsage();

    this.metrics.memory = {
      heapUsed: memUsage.heapUsed,
      heapTotal: memUsage.heapTotal,
      external: memUsage.external,
      arrayBuffers: memUsage.arrayBuffers,
      rss: memUsage.rss,
      heapUsedPercentage: (memUsage.heapUsed / heapStats.heap_size_limit) * 100,
    };

    this.metrics.cpu = {
      user: cpuUsage.user,
      system: cpuUsage.system,
      loadAverage: os.loadavg(),
    };

    this.metrics.system = {
      uptime: process.uptime(),
      nodeVersion: process.version,
      platform: process.platform,
      cpuCount: os.cpus().length,
      freeMemory: os.freemem(),
      totalMemory: os.totalmem(),
    };

    // Calculate latency percentiles
    this.calculatePercentiles();

    // Store in Redis for distributed access
    await this.storeMetrics();

    // Check for alerts
    this.checkAlerts();
  }

  /**
   * Record request metrics
   */
  recordRequest(duration, statusCode, path, method) {
    this.metrics.requests.total++;

    if (statusCode >= 200 && statusCode < 400) {
      this.metrics.requests.success++;
    } else {
      this.metrics.requests.error++;
    }

    // Record latency
    this.recordLatency(duration);

    // Record by endpoint
    const endpoint = `${method}:${path}`;
    if (!this.metrics.endpoints) {
      this.metrics.endpoints = {};
    }
    if (!this.metrics.endpoints[endpoint]) {
      this.metrics.endpoints[endpoint] = {
        count: 0,
        totalDuration: 0,
        avgDuration: 0,
        errors: 0,
      };
    }
    this.metrics.endpoints[endpoint].count++;
    this.metrics.endpoints[endpoint].totalDuration += duration;
    this.metrics.endpoints[endpoint].avgDuration =
      this.metrics.endpoints[endpoint].totalDuration /
      this.metrics.endpoints[endpoint].count;
    if (statusCode >= 400) {
      this.metrics.endpoints[endpoint].errors++;
    }
  }

  /**
   * Record latency sample
   */
  recordLatency(duration) {
    // Keep last 1000 samples
    this.metrics.latency.samples.push(duration);
    if (this.metrics.latency.samples.length > 1000) {
      this.metrics.latency.samples.shift();
    }

    // Update histogram
    let bucketIndex = this.histogramBuckets.findIndex((b) => duration <= b);
    if (bucketIndex === -1) {
      bucketIndex = this.histogramBuckets.length;
    }
    this.latencyHistogram[bucketIndex]++;
  }

  /**
   * Calculate latency percentiles
   */
  calculatePercentiles() {
    const samples = [...this.metrics.latency.samples].sort((a, b) => a - b);
    const len = samples.length;

    if (len === 0) {
      this.metrics.latency.percentiles = {};
      return;
    }

    this.metrics.latency.percentiles = {
      p50: samples[Math.floor(len * 0.5)],
      p75: samples[Math.floor(len * 0.75)],
      p90: samples[Math.floor(len * 0.9)],
      p95: samples[Math.floor(len * 0.95)],
      p99: samples[Math.floor(len * 0.99)],
      avg: samples.reduce((a, b) => a + b, 0) / len,
      min: samples[0],
      max: samples[len - 1],
    };
  }

  /**
   * Record custom metric
   */
  recordMetric(name, value) {
    if (!this.metrics.custom) {
      this.metrics.custom = {};
    }
    if (!this.metrics.custom[name]) {
      this.metrics.custom[name] = [];
    }
    this.metrics.custom[name].push({
      value,
      timestamp: Date.now(),
    });

    // Keep last 100 values
    if (this.metrics.custom[name].length > 100) {
      this.metrics.custom[name].shift();
    }
  }

  /**
   * Store metrics in Redis
   */
  async storeMetrics() {
    try {
      const key = `metrics:${process.env.NODE_APP_INSTANCE || 'default'}`;
      await cache.set(key, JSON.stringify({
        ...this.metrics,
        timestamp: Date.now(),
      }), 300);
    } catch (error) {
      logger.error('Failed to store metrics', { error: error.message });
    }
  }

  /**
   * Get aggregated metrics from all instances
   */
  async getAggregatedMetrics() {
    try {
      const keys = await cache.keys('metrics:*');
      const metrics = [];

      for (const key of keys) {
        const data = await cache.get(key);
        if (data) {
          metrics.push(JSON.parse(data));
        }
      }

      return this.aggregateMetrics(metrics);
    } catch (error) {
      logger.error('Failed to get aggregated metrics', { error: error.message });
      return this.metrics;
    }
  }

  /**
   * Aggregate metrics from multiple instances
   */
  aggregateMetrics(metricsArray) {
    if (metricsArray.length === 0) {
      return this.metrics;
    }

    const aggregated = {
      instances: metricsArray.length,
      requests: {
        total: 0,
        success: 0,
        error: 0,
      },
      latency: {
        percentiles: {},
      },
      memory: {
        total: 0,
        average: 0,
      },
    };

    for (const metrics of metricsArray) {
      aggregated.requests.total += metrics.requests?.total || 0;
      aggregated.requests.success += metrics.requests?.success || 0;
      aggregated.requests.error += metrics.requests?.error || 0;
      aggregated.memory.total += metrics.memory?.heapUsed || 0;
    }

    aggregated.memory.average = aggregated.memory.total / metricsArray.length;

    // Aggregate latency percentiles (simplified)
    const allSamples = metricsArray.flatMap((m) => m.latency?.samples || []);
    if (allSamples.length > 0) {
      allSamples.sort((a, b) => a - b);
      const len = allSamples.length;
      aggregated.latency.percentiles = {
        p50: allSamples[Math.floor(len * 0.5)],
        p95: allSamples[Math.floor(len * 0.95)],
        p99: allSamples[Math.floor(len * 0.99)],
      };
    }

    return aggregated;
  }

  /**
   * Check for alert conditions
   */
  checkAlerts() {
    const alerts = [];

    // Memory alert
    if (this.metrics.memory.heapUsedPercentage > 85) {
      alerts.push({
        type: 'memory',
        severity: 'high',
        message: `Heap usage at ${this.metrics.memory.heapUsedPercentage.toFixed(1)}%`,
      });
    }

    // Event loop lag alert
    if (this.metrics.eventLoop.lag > 100) {
      alerts.push({
        type: 'eventLoop',
        severity: 'medium',
        message: `Event loop lag at ${this.metrics.eventLoop.lag}ms`,
      });
    }

    // Error rate alert
    const errorRate = (this.metrics.requests.error / this.metrics.requests.total) * 100;
    if (errorRate > 5 && this.metrics.requests.total > 100) {
      alerts.push({
        type: 'errorRate',
        severity: 'high',
        message: `Error rate at ${errorRate.toFixed(1)}%`,
      });
    }

    // High latency alert
    if (this.metrics.latency.percentiles.p95 > 5000) {
      alerts.push({
        type: 'latency',
        severity: 'medium',
        message: `P95 latency at ${this.metrics.latency.percentiles.p95}ms`,
      });
    }

    // Log alerts
    for (const alert of alerts) {
      logger.warn('Performance alert', alert);
    }

    return alerts;
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      timestamp: Date.now(),
      histogram: this.getHistogram(),
    };
  }

  /**
   * Get latency histogram
   */
  getHistogram() {
    const total = this.latencyHistogram.reduce((a, b) => a + b, 0);
    if (total === 0) return {};

    const histogram = {};
    for (let i = 0; i < this.histogramBuckets.length; i++) {
      const bucket = `<=${this.histogramBuckets[i]}ms`;
      histogram[bucket] = {
        count: this.latencyHistogram[i],
        percentage: ((this.latencyHistogram[i] / total) * 100).toFixed(1),
      };
    }
    histogram[`>${this.histogramBuckets[this.histogramBuckets.length - 1]}ms`] = {
      count: this.latencyHistogram[this.histogramBuckets.length],
      percentage: ((this.latencyHistogram[this.histogramBuckets.length] / total) * 100).toFixed(1),
    };

    return histogram;
  }

  /**
   * Reset metrics
   */
  reset() {
    this.metrics = {
      requests: { total: 0, success: 0, error: 0 },
      latency: { samples: [], percentiles: {} },
      memory: {},
      cpu: {},
      eventLoop: { lag: 0 },
    };
    this.latencyHistogram = new Array(this.histogramBuckets.length + 1).fill(0);
  }

  /**
   * Express middleware for request timing
   */
  middleware() {
    return (req, res, next) => {
      const startTime = performance.now();

      // Capture response end
      const originalEnd = res.end;
      res.end = (...args) => {
        const duration = performance.now() - startTime;
        this.recordRequest(duration, res.statusCode, req.route?.path || req.path, req.method);
        return originalEnd.apply(res, args);
      };

      next();
    };
  }

  /**
   * Create timing wrapper for async functions
   */
  time(name) {
    const start = performance.now();
    return {
      end: () => {
        const duration = performance.now() - start;
        this.recordMetric(name, { duration });
        return duration;
      },
    };
  }

  /**
   * Measure function execution time
   */
  async measure(name, fn) {
    const timer = this.time(name);
    try {
      const result = await fn();
      timer.end();
      return result;
    } catch (error) {
      timer.end();
      throw error;
    }
  }

  /**
   * Get slow endpoints
   */
  getSlowEndpoints(threshold = 1000) {
    if (!this.metrics.endpoints) return [];

    return Object.entries(this.metrics.endpoints)
      .filter(([_, data]) => data.avgDuration > threshold)
      .sort((a, b) => b[1].avgDuration - a[1].avgDuration)
      .map(([endpoint, data]) => ({
        endpoint,
        avgDuration: data.avgDuration,
        count: data.count,
        errorRate: ((data.errors / data.count) * 100).toFixed(1),
      }));
  }

  /**
   * Get high error endpoints
   */
  getHighErrorEndpoints(threshold = 5) {
    if (!this.metrics.endpoints) return [];

    return Object.entries(this.metrics.endpoints)
      .filter(([_, data]) => {
        const errorRate = (data.errors / data.count) * 100;
        return errorRate > threshold && data.count > 10;
      })
      .sort((a, b) => (b[1].errors / b[1].count) - (a[1].errors / a[1].count))
      .map(([endpoint, data]) => ({
        endpoint,
        errorRate: ((data.errors / data.count) * 100).toFixed(1),
        count: data.count,
        errors: data.errors,
      }));
  }
}

// Export singleton
const performanceMonitor = new PerformanceMonitor();

module.exports = performanceMonitor;
