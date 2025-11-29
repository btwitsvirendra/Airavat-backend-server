// =============================================================================
// AIRAVAT B2B MARKETPLACE - E-WAY BILL ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const eWayBillController = require('../controllers/eWayBill.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

router.post('/generate/:orderId', eWayBillController.generateEWayBill);
router.get('/:ewbNumber', eWayBillController.getEWayBill);
router.get('/', eWayBillController.getEWayBills);
router.put('/vehicle/:ewbNumber', eWayBillController.updateVehicle);
router.post('/extend/:ewbNumber', eWayBillController.extendValidity);
router.post('/cancel/:ewbNumber', eWayBillController.cancelEWayBill);

module.exports = router;

