// =============================================================================
// AIRAVAT B2B MARKETPLACE - API MARKETPLACE CONTROLLER
// Handles public API management endpoints
// =============================================================================

const apiService = require('../services/apiMarketplace.service');
const asyncHandler = require('../middleware/async.middleware');

// =============================================================================
// DOCUMENTATION
// =============================================================================

/**
 * Get API documentation
 * @route GET /api/v1/api-marketplace/docs
 */
const getDocs = asyncHandler(async (req, res) => {
  const docs = apiService.getApiDocumentation();

  res.json({
    success: true,
    data: docs,
  });
});

/**
 * Get available API plans
 * @route GET /api/v1/api-marketplace/plans
 */
const getPlans = asyncHandler(async (req, res) => {
  const plans = apiService.getApiPlans();

  res.json({
    success: true,
    data: plans,
  });
});

// =============================================================================
// API KEY MANAGEMENT
// =============================================================================

/**
 * Generate an API key
 * @route POST /api/v1/api-marketplace/keys
 */
const generateKey = asyncHandler(async (req, res) => {
  const key = await apiService.generateApiKey(
    req.user.businessId,
    req.body
  );

  res.status(201).json({
    success: true,
    message: key.message,
    data: key,
  });
});

/**
 * List API keys
 * @route GET /api/v1/api-marketplace/keys
 */
const listKeys = asyncHandler(async (req, res) => {
  const keys = await apiService.listApiKeys(req.user.businessId);

  res.json({
    success: true,
    data: keys,
  });
});

/**
 * Revoke an API key
 * @route DELETE /api/v1/api-marketplace/keys/:id
 */
const revokeKey = asyncHandler(async (req, res) => {
  await apiService.revokeApiKey(req.params.id, req.user.businessId);

  res.json({
    success: true,
    message: 'API key revoked',
  });
});

/**
 * Get usage statistics
 * @route GET /api/v1/api-marketplace/usage
 */
const getUsage = asyncHandler(async (req, res) => {
  const usage = await apiService.getUsageStats(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: usage,
  });
});

/**
 * Upgrade API plan
 * @route POST /api/v1/api-marketplace/keys/:id/upgrade
 */
const upgradePlan = asyncHandler(async (req, res) => {
  const key = await apiService.upgradePlan(
    req.params.id,
    req.user.businessId,
    req.body.planId
  );

  res.json({
    success: true,
    message: `Upgraded to ${key.plan} plan`,
    data: key,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  getDocs,
  getPlans,
  generateKey,
  listKeys,
  revokeKey,
  getUsage,
  upgradePlan,
};



