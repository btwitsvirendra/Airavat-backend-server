// =============================================================================
// AIRAVAT B2B MARKETPLACE - TALLY INTEGRATION CONTROLLER
// Handles Tally ERP integration endpoints
// =============================================================================

const tallyService = require('../services/tallyIntegration.service');
const asyncHandler = require('../middleware/async.middleware');

// =============================================================================
// CONNECTION
// =============================================================================

/**
 * Configure Tally connection
 * @route POST /api/v1/integrations/tally/connect
 */
const configure = asyncHandler(async (req, res) => {
  const result = await tallyService.configureConnection(
    req.user.businessId,
    req.body
  );

  res.json({
    success: true,
    message: 'Tally connected successfully',
    data: result,
  });
});

/**
 * Get connection status
 * @route GET /api/v1/integrations/tally/status
 */
const getStatus = asyncHandler(async (req, res) => {
  const status = await tallyService.getConnectionStatus(req.user.businessId);

  res.json({
    success: true,
    data: status,
  });
});

// =============================================================================
// SYNCHRONIZATION
// =============================================================================

/**
 * Sync all data to Tally
 * @route POST /api/v1/integrations/tally/sync
 */
const syncAll = asyncHandler(async (req, res) => {
  const result = await tallyService.syncAllData(
    req.user.businessId,
    req.body
  );

  res.json({
    success: true,
    message: 'Sync completed',
    data: result,
  });
});

/**
 * Sync a single customer
 * @route POST /api/v1/integrations/tally/sync/customer/:customerId
 */
const syncCustomer = asyncHandler(async (req, res) => {
  const result = await tallyService.syncCustomer(
    req.user.businessId,
    req.params.customerId
  );

  res.json({
    success: result.success,
    message: result.success ? 'Customer synced' : 'Sync failed',
    data: result,
  });
});

/**
 * Sync a single order
 * @route POST /api/v1/integrations/tally/sync/order/:orderId
 */
const syncOrder = asyncHandler(async (req, res) => {
  const result = await tallyService.syncOrder(
    req.user.businessId,
    req.params.orderId
  );

  res.json({
    success: result.success,
    message: result.success ? 'Order synced as voucher' : 'Sync failed',
    data: result,
  });
});

/**
 * Sync a single product
 * @route POST /api/v1/integrations/tally/sync/product/:productId
 */
const syncProduct = asyncHandler(async (req, res) => {
  const result = await tallyService.syncProduct(
    req.user.businessId,
    req.params.productId
  );

  res.json({
    success: result.success,
    message: result.success ? 'Product synced as stock item' : 'Sync failed',
    data: result,
  });
});

// =============================================================================
// IMPORT
// =============================================================================

/**
 * Import ledgers from Tally
 * @route GET /api/v1/integrations/tally/import/ledgers
 */
const importLedgers = asyncHandler(async (req, res) => {
  const result = await tallyService.importLedgers(req.user.businessId);

  res.json({
    success: true,
    message: `Imported ${result.imported} ledgers`,
    data: result,
  });
});

/**
 * Import stock items from Tally
 * @route GET /api/v1/integrations/tally/import/stock
 */
const importStock = asyncHandler(async (req, res) => {
  const result = await tallyService.importStockItems(req.user.businessId);

  res.json({
    success: true,
    message: `Imported ${result.imported} stock items`,
    data: result,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  configure,
  getStatus,
  syncAll,
  syncCustomer,
  syncOrder,
  syncProduct,
  importLedgers,
  importStock,
};



