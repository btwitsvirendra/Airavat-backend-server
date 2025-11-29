// =============================================================================
// AIRAVAT B2B MARKETPLACE - E-INVOICE CONTROLLER
// =============================================================================

const EInvoiceService = require('../services/eInvoice.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Generate e-invoice
exports.generateEInvoice = asyncHandler(async (req, res) => {
  const result = await EInvoiceService.generateEInvoice(req.params.orderId);
  res.json({ success: true, data: result });
});

// Get e-invoice
exports.getEInvoice = asyncHandler(async (req, res) => {
  const result = await EInvoiceService.getEInvoice(req.params.orderId);
  res.json({ success: true, data: result });
});

// Get all e-invoices
exports.getEInvoices = asyncHandler(async (req, res) => {
  const result = await EInvoiceService.getEInvoices(req.user.businessId, req.query);
  res.json({ success: true, data: result });
});

// Cancel e-invoice
exports.cancelEInvoice = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const result = await EInvoiceService.cancelEInvoice(req.params.orderId, reason);
  res.json({ success: true, data: result });
});

// Download e-invoice PDF
exports.downloadPDF = asyncHandler(async (req, res) => {
  const result = await EInvoiceService.downloadInvoicePDF(req.params.orderId);
  res.json({ success: true, data: result });
});

