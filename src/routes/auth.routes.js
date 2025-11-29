// =============================================================================
// AIRAVAT B2B MARKETPLACE - AUTHENTICATION ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const authController = require('../controllers/auth.controller');
const { authenticate } = require('../middleware/auth');
const { authLimiter, otpLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/errorHandler');
const { 
  registerSchema, 
  loginSchema, 
  sendOTPSchema,
  verifyOTPSchema,
  resetPasswordSchema,
  changePasswordSchema 
} = require('../validators/schemas');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

// Register new user
router.post(
  '/register',
  authLimiter,
  validate(registerSchema),
  authController.register
);

// Login with email/password
router.post(
  '/login',
  authLimiter,
  validate(loginSchema),
  authController.login
);

// Login with phone OTP
router.post(
  '/login/otp',
  authLimiter,
  authController.loginWithOTP
);

// Send OTP (for login/verification)
router.post(
  '/otp/send',
  otpLimiter,
  validate(sendOTPSchema),
  authController.sendOTP
);

// Verify OTP
router.post(
  '/otp/verify',
  authLimiter,
  validate(verifyOTPSchema),
  authController.verifyOTP
);

// Refresh access token
router.post(
  '/refresh-token',
  authController.refreshToken
);

// Forgot password - send reset link
router.post(
  '/forgot-password',
  authLimiter,
  authController.forgotPassword
);

// Reset password with token
router.post(
  '/reset-password',
  authLimiter,
  validate(resetPasswordSchema),
  authController.resetPassword
);

// Verify email with token
router.get(
  '/verify-email/:token',
  authController.verifyEmail
);

// =============================================================================
// PROTECTED ROUTES
// =============================================================================

// Get current user
router.get(
  '/me',
  authenticate,
  authController.getCurrentUser
);

// Update current user profile
router.patch(
  '/me',
  authenticate,
  authController.updateProfile
);

// Change password
router.post(
  '/change-password',
  authenticate,
  validate(changePasswordSchema),
  authController.changePassword
);

// Logout (invalidate token)
router.post(
  '/logout',
  authenticate,
  authController.logout
);

// Logout from all devices
router.post(
  '/logout-all',
  authenticate,
  authController.logoutAll
);

// Get active sessions
router.get(
  '/sessions',
  authenticate,
  authController.getSessions
);

// Revoke specific session
router.delete(
  '/sessions/:sessionId',
  authenticate,
  authController.revokeSession
);

// Enable 2FA
router.post(
  '/2fa/enable',
  authenticate,
  authController.enable2FA
);

// Verify and activate 2FA
router.post(
  '/2fa/verify',
  authenticate,
  authController.verify2FA
);

// Disable 2FA
router.post(
  '/2fa/disable',
  authenticate,
  authController.disable2FA
);

module.exports = router;
