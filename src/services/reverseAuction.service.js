// =============================================================================
// AIRAVAT B2B MARKETPLACE - REVERSE AUCTION SERVICE
// Service for reverse auctions where sellers bid to win buyer orders
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  minDuration: 60 * 60 * 1000, // 1 hour
  maxDuration: 30 * 24 * 60 * 60 * 1000, // 30 days
  minBidDecrement: 1, // Minimum bid decrease percentage
  extensionTime: 10 * 60 * 1000, // 10 minutes extension on late bids
  maxExtensions: 5,
  autoAwardDelay: 60 * 60 * 1000, // 1 hour after end
};

/**
 * Reverse auction statuses
 */
const REVERSE_AUCTION_STATUS = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  PUBLISHED: 'Published',
  ACTIVE: 'Active',
  EXTENDED: 'Extended',
  ENDED: 'Ended',
  AWARDED: 'Awarded',
  CANCELLED: 'Cancelled',
  NO_BIDS: 'No Bids Received',
};

/**
 * Award methods
 */
const AWARD_METHODS = {
  LOWEST_BID: 'Lowest Bid',
  WEIGHTED_SCORE: 'Weighted Score (Price + Rating)',
  MANUAL: 'Manual Selection',
};

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * Create a reverse auction
 * @param {string} buyerId - Buyer user ID
 * @param {Object} data - Auction data
 * @returns {Promise<Object>} Created auction
 */
