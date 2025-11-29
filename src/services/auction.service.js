// =============================================================================
// AIRAVAT B2B MARKETPLACE - AUCTION SERVICE
// B2B auction system with bidding and auto-extend functionality
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} = require('../utils/errors');
const { generateId, formatCurrency } = require('../utils/helpers');
const { emitToBusiness, emitToRoom } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const AUCTION_STATUS = {
  DRAFT: 'DRAFT',
  SCHEDULED: 'SCHEDULED',
  ACTIVE: 'ACTIVE',
  EXTENDED: 'EXTENDED',
  ENDED: 'ENDED',
  SOLD: 'SOLD',
  CANCELLED: 'CANCELLED',
  NO_BIDS: 'NO_BIDS',
};

const CACHE_TTL = { AUCTION: 60, BIDS: 30 };
const AUTO_EXTEND_THRESHOLD_MINUTES = 5;
const DEFAULT_EXTENSION_MINUTES = 5;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const generateAuctionNumber = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = generateId().substring(0, 6).toUpperCase();
  return `AUC-${timestamp}-${random}`;
};

const getAuctionCacheKey = (auctionId) => `auction:${auctionId}`;
const getAuctionBidsCacheKey = (auctionId) => `auction:bids:${auctionId}`;

const invalidateAuctionCache = async (auctionId) => {
  await Promise.all([
    cache.del(getAuctionCacheKey(auctionId)),
    cache.del(getAuctionBidsCacheKey(auctionId)),
  ]);
};

// =============================================================================
// AUCTION MANAGEMENT
// =============================================================================

/**
 * Create new auction
 */
const createAuction = async (sellerId, data) => {
  const {
    productId,
    title,
    description,
    quantity,
    unit = 'pcs',
    startingPrice,
    reservePrice,
    buyNowPrice,
    minBidIncrement = 100,
    startTime,
    endTime,
    extensionMinutes = DEFAULT_EXTENSION_MINUTES,
    autoExtend = true,
    terms,
  } = data;

  // Validate product
  const product = await prisma.product.findFirst({
    where: { id: productId, sellerId },
    select: { id: true, name: true, stockQuantity: true },
  });

  if (!product) {
    throw new NotFoundError('Product');
  }

  if (product.stockQuantity < quantity) {
    throw new BadRequestError(`Insufficient stock. Available: ${product.stockQuantity}`);
  }

  // Validate times
  const start = new Date(startTime);
  const end = new Date(endTime);
  const now = new Date();

  if (start <= now) {
    throw new BadRequestError('Start time must be in the future');
  }

  if (end <= start) {
    throw new BadRequestError('End time must be after start time');
  }

  // Validate prices
  if (reservePrice && parseFloat(reservePrice) < parseFloat(startingPrice)) {
    throw new BadRequestError('Reserve price must be greater than starting price');
  }

  if (buyNowPrice && parseFloat(buyNowPrice) <= parseFloat(startingPrice)) {
    throw new BadRequestError('Buy now price must be greater than starting price');
  }

  const auction = await prisma.auction.create({
    data: {
      auctionNumber: generateAuctionNumber(),
      sellerId,
      productId,
      title,
      description,
      quantity,
      unit,
      startingPrice,
      reservePrice,
      buyNowPrice,
      minBidIncrement,
      currentPrice: startingPrice,
      status: AUCTION_STATUS.SCHEDULED,
      startTime: start,
      endTime: end,
      extensionMinutes,
      autoExtend,
      terms,
    },
    include: {
      product: {
        select: { id: true, name: true, images: true },
      },
    },
  });

  logger.info('Auction created', { auctionId: auction.id, sellerId, productId });

  return auction;
};

/**
 * Get auction by ID
 */
const getAuctionById = async (auctionId, userId = null) => {
  const cacheKey = getAuctionCacheKey(auctionId);
  let auction = await cache.get(cacheKey);

  if (!auction) {
    auction = await prisma.auction.findUnique({
      where: { id: auctionId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            images: true,
            description: true,
          },
        },
        seller: {
          select: { id: true, businessName: true, logo: true },
        },
        winningBid: {
          select: {
            id: true,
            amount: true,
            bidder: { select: { id: true, businessName: true } },
          },
        },
      },
    });

    if (!auction) {
      throw new NotFoundError('Auction');
    }

    await cache.set(cacheKey, auction, CACHE_TTL.AUCTION);
  }

  // Get bid count and user's bid
  const [bidCount, userBid] = await Promise.all([
    prisma.bid.count({ where: { auctionId } }),
    userId
      ? prisma.bid.findFirst({
          where: { auctionId, bidderId: userId },
          orderBy: { createdAt: 'desc' },
        })
      : null,
  ]);

  const now = new Date();
  const isActive = auction.status === AUCTION_STATUS.ACTIVE && now < new Date(auction.endTime);
  const timeRemaining = isActive ? new Date(auction.endTime) - now : 0;

  return {
    ...auction,
    bidCount,
    userBid,
    isActive,
    timeRemaining,
    formattedCurrentPrice: formatCurrency(auction.currentPrice),
    formattedStartingPrice: formatCurrency(auction.startingPrice),
    formattedBuyNowPrice: auction.buyNowPrice ? formatCurrency(auction.buyNowPrice) : null,
  };
};

