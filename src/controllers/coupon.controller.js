// =============================================================================
// AIRAVAT B2B MARKETPLACE - COUPON CONTROLLER
// =============================================================================

const CouponService = require('../services/coupon.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Create coupon
exports.createCoupon = asyncHandler(async (req, res) => {
  const result = await CouponService.createCoupon(req.user.businessId, req.body);
  res.status(201).json({ success: true, data: result });
});

// Bulk generate coupons
exports.bulkGenerateCoupons = asyncHandler(async (req, res) => {
  const { count, ...baseData } = req.body;
  const result = await CouponService.bulkGenerateCoupons(req.user.businessId, baseData, count);
  res.status(201).json({ success: true, data: { count: result.length, coupons: result } });
});

// Validate coupon
exports.validateCoupon = asyncHandler(async (req, res) => {
  const { code, orderDetails } = req.body;
  const result = await CouponService.validateCoupon(code, req.user.id, req.user.businessId, orderDetails);
  res.json({ success: true, data: result });
});

// Get coupons
exports.getCoupons = asyncHandler(async (req, res) => {
  const result = await CouponService.getCoupons(req.user.businessId, req.query);
  res.json({ success: true, data: result });
});

// Get coupon by code
exports.getCoupon = asyncHandler(async (req, res) => {
  const result = await CouponService.getCouponByCode(req.params.code);
  res.json({ success: true, data: result });
});

// Update coupon
exports.updateCoupon = asyncHandler(async (req, res) => {
  const result = await CouponService.updateCoupon(req.params.couponId, req.user.businessId, req.body);
  res.json({ success: true, data: result });
});

// Toggle coupon status
exports.toggleStatus = asyncHandler(async (req, res) => {
  const result = await CouponService.toggleCouponStatus(req.params.couponId, req.user.businessId);
  res.json({ success: true, data: result });
});

// Delete coupon
exports.deleteCoupon = asyncHandler(async (req, res) => {
  await CouponService.deleteCoupon(req.params.couponId, req.user.businessId);
  res.json({ success: true, message: 'Coupon deleted' });
});

// Get auto-apply coupons
exports.getAutoApplyCoupons = asyncHandler(async (req, res) => {
  const { orderDetails } = req.body;
  const result = await CouponService.getAutoApplyCoupons(req.user.id, req.user.businessId, orderDetails);
  res.json({ success: true, data: result });
});

