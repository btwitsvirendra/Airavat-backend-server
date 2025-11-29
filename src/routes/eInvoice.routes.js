// =============================================================================
// AIRAVAT B2B MARKETPLACE - E-INVOICE ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const eInvoiceController = require('../controllers/eInvoice.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

router.post('/generate/:orderId', eInvoiceController.generateEInvoice);
router.get('/:orderId', eInvoiceController.getEInvoice);
router.get('/', eInvoiceController.getEInvoices);
router.post('/cancel/:orderId', eInvoiceController.cancelEInvoice);
router.get('/download/:orderId', eInvoiceController.downloadPDF);

module.exports = router;

