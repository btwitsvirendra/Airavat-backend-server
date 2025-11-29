// =============================================================================
// AIRAVAT B2B MARKETPLACE - COOKIE CONSENT CONTROLLER
// Controller for GDPR/CCPA cookie consent management
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const cookieConsentService = require('../services/cookieConsent.service');
const logger = require('../config/logger');

// =============================================================================
// CONSENT CONFIGURATION
// =============================================================================

/**
 * @desc    Get cookie consent configuration
 * @route   GET /api/v1/consent/config
 * @access  Public
 */
exports.getConsentConfig = asyncHandler(async (req, res) => {
  const config = cookieConsentService.getConsentConfig();

  res.status(200).json({
    success: true,
    data: config,
  });
});

/**
 * @desc    Get cookie banner configuration
 * @route   GET /api/v1/consent/banner
 * @access  Public
 */
exports.getBannerConfig = asyncHandler(async (req, res) => {
  const locale = req.query.locale || req.headers['accept-language']?.split(',')[0] || 'en';

  const config = cookieConsentService.getBannerConfig(locale);

  res.status(200).json({
    success: true,
    data: config,
  });
});

// =============================================================================
// CONSENT MANAGEMENT
// =============================================================================

/**
 * @desc    Save cookie consent preferences
 * @route   POST /api/v1/consent
 * @access  Public
 */
exports.saveConsent = asyncHandler(async (req, res) => {
  const { preferences } = req.body;

  const result = await cookieConsentService.saveConsent(preferences, {
    userId: req.user?.id,
    sessionId: req.sessionID,
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  });

  // Set consent cookie
  res.cookie('consent_id', result.consentId, {
    maxAge: cookieConsentService.CONFIG.cookieMaxAge,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
  });

  res.status(201).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Get current consent preferences
 * @route   GET /api/v1/consent/:consentId
 * @access  Public
 */
exports.getConsent = asyncHandler(async (req, res) => {
  const { consentId } = req.params;

  const consent = await cookieConsentService.getConsent(consentId);

  if (!consent) {
    return res.status(404).json({
      success: false,
      error: 'Consent not found',
    });
  }

  res.status(200).json({
    success: true,
    data: consent,
  });
});

/**
 * @desc    Update consent preferences
 * @route   PUT /api/v1/consent/:consentId
 * @access  Public
 */
exports.updateConsent = asyncHandler(async (req, res) => {
  const { consentId } = req.params;
  const { preferences } = req.body;

  const result = await cookieConsentService.updateConsent(consentId, preferences, {
    ipAddress: req.ip,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Withdraw all consent
 * @route   POST /api/v1/consent/:consentId/withdraw
 * @access  Public
 */
exports.withdrawConsent = asyncHandler(async (req, res) => {
  const { consentId } = req.params;

  const result = await cookieConsentService.withdrawConsent(consentId, {
    ipAddress: req.ip,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

// =============================================================================
// CONSENT VERIFICATION
// =============================================================================

/**
 * @desc    Check if specific category is allowed
 * @route   GET /api/v1/consent/:consentId/check/:category
 * @access  Public
 */
exports.checkCategoryAllowed = asyncHandler(async (req, res) => {
  const { consentId, category } = req.params;

  const allowed = await cookieConsentService.isCategoryAllowed(consentId, category);

  res.status(200).json({
    success: true,
    data: { category, allowed },
  });
});

/**
 * @desc    Check consent version
 * @route   GET /api/v1/consent/:consentId/version
 * @access  Public
 */
exports.checkVersion = asyncHandler(async (req, res) => {
  const { consentId } = req.params;

  const result = await cookieConsentService.checkConsentVersion(consentId);

  res.status(200).json({
    success: true,
    data: result,
  });
});

// =============================================================================
// ADMIN ENDPOINTS
// =============================================================================

/**
 * @desc    Get consent statistics (Admin)
 * @route   GET /api/v1/consent/admin/stats
 * @access  Private (Admin)
 */
exports.getConsentStats = asyncHandler(async (req, res) => {
  const { startDate, endDate } = req.query;

  const stats = await cookieConsentService.getConsentStats({
    startDate,
    endDate,
  });

  res.status(200).json({
    success: true,
    data: stats,
  });
});

/**
 * @desc    Export consent records (Admin)
 * @route   GET /api/v1/consent/admin/export
 * @access  Private (Admin)
 */
exports.exportConsentRecords = asyncHandler(async (req, res) => {
  const { userId, startDate, endDate, format } = req.query;

  const exportData = await cookieConsentService.exportConsentRecords({
    userId,
    startDate,
    endDate,
    format,
  });

  res.status(200).json({
    success: true,
    data: exportData,
  });
});

module.exports = exports;



