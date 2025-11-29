// =============================================================================
// AIRAVAT B2B MARKETPLACE - SMART PRICING CONTROLLER
// Handles AI-powered dynamic pricing and recommendations
// =============================================================================

const smartPricingService = require('../services/smartPricing.service');
const asyncHandler = require('../middleware/async.middleware');
const { NotFoundError } = require('../utils/errors');

// =============================================================================
// PRICE RECOMMENDATIONS
// =============================================================================

/**
 * Get price recommendation for a product
 * @route GET /api/v1/pricing/recommendations/:productId
 */
const getRecommendation = asyncHandler(async (req, res) => {
  const recommendation = await smartPricingService.getRecommendation(
    req.params.productId,
    req.user.id
  );

  res.json({
    success: true,
    data: recommendation,
  });
});

/**
 * Get all recommendations for seller
 * @route GET /api/v1/pricing/recommendations
 */
const getRecommendations = asyncHandler(async (req, res) => {
  const result = await smartPricingService.getRecommendations(
    req.user.id,
    req.query
  );

  res.json({
    success: true,
    data: result.recommendations,
    pagination: result.pagination,
  });
});

/**
 * Apply a price recommendation
 * @route POST /api/v1/pricing/recommendations/:id/apply
 */
const applyRecommendation = asyncHandler(async (req, res) => {
  const result = await smartPricingService.applyRecommendation(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Price updated successfully',
    data: result,
  });
});

/**
 * Dismiss a recommendation
 * @route POST /api/v1/pricing/recommendations/:id/dismiss
 */
const dismissRecommendation = asyncHandler(async (req, res) => {
  await smartPricingService.dismissRecommendation(
    req.params.id,
    req.user.id,
    req.body.reason
  );

  res.json({
    success: true,
    message: 'Recommendation dismissed',
  });
});

/**
 * Get bulk recommendations for products
 * @route POST /api/v1/pricing/recommendations/bulk
 */
const getBulkRecommendations = asyncHandler(async (req, res) => {
  const recommendations = await smartPricingService.getBulkRecommendations(
    req.user.id,
    req.body.productIds
  );

  res.json({
    success: true,
    data: recommendations,
  });
});

// =============================================================================
// PRICING RULES
// =============================================================================

/**
 * Create a pricing rule
 * @route POST /api/v1/pricing/rules
 */
const createRule = asyncHandler(async (req, res) => {
  const rule = await smartPricingService.createRule(
    req.user.businessId,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Pricing rule created',
    data: rule,
  });
});

/**
 * Get all pricing rules
 * @route GET /api/v1/pricing/rules
 */
const getRules = asyncHandler(async (req, res) => {
  const rules = await smartPricingService.getRules(req.user.businessId);

  res.json({
    success: true,
    data: rules,
  });
});

/**
 * Get rule by ID
 * @route GET /api/v1/pricing/rules/:id
 */
const getRuleById = asyncHandler(async (req, res) => {
  const rule = await smartPricingService.getRuleById(
    req.params.id,
    req.user.businessId
  );

  if (!rule) {
    throw new NotFoundError('Pricing rule not found');
  }

  res.json({
    success: true,
    data: rule,
  });
});

/**
 * Update a pricing rule
 * @route PUT /api/v1/pricing/rules/:id
 */
const updateRule = asyncHandler(async (req, res) => {
  const rule = await smartPricingService.updateRule(
    req.params.id,
    req.user.businessId,
    req.body
  );

  res.json({
    success: true,
    message: 'Pricing rule updated',
    data: rule,
  });
});

/**
 * Delete a pricing rule
 * @route DELETE /api/v1/pricing/rules/:id
 */
const deleteRule = asyncHandler(async (req, res) => {
  await smartPricingService.deleteRule(req.params.id, req.user.businessId);

  res.json({
    success: true,
    message: 'Pricing rule deleted',
  });
});

/**
 * Toggle rule status
 * @route POST /api/v1/pricing/rules/:id/toggle
 */
