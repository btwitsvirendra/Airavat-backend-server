// =============================================================================
// AIRAVAT B2B MARKETPLACE - API RESPONSE UTILITIES
// Standardized API response formatting
// =============================================================================

const logger = require('../config/logger');

/**
 * Standard API response codes
 */
const RESPONSE_CODES = {
  // Success codes
  SUCCESS: 'SUCCESS',
  CREATED: 'CREATED',
  UPDATED: 'UPDATED',
  DELETED: 'DELETED',
  NO_CONTENT: 'NO_CONTENT',

  // Client error codes
  BAD_REQUEST: 'BAD_REQUEST',
  VALIDATION_ERROR: 'VALIDATION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  FORBIDDEN: 'FORBIDDEN',
  NOT_FOUND: 'NOT_FOUND',
  CONFLICT: 'CONFLICT',
  GONE: 'GONE',
  UNPROCESSABLE_ENTITY: 'UNPROCESSABLE_ENTITY',
  TOO_MANY_REQUESTS: 'TOO_MANY_REQUESTS',

  // Server error codes
  INTERNAL_ERROR: 'INTERNAL_ERROR',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  GATEWAY_TIMEOUT: 'GATEWAY_TIMEOUT',

  // Business logic codes
  INSUFFICIENT_STOCK: 'INSUFFICIENT_STOCK',
  PAYMENT_FAILED: 'PAYMENT_FAILED',
  ORDER_CANCELLED: 'ORDER_CANCELLED',
  BUSINESS_NOT_VERIFIED: 'BUSINESS_NOT_VERIFIED',
  SUBSCRIPTION_REQUIRED: 'SUBSCRIPTION_REQUIRED',
  CREDIT_LIMIT_EXCEEDED: 'CREDIT_LIMIT_EXCEEDED',
  FEATURE_DISABLED: 'FEATURE_DISABLED',
};

/**
 * HTTP status code mapping
 */
const HTTP_STATUS = {
  [RESPONSE_CODES.SUCCESS]: 200,
  [RESPONSE_CODES.CREATED]: 201,
  [RESPONSE_CODES.UPDATED]: 200,
  [RESPONSE_CODES.DELETED]: 200,
  [RESPONSE_CODES.NO_CONTENT]: 204,
  [RESPONSE_CODES.BAD_REQUEST]: 400,
  [RESPONSE_CODES.VALIDATION_ERROR]: 400,
  [RESPONSE_CODES.UNAUTHORIZED]: 401,
  [RESPONSE_CODES.FORBIDDEN]: 403,
  [RESPONSE_CODES.NOT_FOUND]: 404,
  [RESPONSE_CODES.CONFLICT]: 409,
  [RESPONSE_CODES.GONE]: 410,
  [RESPONSE_CODES.UNPROCESSABLE_ENTITY]: 422,
  [RESPONSE_CODES.TOO_MANY_REQUESTS]: 429,
  [RESPONSE_CODES.INTERNAL_ERROR]: 500,
  [RESPONSE_CODES.SERVICE_UNAVAILABLE]: 503,
  [RESPONSE_CODES.GATEWAY_TIMEOUT]: 504,
  [RESPONSE_CODES.INSUFFICIENT_STOCK]: 400,
  [RESPONSE_CODES.PAYMENT_FAILED]: 400,
  [RESPONSE_CODES.ORDER_CANCELLED]: 400,
  [RESPONSE_CODES.BUSINESS_NOT_VERIFIED]: 403,
  [RESPONSE_CODES.SUBSCRIPTION_REQUIRED]: 403,
  [RESPONSE_CODES.CREDIT_LIMIT_EXCEEDED]: 400,
  [RESPONSE_CODES.FEATURE_DISABLED]: 403,
};

/**
 * Success response builder
 */