/**
 * Get active auctions
 */
const getActiveAuctions = async (options = {}) => {
  const { page = 1, limit = 20, category, sellerId, sortBy = 'endTime', sortOrder = 'asc' } = options;
  const skip = (page - 1) * limit;

  const now = new Date();
  const where = {
    status: { in: [AUCTION_STATUS.ACTIVE, AUCTION_STATUS.EXTENDED] },
    endTime: { gt: now },
  };

  if (sellerId) where.sellerId = sellerId;
  if (category) {
    where.product = { categoryId: category };
  }

  const [auctions, total] = await Promise.all([
    prisma.auction.findMany({
      where,
      include: {
        product: {
          select: { id: true, name: true, images: true, category: { select: { id: true, name: true } } },
        },
        seller: { select: { id: true, businessName: true, logo: true } },
      },
      orderBy: { [sortBy]: sortOrder },
      skip,
      take: limit,
    }),
    prisma.auction.count({ where }),
  ]);

  const auctionsWithInfo = auctions.map((auction) => ({
    ...auction,
    timeRemaining: new Date(auction.endTime) - now,
    formattedCurrentPrice: formatCurrency(auction.currentPrice),
  }));

  return {
    auctions: auctionsWithInfo,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Place a bid
 */
const placeBid = async (bidderId, auctionId, amount, maxBid = null) => {
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
    include: { seller: { select: { id: true } } },
  });

  if (!auction) {
    throw new NotFoundError('Auction');
  }

  // Validations
  if (auction.sellerId === bidderId) {
    throw new ForbiddenError('Cannot bid on your own auction');
  }

  const now = new Date();
  if (auction.status !== AUCTION_STATUS.ACTIVE && auction.status !== AUCTION_STATUS.EXTENDED) {
    throw new BadRequestError('Auction is not active');
  }

  if (now > new Date(auction.endTime)) {
    throw new BadRequestError('Auction has ended');
  }

  const currentPrice = parseFloat(auction.currentPrice);
  const minBid = currentPrice + parseFloat(auction.minBidIncrement);

  if (parseFloat(amount) < minBid) {
    throw new BadRequestError(`Minimum bid is ${formatCurrency(minBid)}`);
  }

  // Create bid
  const bid = await prisma.bid.create({
    data: {
      auctionId,
      bidderId,
      amount,
      maxBid,
      isAutoBid: !!maxBid,
    },
    include: {
      bidder: { select: { id: true, businessName: true } },
    },
  });

  // Update auction
  const updateData = {
    currentPrice: amount,
    bidCount: { increment: 1 },
  };

  // Check if should auto-extend
  const timeUntilEnd = new Date(auction.endTime) - now;
  const thresholdMs = AUTO_EXTEND_THRESHOLD_MINUTES * 60 * 1000;

  if (auction.autoExtend && timeUntilEnd <= thresholdMs) {
    const newEndTime = new Date(now.getTime() + auction.extensionMinutes * 60 * 1000);
    updateData.endTime = newEndTime;
    updateData.status = AUCTION_STATUS.EXTENDED;

    logger.info('Auction extended', { auctionId, newEndTime });
  }

  await prisma.auction.update({
    where: { id: auctionId },
    data: updateData,
  });

  // Update previous winning bid
  await prisma.bid.updateMany({
    where: { auctionId, isWinning: true },
    data: { isWinning: false },
  });

  await prisma.bid.update({
    where: { id: bid.id },
    data: { isWinning: true },
  });

  await invalidateAuctionCache(auctionId);

  // Emit real-time update
  emitToRoom(`auction:${auctionId}`, 'bid:placed', {
    auctionId,
    bidId: bid.id,
    amount,
    bidderName: bid.bidder.businessName,
    newEndTime: updateData.endTime,
  });

  // Notify seller
  emitToBusiness(auction.sellerId, 'auction:new_bid', {
    auctionId,
    auctionNumber: auction.auctionNumber,
    amount,
  });

  logger.info('Bid placed', { auctionId, bidderId, amount });

  return bid;
};

/**
 * Buy now
 */
const buyNow = async (bidderId, auctionId) => {
  const auction = await prisma.auction.findUnique({
    where: { id: auctionId },
  });

  if (!auction) {
    throw new NotFoundError('Auction');
  }

  if (!auction.buyNowPrice) {
    throw new BadRequestError('Buy now not available for this auction');
  }

  if (auction.sellerId === bidderId) {
    throw new ForbiddenError('Cannot buy your own auction');
  }

  if (auction.status !== AUCTION_STATUS.ACTIVE) {
    throw new BadRequestError('Auction is not active');
  }

  // Create winning bid
  const bid = await prisma.bid.create({
    data: {
      auctionId,
      bidderId,
      amount: auction.buyNowPrice,
      isWinning: true,
    },
  });

  // End auction
  await prisma.auction.update({
    where: { id: auctionId },
    data: {
      status: AUCTION_STATUS.SOLD,
      currentPrice: auction.buyNowPrice,
      winningBidId: bid.id,
    },
  });

  await invalidateAuctionCache(auctionId);

  // Notify
  emitToRoom(`auction:${auctionId}`, 'auction:sold', {
    auctionId,
    buyNowPrice: auction.buyNowPrice,
  });

  emitToBusiness(auction.sellerId, 'auction:sold', {
    auctionId,
    auctionNumber: auction.auctionNumber,
    amount: auction.buyNowPrice,
  });

  logger.info('Auction bought now', { auctionId, bidderId, amount: auction.buyNowPrice });

  return { success: true, bid };
};

