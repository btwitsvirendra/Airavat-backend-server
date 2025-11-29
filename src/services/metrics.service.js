// =============================================================================
// AIRAVAT B2B MARKETPLACE - PERFORMANCE MONITORING SERVICE
// APM, metrics collection, and performance tracking
// =============================================================================

const { cache } = require('../config/redis');
const logger = require('../config/logger');

class MetricsService {
  constructor() {
    this.metricsPrefix = 'metrics:';
    this.counters = new Map();
    this.gauges = new Map();
    this.histograms = new Map();
    
    // Flush metrics to Redis every 10 seconds
    this.flushInterval = setInterval(() => this.flush(), 10000);
  }

  // ===========================================================================
  // COUNTER METRICS
  // ===========================================================================

  /**
   * Increment a counter
   */
  increment(name, value = 1, tags = {}) {
    const key = this.buildKey(name, tags);
    const current = this.counters.get(key) || 0;
    this.counters.set(key, current + value);
  }

  /**
   * Decrement a counter
   */
  decrement(name, value = 1, tags = {}) {
    this.increment(name, -value, tags);
  }

  // ===========================================================================
  // GAUGE METRICS
  // ===========================================================================

  /**
   * Set a gauge value
   */
  gauge(name, value, tags = {}) {
    const key = this.buildKey(name, tags);
    this.gauges.set(key, value);
  }

  // ===========================================================================
  // HISTOGRAM METRICS
  // ===========================================================================

  /**
   * Record a histogram value
   */
  histogram(name, value, tags = {}) {
    const key = this.buildKey(name, tags);
    if (!this.histograms.has(key)) {
      this.histograms.set(key, []);
    }
    this.histograms.get(key).push(value);
  }

  /**
   * Time a function execution
   */
  async time(name, fn, tags = {}) {
    const start = process.hrtime.bigint();
    try {
      return await fn();
    } finally {
      const end = process.hrtime.bigint();
      const duration = Number(end - start) / 1e6; // Convert to milliseconds
      this.histogram(name, duration, tags);
    }
  }

  /**
   * Create a timer that can be stopped later
   */
  startTimer(name, tags = {}) {
    const start = process.hrtime.bigint();
    return {
      stop: () => {
        const end = process.hrtime.bigint();
        const duration = Number(end - start) / 1e6;
        this.histogram(name, duration, tags);
        return duration;
      },
    };
  }

  // ===========================================================================
  // API METRICS
  // ===========================================================================

  /**
   * Track API request
   */
  trackRequest(req, res, duration) {
    const route = req.route?.path || req.path;
    const method = req.method;
    const statusCode = res.statusCode;
    const statusClass = `${Math.floor(statusCode / 100)}xx`;

    // Request count
    this.increment('http.requests.total', 1, {
      method,
      route,
      status: statusCode,
      status_class: statusClass,
    });

    // Response time histogram
    this.histogram('http.request.duration', duration, {
      method,
      route,
    });

    // Error tracking
    if (statusCode >= 400) {
      this.increment('http.errors.total', 1, {
        method,
        route,
        status: statusCode,
      });
    }
  }

  /**
   * Track database query
   */
  trackQuery(model, action, duration, success = true) {
    this.histogram('db.query.duration', duration, { model, action });
    this.increment('db.queries.total', 1, { model, action, success: String(success) });
  }

  /**
   * Track cache operation
   */
  trackCache(operation, hit = true) {
    this.increment('cache.operations.total', 1, { operation, hit: String(hit) });
  }

  /**
   * Track external API call
   */
  trackExternalCall(service, endpoint, duration, success = true) {
    this.histogram('external.call.duration', duration, { service, endpoint });
    this.increment('external.calls.total', 1, { service, success: String(success) });
  }

  // ===========================================================================
  // BUSINESS METRICS
  // ===========================================================================

  /**
   * Track order metrics
   */
  trackOrder(order) {
    this.increment('orders.created.total', 1, {
      payment_method: order.paymentMethod,
      status: order.status,
    });
    this.histogram('orders.value', Number(order.totalAmount), {
      currency: order.currency,
    });
  }

  /**
   * Track search metrics
   */
  trackSearch(query, resultsCount, duration) {
    this.increment('search.queries.total', 1);
    this.histogram('search.results.count', resultsCount);
    this.histogram('search.duration', duration);
    
    if (resultsCount === 0) {
      this.increment('search.zero_results.total', 1);
    }
  }

  /**
   * Track user activity
   */
  trackUserActivity(userId, action) {
    this.increment('user.actions.total', 1, { action });
    
    // Update active users gauge
    this.setActiveUser(userId);
  }

  async setActiveUser(userId) {
    const key = `${this.metricsPrefix}active_users`;
    await cache.sadd(key, userId);
    await cache.expire(key, 300); // 5 minute window
  }

  // ===========================================================================
  // SYSTEM METRICS
  // ===========================================================================

