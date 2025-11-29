// =============================================================================
// AIRAVAT B2B MARKETPLACE - PRODUCT ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const productController = require('../controllers/product.controller');
const { authenticate, optionalAuth, requireBusiness, requireVerifiedBusiness } = require('../middleware/auth');
const { validate } = require('../middleware/errorHandler');
const { createProductSchema, updateProductSchema } = require('../validators/schemas');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

// Get all products (with filters)
router.get(
  '/',
  optionalAuth,
  productController.getAll
);

// Get product by ID
router.get(
  '/:productId',
  optionalAuth,
  productController.getById
);

// Get product by slug
router.get(
  '/slug/:slug',
  optionalAuth,
  productController.getBySlug
);

// Get product variants
router.get(
  '/:productId/variants',
  productController.getVariants
);

// Get product reviews
router.get(
  '/:productId/reviews',
  productController.getReviews
);

// Get similar products
router.get(
  '/:productId/similar',
  productController.getSimilar
);

// Get products by category
router.get(
  '/category/:categorySlug',
  optionalAuth,
  productController.getByCategory
);

// =============================================================================
// PROTECTED ROUTES - SELLER
// =============================================================================

// Get my products
router.get(
  '/seller/my-products',
  authenticate,
  requireBusiness,
  productController.getMyProducts
);

// Create product
router.post(
  '/',
  authenticate,
  requireBusiness,
  requireVerifiedBusiness,
  validate(createProductSchema),
  productController.create
);

// Update product
router.patch(
  '/:productId',
  authenticate,
  requireBusiness,
  validate(updateProductSchema),
  productController.update
);

// Delete product (soft delete)
router.delete(
  '/:productId',
  authenticate,
  requireBusiness,
  productController.delete
);

// Duplicate product
router.post(
  '/:productId/duplicate',
  authenticate,
  requireBusiness,
  productController.duplicate
);

// Update product status
router.patch(
  '/:productId/status',
  authenticate,
  requireBusiness,
  productController.updateStatus
);

// =============================================================================
// VARIANTS
// =============================================================================

// Add variant
router.post(
  '/:productId/variants',
  authenticate,
  requireBusiness,
  productController.addVariant
);

// Update variant
router.patch(
  '/:productId/variants/:variantId',
  authenticate,
  requireBusiness,
  productController.updateVariant
);

// Delete variant
router.delete(
  '/:productId/variants/:variantId',
  authenticate,
  requireBusiness,
  productController.deleteVariant
);

// Update variant inventory
router.patch(
  '/:productId/variants/:variantId/inventory',
  authenticate,
  requireBusiness,
  productController.updateInventory
);

// =============================================================================
// PRICING TIERS
// =============================================================================

// Get pricing tiers
router.get(
  '/:productId/variants/:variantId/pricing',
  productController.getPricingTiers
);

// Set pricing tiers
router.put(
  '/:productId/variants/:variantId/pricing',
  authenticate,
  requireBusiness,
  productController.setPricingTiers
);

// =============================================================================
// BULK OPERATIONS
// =============================================================================

// Bulk update products
router.patch(
  '/bulk/update',
  authenticate,
  requireBusiness,
  productController.bulkUpdate
);

// Bulk update status
router.patch(
  '/bulk/status',
  authenticate,
  requireBusiness,
  productController.bulkUpdateStatus
);

// Bulk update inventory
router.patch(
  '/bulk/inventory',
  authenticate,
  requireBusiness,
  productController.bulkUpdateInventory
);

// Export products (CSV)
router.get(
  '/export/csv',
  authenticate,
  requireBusiness,
  productController.exportCSV
);

// Import products (CSV)
router.post(
  '/import/csv',
  authenticate,
  requireBusiness,
  requireVerifiedBusiness,
  productController.importCSV
);

module.exports = router;