const toggleRule = asyncHandler(async (req, res) => {
  const rule = await smartPricingService.toggleRule(
    req.params.id,
    req.user.businessId
  );

  res.json({
    success: true,
    message: `Rule ${rule.isActive ? 'activated' : 'deactivated'}`,
    data: rule,
  });
});

// =============================================================================
// COMPETITOR MONITORING
// =============================================================================

/**
 * Set up competitor monitoring
 * @route POST /api/v1/pricing/monitoring
 */
const setupMonitoring = asyncHandler(async (req, res) => {
  const monitoring = await smartPricingService.setupMonitoring(
    req.body.productId,
    req.user.id,
    req.body.competitors
  );

  res.status(201).json({
    success: true,
    message: 'Competitor monitoring set up',
    data: monitoring,
  });
});

/**
 * Get competitor prices
 * @route GET /api/v1/pricing/monitoring/:productId
 */
const getCompetitorPrices = asyncHandler(async (req, res) => {
  const prices = await smartPricingService.getCompetitorPrices(
    req.params.productId,
    req.user.id
  );

  res.json({
    success: true,
    data: prices,
  });
});

/**
 * Get monitoring settings
 * @route GET /api/v1/pricing/monitoring
 */
const getMonitoringSettings = asyncHandler(async (req, res) => {
  const settings = await smartPricingService.getMonitoringSettings(
    req.user.id
  );

  res.json({
    success: true,
    data: settings,
  });
});

/**
 * Update monitoring settings
 * @route PUT /api/v1/pricing/monitoring/:productId
 */
const updateMonitoring = asyncHandler(async (req, res) => {
  const monitoring = await smartPricingService.updateMonitoring(
    req.params.productId,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Monitoring updated',
    data: monitoring,
  });
});

/**
 * Delete monitoring
 * @route DELETE /api/v1/pricing/monitoring/:productId
 */
const deleteMonitoring = asyncHandler(async (req, res) => {
  await smartPricingService.deleteMonitoring(
    req.params.productId,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Monitoring deleted',
  });
});

// =============================================================================
// PRICE HISTORY & ANALYTICS
// =============================================================================

/**
 * Get price history for a product
 * @route GET /api/v1/pricing/history/:productId
 */
const getPriceHistory = asyncHandler(async (req, res) => {
  const history = await smartPricingService.getPriceHistory(
    req.params.productId,
    req.user.id,
    req.query
  );

  res.json({
    success: true,
    data: history,
  });
});

/**
 * Get pricing analytics
 * @route GET /api/v1/pricing/analytics
 */
const getAnalytics = asyncHandler(async (req, res) => {
  const analytics = await smartPricingService.getAnalytics(
    req.user.id,
    req.query
  );

  res.json({
    success: true,
    data: analytics,
  });
});

/**
 * Calculate optimal price
 * @route POST /api/v1/pricing/calculate
 */
const calculateOptimalPrice = asyncHandler(async (req, res) => {
  const result = await smartPricingService.calculateOptimalPrice(
    req.body.productId,
    req.user.id,
    req.body.params
  );

  res.json({
    success: true,
    data: result,
  });
});

/**
 * Simulate price change impact
 * @route POST /api/v1/pricing/simulate
 */
const simulatePriceChange = asyncHandler(async (req, res) => {
  const simulation = await smartPricingService.simulatePriceChange(
    req.body.productId,
    req.user.id,
    req.body.newPrice
  );

  res.json({
    success: true,
    data: simulation,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  getRecommendation,
  getRecommendations,
  applyRecommendation,
  dismissRecommendation,
  getBulkRecommendations,
  createRule,
  getRules,
  getRuleById,
  updateRule,
  deleteRule,
  toggleRule,
  setupMonitoring,
  getCompetitorPrices,
  getMonitoringSettings,
  updateMonitoring,
  deleteMonitoring,
  getPriceHistory,
  getAnalytics,
  calculateOptimalPrice,
  simulatePriceChange,
};