/**
 * Get bid history
 */
const getBidHistory = async (auctionId, options = {}) => {
  const { page = 1, limit = 50 } = options;
  const skip = (page - 1) * limit;

  const [bids, total] = await Promise.all([
    prisma.bid.findMany({
      where: { auctionId, isRetracted: false },
      include: {
        bidder: { select: { id: true, businessName: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.bid.count({ where: { auctionId, isRetracted: false } }),
  ]);

  return {
    bids: bids.map((bid) => ({
      ...bid,
      formattedAmount: formatCurrency(bid.amount),
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Cancel auction (seller only, before bids)
 */
const cancelAuction = async (sellerId, auctionId, reason) => {
  const auction = await prisma.auction.findFirst({
    where: { id: auctionId, sellerId },
  });

  if (!auction) {
    throw new NotFoundError('Auction');
  }

  if (auction.bidCount > 0) {
    throw new BadRequestError('Cannot cancel auction with bids');
  }

  if (![AUCTION_STATUS.DRAFT, AUCTION_STATUS.SCHEDULED].includes(auction.status)) {
    throw new BadRequestError('Cannot cancel active auction');
  }

  await prisma.auction.update({
    where: { id: auctionId },
    data: { status: AUCTION_STATUS.CANCELLED },
  });

  await invalidateAuctionCache(auctionId);

  logger.info('Auction cancelled', { auctionId, sellerId, reason });

  return { success: true };
};

/**
 * End expired auctions (scheduled job)
 */
const endExpiredAuctions = async () => {
  const now = new Date();
  let ended = 0;

  const expiredAuctions = await prisma.auction.findMany({
    where: {
      status: { in: [AUCTION_STATUS.ACTIVE, AUCTION_STATUS.EXTENDED] },
      endTime: { lte: now },
    },
    include: {
      bids: {
        where: { isWinning: true },
        take: 1,
      },
    },
  });

  for (const auction of expiredAuctions) {
    const winningBid = auction.bids[0];
    const reserveMet = !auction.reservePrice || 
      (winningBid && parseFloat(winningBid.amount) >= parseFloat(auction.reservePrice));

    let newStatus;
    if (!winningBid) {
      newStatus = AUCTION_STATUS.NO_BIDS;
    } else if (reserveMet) {
      newStatus = AUCTION_STATUS.SOLD;
    } else {
      newStatus = AUCTION_STATUS.ENDED;
    }

    await prisma.auction.update({
      where: { id: auction.id },
      data: {
        status: newStatus,
        winningBidId: winningBid?.id,
      },
    });

    await invalidateAuctionCache(auction.id);

    // Notify
    emitToRoom(`auction:${auction.id}`, 'auction:ended', {
      auctionId: auction.id,
      status: newStatus,
      winningBid: winningBid ? { amount: winningBid.amount } : null,
    });

    ended++;
  }

  logger.info('Expired auctions processed', { ended });

  return { ended };
};

/**
 * Get seller's auctions
 */
const getSellerAuctions = async (sellerId, options = {}) => {
  const { page = 1, limit = 20, status } = options;
  const skip = (page - 1) * limit;

  const where = { sellerId };
  if (status) where.status = status;

  const [auctions, total] = await Promise.all([
    prisma.auction.findMany({
      where,
      include: {
        product: { select: { id: true, name: true, images: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.auction.count({ where }),
  ]);

  return {
    auctions,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Watch/unwatch auction
 */
const toggleWatch = async (userId, auctionId) => {
  // For simplicity, using cache to track watchers
  const watchKey = `auction:watch:${auctionId}:${userId}`;
  const isWatching = await cache.get(watchKey);

  if (isWatching) {
    await cache.del(watchKey);
    await prisma.auction.update({
      where: { id: auctionId },
      data: { watcherCount: { decrement: 1 } },
    });
    return { watching: false };
  } else {
    await cache.set(watchKey, true, 30 * 24 * 60 * 60); // 30 days
    await prisma.auction.update({
      where: { id: auctionId },
      data: { watcherCount: { increment: 1 } },
    });
    return { watching: true };
  }
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  AUCTION_STATUS,
  createAuction,
  getAuctionById,
  getActiveAuctions,
  placeBid,
  buyNow,
  getBidHistory,
  cancelAuction,
  endExpiredAuctions,
  getSellerAuctions,
  toggleWatch,
};



