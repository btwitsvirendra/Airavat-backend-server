// =============================================================================
// AIRAVAT B2B MARKETPLACE - ERROR CLASSES
// Custom error classes for consistent error handling
// =============================================================================

/**
 * Base API Error class
 */
class ApiError extends Error {
  constructor(message, statusCode = 500, code = 'INTERNAL_ERROR', details = null) {
    super(message);
    this.name = this.constructor.name;
    this.statusCode = statusCode;
    this.code = code;
    this.details = details;
    this.isOperational = true; // Distinguishes operational errors from programming errors
    
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON() {
    return {
      success: false,
      error: {
        code: this.code,
        message: this.message,
        details: this.details,
      },
    };
  }
}

/**
 * 400 Bad Request - Invalid input/validation errors
 */
class BadRequestError extends ApiError {
  constructor(message = 'Bad request', details = null) {
    super(message, 400, 'BAD_REQUEST', details);
  }
}

/**
 * 401 Unauthorized - Authentication required
 */
class UnauthorizedError extends ApiError {
  constructor(message = 'Authentication required') {
    super(message, 401, 'UNAUTHORIZED');
  }
}

/**
 * 403 Forbidden - Not allowed to access resource
 */
class ForbiddenError extends ApiError {
  constructor(message = 'Access denied') {
    super(message, 403, 'FORBIDDEN');
  }
}

/**
 * 404 Not Found - Resource doesn't exist
 */
class NotFoundError extends ApiError {
  constructor(resource = 'Resource') {
    super(`${resource} not found`, 404, 'NOT_FOUND');
  }
}

/**
 * 409 Conflict - Resource already exists or state conflict
 */
class ConflictError extends ApiError {
  constructor(message = 'Resource already exists') {
    super(message, 409, 'CONFLICT');
  }
}

/**
 * 422 Unprocessable Entity - Validation failed
 */
class ValidationError extends ApiError {
  constructor(errors) {
    super('Validation failed', 422, 'VALIDATION_ERROR', errors);
  }
}

/**
 * 429 Too Many Requests - Rate limit exceeded
 */
class RateLimitError extends ApiError {
  constructor(retryAfter = 60) {
    super('Rate limit exceeded. Please try again later.', 429, 'RATE_LIMIT_EXCEEDED');
    this.retryAfter = retryAfter;
  }
}

/**
 * 500 Internal Server Error
 */
class InternalError extends ApiError {
  constructor(message = 'Internal server error') {
    super(message, 500, 'INTERNAL_ERROR');
    this.isOperational = false;
  }
}

/**
 * 502 Bad Gateway - External service error
 */
class ExternalServiceError extends ApiError {
  constructor(service, message = 'External service unavailable') {
    super(`${service}: ${message}`, 502, 'EXTERNAL_SERVICE_ERROR');
    this.service = service;
  }
}

/**
 * 503 Service Unavailable
 */
class ServiceUnavailableError extends ApiError {
  constructor(message = 'Service temporarily unavailable') {
    super(message, 503, 'SERVICE_UNAVAILABLE');
  }
}

/**
 * Business Logic Errors
 */
class InsufficientStockError extends ApiError {
  constructor(productName, available, requested) {
    super(`Insufficient stock for ${productName}. Available: ${available}, Requested: ${requested}`, 400, 'INSUFFICIENT_STOCK', {
      available,
      requested,
    });
  }
}

class PaymentFailedError extends ApiError {
  constructor(reason) {
    super(`Payment failed: ${reason}`, 400, 'PAYMENT_FAILED');
  }
}

class OrderStateError extends ApiError {
  constructor(currentState, action) {
    super(`Cannot ${action} order in ${currentState} state`, 400, 'INVALID_ORDER_STATE');
  }
}

class VerificationRequiredError extends ApiError {
  constructor(message = 'Business verification required to perform this action') {
    super(message, 403, 'VERIFICATION_REQUIRED');
  }
}

class SubscriptionRequiredError extends ApiError {
  constructor(feature) {
    super(`Active subscription required to access ${feature}`, 403, 'SUBSCRIPTION_REQUIRED');
  }
}

module.exports = {
  ApiError,
  BadRequestError,
  UnauthorizedError,
  ForbiddenError,
  NotFoundError,
  ConflictError,
  ValidationError,
  RateLimitError,
  InternalError,
  ExternalServiceError,
  ServiceUnavailableError,
  InsufficientStockError,
  PaymentFailedError,
  OrderStateError,
  VerificationRequiredError,
  SubscriptionRequiredError,
};
