// =============================================================================
// AIRAVAT B2B MARKETPLACE - TWO-FACTOR AUTH ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const twoFactorAuthController = require('../controllers/twoFactorAuth.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

// OTP
router.post('/otp/send', twoFactorAuthController.generateOTP);
router.post('/otp/verify', twoFactorAuthController.verifyOTP);

// TOTP (Authenticator App)
router.post('/totp/setup', twoFactorAuthController.setupTOTP);
router.post('/totp/enable', twoFactorAuthController.enableTOTP);
router.post('/totp/verify', twoFactorAuthController.verifyTOTP);
router.post('/totp/disable', twoFactorAuthController.disableTOTP);

// Backup codes
router.post('/backup/verify', twoFactorAuthController.verifyBackupCode);
router.post('/backup/regenerate', twoFactorAuthController.regenerateBackupCodes);

// Status
router.get('/status', twoFactorAuthController.getStatus);

module.exports = router;

