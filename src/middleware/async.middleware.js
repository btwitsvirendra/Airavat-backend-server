// =============================================================================
// AIRAVAT B2B MARKETPLACE - ASYNC HANDLER MIDDLEWARE
// Wrapper for async route handlers to catch errors
// =============================================================================

/**
 * Wraps async route handlers to automatically catch errors
 * and pass them to the error handling middleware
 * 
 * @param {Function} fn - Async route handler function
 * @returns {Function} Express middleware function
 * 
 * @example
 * exports.getUser = asyncHandler(async (req, res) => {
 *   const user = await userService.getById(req.params.id);
 *   res.json({ success: true, data: user });
 * });
 */
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;



