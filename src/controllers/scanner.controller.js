// =============================================================================
// AIRAVAT B2B MARKETPLACE - BARCODE/QR SCANNER CONTROLLER
// Controller for barcode and QR code scanning endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const barcodeScannerService = require('../services/barcodeScanner.service');
const logger = require('../config/logger');

// =============================================================================
// BARCODE LOOKUP
// =============================================================================

/**
 * @desc    Look up product by barcode
 * @route   GET /api/v1/scanner/lookup/:barcode
 * @access  Private
 */
exports.lookupByBarcode = asyncHandler(async (req, res) => {
  const result = await barcodeScannerService.lookupByBarcode(
    req.params.barcode,
    req.user?.id
  );

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Bulk barcode lookup
 * @route   POST /api/v1/scanner/bulk-lookup
 * @access  Private
 */
exports.bulkLookup = asyncHandler(async (req, res) => {
  const { barcodes } = req.body;

  const result = await barcodeScannerService.bulkLookup(barcodes, req.user.id);

  res.status(200).json({
    success: true,
    data: result,
  });
});

// =============================================================================
// QR CODE OPERATIONS
// =============================================================================

/**
 * @desc    Generate QR code for product
 * @route   GET /api/v1/scanner/qr/product/:productId
 * @access  Private
 */
exports.generateProductQR = asyncHandler(async (req, res) => {
  const { productId } = req.params;
  const { variantId } = req.query;

  const result = await barcodeScannerService.generateProductQR(productId, variantId);

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Parse QR code data
 * @route   POST /api/v1/scanner/qr/parse
 * @access  Private
 */
exports.parseQRCode = asyncHandler(async (req, res) => {
  const { qrData } = req.body;

  const result = await barcodeScannerService.parseQRCode(qrData);

  res.status(200).json({
    success: true,
    data: result,
  });
});

// =============================================================================
// SCAN TO CART
// =============================================================================

/**
 * @desc    Scan barcode and add to cart
 * @route   POST /api/v1/scanner/scan-to-cart
 * @access  Private
 */
exports.scanToCart = asyncHandler(async (req, res) => {
  const { barcode, quantity } = req.body;

  const result = await barcodeScannerService.scanToCart(
    req.user.id,
    barcode,
    quantity
  );

  res.status(200).json({
    success: true,
    data: result,
  });
});

// =============================================================================
// SCAN HISTORY
// =============================================================================

/**
 * @desc    Get scan history
 * @route   GET /api/v1/scanner/history
 * @access  Private
 */
exports.getScanHistory = asyncHandler(async (req, res) => {
  const { page, limit } = req.query;

  const result = await barcodeScannerService.getScanHistory(req.user.id, {
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
  });

  res.status(200).json({
    success: true,
    data: result.scans,
    pagination: result.pagination,
  });
});

/**
 * @desc    Clear scan history
 * @route   DELETE /api/v1/scanner/history
 * @access  Private
 */
exports.clearScanHistory = asyncHandler(async (req, res) => {
  const result = await barcodeScannerService.clearScanHistory(req.user.id);

  res.status(200).json({
    success: true,
    data: result,
  });
});

module.exports = exports;



