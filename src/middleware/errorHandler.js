// =============================================================================
// AIRAVAT B2B MARKETPLACE - ERROR HANDLING MIDDLEWARE
// Centralized error handling for consistent error responses
// =============================================================================

const { Prisma } = require('@prisma/client');
const logger = require('../config/logger');
const { ApiError, ValidationError, InternalError } = require('../utils/errors');
const config = require('../config');

/**
 * 404 Not Found handler
 */
const notFoundHandler = (req, res, next) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
  });
};

/**
 * Global error handler
 */
const errorHandler = (err, req, res, next) => {
  // Log error
  logger.logError(err, {
    method: req.method,
    url: req.originalUrl,
    userId: req.user?.id,
    ip: req.ip,
  });

  // Handle specific error types
  let error = err;

  // Prisma errors
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    error = handlePrismaError(err);
  } else if (err instanceof Prisma.PrismaClientValidationError) {
    error = new ValidationError([{ field: 'unknown', message: 'Invalid data provided' }]);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new ApiError('Invalid token', 401, 'INVALID_TOKEN');
  } else if (err.name === 'TokenExpiredError') {
    error = new ApiError('Token expired', 401, 'TOKEN_EXPIRED');
  }

  // Multer errors (file upload)
  if (err.code === 'LIMIT_FILE_SIZE') {
    error = new ApiError('File too large', 400, 'FILE_TOO_LARGE');
  } else if (err.code === 'LIMIT_UNEXPECTED_FILE') {
    error = new ApiError('Unexpected file field', 400, 'UNEXPECTED_FILE');
  }

  // Joi validation errors
  if (err.isJoi) {
    const details = err.details.map((d) => ({
      field: d.path.join('.'),
      message: d.message.replace(/"/g, ''),
    }));
    error = new ValidationError(details);
  }

  // If not an ApiError, wrap it
  if (!(error instanceof ApiError)) {
    error = new InternalError(config.app.isDev ? err.message : 'An unexpected error occurred');
  }

  // Build response
  const response = {
    success: false,
    error: {
      code: error.code,
      message: error.message,
    },
  };

  // Add details for validation errors
  if (error.details) {
    response.error.details = error.details;
  }

  // Add stack trace in development
  if (config.app.isDev && err.stack) {
    response.error.stack = err.stack.split('\n');
  }

  // Add retry-after for rate limit errors
  if (error.retryAfter) {
    res.set('Retry-After', error.retryAfter);
  }

  res.status(error.statusCode).json(response);
};

/**
 * Handle Prisma specific errors
 */
const handlePrismaError = (err) => {
  switch (err.code) {
    case 'P2002': {
      // Unique constraint violation
      const field = err.meta?.target?.[0] || 'field';
      return new ApiError(`A record with this ${field} already exists`, 409, 'DUPLICATE_ENTRY');
    }
    case 'P2003': {
      // Foreign key constraint violation
      return new ApiError('Related record not found', 400, 'FOREIGN_KEY_ERROR');
    }
    case 'P2025': {
      // Record not found
      return new ApiError('Record not found', 404, 'NOT_FOUND');
    }
    case 'P2014': {
      // Required relation violation
      return new ApiError('The change would violate required relation', 400, 'RELATION_ERROR');
    }
    default:
      return new InternalError('Database operation failed');
  }
};

/**
 * Async handler wrapper
 * Catches errors in async route handlers
 */
const asyncHandler = (fn) => {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

/**
 * Validate request body/params/query using Joi schema
 */
const validate = (schema, source = 'body') => {
  return (req, res, next) => {
    const data = req[source];
    
    const { error, value } = schema.validate(data, {
      abortEarly: false,
      stripUnknown: true,
    });
    
    if (error) {
      const details = error.details.map((d) => ({
        field: d.path.join('.'),
        message: d.message.replace(/"/g, ''),
      }));
      return next(new ValidationError(details));
    }
    
    // Replace request data with validated/sanitized data
    req[source] = value;
    next();
  };
};

module.exports = {
  notFoundHandler,
  errorHandler,
  asyncHandler,
  validate,
};
