// =============================================================================
// AIRAVAT B2B MARKETPLACE - WAREHOUSE CONTROLLER
// =============================================================================

const WarehouseService = require('../services/warehouse.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Create warehouse
exports.createWarehouse = asyncHandler(async (req, res) => {
  const result = await WarehouseService.createWarehouse(req.user.businessId, req.body);
  res.status(201).json({ success: true, data: result });
});

// Update warehouse
exports.updateWarehouse = asyncHandler(async (req, res) => {
  const result = await WarehouseService.updateWarehouse(req.params.warehouseId, req.user.businessId, req.body);
  res.json({ success: true, data: result });
});

// Get warehouses
exports.getWarehouses = asyncHandler(async (req, res) => {
  const result = await WarehouseService.getWarehouses(req.user.businessId, req.query);
  res.json({ success: true, data: result });
});

// Get warehouse
exports.getWarehouse = asyncHandler(async (req, res) => {
  const result = await WarehouseService.getWarehouse(req.params.warehouseId, req.user.businessId);
  res.json({ success: true, data: result });
});

// Delete warehouse
exports.deleteWarehouse = asyncHandler(async (req, res) => {
  await WarehouseService.deleteWarehouse(req.params.warehouseId, req.user.businessId);
  res.json({ success: true, message: 'Warehouse deleted' });
});

// Get warehouse inventory
exports.getInventory = asyncHandler(async (req, res) => {
  const result = await WarehouseService.getWarehouseInventory(req.params.warehouseId, req.query);
  res.json({ success: true, data: result });
});

// Update inventory
exports.updateInventory = asyncHandler(async (req, res) => {
  const { variantId, quantity, operation } = req.body;
  const result = await WarehouseService.updateInventory(req.params.warehouseId, variantId, quantity, operation);
  res.json({ success: true, data: result });
});

// Transfer inventory
exports.transferInventory = asyncHandler(async (req, res) => {
  const { fromWarehouseId, toWarehouseId, variantId, quantity, reason } = req.body;
  const result = await WarehouseService.transferInventory(fromWarehouseId, toWarehouseId, variantId, quantity, reason);
  res.json({ success: true, data: result });
});

// Get inventory distribution
exports.getInventoryDistribution = asyncHandler(async (req, res) => {
  const result = await WarehouseService.getProductInventoryDistribution(req.params.variantId);
  res.json({ success: true, data: result });
});

