// =============================================================================
// AIRAVAT B2B MARKETPLACE - E-WAY BILL CONTROLLER
// =============================================================================

const EWayBillService = require('../services/eWayBill.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Generate e-way bill
exports.generateEWayBill = asyncHandler(async (req, res) => {
  const result = await EWayBillService.generateEWayBill(req.params.orderId, req.body);
  res.json({ success: true, data: result });
});

// Get e-way bill
exports.getEWayBill = asyncHandler(async (req, res) => {
  const result = await EWayBillService.getEWayBill(req.params.ewbNumber);
  res.json({ success: true, data: result });
});

// Get all e-way bills
exports.getEWayBills = asyncHandler(async (req, res) => {
  const result = await EWayBillService.getEWayBills(req.user.businessId, req.query);
  res.json({ success: true, data: result });
});

// Update vehicle
exports.updateVehicle = asyncHandler(async (req, res) => {
  const result = await EWayBillService.updateVehicle(req.params.ewbNumber, req.body);
  res.json({ success: true, data: result });
});

// Extend validity
exports.extendValidity = asyncHandler(async (req, res) => {
  const { reason, remainingDistance } = req.body;
  const result = await EWayBillService.extendValidity(req.params.ewbNumber, reason, remainingDistance);
  res.json({ success: true, data: result });
});

// Cancel e-way bill
exports.cancelEWayBill = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  const result = await EWayBillService.cancelEWayBill(req.params.ewbNumber, reason);
  res.json({ success: true, data: result });
});

