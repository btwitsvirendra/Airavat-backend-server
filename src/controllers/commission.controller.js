// =============================================================================
// AIRAVAT B2B MARKETPLACE - COMMISSION CONTROLLER
// Handles commission management and payout endpoints
// =============================================================================

const commissionService = require('../services/commission.service');
const asyncHandler = require('../middleware/async.middleware');
const { NotFoundError } = require('../utils/errors');

// =============================================================================
// SELLER COMMISSION ENDPOINTS
// =============================================================================

/**
 * Get commission for an order
 * @route GET /api/v1/commissions/orders/:orderId
 */
const getOrderCommission = asyncHandler(async (req, res) => {
  const commission = await commissionService.calculateOrderCommission(
    { id: req.params.orderId, ...req.body },
    req.query
  );

  res.json({
    success: true,
    data: commission,
  });
});

/**
 * Get seller's commission records
 * @route GET /api/v1/commissions
 */
const getSellerCommissions = asyncHandler(async (req, res) => {
  const result = await commissionService.getSellerCommissions(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: result.records,
    pagination: result.pagination,
    summary: result.summary,
  });
});

/**
 * Get pending payout amount
 * @route GET /api/v1/commissions/pending-payout
 */
const getPendingPayout = asyncHandler(async (req, res) => {
  const payout = await commissionService.calculatePendingPayout(
    req.user.businessId
  );

  res.json({
    success: true,
    data: payout,
  });
});

// =============================================================================
// PAYOUT ENDPOINTS
// =============================================================================

/**
 * Request a payout
 * @route POST /api/v1/payouts
 */
const requestPayout = asyncHandler(async (req, res) => {
  const payout = await commissionService.createPayoutRequest(
    req.user.businessId,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Payout request created successfully',
    data: payout,
  });
});

/**
 * Get payout history
 * @route GET /api/v1/payouts
 */
const getPayoutHistory = asyncHandler(async (req, res) => {
  const result = await commissionService.getPayoutHistory(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: result.payouts,
    pagination: result.pagination,
    summary: result.summary,
  });
});

/**
 * Get payout by ID
 * @route GET /api/v1/payouts/:id
 */
const getPayoutById = asyncHandler(async (req, res) => {
  const payouts = await commissionService.getPayoutHistory(
    req.user.businessId,
    { payoutId: req.params.id }
  );

  const payout = payouts.payouts.find((p) => p.id === req.params.id);
  if (!payout) {
    throw new NotFoundError('Payout not found');
  }

  res.json({
    success: true,
    data: payout,
  });
});

// =============================================================================
// ADMIN ENDPOINTS
// =============================================================================

/**
 * Process a payout (Admin)
 * @route POST /api/v1/admin/payouts/:id/process
 */
const processPayout = asyncHandler(async (req, res) => {
  const payout = await commissionService.processPayout(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: `Payout ${payout.status.toLowerCase()}`,
    data: payout,
  });
});

/**
 * Set category commission rate (Admin)
 * @route POST /api/v1/admin/commissions/rates
 */
const setCategoryRate = asyncHandler(async (req, res) => {
  const { categoryCode, rate } = req.body;
  
  const commissionRate = await commissionService.setCategoryCommissionRate(
    categoryCode,
    rate,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Commission rate updated',
    data: commissionRate,
  });
});

/**
 * Set seller commission override (Admin)
 * @route POST /api/v1/admin/commissions/overrides
 */
const setSellerOverride = asyncHandler(async (req, res) => {
  const { sellerId, ...override } = req.body;
  
  const commissionOverride = await commissionService.setSellerCommissionOverride(
    sellerId,
    override,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Commission override created',
    data: commissionOverride,
  });
});

/**
 * Get all commission rates (Admin)
 * @route GET /api/v1/admin/commissions/rates
 */
const getAllRates = asyncHandler(async (req, res) => {
  const rates = await commissionService.getAllCommissionRates();

  res.json({
    success: true,
    data: rates,
  });
});

/**
 * Get platform revenue (Admin)
 * @route GET /api/v1/admin/revenue
 */
const getPlatformRevenue = asyncHandler(async (req, res) => {
  const revenue = await commissionService.getPlatformRevenue(req.query);

  res.json({
    success: true,
    data: revenue,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  getOrderCommission,
  getSellerCommissions,
  getPendingPayout,
  requestPayout,
  getPayoutHistory,
  getPayoutById,
  processPayout,
  setCategoryRate,
  setSellerOverride,
  getAllRates,
  getPlatformRevenue,
};



