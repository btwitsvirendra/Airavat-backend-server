// =============================================================================
// AIRAVAT B2B MARKETPLACE - PRODUCT CONTROLLER
// =============================================================================

const productService = require('../services/product.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, created, paginated, noContent } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

/**
 * Get all products
 * GET /api/v1/products
 */
exports.getAll = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const {
    category,
    minPrice,
    maxPrice,
    brand,
    rating,
    verified,
    inStock,
    sort,
    q: searchQuery,
  } = req.query;
  
  const filters = {
    category,
    minPrice: minPrice ? parseFloat(minPrice) : undefined,
    maxPrice: maxPrice ? parseFloat(maxPrice) : undefined,
    brand,
    rating: rating ? parseFloat(rating) : undefined,
    verified: verified === 'true',
    inStock: inStock !== 'false',
    searchQuery,
  };
  
  const { products, total, aggregations } = await productService.getAll({
    skip,
    limit,
    filters,
    sort,
    userId: req.user?.id,
  });
  
  paginated(res, { products, aggregations }, { page, limit, total });
});

/**
 * Get product by ID
 * GET /api/v1/products/:productId
 */
exports.getById = asyncHandler(async (req, res) => {
  const product = await productService.getById(req.params.productId, {
    includeVariants: true,
    includeBusiness: true,
  });
  
  if (!product) {
    throw new NotFoundError('Product');
  }
  
  // Track view
  await productService.trackView(product.id, req.user?.id);
  
  success(res, { product });
});

/**
 * Get product by slug
 * GET /api/v1/products/slug/:slug
 */
exports.getBySlug = asyncHandler(async (req, res) => {
  const product = await productService.getBySlug(req.params.slug, {
    includeVariants: true,
    includeBusiness: true,
  });
  
  if (!product) {
    throw new NotFoundError('Product');
  }
  
  // Track view
  await productService.trackView(product.id, req.user?.id);
  
  success(res, { product });
});

/**
 * Get product variants
 * GET /api/v1/products/:productId/variants
 */
exports.getVariants = asyncHandler(async (req, res) => {
  const variants = await productService.getVariants(req.params.productId);
  
  success(res, { variants });
});

/**
 * Get product reviews
 * GET /api/v1/products/:productId/reviews
 */
exports.getReviews = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { rating, sort } = req.query;
  
  const { reviews, total, stats } = await productService.getReviews(req.params.productId, {
    skip,
    limit,
    rating: rating ? parseInt(rating) : undefined,
    sort,
  });
  
  paginated(res, { reviews, stats }, { page, limit, total });
});

/**
 * Get similar products
 * GET /api/v1/products/:productId/similar
 */
exports.getSimilar = asyncHandler(async (req, res) => {
  const { limit = 10 } = req.query;
  
  const products = await productService.getSimilar(req.params.productId, parseInt(limit));
  
  success(res, { products });
});

/**
 * Get products by category
 * GET /api/v1/products/category/:categorySlug
 */
exports.getByCategory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { sort, ...filters } = req.query;
  
  const { products, total, category } = await productService.getByCategory(
    req.params.categorySlug,
    { skip, limit, filters, sort }
  );
  
  paginated(res, { products, category }, { page, limit, total });
});

/**
 * Get my products (seller)
 * GET /api/v1/products/seller/my-products
 */
exports.getMyProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, category, sort, q: searchQuery } = req.query;
  
  const { products, total } = await productService.getByBusiness(req.business.id, {
    skip,
    limit,
    status,
    category,
    sort,
    searchQuery,
  });
  
  paginated(res, products, { page, limit, total });
});

/**
 * Create product
 * POST /api/v1/products
 */
exports.create = asyncHandler(async (req, res) => {
  const product = await productService.create({
    ...req.body,
    businessId: req.business.id,
  });
  
  created(res, { product }, 'Product created successfully');
});

/**
 * Update product
 * PATCH /api/v1/products/:productId
 */
exports.update = asyncHandler(async (req, res) => {
  // Verify ownership
  const existingProduct = await productService.getById(req.params.productId);
  if (!existingProduct || existingProduct.businessId !== req.business.id) {
    throw new ForbiddenError('You can only update your own products');
  }
  
  const product = await productService.update(req.params.productId, req.body);
  
  success(res, { product }, 'Product updated successfully');
});

/**
 * Delete product
 * DELETE /api/v1/products/:productId
 */
exports.delete = asyncHandler(async (req, res) => {
  // Verify ownership
  const existingProduct = await productService.getById(req.params.productId);
  if (!existingProduct || existingProduct.businessId !== req.business.id) {
    throw new ForbiddenError('You can only delete your own products');
  }
  
  await productService.delete(req.params.productId);
  
  success(res, null, 'Product deleted successfully');
});

/**
 * Duplicate product
 * POST /api/v1/products/:productId/duplicate
 */
exports.duplicate = asyncHandler(async (req, res) => {
  // Verify ownership
  const existingProduct = await productService.getById(req.params.productId);
  if (!existingProduct || existingProduct.businessId !== req.business.id) {
    throw new ForbiddenError('You can only duplicate your own products');
  }
  
  const product = await productService.duplicate(req.params.productId);
  
  created(res, { product }, 'Product duplicated successfully');
});

/**
 * Update product status
 * PATCH /api/v1/products/:productId/status
 */
exports.updateStatus = asyncHandler(async (req, res) => {
  const { status } = req.body;
  
  if (!status) {
    throw new BadRequestError('Status is required');
  }
  
  // Verify ownership
  const existingProduct = await productService.getById(req.params.productId);
  if (!existingProduct || existingProduct.businessId !== req.business.id) {
    throw new ForbiddenError('You can only update your own products');
  }
  
  const product = await productService.updateStatus(req.params.productId, status);
  
  success(res, { product }, 'Product status updated');
});

