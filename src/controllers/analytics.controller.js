// =============================================================================
// AIRAVAT B2B MARKETPLACE - ANALYTICS CONTROLLER
// =============================================================================

const AdvancedAnalyticsService = require('../services/advancedAnalytics.service');
const AIRecommendationService = require('../services/aiRecommendation.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Get business analytics
exports.getBusinessAnalytics = asyncHandler(async (req, res) => {
  const { start, end } = req.query;
  const dateRange = {};
  if (start) dateRange.start = new Date(start);
  if (end) dateRange.end = new Date(end);
  
  const result = await AdvancedAnalyticsService.getBusinessAnalytics(req.user.businessId, dateRange);
  res.json({ success: true, data: result });
});

// Get sales forecast
exports.getSalesForecast = asyncHandler(async (req, res) => {
  const { days = 30 } = req.query;
  const result = await AdvancedAnalyticsService.generateSalesForecast(req.user.businessId, parseInt(days));
  res.json({ success: true, data: result });
});

// Get personalized recommendations
exports.getRecommendations = asyncHandler(async (req, res) => {
  const { limit = 12 } = req.query;
  const result = await AIRecommendationService.getPersonalizedRecommendations(
    req.user.id,
    req.user.businessId,
    parseInt(limit)
  );
  res.json({ success: true, data: result });
});

// Get also bought
exports.getAlsoBought = asyncHandler(async (req, res) => {
  const { limit = 8 } = req.query;
  const result = await AIRecommendationService.getAlsoBought(req.params.productId, parseInt(limit));
  res.json({ success: true, data: result });
});

// Get frequently bought together
exports.getFrequentlyBoughtTogether = asyncHandler(async (req, res) => {
  const result = await AIRecommendationService.getFrequentlyBoughtTogether(req.params.productId);
  res.json({ success: true, data: result });
});

// Get trending products
exports.getTrending = asyncHandler(async (req, res) => {
  const { limit = 12 } = req.query;
  const result = await AIRecommendationService.getTrendingProducts(parseInt(limit));
  res.json({ success: true, data: result });
});

// Get best sellers
exports.getBestSellers = asyncHandler(async (req, res) => {
  const { categoryId, limit = 12 } = req.query;
  const result = await AIRecommendationService.getBestSellers(categoryId, parseInt(limit));
  res.json({ success: true, data: result });
});

// Get new arrivals
exports.getNewArrivals = asyncHandler(async (req, res) => {
  const { categoryId, limit = 12 } = req.query;
  const result = await AIRecommendationService.getNewArrivals(categoryId, parseInt(limit));
  res.json({ success: true, data: result });
});

// Get reorder suggestions
exports.getReorderSuggestions = asyncHandler(async (req, res) => {
  const { limit = 10 } = req.query;
  const result = await AIRecommendationService.getReorderSuggestions(req.user.businessId, parseInt(limit));
  res.json({ success: true, data: result });
});

