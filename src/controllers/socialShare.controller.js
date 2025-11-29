// =============================================================================
// AIRAVAT B2B MARKETPLACE - SOCIAL SHARING CONTROLLER
// Controller for social sharing functionality
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const socialSharingService = require('../services/socialSharing.service');
const logger = require('../config/logger');

// =============================================================================
// SHARE LINK GENERATION
// =============================================================================

/**
 * @desc    Get share links for a product
 * @route   GET /api/v1/share/product/:productId
 * @access  Public
 */
exports.getProductShareLinks = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { source } = req.query;

  const result = await socialSharingService.getProductShareLinks(productId, {
    userId: req.user?.id,
    source: source || 'direct',
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Get share links for a business
 * @route   GET /api/v1/share/business/:businessId
 * @access  Public
 */
exports.getBusinessShareLinks = asyncHandler(async (req, res) => {
  const { businessId } = req.params;
  const { source } = req.query;

  const result = await socialSharingService.getBusinessShareLinks(businessId, {
    userId: req.user?.id,
    source: source || 'direct',
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Get share links for an RFQ
 * @route   GET /api/v1/share/rfq/:rfqId
 * @access  Public
 */
exports.getRFQShareLinks = asyncHandler(async (req, res) => {
  const { rfqId } = req.params;
  const { source } = req.query;

  const result = await socialSharingService.getRFQShareLinks(rfqId, {
    userId: req.user?.id,
    source: source || 'direct',
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Get custom share links
 * @route   POST /api/v1/share/custom
 * @access  Private
 */
exports.getCustomShareLinks = asyncHandler(async (req, res) => {
  const { title, description, url, image, hashtags } = req.body;

  const result = await socialSharingService.getCustomShareLinks({
    title,
    description,
    url,
    image,
    hashtags,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

// =============================================================================
// SHARE TRACKING
// =============================================================================

/**
 * @desc    Track a share event
 * @route   POST /api/v1/share/track
 * @access  Public
 */
exports.trackShare = asyncHandler(async (req, res) => {
  const { entityType, entityId, platform, source, referrer } = req.body;

  const result = await socialSharingService.trackShare(entityType, entityId, platform, {
    userId: req.user?.id,
    source,
    referrer,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Handle referral from share link
 * @route   GET /api/v1/share/referral/:trackingCode
 * @access  Public
 */
exports.handleReferral = asyncHandler(async (req, res) => {
  const { trackingCode } = req.params;

  const result = await socialSharingService.handleReferral(trackingCode, {
    ip: req.ip,
    userAgent: req.headers['user-agent'],
    referrer: req.headers.referer,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

// =============================================================================
// SHARE ANALYTICS
// =============================================================================

/**
 * @desc    Get share analytics for an entity
 * @route   GET /api/v1/share/analytics/:entityType/:entityId
 * @access  Private
 */
exports.getShareAnalytics = asyncHandler(async (req, res) => {
  const { entityType, entityId } = req.params;
  const { startDate, endDate } = req.query;

  const result = await socialSharingService.getShareAnalytics(entityType, entityId, {
    startDate,
    endDate,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Get social proof for an entity
 * @route   GET /api/v1/share/social-proof/:entityType/:entityId
 * @access  Public
 */
exports.getSocialProof = asyncHandler(async (req, res) => {
  const { entityType, entityId } = req.params;

  const result = await socialSharingService.getSocialProof(entityType, entityId);

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Get supported platforms
 * @route   GET /api/v1/share/platforms
 * @access  Public
 */
exports.getSupportedPlatforms = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: socialSharingService.PLATFORMS,
  });
});

module.exports = exports;



