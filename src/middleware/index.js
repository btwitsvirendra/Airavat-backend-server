// =============================================================================
// AIRAVAT B2B MARKETPLACE - MIDDLEWARE INDEX
// Central export for all middleware
// =============================================================================

const authMiddleware = require('./auth');
const errorHandler = require('./errorHandler');
const rateLimiter = require('./rateLimiter');
const { validate, validateAll, schemas } = require('./validation');
const upload = require('./upload');
const security = require('./security');

module.exports = {
  // Authentication & Authorization
  auth: authMiddleware,
  authenticate: authMiddleware.authenticate,
  authorize: authMiddleware.authorize,
  optionalAuth: authMiddleware.optionalAuth,
  requireBusiness: authMiddleware.requireBusiness,
  requireVerifiedBusiness: authMiddleware.requireVerifiedBusiness,

  // Error Handling
  errorHandler,

  // Rate Limiting
  rateLimiter,
  apiLimiter: rateLimiter.apiLimiter,
  authLimiter: rateLimiter.authLimiter,
  uploadLimiter: rateLimiter.uploadLimiter,

  // Validation
  validate,
  validateAll,
  schemas,

  // File Uploads
  upload,
  uploadProductImages: upload.uploadProductImages,
  uploadBusinessLogo: upload.uploadBusinessLogo,
  uploadDocument: upload.uploadDocument,
  uploadAvatar: upload.uploadAvatar,
  handleUploadError: upload.handleUploadError,
  processUploads: upload.processUploads,

  // Security
  security,
  cors: security.cors,
  helmet: security.helmet,
  xssSanitizer: security.xssSanitizer,
  requestId: security.requestId,
  extractIP: security.extractIP,
  extractDeviceInfo: security.extractDeviceInfo,
  applySecurityMiddleware: security.applySecurityMiddleware,
};
