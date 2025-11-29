// =============================================================================
// AIRAVAT B2B MARKETPLACE - REVERSE AUCTION CONTROLLER
// Handles buyer-initiated auctions where sellers compete on price
// =============================================================================

const reverseAuctionService = require('../services/reverseAuction.service');
const asyncHandler = require('../middleware/async.middleware');
const { NotFoundError } = require('../utils/errors');

// =============================================================================
// AUCTION MANAGEMENT (BUYER)
// =============================================================================

/**
 * Create a reverse auction
 * @route POST /api/v1/reverse-auctions
 */
const createAuction = asyncHandler(async (req, res) => {
  const auction = await reverseAuctionService.createAuction(
    req.user.id,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Reverse auction created successfully',
    data: auction,
  });
});

/**
 * Get auction by ID
 * @route GET /api/v1/reverse-auctions/:id
 */
const getAuctionById = asyncHandler(async (req, res) => {
  const auction = await reverseAuctionService.getAuctionById(
    req.params.id,
    req.user?.id
  );

  if (!auction) {
    throw new NotFoundError('Auction not found');
  }

  res.json({
    success: true,
    data: auction,
  });
});

/**
 * Get all auctions with filters
 * @route GET /api/v1/reverse-auctions
 */
const getAuctions = asyncHandler(async (req, res) => {
  const result = await reverseAuctionService.getAuctions(
    req.query,
    req.user?.id
  );

  res.json({
    success: true,
    data: result.auctions,
    pagination: result.pagination,
  });
});

/**
 * Update auction details
 * @route PUT /api/v1/reverse-auctions/:id
 */
const updateAuction = asyncHandler(async (req, res) => {
  const auction = await reverseAuctionService.updateAuction(
    req.params.id,
    req.user.id,
    req.body
  );

  res.json({
    success: true,
    message: 'Auction updated successfully',
    data: auction,
  });
});

/**
 * Publish auction
 * @route POST /api/v1/reverse-auctions/:id/publish
 */
const publishAuction = asyncHandler(async (req, res) => {
  const auction = await reverseAuctionService.publishAuction(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Auction published successfully',
    data: auction,
  });
});

/**
 * Cancel auction
 * @route POST /api/v1/reverse-auctions/:id/cancel
 */
const cancelAuction = asyncHandler(async (req, res) => {
  const auction = await reverseAuctionService.cancelAuction(
    req.params.id,
    req.user.id,
    req.body.reason
  );

  res.json({
    success: true,
    message: 'Auction cancelled',
    data: auction,
  });
});

/**
 * Extend auction end time
 * @route POST /api/v1/reverse-auctions/:id/extend
 */
const extendAuction = asyncHandler(async (req, res) => {
  const auction = await reverseAuctionService.extendAuction(
    req.params.id,
    req.user.id,
    req.body.extensionMinutes
  );

  res.json({
    success: true,
    message: 'Auction extended',
    data: auction,
  });
});

/**
 * Award auction to a bid
 * @route POST /api/v1/reverse-auctions/:id/award
 */
const awardAuction = asyncHandler(async (req, res) => {
  const auction = await reverseAuctionService.awardAuction(
    req.params.id,
    req.user.id,
    req.body.bidId,
    req.body.notes
  );

  res.json({
    success: true,
    message: 'Auction awarded successfully',
    data: auction,
  });
});

// =============================================================================
// INVITATION MANAGEMENT
// =============================================================================

/**
 * Invite sellers to auction
 * @route POST /api/v1/reverse-auctions/:id/invite
 */
const inviteSellers = asyncHandler(async (req, res) => {
  const invitations = await reverseAuctionService.inviteSellers(
    req.params.id,
    req.user.id,
    req.body.sellerIds
  );

  res.json({
    success: true,
    message: 'Invitations sent',
    data: invitations,
  });
});

/**
 * Get invited sellers
 * @route GET /api/v1/reverse-auctions/:id/invitations
 */
const getInvitations = asyncHandler(async (req, res) => {
  const invitations = await reverseAuctionService.getInvitations(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    data: invitations,
  });
});

// =============================================================================
// BIDDING (SELLER)
// =============================================================================

