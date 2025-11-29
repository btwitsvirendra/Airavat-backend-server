// =============================================================================
// AIRAVAT B2B MARKETPLACE - RESPONSE HELPERS
// Standardized API response formats
// =============================================================================

/**
 * Success response
 */
const success = (res, data = null, message = 'Success', statusCode = 200) => {
  const response = {
    success: true,
    message,
  };

  if (data !== null) {
    response.data = data;
  }

  return res.status(statusCode).json(response);
};

/**
 * Created response (201)
 */
const created = (res, data, message = 'Created successfully') => {
  return success(res, data, message, 201);
};

/**
 * No content response (204)
 */
const noContent = (res) => {
  return res.status(204).send();
};

/**
 * Paginated response
 */
const paginated = (res, data, pagination, message = 'Success') => {
  return res.status(200).json({
    success: true,
    message,
    data,
    pagination: {
      page: pagination.page,
      limit: pagination.limit,
      total: pagination.total,
      totalPages: Math.ceil(pagination.total / pagination.limit),
      hasMore: pagination.page * pagination.limit < pagination.total,
    },
  });
};

/**
 * Error response
 */
const error = (res, statusCode, code, message, details = null) => {
  const response = {
    success: false,
    error: {
      code,
      message,
    },
  };

  if (details) {
    response.error.details = details;
  }

  return res.status(statusCode).json(response);
};

/**
 * Validation error response
 */
const validationError = (res, errors) => {
  return error(res, 422, 'VALIDATION_ERROR', 'Validation failed', errors);
};

module.exports = {
  success,
  created,
  noContent,
  paginated,
  error,
  validationError,
};
