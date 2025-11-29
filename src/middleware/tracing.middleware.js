// =============================================================================
// AIRAVAT B2B MARKETPLACE - REQUEST TRACING
// Distributed tracing and request correlation for debugging and monitoring
// =============================================================================

const { v4: uuidv4 } = require('uuid');
const { AsyncLocalStorage } = require('async_hooks');
const logger = require('../config/logger');

// Async local storage for request context
const asyncLocalStorage = new AsyncLocalStorage();

/**
 * Trace context that follows the request through the system
 */
class TraceContext {
  constructor(options = {}) {
    this.traceId = options.traceId || uuidv4();
    this.spanId = options.spanId || this.generateSpanId();
    this.parentSpanId = options.parentSpanId || null;
    this.startTime = Date.now();
    this.userId = options.userId || null;
    this.businessId = options.businessId || null;
    this.metadata = options.metadata || {};
    this.spans = [];
    this.events = [];
  }

  generateSpanId() {
    return uuidv4().substring(0, 16);
  }

  /**
   * Create a child span for nested operations
   */
  createSpan(name, metadata = {}) {
    const span = {
      spanId: this.generateSpanId(),
      parentSpanId: this.spanId,
      name,
      startTime: Date.now(),
      endTime: null,
      duration: null,
      status: 'running',
      metadata,
      events: [],
    };

    this.spans.push(span);
    return span;
  }

  /**
   * End a span
   */
  endSpan(span, status = 'success', error = null) {
    span.endTime = Date.now();
    span.duration = span.endTime - span.startTime;
    span.status = status;
    if (error) {
      span.error = {
        message: error.message,
        stack: error.stack,
      };
    }
  }

  /**
   * Add event to trace
   */
  addEvent(name, data = {}) {
    this.events.push({
      name,
      timestamp: Date.now(),
      data,
    });
  }

  /**
   * Set user context
   */
  setUser(userId, businessId = null) {
    this.userId = userId;
    this.businessId = businessId;
  }

  /**
   * Add metadata
   */
  addMetadata(key, value) {
    this.metadata[key] = value;
  }

  /**
   * Get trace summary
   */
  getSummary() {
    const endTime = Date.now();
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      userId: this.userId,
      businessId: this.businessId,
      duration: endTime - this.startTime,
      spanCount: this.spans.length,
      eventCount: this.events.length,
      spans: this.spans.map((s) => ({
        name: s.name,
        duration: s.duration,
        status: s.status,
      })),
      metadata: this.metadata,
    };
  }

  /**
   * Get full trace for debugging
   */
  getFullTrace() {
    return {
      traceId: this.traceId,
      spanId: this.spanId,
      parentSpanId: this.parentSpanId,
      startTime: this.startTime,
      endTime: Date.now(),
      duration: Date.now() - this.startTime,
      userId: this.userId,
      businessId: this.businessId,
      metadata: this.metadata,
      spans: this.spans,
      events: this.events,
    };
  }
}

/**
 * Get current trace context
 */
function getTraceContext() {
  return asyncLocalStorage.getStore();
}

/**
 * Get trace ID from current context
 */
function getTraceId() {
  const context = getTraceContext();
  return context?.traceId || 'no-trace';
}

/**
 * Run function within trace context
 */
function runWithTrace(context, fn) {
  return asyncLocalStorage.run(context, fn);
}

/**
 * Request tracing middleware
 */
function traceMiddleware(options = {}) {
  const {
    headerName = 'x-trace-id',
    includeInResponse = true,
    logRequests = true,
  } = options;

  return (req, res, next) => {
    // Extract or generate trace ID
    const incomingTraceId = req.headers[headerName] || req.headers['x-request-id'];
    const parentSpanId = req.headers['x-parent-span-id'];

    // Create trace context
    const traceContext = new TraceContext({
      traceId: incomingTraceId,
      parentSpanId,
      metadata: {
        method: req.method,
        path: req.path,
        ip: req.ip,
        userAgent: req.headers['user-agent'],
      },
    });

    // Attach to request
    req.traceContext = traceContext;
    req.traceId = traceContext.traceId;

    // Add trace ID to response headers
    if (includeInResponse) {
      res.setHeader('X-Trace-Id', traceContext.traceId);
      res.setHeader('X-Span-Id', traceContext.spanId);
    }

    // Log request start
    if (logRequests) {
      logger.info('Request started', {
        traceId: traceContext.traceId,
        method: req.method,
        path: req.path,
        query: req.query,
      });
    }

    // Capture response
    const startTime = Date.now();
    const originalSend = res.send;

    res.send = function (body) {
      const duration = Date.now() - startTime;

      // Add response metadata
      traceContext.addMetadata('statusCode', res.statusCode);
      traceContext.addMetadata('duration', duration);
      traceContext.addMetadata('contentLength', body?.length || 0);

      // Log request completion
      if (logRequests) {
        const logLevel = res.statusCode >= 400 ? 'warn' : 'info';
        logger[logLevel]('Request completed', {
          traceId: traceContext.traceId,
          method: req.method,
          path: req.path,
          statusCode: res.statusCode,
          duration,
        });
      }

      return originalSend.call(this, body);
    };

    // Run request within trace context
    runWithTrace(traceContext, () => {
      next();
    });
  };
}

