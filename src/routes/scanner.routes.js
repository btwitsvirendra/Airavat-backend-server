// =============================================================================
// AIRAVAT B2B MARKETPLACE - BARCODE/QR SCANNER ROUTES
// Routes for barcode and QR code scanning
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const scannerController = require('../controllers/scanner.controller');
const { protect } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

// =============================================================================
// BARCODE LOOKUP
// =============================================================================

/**
 * @route   GET /api/v1/scanner/lookup/:barcode
 * @desc    Look up product by barcode
 */
router.get(
  '/lookup/:barcode',
  protect,
  [param('barcode').notEmpty().withMessage('Barcode is required')],
  validate,
  scannerController.lookupByBarcode
);

/**
 * @route   POST /api/v1/scanner/bulk-lookup
 * @desc    Bulk barcode lookup
 */
router.post(
  '/bulk-lookup',
  protect,
  [
    body('barcodes')
      .isArray({ min: 1, max: 50 })
      .withMessage('Barcodes must be an array of 1-50 items'),
    body('barcodes.*').isString().withMessage('Each barcode must be a string'),
  ],
  validate,
  scannerController.bulkLookup
);

// =============================================================================
// QR CODE
// =============================================================================

/**
 * @route   GET /api/v1/scanner/qr/product/:productId
 * @desc    Generate QR code for product
 */
router.get(
  '/qr/product/:productId',
  protect,
  [
    param('productId').notEmpty().withMessage('Product ID is required'),
    query('variantId').optional().isString(),
  ],
  validate,
  scannerController.generateProductQR
);

/**
 * @route   POST /api/v1/scanner/qr/parse
 * @desc    Parse QR code data
 */
router.post(
  '/qr/parse',
  protect,
  [body('qrData').notEmpty().withMessage('QR data is required')],
  validate,
  scannerController.parseQRCode
);

// =============================================================================
// SCAN TO CART
// =============================================================================

/**
 * @route   POST /api/v1/scanner/scan-to-cart
 * @desc    Scan barcode and add to cart
 */
router.post(
  '/scan-to-cart',
  protect,
  [
    body('barcode').notEmpty().withMessage('Barcode is required'),
    body('quantity')
      .optional()
      .isInt({ min: 1 })
      .withMessage('Quantity must be at least 1'),
  ],
  validate,
  scannerController.scanToCart
);

// =============================================================================
// SCAN HISTORY
// =============================================================================

/**
 * @route   GET /api/v1/scanner/history
 * @desc    Get scan history
 */
router.get(
  '/history',
  protect,
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  scannerController.getScanHistory
);

/**
 * @route   DELETE /api/v1/scanner/history
 * @desc    Clear scan history
 */
router.delete('/history', protect, scannerController.clearScanHistory);

module.exports = router;



