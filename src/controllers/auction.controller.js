// =============================================================================
// AIRAVAT B2B MARKETPLACE - AUCTION CONTROLLER
// Controller for auction and bidding endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const auctionService = require('../services/auction.service');
const { success, created } = require('../utils/apiResponse');

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * @desc    Create new auction
 * @route   POST /api/v1/auctions
 * @access  Private (Seller)
 */
exports.createAuction = asyncHandler(async (req, res) => {
  const auction = await auctionService.createAuction(
    req.user.businessId,
    req.body
  );
  return created(res, auction, 'Auction created');
});

/**
 * @desc    Place a bid
 * @route   POST /api/v1/auctions/:auctionId/bid
 * @access  Private
 */
exports.placeBid = asyncHandler(async (req, res) => {
  const bid = await auctionService.placeBid(
    req.user.businessId,
    req.params.auctionId,
    req.body.amount,
    req.body.maxBid
  );
  return created(res, bid, 'Bid placed successfully');
});

/**
 * @desc    Buy now
 * @route   POST /api/v1/auctions/:auctionId/buy-now
 * @access  Private
 */
exports.buyNow = asyncHandler(async (req, res) => {
  const result = await auctionService.buyNow(
    req.user.businessId,
    req.params.auctionId
  );
  return success(res, result, 'Purchase successful');
});

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * @desc    Get active auctions
 * @route   GET /api/v1/auctions
 * @access  Public
 */
exports.getActiveAuctions = asyncHandler(async (req, res) => {
  const result = await auctionService.getActiveAuctions(req.query);
  return success(res, result);
});

/**
 * @desc    Get auction by ID
 * @route   GET /api/v1/auctions/:auctionId
 * @access  Public
 */
exports.getAuctionById = asyncHandler(async (req, res) => {
  const auction = await auctionService.getAuctionById(
    req.params.auctionId,
    req.user?.businessId
  );
  return success(res, auction);
});

/**
 * @desc    Get bid history
 * @route   GET /api/v1/auctions/:auctionId/bids
 * @access  Public
 */
exports.getBidHistory = asyncHandler(async (req, res) => {
  const result = await auctionService.getBidHistory(
    req.params.auctionId,
    req.query
  );
  return success(res, result);
});

/**
 * @desc    Get seller's auctions
 * @route   GET /api/v1/auctions/seller/my-auctions
 * @access  Private (Seller)
 */
exports.getSellerAuctions = asyncHandler(async (req, res) => {
  const result = await auctionService.getSellerAuctions(
    req.user.businessId,
    req.query
  );
  return success(res, result);
});

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

/**
 * @desc    Toggle watch auction
 * @route   POST /api/v1/auctions/:auctionId/watch
 * @access  Private
 */
exports.toggleWatch = asyncHandler(async (req, res) => {
  const result = await auctionService.toggleWatch(
    req.user.id,
    req.params.auctionId
  );
  return success(res, result);
});

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

/**
 * @desc    Cancel auction
 * @route   DELETE /api/v1/auctions/:auctionId
 * @access  Private (Seller)
 */
exports.cancelAuction = asyncHandler(async (req, res) => {
  await auctionService.cancelAuction(
    req.user.businessId,
    req.params.auctionId,
    req.body.reason
  );
  return success(res, null, 'Auction cancelled');
});

module.exports = exports;
