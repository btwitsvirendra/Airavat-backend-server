// =============================================================================
// AIRAVAT B2B MARKETPLACE - AUCTION ROUTES
// Routes for auction and bidding endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const auctionController = require('../controllers/auction.controller');
const { authenticate, optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/validation');
const { rateLimiter } = require('../middleware/rateLimiter');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/auctions
 * @desc    Get active auctions
 */
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('category').optional(),
    query('sellerId').optional(),
    query('sortBy').optional().isIn(['endTime', 'currentPrice', 'bidCount']),
    query('sortOrder').optional().isIn(['asc', 'desc']),
  ],
  validate,
  auctionController.getActiveAuctions
);

/**
 * @route   GET /api/v1/auctions/:auctionId
 * @desc    Get auction by ID
 */
router.get(
  '/:auctionId',
  optionalAuth,
  [param('auctionId').notEmpty().withMessage('Auction ID is required')],
  validate,
  auctionController.getAuctionById
);

/**
 * @route   GET /api/v1/auctions/:auctionId/bids
 * @desc    Get bid history
 */
router.get(
  '/:auctionId/bids',
  [
    param('auctionId').notEmpty().withMessage('Auction ID is required'),
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
  ],
  validate,
  auctionController.getBidHistory
);

// =============================================================================
// PROTECTED ROUTES
// =============================================================================

router.use(authenticate);

// =============================================================================
// SELLER OPERATIONS
// =============================================================================

/**
 * @route   GET /api/v1/auctions/seller/my-auctions
 * @desc    Get seller's auctions
 */
router.get(
  '/seller/my-auctions',
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isIn([
      'DRAFT', 'SCHEDULED', 'ACTIVE', 'EXTENDED',
      'ENDED', 'SOLD', 'CANCELLED', 'NO_BIDS',
    ]),
  ],
  validate,
  auctionController.getSellerAuctions
);

/**
 * @route   POST /api/v1/auctions
 * @desc    Create new auction
 */
router.post(
  '/',
  rateLimiter({ windowMs: 60 * 60 * 1000, max: 20 }), // 20 per hour
  [
    body('productId').notEmpty().withMessage('Product ID is required'),
    body('title')
      .notEmpty()
      .withMessage('Title is required')
      .isLength({ max: 200 })
      .withMessage('Title max 200 characters'),
    body('description').optional().isLength({ max: 2000 }),
    body('quantity').isInt({ min: 1 }).withMessage('Quantity must be positive'),
    body('unit').optional().isLength({ max: 20 }),
    body('startingPrice')
      .isFloat({ min: 1 })
      .withMessage('Starting price must be positive'),
    body('reservePrice')
      .optional()
      .isFloat({ min: 1 })
      .withMessage('Reserve price must be positive'),
    body('buyNowPrice')
      .optional()
      .isFloat({ min: 1 })
      .withMessage('Buy now price must be positive'),
    body('minBidIncrement')
      .optional()
      .isFloat({ min: 1 })
      .withMessage('Min bid increment must be positive'),
    body('startTime').isISO8601().withMessage('Valid start time required'),
    body('endTime').isISO8601().withMessage('Valid end time required'),
    body('extensionMinutes').optional().isInt({ min: 1, max: 60 }),
    body('autoExtend').optional().isBoolean(),
    body('terms').optional().isLength({ max: 5000 }),
  ],
  validate,
  auctionController.createAuction
);

/**
 * @route   DELETE /api/v1/auctions/:auctionId
 * @desc    Cancel auction
 */
router.delete(
  '/:auctionId',
  [
    param('auctionId').notEmpty().withMessage('Auction ID is required'),
    body('reason').optional().isLength({ max: 500 }),
  ],
  validate,
  auctionController.cancelAuction
);

// =============================================================================
// BIDDING OPERATIONS
// =============================================================================

/**
 * @route   POST /api/v1/auctions/:auctionId/bid
 * @desc    Place a bid
 */
router.post(
  '/:auctionId/bid',
  rateLimiter({ windowMs: 60 * 1000, max: 30 }), // 30 per minute
  [
    param('auctionId').notEmpty().withMessage('Auction ID is required'),
    body('amount')
      .isFloat({ min: 1 })
      .withMessage('Bid amount must be positive'),
    body('maxBid')
      .optional()
      .isFloat({ min: 1 })
      .withMessage('Max bid must be positive'),
  ],
  validate,
  auctionController.placeBid
);

/**
 * @route   POST /api/v1/auctions/:auctionId/buy-now
 * @desc    Buy now
 */
router.post(
  '/:auctionId/buy-now',
  [param('auctionId').notEmpty().withMessage('Auction ID is required')],
  validate,
  auctionController.buyNow
);

/**
 * @route   POST /api/v1/auctions/:auctionId/watch
 * @desc    Toggle watch auction
 */
router.post(
  '/:auctionId/watch',
  [param('auctionId').notEmpty().withMessage('Auction ID is required')],
  validate,
  auctionController.toggleWatch
);

module.exports = router;