/**
 * Add variant
 * POST /api/v1/products/:productId/variants
 */
exports.addVariant = asyncHandler(async (req, res) => {
  // Verify ownership
  const existingProduct = await productService.getById(req.params.productId);
  if (!existingProduct || existingProduct.businessId !== req.business.id) {
    throw new ForbiddenError('You can only modify your own products');
  }
  
  const variant = await productService.addVariant(req.params.productId, req.body);
  
  created(res, { variant }, 'Variant added successfully');
});

/**
 * Update variant
 * PATCH /api/v1/products/:productId/variants/:variantId
 */
exports.updateVariant = asyncHandler(async (req, res) => {
  // Verify ownership
  const existingProduct = await productService.getById(req.params.productId);
  if (!existingProduct || existingProduct.businessId !== req.business.id) {
    throw new ForbiddenError('You can only modify your own products');
  }
  
  const variant = await productService.updateVariant(req.params.variantId, req.body);
  
  success(res, { variant }, 'Variant updated successfully');
});

/**
 * Delete variant
 * DELETE /api/v1/products/:productId/variants/:variantId
 */
exports.deleteVariant = asyncHandler(async (req, res) => {
  // Verify ownership
  const existingProduct = await productService.getById(req.params.productId);
  if (!existingProduct || existingProduct.businessId !== req.business.id) {
    throw new ForbiddenError('You can only modify your own products');
  }
  
  await productService.deleteVariant(req.params.variantId);
  
  success(res, null, 'Variant deleted successfully');
});

/**
 * Update variant inventory
 * PATCH /api/v1/products/:productId/variants/:variantId/inventory
 */
exports.updateInventory = asyncHandler(async (req, res) => {
  const { quantity, type = 'set', reason } = req.body;
  
  if (quantity === undefined) {
    throw new BadRequestError('Quantity is required');
  }
  
  // Verify ownership
  const existingProduct = await productService.getById(req.params.productId);
  if (!existingProduct || existingProduct.businessId !== req.business.id) {
    throw new ForbiddenError('You can only modify your own products');
  }
  
  const variant = await productService.updateInventory(req.params.variantId, {
    quantity: parseInt(quantity),
    type,
    reason,
    updatedBy: req.user.id,
  });
  
  success(res, { variant }, 'Inventory updated successfully');
});

/**
 * Get pricing tiers
 * GET /api/v1/products/:productId/variants/:variantId/pricing
 */
exports.getPricingTiers = asyncHandler(async (req, res) => {
  const tiers = await productService.getPricingTiers(req.params.variantId);
  
  success(res, { tiers });
});

/**
 * Set pricing tiers
 * PUT /api/v1/products/:productId/variants/:variantId/pricing
 */
exports.setPricingTiers = asyncHandler(async (req, res) => {
  const { tiers } = req.body;
  
  if (!Array.isArray(tiers)) {
    throw new BadRequestError('Tiers must be an array');
  }
  
  // Verify ownership
  const existingProduct = await productService.getById(req.params.productId);
  if (!existingProduct || existingProduct.businessId !== req.business.id) {
    throw new ForbiddenError('You can only modify your own products');
  }
  
  const updatedTiers = await productService.setPricingTiers(req.params.variantId, tiers);
  
  success(res, { tiers: updatedTiers }, 'Pricing tiers updated');
});

/**
 * Bulk update products
 * PATCH /api/v1/products/bulk/update
 */
exports.bulkUpdate = asyncHandler(async (req, res) => {
  const { productIds, updates } = req.body;
  
  if (!productIds || !Array.isArray(productIds)) {
    throw new BadRequestError('Product IDs array is required');
  }
  
  const result = await productService.bulkUpdate(req.business.id, productIds, updates);
  
  success(res, result, `${result.updated} products updated`);
});

/**
 * Bulk update status
 * PATCH /api/v1/products/bulk/status
 */
exports.bulkUpdateStatus = asyncHandler(async (req, res) => {
  const { productIds, status } = req.body;
  
  if (!productIds || !status) {
    throw new BadRequestError('Product IDs and status are required');
  }
  
  const result = await productService.bulkUpdateStatus(req.business.id, productIds, status);
  
  success(res, result, `${result.updated} products updated`);
});

/**
 * Bulk update inventory
 * PATCH /api/v1/products/bulk/inventory
 */
exports.bulkUpdateInventory = asyncHandler(async (req, res) => {
  const { updates } = req.body;
  
  if (!Array.isArray(updates)) {
    throw new BadRequestError('Updates array is required');
  }
  
  const result = await productService.bulkUpdateInventory(req.business.id, updates);
  
  success(res, result, 'Inventory updated');
});

/**
 * Export products to CSV
 * GET /api/v1/products/export/csv
 */
exports.exportCSV = asyncHandler(async (req, res) => {
  const csv = await productService.exportToCSV(req.business.id, req.query);
  
  res.setHeader('Content-Type', 'text/csv');
  res.setHeader('Content-Disposition', 'attachment; filename="products.csv"');
  res.send(csv);
});

/**
 * Import products from CSV
 * POST /api/v1/products/import/csv
 */
exports.importCSV = asyncHandler(async (req, res) => {
  const { fileUrl, mode = 'create' } = req.body;
  
  if (!fileUrl) {
    throw new BadRequestError('CSV file URL is required');
  }
  
  const result = await productService.importFromCSV(req.business.id, fileUrl, mode);
  
  success(res, result, `Import completed: ${result.created} created, ${result.updated} updated, ${result.errors} errors`);
});
