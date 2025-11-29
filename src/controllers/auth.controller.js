// =============================================================================
// AIRAVAT B2B MARKETPLACE - AUTHENTICATION CONTROLLER
// =============================================================================

const authService = require('../services/auth.service');
const emailService = require('../services/email.service');
const smsService = require('../services/sms.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, created } = require('../utils/response');
const { BadRequestError, UnauthorizedError } = require('../utils/errors');
const { generateToken } = require('../utils/helpers');
const config = require('../config');

/**
 * Register new user
 * POST /api/v1/auth/register
 */
exports.register = asyncHandler(async (req, res) => {
  const { email, phone, password, firstName, lastName, role } = req.body;
  
  const result = await authService.register({
    email,
    phone,
    password,
    firstName,
    lastName,
    role: role || 'BUYER',
  });
  
  // Send verification email
  if (email) {
    await emailService.sendVerificationEmail(result.user.email, result.user.id);
  }
  
  // Set refresh token in HTTP-only cookie
  res.cookie('refreshToken', result.refreshToken, {
    httpOnly: true,
    secure: config.app.isProd,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000, // 30 days
  });
  
  created(res, {
    user: result.user,
    accessToken: result.accessToken,
  }, 'Registration successful. Please verify your email.');
});

/**
 * Login with email/password
 * POST /api/v1/auth/login
 */
exports.login = asyncHandler(async (req, res) => {
  const { email, password, twoFactorCode } = req.body;
  
  const result = await authService.login(email, password, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
    twoFactorCode,
  });
  
  // If 2FA is required but not provided
  if (result.requires2FA) {
    return success(res, { requires2FA: true }, 'Two-factor authentication required');
  }
  
  // Set refresh token in HTTP-only cookie
  res.cookie('refreshToken', result.refreshToken, {
    httpOnly: true,
    secure: config.app.isProd,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  
  success(res, {
    user: result.user,
    accessToken: result.accessToken,
  }, 'Login successful');
});

/**
 * Login with phone OTP
 * POST /api/v1/auth/login/otp
 */
exports.loginWithOTP = asyncHandler(async (req, res) => {
  const { phone, otp } = req.body;
  
  if (!phone || !otp) {
    throw new BadRequestError('Phone number and OTP are required');
  }
  
  const result = await authService.loginWithOTP(phone, otp, {
    ip: req.ip,
    userAgent: req.get('User-Agent'),
  });
  
  res.cookie('refreshToken', result.refreshToken, {
    httpOnly: true,
    secure: config.app.isProd,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  
  success(res, {
    user: result.user,
    accessToken: result.accessToken,
  }, 'Login successful');
});

/**
 * Send OTP
 * POST /api/v1/auth/otp/send
 */
exports.sendOTP = asyncHandler(async (req, res) => {
  const { phone, email, purpose } = req.body;
  
  if (!phone && !email) {
    throw new BadRequestError('Phone number or email is required');
  }
  
  const otp = await authService.generateAndStoreOTP(phone || email, purpose || 'login');
  
  // Send OTP via SMS or email
  if (phone) {
    await smsService.sendOTP(phone, otp);
  } else {
    await emailService.sendOTPEmail(email, otp);
  }
  
  success(res, {
    sent: true,
    expiresIn: config.businessRules.otpExpiryMinutes * 60,
  }, 'OTP sent successfully');
});

/**
 * Verify OTP
 * POST /api/v1/auth/otp/verify
 */
exports.verifyOTP = asyncHandler(async (req, res) => {
  const { phone, email, otp, purpose } = req.body;
  
  const identifier = phone || email;
  if (!identifier || !otp) {
    throw new BadRequestError('Identifier and OTP are required');
  }
  
  const isValid = await authService.verifyOTP(identifier, otp, purpose || 'login');
  
  if (!isValid) {
    throw new BadRequestError('Invalid or expired OTP');
  }
  
  success(res, { verified: true }, 'OTP verified successfully');
});

/**
 * Refresh access token
 * POST /api/v1/auth/refresh-token
 */
exports.refreshToken = asyncHandler(async (req, res) => {
  const refreshToken = req.cookies.refreshToken || req.body.refreshToken;
  
  if (!refreshToken) {
    throw new UnauthorizedError('Refresh token required');
  }
  
  const result = await authService.refreshAccessToken(refreshToken);
  
  // Set new refresh token
  res.cookie('refreshToken', result.refreshToken, {
    httpOnly: true,
    secure: config.app.isProd,
    sameSite: 'strict',
    maxAge: 30 * 24 * 60 * 60 * 1000,
  });
  
  success(res, {
    accessToken: result.accessToken,
  }, 'Token refreshed');
});

/**
 * Forgot password
 * POST /api/v1/auth/forgot-password
 */
exports.forgotPassword = asyncHandler(async (req, res) => {
  const { email } = req.body;
  
  if (!email) {
    throw new BadRequestError('Email is required');
  }
  
  const resetToken = await authService.createPasswordResetToken(email);
  
  if (resetToken) {
    await emailService.sendPasswordResetEmail(email, resetToken);
  }
  
  // Always return success to prevent email enumeration
  success(res, null, 'If the email exists, a password reset link has been sent');
});

/**
 * Reset password
 * POST /api/v1/auth/reset-password
 */
exports.resetPassword = asyncHandler(async (req, res) => {
  const { token, password } = req.body;
  
  await authService.resetPassword(token, password);
  
  success(res, null, 'Password reset successful. You can now login with your new password.');
});

/**
 * Verify email
 * GET /api/v1/auth/verify-email/:token
 */
exports.verifyEmail = asyncHandler(async (req, res) => {
  const { token } = req.params;
  
  await authService.verifyEmail(token);
  
  // Redirect to frontend with success message
  res.redirect(`${config.app.frontendUrl}/email-verified?success=true`);
});

/**
 * Get current user
 * GET /api/v1/auth/me
 */
exports.getCurrentUser = asyncHandler(async (req, res) => {
  const user = await authService.getUserById(req.user.id);
  success(res, { user });
});

/**
 * Update profile
 * PATCH /api/v1/auth/me
 */
exports.updateProfile = asyncHandler(async (req, res) => {
  const allowedFields = ['firstName', 'lastName', 'avatar', 'language', 'timezone'];
  const updates = {};
  
  allowedFields.forEach((field) => {
    if (req.body[field] !== undefined) {
      updates[field] = req.body[field];
    }
  });
  
  const user = await authService.updateUser(req.user.id, updates);
  
  success(res, { user }, 'Profile updated successfully');
});

/**
 * Change password
 * POST /api/v1/auth/change-password
 */
exports.changePassword = asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body;
  
  await authService.changePassword(req.user.id, currentPassword, newPassword);
  
  success(res, null, 'Password changed successfully');
});

/**
 * Logout
 * POST /api/v1/auth/logout
 */
exports.logout = asyncHandler(async (req, res) => {
  await authService.logout(req.token);
  
  res.clearCookie('refreshToken');
  
  success(res, null, 'Logged out successfully');
});

/**
 * Logout from all devices
 * POST /api/v1/auth/logout-all
 */
exports.logoutAll = asyncHandler(async (req, res) => {
  await authService.logoutAll(req.user.id);
  
  res.clearCookie('refreshToken');
  
  success(res, null, 'Logged out from all devices');
});

/**
 * Get active sessions
 * GET /api/v1/auth/sessions
 */
exports.getSessions = asyncHandler(async (req, res) => {
  const sessions = await authService.getUserSessions(req.user.id);
  
  success(res, { sessions });
});

/**
 * Revoke specific session
 * DELETE /api/v1/auth/sessions/:sessionId
 */
exports.revokeSession = asyncHandler(async (req, res) => {
  await authService.revokeSession(req.user.id, req.params.sessionId);
  
  success(res, null, 'Session revoked');
});

/**
 * Enable 2FA
 * POST /api/v1/auth/2fa/enable
 */
exports.enable2FA = asyncHandler(async (req, res) => {
  const { secret, qrCode } = await authService.generate2FASecret(req.user.id);
  
  success(res, { secret, qrCode }, 'Scan the QR code with your authenticator app');
});

/**
 * Verify and activate 2FA
 * POST /api/v1/auth/2fa/verify
 */
exports.verify2FA = asyncHandler(async (req, res) => {
  const { code } = req.body;
  
  if (!code) {
    throw new BadRequestError('Verification code is required');
  }
  
  await authService.verify2FA(req.user.id, code);
  
  success(res, null, 'Two-factor authentication enabled');
});

/**
 * Disable 2FA
 * POST /api/v1/auth/2fa/disable
 */
exports.disable2FA = asyncHandler(async (req, res) => {
  const { password, code } = req.body;
  
  await authService.disable2FA(req.user.id, password, code);
  
  success(res, null, 'Two-factor authentication disabled');
});