/**
 * Place a bid
 * @route POST /api/v1/reverse-auctions/:id/bids
 */
const placeBid = asyncHandler(async (req, res) => {
  const bid = await reverseAuctionService.placeBid(
    req.params.id,
    req.user.id,
    req.user.businessId,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Bid placed successfully',
    data: bid,
  });
});

/**
 * Get bids for an auction
 * @route GET /api/v1/reverse-auctions/:id/bids
 */
const getBids = asyncHandler(async (req, res) => {
  const bids = await reverseAuctionService.getBids(
    req.params.id,
    req.user?.id
  );

  res.json({
    success: true,
    data: bids,
  });
});

/**
 * Get my bid for an auction
 * @route GET /api/v1/reverse-auctions/:id/my-bid
 */
const getMyBid = asyncHandler(async (req, res) => {
  const bid = await reverseAuctionService.getMyBid(
    req.params.id,
    req.user.businessId
  );

  res.json({
    success: true,
    data: bid,
  });
});

/**
 * Withdraw a bid
 * @route POST /api/v1/reverse-auctions/:id/bids/:bidId/withdraw
 */
const withdrawBid = asyncHandler(async (req, res) => {
  const bid = await reverseAuctionService.withdrawBid(
    req.params.bidId,
    req.user.id
  );

  res.json({
    success: true,
    message: 'Bid withdrawn',
    data: bid,
  });
});

/**
 * Accept invitation (seller)
 * @route POST /api/v1/reverse-auctions/:id/accept-invitation
 */
const acceptInvitation = asyncHandler(async (req, res) => {
  const invitation = await reverseAuctionService.respondToInvitation(
    req.params.id,
    req.user.businessId,
    'ACCEPTED'
  );

  res.json({
    success: true,
    message: 'Invitation accepted',
    data: invitation,
  });
});

/**
 * Decline invitation (seller)
 * @route POST /api/v1/reverse-auctions/:id/decline-invitation
 */
const declineInvitation = asyncHandler(async (req, res) => {
  const invitation = await reverseAuctionService.respondToInvitation(
    req.params.id,
    req.user.businessId,
    'DECLINED'
  );

  res.json({
    success: true,
    message: 'Invitation declined',
    data: invitation,
  });
});

// =============================================================================
// ANALYTICS & DISCOVERY
// =============================================================================

/**
 * Get my auctions (buyer)
 * @route GET /api/v1/reverse-auctions/my-auctions
 */
const getMyAuctions = asyncHandler(async (req, res) => {
  const result = await reverseAuctionService.getMyAuctions(
    req.user.id,
    req.query
  );

  res.json({
    success: true,
    data: result.auctions,
    pagination: result.pagination,
  });
});

/**
 * Get my participations (seller)
 * @route GET /api/v1/reverse-auctions/my-participations
 */
const getMyParticipations = asyncHandler(async (req, res) => {
  const result = await reverseAuctionService.getMyParticipations(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: result.auctions,
    pagination: result.pagination,
  });
});

/**
 * Get auction analytics
 * @route GET /api/v1/reverse-auctions/:id/analytics
 */
const getAuctionAnalytics = asyncHandler(async (req, res) => {
  const analytics = await reverseAuctionService.getAuctionAnalytics(
    req.params.id,
    req.user.id
  );

  res.json({
    success: true,
    data: analytics,
  });
});

/**
 * Get live auction updates
 * @route GET /api/v1/reverse-auctions/:id/live
 */
const getLiveUpdates = asyncHandler(async (req, res) => {
  const updates = await reverseAuctionService.getLiveUpdates(req.params.id);

  res.json({
    success: true,
    data: updates,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  createAuction,
  getAuctionById,
  getAuctions,
  updateAuction,
  publishAuction,
  cancelAuction,
  extendAuction,
  awardAuction,
  inviteSellers,
  getInvitations,
  placeBid,
  getBids,
  getMyBid,
  withdrawBid,
  acceptInvitation,
  declineInvitation,
  getMyAuctions,
  getMyParticipations,
  getAuctionAnalytics,
  getLiveUpdates,
};



