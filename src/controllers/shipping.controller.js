// =============================================================================
// AIRAVAT B2B MARKETPLACE - SHIPPING CONTROLLER
// =============================================================================

const ShippingService = require('../services/shipping.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Get shipping rates
exports.getRates = asyncHandler(async (req, res) => {
  const result = await ShippingService.getShippingRates(req.body);
  res.json({ success: true, data: result });
});

// Create shipment
exports.createShipment = asyncHandler(async (req, res) => {
  const { orderId, carrierDetails } = req.body;
  const result = await ShippingService.createShipment(orderId, carrierDetails);
  res.status(201).json({ success: true, data: result });
});

// Track shipment
exports.trackShipment = asyncHandler(async (req, res) => {
  const { awbNumber, carrierId } = req.params;
  const result = await ShippingService.trackShipment(awbNumber, carrierId);
  res.json({ success: true, data: result });
});

// Check serviceability
exports.checkServiceability = asyncHandler(async (req, res) => {
  const { pickupPincode, deliveryPincode } = req.query;
  const result = await ShippingService.checkServiceability(pickupPincode, deliveryPincode);
  res.json({ success: true, data: result });
});