  /**
   * Collect system metrics
   */
  collectSystemMetrics() {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Memory metrics
    this.gauge('process.memory.heap_used', memUsage.heapUsed);
    this.gauge('process.memory.heap_total', memUsage.heapTotal);
    this.gauge('process.memory.external', memUsage.external);
    this.gauge('process.memory.rss', memUsage.rss);

    // CPU metrics
    this.gauge('process.cpu.user', cpuUsage.user);
    this.gauge('process.cpu.system', cpuUsage.system);

    // Event loop lag
    const start = process.hrtime.bigint();
    setImmediate(() => {
      const lag = Number(process.hrtime.bigint() - start) / 1e6;
      this.gauge('process.event_loop.lag', lag);
    });

    // Active handles and requests
    this.gauge('process.handles.active', process._getActiveHandles().length);
    this.gauge('process.requests.active', process._getActiveRequests().length);
  }

  // ===========================================================================
  // METRICS EXPORT
  // ===========================================================================

  /**
   * Flush metrics to Redis
   */
  async flush() {
    try {
      const timestamp = Date.now();
      const pipeline = cache.pipeline();

      // Flush counters
      for (const [key, value] of this.counters) {
        pipeline.hincrby(`${this.metricsPrefix}counters`, key, value);
      }
      this.counters.clear();

      // Flush gauges
      for (const [key, value] of this.gauges) {
        pipeline.hset(`${this.metricsPrefix}gauges`, key, value);
      }

      // Flush histograms (store as time-series)
      for (const [key, values] of this.histograms) {
        if (values.length > 0) {
          const stats = this.calculateStats(values);
          pipeline.hset(`${this.metricsPrefix}histograms:${key}:${timestamp}`, {
            count: stats.count,
            sum: stats.sum,
            min: stats.min,
            max: stats.max,
            avg: stats.avg,
            p50: stats.p50,
            p95: stats.p95,
            p99: stats.p99,
          });
          pipeline.expire(`${this.metricsPrefix}histograms:${key}:${timestamp}`, 3600);
        }
      }
      this.histograms.clear();

      await pipeline.exec();
    } catch (error) {
      logger.error('Failed to flush metrics', { error: error.message });
    }
  }

  /**
   * Get current metrics snapshot
   */
  async getMetrics() {
    const [counters, gauges] = await Promise.all([
      cache.hgetall(`${this.metricsPrefix}counters`),
      cache.hgetall(`${this.metricsPrefix}gauges`),
    ]);

    // Get active users count
    const activeUsers = await cache.scard(`${this.metricsPrefix}active_users`);

    return {
      timestamp: new Date().toISOString(),
      counters: this.parseMetrics(counters),
      gauges: this.parseMetrics(gauges),
      activeUsers,
    };
  }

  /**
   * Export metrics in Prometheus format
   */
  async exportPrometheus() {
    const metrics = await this.getMetrics();
    const lines = [];

    // Export counters
    for (const [name, value] of Object.entries(metrics.counters)) {
      const { metricName, labels } = this.parseKey(name);
      lines.push(`# TYPE ${metricName} counter`);
      lines.push(`${metricName}${labels} ${value}`);
    }

    // Export gauges
    for (const [name, value] of Object.entries(metrics.gauges)) {
      const { metricName, labels } = this.parseKey(name);
      lines.push(`# TYPE ${metricName} gauge`);
      lines.push(`${metricName}${labels} ${value}`);
    }

    return lines.join('\n');
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  buildKey(name, tags) {
    const tagStr = Object.entries(tags)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, v]) => `${k}=${v}`)
      .join(',');
    return tagStr ? `${name}{${tagStr}}` : name;
  }

  parseKey(key) {
    const match = key.match(/^([^{]+)(\{(.+)\})?$/);
    if (!match) return { metricName: key, labels: '' };

    const metricName = match[1].replace(/\./g, '_');
    const labels = match[2] || '';
    return { metricName, labels };
  }

  parseMetrics(obj) {
    const result = {};
    for (const [key, value] of Object.entries(obj || {})) {
      result[key] = parseFloat(value);
    }
    return result;
  }

  calculateStats(values) {
    if (values.length === 0) {
      return { count: 0, sum: 0, min: 0, max: 0, avg: 0, p50: 0, p95: 0, p99: 0 };
    }

    const sorted = [...values].sort((a, b) => a - b);
    const count = values.length;
    const sum = values.reduce((a, b) => a + b, 0);

    return {
      count,
      sum,
      min: sorted[0],
      max: sorted[count - 1],
      avg: sum / count,
      p50: sorted[Math.floor(count * 0.5)],
      p95: sorted[Math.floor(count * 0.95)],
      p99: sorted[Math.floor(count * 0.99)],
    };
  }

  // ===========================================================================
  // EXPRESS MIDDLEWARE
  // ===========================================================================

  middleware() {
    return (req, res, next) => {
      const start = process.hrtime.bigint();

      // Capture response
      const originalEnd = res.end;
      res.end = (...args) => {
        const duration = Number(process.hrtime.bigint() - start) / 1e6;
        this.trackRequest(req, res, duration);
        return originalEnd.apply(res, args);
      };

      next();
    };
  }

  // ===========================================================================
  // CLEANUP
  // ===========================================================================

  destroy() {
    if (this.flushInterval) {
      clearInterval(this.flushInterval);
    }
    this.flush();
  }
}

// Export singleton
const metrics = new MetricsService();

// Collect system metrics every 30 seconds
setInterval(() => metrics.collectSystemMetrics(), 30000);

module.exports = metrics;
