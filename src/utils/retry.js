// =============================================================================
// AIRAVAT B2B MARKETPLACE - RETRY UTILITY
// Retry operations with exponential backoff and jitter
// =============================================================================

const logger = require('../config/logger');

/**
 * Default retry configuration
 */
const DEFAULT_CONFIG = {
  maxRetries: 3,
  initialDelay: 1000, // 1 second
  maxDelay: 30000, // 30 seconds
  backoffMultiplier: 2,
  jitter: true,
  jitterFactor: 0.5,
  retryableErrors: [],
  nonRetryableErrors: [],
  onRetry: null,
  timeout: 60000, // 1 minute total timeout
};

/**
 * Calculate delay with exponential backoff and optional jitter
 */
function calculateDelay(attempt, config) {
  const { initialDelay, maxDelay, backoffMultiplier, jitter, jitterFactor } = config;

  // Exponential backoff
  let delay = initialDelay * Math.pow(backoffMultiplier, attempt - 1);

  // Apply max delay cap
  delay = Math.min(delay, maxDelay);

  // Add jitter to prevent thundering herd
  if (jitter) {
    const jitterRange = delay * jitterFactor;
    delay = delay + (Math.random() * 2 - 1) * jitterRange;
  }

  return Math.floor(delay);
}

/**
 * Check if error is retryable
 */
function isRetryable(error, config) {
  const { retryableErrors, nonRetryableErrors } = config;

  // Check non-retryable errors first
  if (nonRetryableErrors.length > 0) {
    for (const errorType of nonRetryableErrors) {
      if (error instanceof errorType || error.name === errorType) {
        return false;
      }
      if (typeof errorType === 'string' && error.message?.includes(errorType)) {
        return false;
      }
    }
  }

  // Check specific retryable errors
  if (retryableErrors.length > 0) {
    for (const errorType of retryableErrors) {
      if (error instanceof errorType || error.name === errorType) {
        return true;
      }
      if (typeof errorType === 'string' && error.message?.includes(errorType)) {
        return true;
      }
    }
    return false; // Only retry specified errors
  }

  // Default: retry on network errors and 5xx status codes
  if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
    return true;
  }

  if (error.response?.status >= 500 && error.response?.status < 600) {
    return true;
  }

  // Retry on rate limiting (429)
  if (error.response?.status === 429) {
    return true;
  }

  return true; // Default to retry
}

/**
 * Sleep for specified milliseconds
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Retry a function with exponential backoff
 */
async function retry(fn, options = {}) {
  const config = { ...DEFAULT_CONFIG, ...options };
  const { maxRetries, onRetry, timeout } = config;

  const startTime = Date.now();
  let lastError;

  for (let attempt = 1; attempt <= maxRetries + 1; attempt++) {
    // Check total timeout
    if (Date.now() - startTime > timeout) {
      throw new RetryTimeoutError(`Retry timeout after ${timeout}ms`, lastError);
    }

    try {
      return await fn(attempt);
    } catch (error) {
      lastError = error;

      // Check if we've exhausted retries
      if (attempt > maxRetries) {
        throw new MaxRetriesExceededError(
          `Failed after ${maxRetries} retries`,
          error,
          attempt - 1
        );
      }

      // Check if error is retryable
      if (!isRetryable(error, config)) {
        throw error;
      }

      // Calculate delay
      const delay = calculateDelay(attempt, config);

      // Call onRetry callback
      if (onRetry) {
        await onRetry({ attempt, error, delay, maxRetries });
      }

      logger.debug(`Retry attempt ${attempt}/${maxRetries}`, {
        error: error.message,
        delay,
        nextAttempt: attempt + 1,
      });

      // Wait before retrying
      await sleep(delay);
    }
  }
}

/**
 * Retry with circuit breaker integration
 */
async function retryWithBreaker(fn, circuitBreaker, options = {}) {
  return circuitBreaker.execute(() => retry(fn, options));
}

