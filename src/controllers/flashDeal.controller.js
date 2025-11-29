// =============================================================================
// AIRAVAT B2B MARKETPLACE - FLASH DEAL CONTROLLER
// =============================================================================

const FlashDealService = require('../services/flashDeal.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Create deal
exports.createDeal = asyncHandler(async (req, res) => {
  const result = await FlashDealService.createDeal(req.user.businessId, req.body);
  res.status(201).json({ success: true, data: result });
});

// Update deal
exports.updateDeal = asyncHandler(async (req, res) => {
  const result = await FlashDealService.updateDeal(req.params.dealId, req.user.businessId, req.body);
  res.json({ success: true, data: result });
});

// Cancel deal
exports.cancelDeal = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const result = await FlashDealService.cancelDeal(req.params.dealId, req.user.businessId, reason);
  res.json({ success: true, data: result });
});

// Get active deals (public)
exports.getActiveDeals = asyncHandler(async (req, res) => {
  const result = await FlashDealService.getActiveDeals(req.query);
  res.json({ success: true, data: result });
});

// Get upcoming deals (public)
exports.getUpcomingDeals = asyncHandler(async (req, res) => {
  const result = await FlashDealService.getUpcomingDeals(req.query);
  res.json({ success: true, data: result });
});

// Get deal by ID
exports.getDeal = asyncHandler(async (req, res) => {
  const result = await FlashDealService.getDeal(req.params.dealId);
  res.json({ success: true, data: result });
});

// Reserve stock
exports.reserveStock = asyncHandler(async (req, res) => {
  const { quantity } = req.body;
  const result = await FlashDealService.reserveStock(req.params.dealId, req.user.id, quantity);
  res.json({ success: true, data: result });
});

// Get seller deals
exports.getSellerDeals = asyncHandler(async (req, res) => {
  const result = await FlashDealService.getSellerDeals(req.user.businessId, req.query);
  res.json({ success: true, data: result });
});

// Get deal analytics
exports.getDealAnalytics = asyncHandler(async (req, res) => {
  const result = await FlashDealService.getDealAnalytics(req.params.dealId, req.user.businessId);
  res.json({ success: true, data: result });
});

