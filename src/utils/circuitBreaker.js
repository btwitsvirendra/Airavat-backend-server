// =============================================================================
// AIRAVAT B2B MARKETPLACE - CIRCUIT BREAKER
// Resilience pattern for external service calls
// =============================================================================

const logger = require('../config/logger');
const { cache } = require('../config/redis');

/**
 * Circuit Breaker States
 */
const STATES = {
  CLOSED: 'CLOSED',     // Normal operation, requests pass through
  OPEN: 'OPEN',         // Circuit is open, requests fail fast
  HALF_OPEN: 'HALF_OPEN', // Testing if service has recovered
};

/**
 * Circuit Breaker Implementation
 */
class CircuitBreaker {
  constructor(options = {}) {
    this.name = options.name || 'default';
    this.failureThreshold = options.failureThreshold || 5;
    this.successThreshold = options.successThreshold || 3;
    this.timeout = options.timeout || 30000; // 30 seconds
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.monitorInterval = options.monitorInterval || 10000; // 10 seconds

    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;

    // Metrics
    this.metrics = {
      totalCalls: 0,
      successfulCalls: 0,
      failedCalls: 0,
      rejectedCalls: 0,
      lastStateChange: new Date(),
    };
  }

  /**
   * Execute function with circuit breaker protection
   */
  async execute(fn, fallback = null) {
    this.metrics.totalCalls++;

    // Check if circuit is open
    if (this.state === STATES.OPEN) {
      if (Date.now() < this.nextAttempt) {
        this.metrics.rejectedCalls++;
        logger.warn(`Circuit breaker [${this.name}] is OPEN, rejecting request`);

        if (fallback) {
          return typeof fallback === 'function' ? fallback() : fallback;
        }
        throw new CircuitBreakerError(`Service ${this.name} is unavailable`);
      }

      // Time to try again
      this.halfOpen();
    }

    try {
      // Execute with timeout
      const result = await this.executeWithTimeout(fn);
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);

      if (fallback) {
        return typeof fallback === 'function' ? fallback() : fallback;
      }
      throw error;
    }
  }

  /**
   * Execute function with timeout
   */
  async executeWithTimeout(fn) {
    return new Promise(async (resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Request timeout after ${this.timeout}ms`));
      }, this.timeout);

      try {
        const result = await fn();
        clearTimeout(timer);
        resolve(result);
      } catch (error) {
        clearTimeout(timer);
        reject(error);
      }
    });
  }

  /**
   * Handle successful execution
   */
  onSuccess() {
    this.metrics.successfulCalls++;
    this.failureCount = 0;

    if (this.state === STATES.HALF_OPEN) {
      this.successCount++;

      if (this.successCount >= this.successThreshold) {
        this.close();
      }
    }
  }

  /**
   * Handle failed execution
   */
  onFailure(error) {
    this.metrics.failedCalls++;
    this.failureCount++;
    this.lastFailureTime = Date.now();

    logger.error(`Circuit breaker [${this.name}] failure`, {
      failureCount: this.failureCount,
      threshold: this.failureThreshold,
      error: error.message,
    });

    if (this.state === STATES.HALF_OPEN) {
      this.open();
    } else if (this.failureCount >= this.failureThreshold) {
      this.open();
    }
  }

  /**
   * Open the circuit
   */
  open() {
    if (this.state !== STATES.OPEN) {
      this.state = STATES.OPEN;
      this.nextAttempt = Date.now() + this.resetTimeout;
      this.metrics.lastStateChange = new Date();

      logger.warn(`Circuit breaker [${this.name}] OPENED`, {
        nextAttempt: new Date(this.nextAttempt).toISOString(),
      });

      this.emitStateChange(STATES.OPEN);
    }
  }

  /**
   * Half-open the circuit (testing)
   */
  halfOpen() {
    if (this.state !== STATES.HALF_OPEN) {
      this.state = STATES.HALF_OPEN;
      this.successCount = 0;
      this.metrics.lastStateChange = new Date();

      logger.info(`Circuit breaker [${this.name}] HALF-OPEN, testing service`);
      this.emitStateChange(STATES.HALF_OPEN);
    }
  }

  /**
   * Close the circuit (normal operation)
   */
  close() {
    if (this.state !== STATES.CLOSED) {
      this.state = STATES.CLOSED;
      this.failureCount = 0;
      this.successCount = 0;
      this.metrics.lastStateChange = new Date();

      logger.info(`Circuit breaker [${this.name}] CLOSED, service recovered`);
      this.emitStateChange(STATES.CLOSED);
    }
  }

  /**
   * Emit state change event
   */
  async emitStateChange(newState) {
    try {
      // Store state in Redis for distributed systems
      await cache.set(
        `circuit:${this.name}:state`,
        JSON.stringify({
          state: newState,
          timestamp: Date.now(),
          metrics: this.metrics,
        }),
        300 // 5 minutes TTL
      );
    } catch (error) {
      logger.error('Failed to store circuit breaker state', { error: error.message });
    }
  }

  /**
   * Get circuit breaker status
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failureCount: this.failureCount,
      successCount: this.successCount,
      failureThreshold: this.failureThreshold,
      successThreshold: this.successThreshold,
      lastFailureTime: this.lastFailureTime,
      nextAttempt: this.nextAttempt,
      metrics: this.metrics,
    };
  }

  /**
   * Force reset the circuit
   */
  reset() {
    this.state = STATES.CLOSED;
    this.failureCount = 0;
    this.successCount = 0;
    this.lastFailureTime = null;
    this.nextAttempt = null;
    this.metrics.lastStateChange = new Date();

    logger.info(`Circuit breaker [${this.name}] manually reset`);
  }
}

/**
 * Circuit Breaker Error
 */
class CircuitBreakerError extends Error {
  constructor(message) {
    super(message);
    this.name = 'CircuitBreakerError';
    this.isCircuitBreakerError = true;
  }
}

/**
 * Circuit Breaker Registry
 */
class CircuitBreakerRegistry {
  constructor() {
    this.breakers = new Map();
  }

  /**
   * Get or create a circuit breaker
   */
  get(name, options = {}) {
    if (!this.breakers.has(name)) {
      this.breakers.set(name, new CircuitBreaker({ name, ...options }));
    }
    return this.breakers.get(name);
  }

  /**
   * Get all circuit breakers status
   */
  getAllStatus() {
    const status = {};
    for (const [name, breaker] of this.breakers) {
      status[name] = breaker.getStatus();
    }
    return status;
  }

  /**
   * Reset all circuit breakers
   */
  resetAll() {
    for (const breaker of this.breakers.values()) {
      breaker.reset();
    }
  }

  /**
   * Get breaker by name
   */
  getBreaker(name) {
    return this.breakers.get(name);
  }
}

// Pre-configured circuit breakers for common services
const registry = new CircuitBreakerRegistry();

const circuitBreakers = {
  // Payment gateway
  razorpay: registry.get('razorpay', {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 30000,
    resetTimeout: 60000,
  }),

  // Shipping providers
  shiprocket: registry.get('shiprocket', {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 20000,
    resetTimeout: 120000,
  }),

  delhivery: registry.get('delhivery', {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 20000,
    resetTimeout: 120000,
  }),

  // GST/Tax services
  gst: registry.get('gst', {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 45000,
    resetTimeout: 300000, // 5 minutes
  }),

  // Email service
  email: registry.get('email', {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 10000,
    resetTimeout: 60000,
  }),

  // SMS service
  sms: registry.get('sms', {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 10000,
    resetTimeout: 60000,
  }),

  // Elasticsearch
  elasticsearch: registry.get('elasticsearch', {
    failureThreshold: 3,
    successThreshold: 2,
    timeout: 5000,
    resetTimeout: 30000,
  }),

  // External APIs
  externalApi: registry.get('externalApi', {
    failureThreshold: 5,
    successThreshold: 3,
    timeout: 15000,
    resetTimeout: 120000,
  }),
};

module.exports = {
  CircuitBreaker,
  CircuitBreakerError,
  CircuitBreakerRegistry,
  circuitBreakers,
  registry,
};