/**
 * Decorator for retrying class methods
 */
function retryable(options = {}) {
  return function (target, propertyKey, descriptor) {
    const originalMethod = descriptor.value;

    descriptor.value = async function (...args) {
      return retry(() => originalMethod.apply(this, args), options);
    };

    return descriptor;
  };
}

/**
 * Retry for database operations
 */
async function retryDatabase(fn, options = {}) {
  return retry(fn, {
    maxRetries: 3,
    initialDelay: 100,
    maxDelay: 5000,
    retryableErrors: [
      'ECONNREFUSED',
      'Connection lost',
      'deadlock',
      'lock wait timeout',
    ],
    nonRetryableErrors: [
      'unique constraint',
      'foreign key constraint',
      'validation error',
    ],
    ...options,
  });
}

/**
 * Retry for HTTP requests
 */
async function retryHttp(fn, options = {}) {
  return retry(fn, {
    maxRetries: 3,
    initialDelay: 1000,
    maxDelay: 10000,
    retryableErrors: [
      'ECONNRESET',
      'ETIMEDOUT',
      'ENOTFOUND',
      'socket hang up',
    ],
    ...options,
  });
}

/**
 * Retry for external API calls
 */
async function retryExternalApi(fn, options = {}) {
  return retry(fn, {
    maxRetries: 5,
    initialDelay: 2000,
    maxDelay: 30000,
    jitter: true,
    ...options,
    onRetry: async ({ attempt, error, delay }) => {
      logger.warn('External API retry', {
        attempt,
        error: error.message,
        delay,
      });
    },
  });
}

/**
 * Batch retry for multiple operations
 */
async function batchRetry(operations, options = {}) {
  const { concurrency = 5, stopOnError = false } = options;

  const results = [];
  const errors = [];

  // Process in batches
  for (let i = 0; i < operations.length; i += concurrency) {
    const batch = operations.slice(i, i + concurrency);

    const batchResults = await Promise.allSettled(
      batch.map((op) => retry(op, options))
    );

    for (let j = 0; j < batchResults.length; j++) {
      const result = batchResults[j];
      const index = i + j;

      if (result.status === 'fulfilled') {
        results[index] = result.value;
      } else {
        errors[index] = result.reason;
        results[index] = null;

        if (stopOnError) {
          throw result.reason;
        }
      }
    }
  }

  return { results, errors };
}

/**
 * Custom error for max retries exceeded
 */
class MaxRetriesExceededError extends Error {
  constructor(message, originalError, attempts) {
    super(message);
    this.name = 'MaxRetriesExceededError';
    this.originalError = originalError;
    this.attempts = attempts;
  }
}

/**
 * Custom error for retry timeout
 */
class RetryTimeoutError extends Error {
  constructor(message, originalError) {
    super(message);
    this.name = 'RetryTimeoutError';
    this.originalError = originalError;
  }
}

/**
 * Create a retryable version of a function
 */
function makeRetryable(fn, options = {}) {
  return async (...args) => {
    return retry(() => fn(...args), options);
  };
}

/**
 * Retry with progressive timeout
 */
async function retryWithProgressiveTimeout(fn, options = {}) {
  const { timeoutProgression = [5000, 10000, 30000] } = options;

  let attempt = 0;

  return retry(async (currentAttempt) => {
    attempt = currentAttempt;
    const timeout = timeoutProgression[Math.min(currentAttempt - 1, timeoutProgression.length - 1)];

    return Promise.race([
      fn(currentAttempt),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error(`Timeout after ${timeout}ms`)), timeout)
      ),
    ]);
  }, options);
}

module.exports = {
  retry,
  retryWithBreaker,
  retryable,
  retryDatabase,
  retryHttp,
  retryExternalApi,
  batchRetry,
  makeRetryable,
  retryWithProgressiveTimeout,
  calculateDelay,
  isRetryable,
  MaxRetriesExceededError,
  RetryTimeoutError,
  DEFAULT_CONFIG,
};
