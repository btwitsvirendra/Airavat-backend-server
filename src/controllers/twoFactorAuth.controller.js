// =============================================================================
// AIRAVAT B2B MARKETPLACE - TWO-FACTOR AUTH CONTROLLER
// =============================================================================

const TwoFactorAuthService = require('../services/twoFactorAuth.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Generate OTP
exports.generateOTP = asyncHandler(async (req, res) => {
  const { type = 'sms' } = req.body;
  const result = await TwoFactorAuthService.generateOTP(req.user.id, type);
  res.json({ success: true, data: result });
});

// Verify OTP
exports.verifyOTP = asyncHandler(async (req, res) => {
  const { otp, type = 'sms' } = req.body;
  const result = await TwoFactorAuthService.verifyOTP(req.user.id, otp, type);
  res.json({ success: true, data: result });
});

// Setup TOTP
exports.setupTOTP = asyncHandler(async (req, res) => {
  const result = await TwoFactorAuthService.setupTOTP(req.user.id);
  res.json({ success: true, data: result });
});

// Verify and enable TOTP
exports.enableTOTP = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const result = await TwoFactorAuthService.verifyAndEnableTOTP(req.user.id, token);
  res.json({ success: true, data: result });
});

// Verify TOTP
exports.verifyTOTP = asyncHandler(async (req, res) => {
  const { token } = req.body;
  const result = await TwoFactorAuthService.verifyTOTP(req.user.id, token);
  res.json({ success: true, data: result });
});

// Disable TOTP
exports.disableTOTP = asyncHandler(async (req, res) => {
  const { password } = req.body;
  const result = await TwoFactorAuthService.disableTOTP(req.user.id, password);
  res.json({ success: true, data: result });
});

// Verify backup code
exports.verifyBackupCode = asyncHandler(async (req, res) => {
  const { code } = req.body;
  const result = await TwoFactorAuthService.verifyBackupCode(req.user.id, code);
  res.json({ success: true, data: result });
});

// Regenerate backup codes
exports.regenerateBackupCodes = asyncHandler(async (req, res) => {
  const result = await TwoFactorAuthService.regenerateBackupCodes(req.user.id);
  res.json({ success: true, data: result });
});

// Check 2FA status
exports.getStatus = asyncHandler(async (req, res) => {
  const enabled = await TwoFactorAuthService.is2FAEnabled(req.user.id);
  res.json({ success: true, data: { enabled } });
});