/**
 * Create span for async operations
 */
async function withSpan(name, fn, metadata = {}) {
  const context = getTraceContext();
  if (!context) {
    return fn();
  }

  const span = context.createSpan(name, metadata);

  try {
    const result = await fn();
    context.endSpan(span, 'success');
    return result;
  } catch (error) {
    context.endSpan(span, 'error', error);
    throw error;
  }
}

/**
 * Wrap function with automatic span creation
 */
function traced(name) {
  return function (target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args) {
      return withSpan(name || propertyKey, () => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}

/**
 * Logger that automatically includes trace context
 */
function tracedLogger() {
  const log = (level, message, meta = {}) => {
    const context = getTraceContext();
    const traceInfo = context
      ? {
          traceId: context.traceId,
          spanId: context.spanId,
          userId: context.userId,
        }
      : {};

    logger[level](message, { ...traceInfo, ...meta });
  };

  return {
    info: (message, meta) => log('info', message, meta),
    warn: (message, meta) => log('warn', message, meta),
    error: (message, meta) => log('error', message, meta),
    debug: (message, meta) => log('debug', message, meta),
  };
}

/**
 * HTTP client wrapper with trace propagation
 */
function createTracedAxios(axios) {
  const instance = axios.create();

  instance.interceptors.request.use((config) => {
    const context = getTraceContext();
    if (context) {
      config.headers['x-trace-id'] = context.traceId;
      config.headers['x-parent-span-id'] = context.spanId;
    }
    return config;
  });

  return instance;
}

/**
 * Trace exporter for external monitoring (e.g., Jaeger, Zipkin)
 */
class TraceExporter {
  constructor(options = {}) {
    this.endpoint = options.endpoint;
    this.serviceName = options.serviceName || 'airavat-api';
    this.queue = [];
    this.batchSize = options.batchSize || 100;
    this.flushInterval = options.flushInterval || 5000;

    if (this.endpoint) {
      this.startFlushTimer();
    }
  }

  export(trace) {
    this.queue.push(this.formatTrace(trace));

    if (this.queue.length >= this.batchSize) {
      this.flush();
    }
  }

  formatTrace(trace) {
    return {
      traceId: trace.traceId,
      spanId: trace.spanId,
      parentSpanId: trace.parentSpanId,
      operationName: trace.metadata?.path || 'unknown',
      serviceName: this.serviceName,
      startTime: trace.startTime,
      duration: trace.metadata?.duration || 0,
      tags: {
        'http.method': trace.metadata?.method,
        'http.status_code': trace.metadata?.statusCode,
        'user.id': trace.userId,
      },
      logs: trace.events.map((e) => ({
        timestamp: e.timestamp,
        fields: { event: e.name, ...e.data },
      })),
    };
  }

  async flush() {
    if (this.queue.length === 0 || !this.endpoint) return;

    const traces = this.queue.splice(0, this.batchSize);

    try {
      const axios = require('axios');
      await axios.post(this.endpoint, traces);
    } catch (error) {
      logger.error('Failed to export traces', { error: error.message });
      // Re-queue failed traces
      this.queue.unshift(...traces);
    }
  }

  startFlushTimer() {
    setInterval(() => this.flush(), this.flushInterval);
  }
}

module.exports = {
  TraceContext,
  getTraceContext,
  getTraceId,
  runWithTrace,
  traceMiddleware,
  withSpan,
  traced,
  tracedLogger,
  createTracedAxios,
  TraceExporter,
};
