// =============================================================================
// AIRAVAT B2B MARKETPLACE - ADVERTISING CONTROLLER
// Handles advertising campaigns and sponsored listings
// =============================================================================

const advertisingService = require('../services/advertising.service');
const asyncHandler = require('../middleware/async.middleware');
const { NotFoundError } = require('../utils/errors');

// =============================================================================
// CAMPAIGN MANAGEMENT
// =============================================================================

/**
 * Create an ad campaign
 * @route POST /api/v1/advertising/campaigns
 */
const createCampaign = asyncHandler(async (req, res) => {
  const campaign = await advertisingService.createCampaign(
    req.user.businessId,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Campaign created successfully',
    data: campaign,
  });
});

/**
 * Get all campaigns
 * @route GET /api/v1/advertising/campaigns
 */
const getCampaigns = asyncHandler(async (req, res) => {
  const result = await advertisingService.getCampaigns(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: result.campaigns,
    pagination: result.pagination,
    summary: result.summary,
  });
});

/**
 * Get campaign by ID
 * @route GET /api/v1/advertising/campaigns/:id
 */
const getCampaignById = asyncHandler(async (req, res) => {
  const result = await advertisingService.getCampaigns(
    req.user.businessId,
    { campaignId: req.params.id }
  );

  const campaign = result.campaigns.find((c) => c.id === req.params.id);
  if (!campaign) {
    throw new NotFoundError('Campaign not found');
  }

  res.json({
    success: true,
    data: campaign,
  });
});

/**
 * Update campaign
 * @route PUT /api/v1/advertising/campaigns/:id
 */
const updateCampaign = asyncHandler(async (req, res) => {
  const campaign = await advertisingService.updateCampaign(
    req.params.id,
    req.user.businessId,
    req.body
  );

  res.json({
    success: true,
    message: 'Campaign updated successfully',
    data: campaign,
  });
});

/**
 * Submit campaign for review
 * @route POST /api/v1/advertising/campaigns/:id/submit
 */
const submitForReview = asyncHandler(async (req, res) => {
  const campaign = await advertisingService.submitForReview(
    req.params.id,
    req.user.businessId
  );

  res.json({
    success: true,
    message: 'Campaign submitted for review',
    data: campaign,
  });
});

/**
 * Pause campaign
 * @route POST /api/v1/advertising/campaigns/:id/pause
 */
const pauseCampaign = asyncHandler(async (req, res) => {
  const campaign = await advertisingService.toggleCampaignStatus(
    req.params.id,
    req.user.businessId,
    true
  );

  res.json({
    success: true,
    message: 'Campaign paused',
    data: campaign,
  });
});

/**
 * Resume campaign
 * @route POST /api/v1/advertising/campaigns/:id/resume
 */
const resumeCampaign = asyncHandler(async (req, res) => {
  const campaign = await advertisingService.toggleCampaignStatus(
    req.params.id,
    req.user.businessId,
    false
  );

  res.json({
    success: true,
    message: 'Campaign resumed',
    data: campaign,
  });
});

/**
 * Get campaign performance
 * @route GET /api/v1/advertising/campaigns/:id/performance
 */
const getCampaignPerformance = asyncHandler(async (req, res) => {
  const performance = await advertisingService.getCampaignPerformance(
    req.params.id,
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: performance,
  });
});

// =============================================================================
// AD SERVING (PUBLIC)
// =============================================================================

/**
 * Get ads for a placement
 * @route GET /api/v1/ads/:placement
 */
const getAds = asyncHandler(async (req, res) => {
  const ads = await advertisingService.getAdsForPlacement(
    req.params.placement,
    {
      categoryId: req.query.categoryId,
      searchQuery: req.query.q,
      productId: req.query.productId,
      userId: req.user?.id,
    }
  );

  res.json({
    success: true,
    data: ads,
  });
});

/**
 * Record ad click
 * @route POST /api/v1/ads/click
 */
const recordClick = asyncHandler(async (req, res) => {
  await advertisingService.recordClick(
    req.body.productId,
    req.body.placement,
    {
      userId: req.user?.id,
      sessionId: req.body.sessionId,
      source: req.body.source,
    }
  );

  res.json({
    success: true,
    message: 'Click recorded',
  });
});

/**
 * Get available placements
 * @route GET /api/v1/advertising/placements
 */
const getPlacements = asyncHandler(async (req, res) => {
  res.json({
    success: true,
    data: advertisingService.AD_PLACEMENTS,
  });
});

// =============================================================================
// ADMIN ENDPOINTS
// =============================================================================

/**
 * Review campaign (Admin)
 * @route POST /api/v1/admin/advertising/campaigns/:id/review
 */
const reviewCampaign = asyncHandler(async (req, res) => {
  const campaign = await advertisingService.reviewCampaign(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: `Campaign ${campaign.status.toLowerCase()}`,
    data: campaign,
  });
});

/**
 * Get ad revenue (Admin)
 * @route GET /api/v1/admin/advertising/revenue
 */
const getAdRevenue = asyncHandler(async (req, res) => {
  const revenue = await advertisingService.getAdRevenue(req.query);

  res.json({
    success: true,
    data: revenue,
  });
});

/**
 * Get all campaigns (Admin)
 * @route GET /api/v1/admin/advertising/campaigns
 */
const getAllCampaigns = asyncHandler(async (req, res) => {
  // Admin can see all campaigns
  const result = await advertisingService.getCampaigns(null, req.query);

  res.json({
    success: true,
    data: result.campaigns,
    pagination: result.pagination,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  createCampaign,
  getCampaigns,
  getCampaignById,
  updateCampaign,
  submitForReview,
  pauseCampaign,
  resumeCampaign,
  getCampaignPerformance,
  getAds,
  recordClick,
  getPlacements,
  reviewCampaign,
  getAdRevenue,
  getAllCampaigns,
};



