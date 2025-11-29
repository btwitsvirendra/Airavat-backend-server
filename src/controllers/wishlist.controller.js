// =============================================================================
// AIRAVAT B2B MARKETPLACE - WISHLIST CONTROLLER
// Controller for wishlist management endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const wishlistService = require('../services/wishlist.service');
const { success, created } = require('../utils/apiResponse');

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @desc    Add product to wishlist
 * @route   POST /api/v1/wishlist
 * @access  Private
 */
exports.addToWishlist = asyncHandler(async (req, res) => {
  const item = await wishlistService.addToWishlist(
    req.user.id,
    req.user.businessId,
    req.body
  );
  return created(res, item, 'Product added to wishlist');
});

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @desc    Get user's wishlist
 * @route   GET /api/v1/wishlist
 * @access  Private
 */
exports.getWishlist = asyncHandler(async (req, res) => {
  const result = await wishlistService.getWishlist(req.user.id, req.query);
  return success(res, result);
});

/**
 * @desc    Get wishlist item count
 * @route   GET /api/v1/wishlist/count
 * @access  Private
 */
exports.getWishlistCount = asyncHandler(async (req, res) => {
  const count = await wishlistService.getWishlistCount(req.user.id);
  return success(res, { count });
});

/**
 * @desc    Check if product is in wishlist
 * @route   GET /api/v1/wishlist/check/:productId
 * @access  Private
 */
exports.checkInWishlist = asyncHandler(async (req, res) => {
  const isInWishlist = await wishlistService.isInWishlist(
    req.user.id,
    req.params.productId
  );
  return success(res, { isInWishlist });
});

/**
 * @desc    Get products with price drops
 * @route   GET /api/v1/wishlist/price-drops
 * @access  Private
 */
exports.getPriceDrops = asyncHandler(async (req, res) => {
  const items = await wishlistService.getItemsWithPriceDrops(req.user.id);
  return success(res, items);
});

/**
 * @desc    Get shared wishlist by token
 * @route   GET /api/v1/wishlist/shared/:token
 * @access  Public
 */
exports.getSharedWishlist = asyncHandler(async (req, res) => {
  const result = await wishlistService.getSharedWishlist(req.params.token);
  return success(res, result);
});

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * @desc    Update wishlist item
 * @route   PATCH /api/v1/wishlist/:productId
 * @access  Private
 */
exports.updateWishlistItem = asyncHandler(async (req, res) => {
  const item = await wishlistService.updateWishlistItem(
    req.user.id,
    req.params.productId,
    req.body
  );
  return success(res, item, 'Wishlist item updated');
});

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * @desc    Remove product from wishlist
 * @route   DELETE /api/v1/wishlist/:productId
 * @access  Private
 */
exports.removeFromWishlist = asyncHandler(async (req, res) => {
  await wishlistService.removeFromWishlist(req.user.id, req.params.productId);
  return success(res, null, 'Product removed from wishlist');
});

/**
 * @desc    Clear entire wishlist
 * @route   DELETE /api/v1/wishlist/clear
 * @access  Private
 */
exports.clearWishlist = asyncHandler(async (req, res) => {
  await wishlistService.clearWishlist(req.user.id);
  return success(res, null, 'Wishlist cleared');
});

// =============================================================================
// SPECIAL OPERATIONS
// =============================================================================

/**
 * @desc    Move wishlist item to cart
 * @route   POST /api/v1/wishlist/:productId/move-to-cart
 * @access  Private
 */
exports.moveToCart = asyncHandler(async (req, res) => {
  const result = await wishlistService.moveToCart(
    req.user.id,
    req.params.productId,
    req.body.quantity
  );
  return success(res, result, 'Item moved to cart');
});

/**
 * @desc    Share wishlist
 * @route   POST /api/v1/wishlist/share
 * @access  Private
 */
exports.shareWishlist = asyncHandler(async (req, res) => {
  const result = await wishlistService.shareWishlist(req.user.id, req.body);
  return success(res, result);
});

module.exports = exports;
