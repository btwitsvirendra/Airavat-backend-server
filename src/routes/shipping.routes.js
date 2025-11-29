// =============================================================================
// AIRAVAT B2B MARKETPLACE - SHIPPING ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const shippingController = require('../controllers/shipping.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

router.post('/rates', shippingController.getRates);
router.post('/shipment', shippingController.createShipment);
router.get('/track/:carrierId/:awbNumber', shippingController.trackShipment);
router.get('/serviceability', shippingController.checkServiceability);

module.exports = router;

