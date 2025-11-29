// =============================================================================
// AIRAVAT B2B MARKETPLACE - DEEP LINK CONTROLLER
// Controller for deep linking endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const deepLinkService = require('../services/deepLink.service');
const logger = require('../config/logger');

// =============================================================================
// GENERATE DEEP LINKS
// =============================================================================

/**
 * @desc    Generate deep link for any entity
 * @route   POST /api/v1/deep-links
 * @access  Private
 */
exports.generateDeepLink = asyncHandler(async (req, res) => {
  const { type, params, expiresIn, campaign, source } = req.body;

  const result = await deepLinkService.generateDeepLink(type, params, {
    expiresIn,
    campaign,
    source,
    userId: req.user.id,
  });

  res.status(201).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Generate product deep link
 * @route   POST /api/v1/deep-links/product/:productId
 * @access  Private
 */
exports.generateProductLink = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { campaign, source } = req.body;

  const result = await deepLinkService.generateProductLink(productId, {
    campaign,
    source,
    userId: req.user.id,
  });

  res.status(201).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Generate referral deep link
 * @route   POST /api/v1/deep-links/referral
 * @access  Private
 */
exports.generateReferralLink = asyncHandler(async (req, res) => {
  const { campaign, source } = req.body;

  const result = await deepLinkService.generateReferralLink(req.user.id, {
    campaign,
    source,
  });

  res.status(201).json({
    success: true,
    data: result,
  });
});

// =============================================================================
// RESOLVE DEEP LINKS
// =============================================================================

/**
 * @desc    Resolve deep link by short code
 * @route   GET /api/v1/deep-links/:shortCode
 * @access  Public
 */
exports.resolveDeepLink = asyncHandler(async (req, res) => {
  const { shortCode } = req.params;

  const result = await deepLinkService.resolveDeepLink(shortCode, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    referrer: req.headers.referer,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Redirect to appropriate destination
 * @route   GET /api/v1/deep-links/:shortCode/redirect
 * @access  Public
 */
exports.redirectDeepLink = asyncHandler(async (req, res) => {
  const { shortCode } = req.params;
  const userAgent = req.headers['user-agent'];

  const redirectUrl = await deepLinkService.getRedirectUrl(shortCode, userAgent);

  res.redirect(302, redirectUrl);
});

// =============================================================================
// LINK MANAGEMENT
// =============================================================================

/**
 * @desc    Get user's deep links
 * @route   GET /api/v1/deep-links
 * @access  Private
 */
exports.getUserDeepLinks = asyncHandler(async (req, res) => {
  const { page, limit, type } = req.query;

  const result = await deepLinkService.getUserDeepLinks(req.user.id, {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
    type,
  });

  res.status(200).json({
    success: true,
    data: result.links,
    pagination: result.pagination,
  });
});

/**
 * @desc    Get deep link analytics
 * @route   GET /api/v1/deep-links/:shortCode/analytics
 * @access  Private
 */
exports.getLinkAnalytics = asyncHandler(async (req, res) => {
  const { shortCode } = req.params;

  const result = await deepLinkService.getLinkAnalytics(shortCode, req.user.id);

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Delete deep link
 * @route   DELETE /api/v1/deep-links/:shortCode
 * @access  Private
 */
exports.deleteDeepLink = asyncHandler(async (req, res) => {
  const { shortCode } = req.params;

  await deepLinkService.deleteDeepLink(shortCode, req.user.id);

  res.status(200).json({
    success: true,
    message: 'Deep link deleted successfully',
  });
});

/**
 * @desc    Update deep link expiry
 * @route   PUT /api/v1/deep-links/:shortCode/expiry
 * @access  Private
 */
exports.updateExpiry = asyncHandler(async (req, res) => {
  const { shortCode } = req.params;
  const { expiresAt } = req.body;

  const result = await deepLinkService.updateExpiry(shortCode, req.user.id, expiresAt);

  res.status(200).json({
    success: true,
    data: result,
  });
});

module.exports = exports;