class SuccessResponse {
  constructor(data, options = {}) {
    this.success = true;
    this.code = options.code || RESPONSE_CODES.SUCCESS;
    this.message = options.message || 'Request successful';

    if (data !== undefined && data !== null) {
      this.data = data;
    }

    if (options.meta) {
      this.meta = options.meta;
    }
  }

  /**
   * Add pagination info
   */
  withPagination(pagination) {
    this.pagination = {
      page: pagination.page,
      limit: pagination.limit,
      total: pagination.total,
      pages: pagination.pages || Math.ceil(pagination.total / pagination.limit),
      hasNext: pagination.page < (pagination.pages || Math.ceil(pagination.total / pagination.limit)),
      hasPrev: pagination.page > 1,
    };
    return this;
  }

  /**
   * Add metadata
   */
  withMeta(meta) {
    this.meta = { ...this.meta, ...meta };
    return this;
  }

  /**
   * Add links (HATEOAS)
   */
  withLinks(links) {
    this.links = links;
    return this;
  }

  /**
   * Send response
   */
  send(res) {
    const status = HTTP_STATUS[this.code] || 200;
    return res.status(status).json(this);
  }
}

/**
 * Error response builder
 */
class ErrorResponse extends Error {
  constructor(message, code = RESPONSE_CODES.INTERNAL_ERROR, details = {}) {
    super(message);
    this.success = false;
    this.code = code;
    this.statusCode = HTTP_STATUS[code] || 500;
    this.details = details;
    this.timestamp = new Date().toISOString();

    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Add field errors
   */
  withErrors(errors) {
    this.errors = errors;
    return this;
  }

  /**
   * Add suggestions
   */
  withSuggestions(suggestions) {
    this.suggestions = suggestions;
    return this;
  }

  /**
   * Add documentation link
   */
  withDocLink(link) {
    this.docLink = link;
    return this;
  }

  /**
   * Convert to JSON response
   */
  toJSON() {
    const response = {
      success: false,
      code: this.code,
      message: this.message,
      timestamp: this.timestamp,
    };

    if (this.errors) {
      response.errors = this.errors;
    }

    if (this.details && Object.keys(this.details).length > 0) {
      response.details = this.details;
    }

    if (this.suggestions) {
      response.suggestions = this.suggestions;
    }

    if (this.docLink) {
      response.docLink = this.docLink;
    }

    return response;
  }

  /**
   * Send response
   */
  send(res) {
    return res.status(this.statusCode).json(this.toJSON());
  }
}

/**
 * Pre-built error responses
 */
const errors = {
  badRequest: (message = 'Bad request', details = {}) =>
    new ErrorResponse(message, RESPONSE_CODES.BAD_REQUEST, details),

  validationError: (errors, message = 'Validation failed') =>
    new ErrorResponse(message, RESPONSE_CODES.VALIDATION_ERROR).withErrors(errors),

  unauthorized: (message = 'Unauthorized access') =>
    new ErrorResponse(message, RESPONSE_CODES.UNAUTHORIZED),

  forbidden: (message = 'Access forbidden') =>
    new ErrorResponse(message, RESPONSE_CODES.FORBIDDEN),

  notFound: (resource = 'Resource', message) =>
    new ErrorResponse(message || `${resource} not found`, RESPONSE_CODES.NOT_FOUND),

  conflict: (message = 'Resource conflict') =>
    new ErrorResponse(message, RESPONSE_CODES.CONFLICT),

  tooManyRequests: (retryAfter, message = 'Too many requests') =>
    new ErrorResponse(message, RESPONSE_CODES.TOO_MANY_REQUESTS, { retryAfter }),

  internalError: (message = 'Internal server error') =>
    new ErrorResponse(message, RESPONSE_CODES.INTERNAL_ERROR),

  serviceUnavailable: (message = 'Service temporarily unavailable') =>
    new ErrorResponse(message, RESPONSE_CODES.SERVICE_UNAVAILABLE),

  insufficientStock: (details) =>
    new ErrorResponse('Insufficient stock', RESPONSE_CODES.INSUFFICIENT_STOCK, details),

  paymentFailed: (reason) =>
    new ErrorResponse('Payment failed', RESPONSE_CODES.PAYMENT_FAILED, { reason }),

  businessNotVerified: () =>
    new ErrorResponse('Business verification required', RESPONSE_CODES.BUSINESS_NOT_VERIFIED),

  subscriptionRequired: (feature) =>
    new ErrorResponse(`Subscription required for ${feature}`, RESPONSE_CODES.SUBSCRIPTION_REQUIRED),

  featureDisabled: (feature) =>
    new ErrorResponse(`Feature ${feature} is disabled`, RESPONSE_CODES.FEATURE_DISABLED),
};

/**
 * Response helper middleware
 */
function responseHelpers(req, res, next) {
  // Success responses
  res.success = (data, options = {}) => {
    return new SuccessResponse(data, options).send(res);
  };

  res.created = (data, message = 'Resource created successfully') => {
    return new SuccessResponse(data, {
      code: RESPONSE_CODES.CREATED,
      message,
    }).send(res);
  };

  res.updated = (data, message = 'Resource updated successfully') => {
    return new SuccessResponse(data, {
      code: RESPONSE_CODES.UPDATED,
      message,
    }).send(res);
  };

  res.deleted = (message = 'Resource deleted successfully') => {
    return new SuccessResponse(null, {
      code: RESPONSE_CODES.DELETED,
      message,
    }).send(res);
  };

  res.noContent = () => {
    return res.status(204).end();
  };

  res.paginated = (data, pagination, options = {}) => {
    return new SuccessResponse(data, options)
      .withPagination(pagination)
      .send(res);
  };

  // Error responses
  res.error = (error) => {
    if (error instanceof ErrorResponse) {
      return error.send(res);
    }
    return errors.internalError(error.message).send(res);
  };

  res.badRequest = (message, details) => errors.badRequest(message, details).send(res);
  res.unauthorized = (message) => errors.unauthorized(message).send(res);
  res.forbidden = (message) => errors.forbidden(message).send(res);
  res.notFound = (resource, message) => errors.notFound(resource, message).send(res);
  res.conflict = (message) => errors.conflict(message).send(res);
  res.validationError = (errors) => errors.validationError(errors).send(res);

  next();
}

/**
 * Async handler wrapper
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch((error) => {
    logger.error('Request handler error', {
      error: error.message,
      stack: error.stack,
      path: req.path,
      method: req.method,
    });

    if (error instanceof ErrorResponse) {
      return error.send(res);
    }

    // Convert known errors
    if (error.name === 'ValidationError') {
      return errors.validationError(error.details || [error.message]).send(res);
    }

    if (error.name === 'CastError') {
      return errors.badRequest('Invalid ID format').send(res);
    }

    if (error.code === 'P2002') {
      return errors.conflict('Resource already exists').send(res);
    }

    if (error.code === 'P2025') {
      return errors.notFound('Resource').send(res);
    }

    // Generic error
    return errors.internalError(
      process.env.NODE_ENV === 'production' ? 'An error occurred' : error.message
    ).send(res);
  });
};

/**
 * Format list response with pagination
 */
function formatListResponse(items, total, page, limit) {
  return {
    data: items,
    pagination: {
      page,
      limit,
      total,
      pages: Math.ceil(total / limit),
      hasNext: page * limit < total,
      hasPrev: page > 1,
    },
  };
}

/**
 * Format single item response
 */
function formatItemResponse(item, includes = {}) {
  return {
    data: item,
    ...includes,
  };
}

module.exports = {
  RESPONSE_CODES,
  HTTP_STATUS,
  SuccessResponse,
  ErrorResponse,
  errors,
  responseHelpers,
  asyncHandler,
  formatListResponse,
  formatItemResponse,
};