exports.createReverseAuction = async (buyerId, data) => {
  try {
    const {
      title,
      description,
      categoryId,
      specifications,
      quantity,
      unit,
      maxBudget,
      currency = 'INR',
      startDate,
      endDate,
      deliveryAddress,
      deliveryDeadline,
      awardMethod = 'LOWEST_BID',
      qualificationCriteria = [],
      attachments = [],
      invitedSellers = [],
      isPublic = true,
    } = data;

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    
    if (start < new Date()) {
      throw new AppError('Start date must be in the future', 400);
    }

    const duration = end - start;
    if (duration < CONFIG.minDuration || duration > CONFIG.maxDuration) {
      throw new AppError('Invalid auction duration', 400);
    }

    // Generate auction number
    const auctionNumber = generateAuctionNumber();

    const auction = await prisma.reverseAuction.create({
      data: {
        auctionNumber,
        buyerId,
        title,
        description,
        categoryId,
        specifications,
        quantity,
        unit: unit || 'units',
        maxBudget,
        currency,
        startDate: start,
        endDate: end,
        originalEndDate: end,
        deliveryAddress,
        deliveryDeadline: deliveryDeadline ? new Date(deliveryDeadline) : null,
        awardMethod,
        qualificationCriteria,
        attachments,
        isPublic,
        status: 'DRAFT',
        extensionsUsed: 0,
        // Create invitations for private auctions
        invitations: invitedSellers.length > 0 ? {
          create: invitedSellers.map((sellerId) => ({
            sellerId,
            status: 'PENDING',
          })),
        } : undefined,
      },
      include: {
        category: { select: { id: true, name: true } },
        buyer: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    logger.info('Reverse auction created', {
      auctionNumber,
      buyerId,
      isPublic,
    });

    return auction;
  } catch (error) {
    logger.error('Create reverse auction error', { error: error.message, buyerId });
    throw error;
  }
};

/**
 * Publish auction (make it live)
 * @param {string} auctionId - Auction ID
 * @param {string} userId - Buyer user ID
 * @returns {Promise<Object>} Published auction
 */
exports.publishAuction = async (auctionId, userId) => {
  const auction = await prisma.reverseAuction.findUnique({
    where: { id: auctionId },
  });

  if (!auction) {
    throw new AppError('Auction not found', 404);
  }

  if (auction.buyerId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  if (auction.status !== 'DRAFT') {
    throw new AppError('Only draft auctions can be published', 400);
  }

  // Determine initial status based on start date
  const now = new Date();
  const status = auction.startDate <= now ? 'ACTIVE' : 'PUBLISHED';

  const updated = await prisma.reverseAuction.update({
    where: { id: auctionId },
    data: {
      status,
      publishedAt: new Date(),
    },
  });

  // Notify invited sellers if private
  if (!auction.isPublic) {
    await notifyInvitedSellers(auctionId);
  }

  logger.info('Reverse auction published', { auctionId, status });

  return updated;
};

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * Get auction by ID
 * @param {string} auctionId - Auction ID
 * @param {string} userId - Requesting user ID
 * @returns {Promise<Object>} Auction details
 */
exports.getAuction = async (auctionId, userId) => {
  const auction = await prisma.reverseAuction.findUnique({
    where: { id: auctionId },
    include: {
      category: { select: { id: true, name: true } },
      buyer: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          business: { select: { businessName: true, verificationStatus: true } },
        },
      },
      bids: {
        where: { status: 'ACTIVE' },
        orderBy: { amount: 'asc' },
        take: 10,
        select: {
          id: true,
          amount: true,
          createdAt: true,
          seller: {
            select: {
              id: true,
              businessName: true,
              verificationStatus: true,
              // Hide name for sealed bids
            },
          },
        },
      },
      _count: { select: { bids: true } },
    },
  });

  if (!auction) {
    throw new AppError('Auction not found', 404);
  }

  // Check access for private auctions
  if (!auction.isPublic && auction.buyerId !== userId) {
    const invitation = await prisma.reverseAuctionInvitation.findFirst({
      where: {
        auctionId,
        sellerId: userId,
      },
    });

    if (!invitation) {
      throw new AppError('Not authorized to view this auction', 403);
    }
  }

  // Get current lowest bid
  const lowestBid = auction.bids[0] || null;

  return {
    ...auction,
    statusInfo: REVERSE_AUCTION_STATUS[auction.status],
    awardMethodInfo: AWARD_METHODS[auction.awardMethod],
    currentLowestBid: lowestBid?.amount || null,
    bidCount: auction._count.bids,
    isOwner: auction.buyerId === userId,
    timeRemaining: calculateTimeRemaining(auction.endDate),
  };
};

/**
 * Get active reverse auctions
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated auctions
 */
exports.getActiveAuctions = async (options = {}) => {
  const {
    page = 1,
    limit = 20,
    categoryId = null,
    search = null,
    minBudget = null,
    maxBudget = null,
    sortBy = 'endDate',
    sortOrder = 'asc',
  } = options;

  const skip = (page - 1) * limit;

  const where = {
    status: { in: ['ACTIVE', 'EXTENDED'] },
    isPublic: true,
    endDate: { gt: new Date() },
  };

  if (categoryId) where.categoryId = categoryId;
  if (minBudget) where.maxBudget = { gte: minBudget };
  if (maxBudget) where.maxBudget = { ...where.maxBudget, lte: maxBudget };

  if (search) {
    where.OR = [
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
      { auctionNumber: { contains: search, mode: 'insensitive' } },
    ];
  }

  const [auctions, total] = await Promise.all([
    prisma.reverseAuction.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        category: { select: { id: true, name: true } },
        buyer: {
          select: {
            id: true,
            firstName: true,
            business: { select: { businessName: true } },
          },
        },
        _count: { select: { bids: true } },
      },
    }),
    prisma.reverseAuction.count({ where }),
  ]);

  // Get lowest bids for each auction
  const auctionsWithBids = await Promise.all(
    auctions.map(async (auction) => {
      const lowestBid = await prisma.reverseAuctionBid.findFirst({
        where: { auctionId: auction.id, status: 'ACTIVE' },
        orderBy: { amount: 'asc' },
        select: { amount: true },
      });

      return {
        ...auction,
        currentLowestBid: lowestBid?.amount || null,
        statusInfo: REVERSE_AUCTION_STATUS[auction.status],
        timeRemaining: calculateTimeRemaining(auction.endDate),
      };
    })
  );

  return {
    auctions: auctionsWithBids,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get buyer's auctions
 * @param {string} buyerId - Buyer user ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Buyer's auctions
 */
exports.getBuyerAuctions = async (buyerId, options = {}) => {
  const { page = 1, limit = 20, status = null } = options;
  const skip = (page - 1) * limit;

  const where = { buyerId };
  if (status) where.status = status;

  const [auctions, total] = await Promise.all([
    prisma.reverseAuction.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        _count: { select: { bids: true } },
        winningBid: {
          include: {
            seller: { select: { id: true, businessName: true } },
          },
        },
      },
    }),
    prisma.reverseAuction.count({ where }),
  ]);

  return {
    auctions: auctions.map((a) => ({
      ...a,
      statusInfo: REVERSE_AUCTION_STATUS[a.status],
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// =============================================================================
// BIDDING OPERATIONS
// =============================================================================

/**
 * Place a bid on reverse auction
 * @param {string} auctionId - Auction ID
 * @param {string} sellerId - Seller business ID
 * @param {Object} data - Bid data
 * @returns {Promise<Object>} Placed bid
 */
exports.placeBid = async (auctionId, sellerId, data) => {
  try {
    const { amount, notes, deliveryDays, warranty, attachments = [] } = data;

    const auction = await prisma.reverseAuction.findUnique({
      where: { id: auctionId },
      include: {
        bids: {
          where: { status: 'ACTIVE' },
          orderBy: { amount: 'asc' },
          take: 1,
        },
      },
    });

    if (!auction) {
      throw new AppError('Auction not found', 404);
    }

    if (!['ACTIVE', 'EXTENDED'].includes(auction.status)) {
      throw new AppError('Auction is not accepting bids', 400);
    }

    if (new Date() > auction.endDate) {
      throw new AppError('Auction has ended', 400);
    }

    // Check if seller is invited (for private auctions)
    if (!auction.isPublic) {
      const invitation = await prisma.reverseAuctionInvitation.findFirst({
        where: {
          auctionId,
          sellerId,
          status: 'ACCEPTED',
        },
      });

      if (!invitation) {
        throw new AppError('Not authorized to bid on this auction', 403);
      }
    }

    // Validate bid amount
    if (amount > auction.maxBudget) {
      throw new AppError(`Bid must not exceed budget of ${auction.maxBudget}`, 400);
    }

    // Check if bid is lower than current lowest
    const currentLowest = auction.bids[0]?.amount;
    if (currentLowest) {
      const minAmount = currentLowest * (1 - CONFIG.minBidDecrement / 100);
      if (amount >= currentLowest) {
        throw new AppError(`Bid must be lower than current lowest: ${currentLowest}`, 400);
      }
    }

    // Check for existing bid from this seller
    const existingBid = await prisma.reverseAuctionBid.findFirst({
      where: {
        auctionId,
        sellerId,
        status: 'ACTIVE',
      },
    });

    let bid;
    if (existingBid) {
      // Update existing bid
      bid = await prisma.reverseAuctionBid.update({
        where: { id: existingBid.id },
        data: {
          amount,
          notes,
          deliveryDays,
          warranty,
          attachments,
          updatedAt: new Date(),
        },
      });
    } else {
      // Create new bid
      bid = await prisma.reverseAuctionBid.create({
        data: {
          auctionId,
          sellerId,
          amount,
          notes,
          deliveryDays,
          warranty,
          attachments,
          status: 'ACTIVE',
        },
      });
    }

    // Check for auto-extension
    await checkAndExtendAuction(auctionId);

    // Update auction's current lowest
    await updateAuctionLowestBid(auctionId);

    logger.info('Reverse auction bid placed', {
      auctionId,
      sellerId,
      amount,
      isUpdate: !!existingBid,
    });

    return bid;
  } catch (error) {
    logger.error('Place bid error', { error: error.message, auctionId, sellerId });
    throw error;
  }
};

/**
 * Withdraw bid
 * @param {string} bidId - Bid ID
 * @param {string} sellerId - Seller ID
 * @returns {Promise<Object>} Withdrawal result
 */
exports.withdrawBid = async (bidId, sellerId) => {
  const bid = await prisma.reverseAuctionBid.findUnique({
    where: { id: bidId },
    include: { auction: true },
  });

  if (!bid) {
    throw new AppError('Bid not found', 404);
  }

  if (bid.sellerId !== sellerId) {
    throw new AppError('Not authorized', 403);
  }

  if (bid.auction.status === 'AWARDED') {
    throw new AppError('Cannot withdraw bid from awarded auction', 400);
  }

  await prisma.reverseAuctionBid.update({
    where: { id: bidId },
    data: {
      status: 'WITHDRAWN',
      withdrawnAt: new Date(),
    },
  });

  // Update auction's lowest bid
  await updateAuctionLowestBid(bid.auctionId);

  logger.info('Bid withdrawn', { bidId, sellerId });

  return { success: true };
};

/**
 * Get bids for an auction
 * @param {string} auctionId - Auction ID
 * @param {string} userId - Requesting user ID
 * @returns {Promise<Object[]>} Auction bids
 */
exports.getAuctionBids = async (auctionId, userId) => {
  const auction = await prisma.reverseAuction.findUnique({
    where: { id: auctionId },
  });

  if (!auction) {
    throw new AppError('Auction not found', 404);
  }

  // Only buyer can see all bids
  if (auction.buyerId !== userId) {
    throw new AppError('Not authorized to view all bids', 403);
  }

  const bids = await prisma.reverseAuctionBid.findMany({
    where: { auctionId, status: 'ACTIVE' },
    orderBy: { amount: 'asc' },
    include: {
      seller: {
        select: {
          id: true,
          businessName: true,
          verificationStatus: true,
          badges: { where: { status: 'ACTIVE' }, take: 3 },
        },
      },
    },
  });

  // Calculate rank
  return bids.map((bid, index) => ({
    ...bid,
    rank: index + 1,
  }));
};

// =============================================================================
// AWARD OPERATIONS
// =============================================================================

/**
 * Award auction to a seller
 * @param {string} auctionId - Auction ID
 * @param {string} buyerId - Buyer user ID
 * @param {string} bidId - Winning bid ID
 * @param {string} notes - Award notes
 * @returns {Promise<Object>} Award result
 */
exports.awardAuction = async (auctionId, buyerId, bidId, notes = '') => {
  try {
    const auction = await prisma.reverseAuction.findUnique({
      where: { id: auctionId },
    });

    if (!auction) {
      throw new AppError('Auction not found', 404);
    }

    if (auction.buyerId !== buyerId) {
      throw new AppError('Not authorized', 403);
    }

    if (auction.status !== 'ENDED') {
      throw new AppError('Auction must be ended before awarding', 400);
    }

    const bid = await prisma.reverseAuctionBid.findUnique({
      where: { id: bidId },
      include: { seller: true },
    });

    if (!bid || bid.auctionId !== auctionId) {
      throw new AppError('Invalid bid', 400);
    }

    // Award auction
    const result = await prisma.$transaction(async (tx) => {
      // Update auction
      const updatedAuction = await tx.reverseAuction.update({
        where: { id: auctionId },
        data: {
          status: 'AWARDED',
          winningBidId: bidId,
          awardedAt: new Date(),
          awardNotes: notes,
        },
      });

      // Update winning bid
      await tx.reverseAuctionBid.update({
        where: { id: bidId },
        data: { status: 'AWARDED' },
      });

      // Reject other bids
      await tx.reverseAuctionBid.updateMany({
        where: {
          auctionId,
          id: { not: bidId },
          status: 'ACTIVE',
        },
        data: { status: 'REJECTED' },
      });

      // Create purchase order
      const order = await tx.order.create({
        data: {
          buyerId: auction.buyerId,
          sellerId: bid.sellerId,
          orderNumber: generateOrderNumber(),
          status: 'PENDING',
          subtotal: bid.amount * auction.quantity,
          total: bid.amount * auction.quantity,
          currency: auction.currency,
          reverseAuctionId: auctionId,
          shippingAddress: auction.deliveryAddress,
          items: {
            create: {
              description: auction.title,
              quantity: auction.quantity,
              unitPrice: bid.amount,
              totalPrice: bid.amount * auction.quantity,
            },
          },
        },
      });

      return { auction: updatedAuction, order };
    });

    // Notify winner
    await notifyAuctionWinner(bid.sellerId, auction, bid);

    // Notify other participants
    await notifyAuctionParticipants(auctionId, bidId);

    logger.info('Reverse auction awarded', {
      auctionId,
      bidId,
      winnerId: bid.sellerId,
    });

    return result;
  } catch (error) {
    logger.error('Award auction error', { error: error.message, auctionId });
    throw error;
  }
};

/**
 * Cancel auction
 * @param {string} auctionId - Auction ID
 * @param {string} buyerId - Buyer user ID
 * @param {string} reason - Cancellation reason
 * @returns {Promise<Object>} Cancellation result
 */
exports.cancelAuction = async (auctionId, buyerId, reason) => {
  const auction = await prisma.reverseAuction.findUnique({
    where: { id: auctionId },
  });

  if (!auction) {
    throw new AppError('Auction not found', 404);
  }

  if (auction.buyerId !== buyerId) {
    throw new AppError('Not authorized', 403);
  }

  if (auction.status === 'AWARDED') {
    throw new AppError('Awarded auctions cannot be cancelled', 400);
  }

  await prisma.reverseAuction.update({
    where: { id: auctionId },
    data: {
      status: 'CANCELLED',
      cancellationReason: reason,
      cancelledAt: new Date(),
    },
  });

  // Notify all bidders
  await notifyAuctionCancelled(auctionId);

  logger.info('Reverse auction cancelled', { auctionId, reason });

  return { success: true };
};

// =============================================================================
// SCHEDULED OPERATIONS
// =============================================================================

/**
 * End expired auctions
 * @returns {Promise<Object>} Processing result
 */
exports.endExpiredAuctions = async () => {
  const expired = await prisma.reverseAuction.findMany({
    where: {
      status: { in: ['ACTIVE', 'EXTENDED'] },
      endDate: { lte: new Date() },
    },
  });

  for (const auction of expired) {
    const bidCount = await prisma.reverseAuctionBid.count({
      where: { auctionId: auction.id, status: 'ACTIVE' },
    });

    await prisma.reverseAuction.update({
      where: { id: auction.id },
      data: {
        status: bidCount > 0 ? 'ENDED' : 'NO_BIDS',
        endedAt: new Date(),
      },
    });
  }

  logger.info('Expired reverse auctions processed', { count: expired.length });

  return { processed: expired.length };
};

/**
 * Start scheduled auctions
 * @returns {Promise<Object>} Processing result
 */
exports.startScheduledAuctions = async () => {
  const result = await prisma.reverseAuction.updateMany({
    where: {
      status: 'PUBLISHED',
      startDate: { lte: new Date() },
    },
    data: { status: 'ACTIVE' },
  });

  if (result.count > 0) {
    logger.info('Scheduled reverse auctions started', { count: result.count });
  }

  return { started: result.count };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateAuctionNumber() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `RA${year}${month}-${random}`;
}

function generateOrderNumber() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `PO${year}${month}-${random}`;
}

function calculateTimeRemaining(endDate) {
  const remaining = new Date(endDate) - new Date();
  if (remaining <= 0) return 'Ended';

  const days = Math.floor(remaining / (24 * 60 * 60 * 1000));
  const hours = Math.floor((remaining % (24 * 60 * 60 * 1000)) / (60 * 60 * 1000));
  const minutes = Math.floor((remaining % (60 * 60 * 1000)) / (60 * 1000));

  if (days > 0) return `${days}d ${hours}h`;
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
}

async function checkAndExtendAuction(auctionId) {
  const auction = await prisma.reverseAuction.findUnique({
    where: { id: auctionId },
  });

  const timeRemaining = auction.endDate - new Date();

  // If less than extension time remaining and extensions available
  if (timeRemaining < CONFIG.extensionTime && auction.extensionsUsed < CONFIG.maxExtensions) {
    const newEndDate = new Date(auction.endDate.getTime() + CONFIG.extensionTime);

    await prisma.reverseAuction.update({
      where: { id: auctionId },
      data: {
        endDate: newEndDate,
        extensionsUsed: { increment: 1 },
        status: 'EXTENDED',
      },
    });

    logger.info('Auction extended', { auctionId, newEndDate });
  }
}

async function updateAuctionLowestBid(auctionId) {
  const lowestBid = await prisma.reverseAuctionBid.findFirst({
    where: { auctionId, status: 'ACTIVE' },
    orderBy: { amount: 'asc' },
  });

  await prisma.reverseAuction.update({
    where: { id: auctionId },
    data: { currentLowestBid: lowestBid?.amount || null },
  });
}

async function notifyInvitedSellers(auctionId) {
  logger.info('Notifying invited sellers', { auctionId });
}

async function notifyAuctionWinner(sellerId, auction, bid) {
  logger.info('Notifying auction winner', { sellerId, auctionId: auction.id });
}

async function notifyAuctionParticipants(auctionId, winningBidId) {
  logger.info('Notifying other participants', { auctionId });
}

async function notifyAuctionCancelled(auctionId) {
  logger.info('Notifying auction cancellation', { auctionId });
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  REVERSE_AUCTION_STATUS,
  AWARD_METHODS,
  CONFIG,
};



