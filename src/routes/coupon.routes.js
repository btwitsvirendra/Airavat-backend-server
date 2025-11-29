// =============================================================================
// AIRAVAT B2B MARKETPLACE - COUPON ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const couponController = require('../controllers/coupon.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

router.post('/', couponController.createCoupon);
router.post('/bulk-generate', couponController.bulkGenerateCoupons);
router.post('/validate', couponController.validateCoupon);
router.post('/auto-apply', couponController.getAutoApplyCoupons);
router.get('/', couponController.getCoupons);
router.get('/:code', couponController.getCoupon);
router.put('/:couponId', couponController.updateCoupon);
router.put('/:couponId/toggle', couponController.toggleStatus);
router.delete('/:couponId', couponController.deleteCoupon);

module.exports = router;

