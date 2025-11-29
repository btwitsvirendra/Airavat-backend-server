// =============================================================================
// AIRAVAT B2B MARKETPLACE - WISHLIST ROUTES
// Routes for wishlist management endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const wishlistController = require('../controllers/wishlist.controller');
const { authenticate } = require('../middleware/auth');
const { validate } = require('../middleware/validation');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/wishlist/shared/:token
 * @desc    Get shared wishlist
 */
router.get(
  '/shared/:token',
  [param('token').notEmpty().withMessage('Share token is required')],
  validate,
  wishlistController.getSharedWishlist
);

// =============================================================================
// PROTECTED ROUTES
// =============================================================================

router.use(authenticate);

/**
 * @route   GET /api/v1/wishlist
 * @desc    Get user's wishlist
 */
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    query('sortBy').optional().isIn(['createdAt', 'priority']).withMessage('Invalid sort field'),
    query('sortOrder').optional().isIn(['asc', 'desc']).withMessage('Invalid sort order'),
  ],
  validate,
  wishlistController.getWishlist
);

/**
 * @route   POST /api/v1/wishlist
 * @desc    Add product to wishlist
 */
router.post(
  '/',
  [
    body('productId').notEmpty().withMessage('Product ID is required'),
    body('notes').optional().isLength({ max: 500 }).withMessage('Notes max 500 characters'),
    body('priority').optional().isInt({ min: 0, max: 10 }).withMessage('Priority must be 0-10'),
    body('notifyOnPriceDrop').optional().isBoolean().withMessage('Must be boolean'),
  ],
  validate,
  wishlistController.addToWishlist
);

/**
 * @route   GET /api/v1/wishlist/count
 * @desc    Get wishlist count
 */
router.get('/count', wishlistController.getWishlistCount);

/**
 * @route   GET /api/v1/wishlist/price-drops
 * @desc    Get items with price drops
 */
router.get('/price-drops', wishlistController.getPriceDrops);

/**
 * @route   DELETE /api/v1/wishlist/clear
 * @desc    Clear entire wishlist
 */
router.delete('/clear', wishlistController.clearWishlist);

/**
 * @route   POST /api/v1/wishlist/share
 * @desc    Share wishlist
 */
router.post(
  '/share',
  [
    body('expiresIn').optional().isInt({ min: 1, max: 30 }).withMessage('Expires in 1-30 days'),
  ],
  validate,
  wishlistController.shareWishlist
);

/**
 * @route   GET /api/v1/wishlist/check/:productId
 * @desc    Check if product is in wishlist
 */
router.get(
  '/check/:productId',
  [param('productId').notEmpty().withMessage('Product ID is required')],
  validate,
  wishlistController.checkInWishlist
);

/**
 * @route   PATCH /api/v1/wishlist/:productId
 * @desc    Update wishlist item
 */
router.patch(
  '/:productId',
  [
    param('productId').notEmpty().withMessage('Product ID is required'),
    body('notes').optional().isLength({ max: 500 }),
    body('priority').optional().isInt({ min: 0, max: 10 }),
    body('notifyOnPriceDrop').optional().isBoolean(),
  ],
  validate,
  wishlistController.updateWishlistItem
);

/**
 * @route   DELETE /api/v1/wishlist/:productId
 * @desc    Remove product from wishlist
 */
router.delete(
  '/:productId',
  [param('productId').notEmpty().withMessage('Product ID is required')],
  validate,
  wishlistController.removeFromWishlist
);

/**
 * @route   POST /api/v1/wishlist/:productId/move-to-cart
 * @desc    Move item to cart
 */
router.post(
  '/:productId/move-to-cart',
  [
    param('productId').notEmpty().withMessage('Product ID is required'),
    body('quantity').optional().isInt({ min: 1 }).withMessage('Quantity must be positive'),
  ],
  validate,
  wishlistController.moveToCart
);

module.exports = router;
