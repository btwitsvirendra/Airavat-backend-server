// =============================================================================
// AIRAVAT B2B MARKETPLACE - LEAD GENERATION CONTROLLER
// Handles lead packages, lead marketplace, and intent tracking
// =============================================================================

const leadGenerationService = require('../services/leadGeneration.service');
const asyncHandler = require('../middleware/async.middleware');

// =============================================================================
// LEAD PACKAGES
// =============================================================================

/**
 * Get available lead packages
 * @route GET /api/v1/leads/packages
 */
const getPackages = asyncHandler(async (req, res) => {
  const packages = leadGenerationService.getLeadPackages();

  res.json({
    success: true,
    data: packages,
  });
});

/**
 * Purchase a lead package
 * @route POST /api/v1/leads/packages/purchase
 */
const purchasePackage = asyncHandler(async (req, res) => {
  const result = await leadGenerationService.purchaseLeadPackage(
    req.user.businessId,
    req.body.packageId,
    req.body
  );

  res.status(201).json({
    success: true,
    message: result.message,
    data: result,
  });
});

/**
 * Get lead credit balance
 * @route GET /api/v1/leads/credits
 */
const getCredits = asyncHandler(async (req, res) => {
  const credits = await leadGenerationService.getLeadCredits(
    req.user.businessId
  );

  res.json({
    success: true,
    data: credits,
  });
});

// =============================================================================
// LEAD MARKETPLACE
// =============================================================================

/**
 * Get available leads
 * @route GET /api/v1/leads/available
 */
const getAvailableLeads = asyncHandler(async (req, res) => {
  const result = await leadGenerationService.getAvailableLeads(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: result.leads,
    pagination: result.pagination,
    credits: result.credits,
  });
});

/**
 * Purchase/claim a lead
 * @route POST /api/v1/leads/:leadId/purchase
 */
const purchaseLead = asyncHandler(async (req, res) => {
  const result = await leadGenerationService.purchaseLead(
    req.user.businessId,
    req.params.leadId
  );

  res.json({
    success: true,
    message: result.message,
    data: result.lead,
    creditsRemaining: result.creditsRemaining,
  });
});

/**
 * Get purchased leads
 * @route GET /api/v1/leads/purchased
 */
const getPurchasedLeads = asyncHandler(async (req, res) => {
  const result = await leadGenerationService.getPurchasedLeads(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: result.leads,
    pagination: result.pagination,
    statusCounts: result.statusCounts,
  });
});

/**
 * Get lead by ID
 * @route GET /api/v1/leads/:leadId
 */
const getLeadById = asyncHandler(async (req, res) => {
  const result = await leadGenerationService.getPurchasedLeads(
    req.user.businessId,
    { leadId: req.params.leadId }
  );

  const lead = result.leads.find((l) => l.id === req.params.leadId);
  if (!lead) {
    return res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: 'Lead not found' },
    });
  }

  res.json({
    success: true,
    data: lead,
  });
});

/**
 * Update lead status
 * @route PUT /api/v1/leads/:leadId/status
 */
const updateLeadStatus = asyncHandler(async (req, res) => {
  const lead = await leadGenerationService.updateLeadStatus(
    req.params.leadId,
    req.user.businessId,
    req.body
  );

  res.json({
    success: true,
    message: 'Lead status updated',
    data: lead,
  });
});

// =============================================================================
// INTENT TRACKING
// =============================================================================

/**
 * Track buyer intent (Internal/System)
 * @route POST /api/v1/leads/intent
 */
const trackIntent = asyncHandler(async (req, res) => {
  await leadGenerationService.trackIntent(
    req.user?.id || req.body.buyerId,
    req.body.signal,
    req.body
  );

  res.json({
    success: true,
    message: 'Intent tracked',
  });
});

/**
 * Get buyer intent score
 * @route GET /api/v1/leads/intent/:buyerId
 */
const getBuyerIntent = asyncHandler(async (req, res) => {
  const intent = await leadGenerationService.getBuyerIntent(req.params.buyerId);

  res.json({
    success: true,
    data: intent,
  });
});

// =============================================================================
// ANALYTICS
// =============================================================================

/**
 * Get lead analytics
 * @route GET /api/v1/leads/analytics
 */
const getLeadAnalytics = asyncHandler(async (req, res) => {
  const analytics = await leadGenerationService.getLeadAnalytics(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: analytics,
  });
});

// =============================================================================
// ADMIN ENDPOINTS
// =============================================================================

/**
 * Get lead revenue (Admin)
 * @route GET /api/v1/admin/leads/revenue
 */
const getLeadRevenue = asyncHandler(async (req, res) => {
  const revenue = await leadGenerationService.getLeadRevenue(req.query);

  res.json({
    success: true,
    data: revenue,
  });
});

/**
 * Get all leads (Admin)
 * @route GET /api/v1/admin/leads
 */
const getAllLeads = asyncHandler(async (req, res) => {
  // Admin-specific lead listing
  const leads = await leadGenerationService.getPurchasedLeads(null, req.query);

  res.json({
    success: true,
    data: leads.leads,
    pagination: leads.pagination,
  });
});

/**
 * Verify a lead (Admin)
 * @route POST /api/v1/admin/leads/:leadId/verify
 */
const verifyLead = asyncHandler(async (req, res) => {
  const lead = await leadGenerationService.updateLeadStatus(
    req.params.leadId,
    null, // Admin can update any lead
    { isVerified: true, ...req.body }
  );

  res.json({
    success: true,
    message: 'Lead verified',
    data: lead,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  getPackages,
  purchasePackage,
  getCredits,
  getAvailableLeads,
  purchaseLead,
  getPurchasedLeads,
  getLeadById,
  updateLeadStatus,
  trackIntent,
  getBuyerIntent,
  getLeadAnalytics,
  getLeadRevenue,
  getAllLeads,
  verifyLead,
};



