// =============================================================================
// AIRAVAT B2B MARKETPLACE - WISHLIST SERVICE
// Save products for later with notifications and priority management
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
  ConflictError,
} = require('../utils/errors');
const { emitToUser } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const CACHE_TTL = { WISHLIST: 300, COUNT: 600 };
const MAX_WISHLIST_ITEMS = 500;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const getWishlistCacheKey = (userId) => `wishlist:${userId}`;
const getWishlistCountKey = (userId) => `wishlist:count:${userId}`;

const invalidateWishlistCache = async (userId) => {
  await Promise.all([
    cache.del(getWishlistCacheKey(userId)),
    cache.del(getWishlistCountKey(userId)),
  ]);
};

// =============================================================================
// WISHLIST MANAGEMENT
// =============================================================================

/**
 * Add product to wishlist
 */
const addToWishlist = async (userId, businessId, data) => {
  const { productId, notes, priority = 0, notifyOnPriceDrop = false } = data;

  // Check if product exists
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, sellerId: true, price: true },
  });

  if (!product) {
    throw new NotFoundError('Product');
  }

  // Check wishlist count
  const count = await prisma.wishlist.count({ where: { userId } });
  if (count >= MAX_WISHLIST_ITEMS) {
    throw new BadRequestError(`Maximum wishlist limit (${MAX_WISHLIST_ITEMS}) reached`);
  }

  // Check if already in wishlist
  const existing = await prisma.wishlist.findUnique({
    where: { userId_productId: { userId, productId } },
  });

  if (existing) {
    throw new ConflictError('Product already in wishlist');
  }

  const wishlistItem = await prisma.wishlist.create({
    data: {
      userId,
      businessId,
      productId,
      notes,
      priority,
      notifyOnPriceDrop,
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          slug: true,
          price: true,
          images: true,
          seller: { select: { id: true, businessName: true } },
        },
      },
    },
  });

  await invalidateWishlistCache(userId);

  // Create price alert if enabled
  if (notifyOnPriceDrop && product.price) {
    await prisma.priceAlert.create({
      data: {
        userId,
        productId,
        targetPrice: product.price,
        alertType: 'PRICE_DROP',
        status: 'ACTIVE',
        currentPrice: product.price,
      },
    }).catch((err) => logger.warn('Failed to create price alert', { err: err.message }));
  }

  logger.info('Product added to wishlist', { userId, productId });

  return wishlistItem;
};

/**
 * Remove product from wishlist
 */
const removeFromWishlist = async (userId, productId) => {
  const item = await prisma.wishlist.findUnique({
    where: { userId_productId: { userId, productId } },
  });

  if (!item) {
    throw new NotFoundError('Wishlist item');
  }

  await prisma.wishlist.delete({
    where: { userId_productId: { userId, productId } },
  });

  await invalidateWishlistCache(userId);

  logger.info('Product removed from wishlist', { userId, productId });

  return { success: true };
};

/**
 * Get user's wishlist
 */
const getWishlist = async (userId, options = {}) => {
  const { page = 1, limit = 20, sortBy = 'createdAt', sortOrder = 'desc' } = options;
  const skip = (page - 1) * limit;

  const cacheKey = getWishlistCacheKey(userId);
  
  // Try cache for first page
  if (page === 1 && !options.skipCache) {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  }

  const [items, total] = await Promise.all([
    prisma.wishlist.findMany({
      where: { userId },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            slug: true,
            price: true,
            compareAtPrice: true,
            images: true,
            stockQuantity: true,
            status: true,
            seller: { select: { id: true, businessName: true, logo: true } },
          },
        },
      },
      orderBy: { [sortBy]: sortOrder },
      skip,
      take: limit,
    }),
    prisma.wishlist.count({ where: { userId } }),
  ]);

  // Calculate price changes
  const itemsWithChanges = items.map((item) => {
    const hasDiscount = item.product.compareAtPrice &&
      parseFloat(item.product.price) < parseFloat(item.product.compareAtPrice);
    const discountPercent = hasDiscount
      ? Math.round((1 - parseFloat(item.product.price) / parseFloat(item.product.compareAtPrice)) * 100)
      : 0;

    return {
      ...item,
      hasDiscount,
      discountPercent,
      isOutOfStock: item.product.stockQuantity <= 0,
    };
  });

  const result = {
    items: itemsWithChanges,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  };

  if (page === 1) {
    await cache.set(cacheKey, result, CACHE_TTL.WISHLIST);
  }

  return result;
};

/**
 * Update wishlist item
 */
const updateWishlistItem = async (userId, productId, updates) => {
  const item = await prisma.wishlist.findUnique({
    where: { userId_productId: { userId, productId } },
  });

  if (!item) {
    throw new NotFoundError('Wishlist item');
  }

  const { notes, priority, notifyOnPriceDrop } = updates;

  const updated = await prisma.wishlist.update({
    where: { userId_productId: { userId, productId } },
    data: {
      ...(notes !== undefined && { notes }),
      ...(priority !== undefined && { priority }),
      ...(notifyOnPriceDrop !== undefined && { notifyOnPriceDrop }),
    },
    include: {
      product: {
        select: { id: true, name: true, price: true, images: true },
      },
    },
  });

  await invalidateWishlistCache(userId);

  return updated;
};

/**
 * Get wishlist count
 */
const getWishlistCount = async (userId) => {
  const cacheKey = getWishlistCountKey(userId);
  const cached = await cache.get(cacheKey);
  if (cached !== null) return cached;

  const count = await prisma.wishlist.count({ where: { userId } });
  await cache.set(cacheKey, count, CACHE_TTL.COUNT);

  return count;
};

/**
 * Check if product is in wishlist
 */
const isInWishlist = async (userId, productId) => {
  const item = await prisma.wishlist.findUnique({
    where: { userId_productId: { userId, productId } },
    select: { id: true },
  });

  return !!item;
};

/**
 * Move wishlist item to cart
 */
const moveToCart = async (userId, productId, quantity = 1) => {
  const item = await prisma.wishlist.findUnique({
    where: { userId_productId: { userId, productId } },
    include: { product: { select: { id: true, stockQuantity: true, minOrderQuantity: true } } },
  });

  if (!item) {
    throw new NotFoundError('Wishlist item');
  }

  if (item.product.stockQuantity < quantity) {
    throw new BadRequestError('Insufficient stock');
  }

  const minQty = item.product.minOrderQuantity || 1;
  if (quantity < minQty) {
    throw new BadRequestError(`Minimum order quantity is ${minQty}`);
  }

  // Add to cart (assuming cart service exists)
  // await cartService.addItem(userId, productId, quantity);

  // Remove from wishlist
  await prisma.wishlist.delete({
    where: { userId_productId: { userId, productId } },
  });

  await invalidateWishlistCache(userId);

  logger.info('Wishlist item moved to cart', { userId, productId, quantity });

  return { success: true, message: 'Item moved to cart' };
};

/**
 * Clear entire wishlist
 */
const clearWishlist = async (userId) => {
  await prisma.wishlist.deleteMany({ where: { userId } });
  await invalidateWishlistCache(userId);

  logger.info('Wishlist cleared', { userId });

  return { success: true };
};

/**
 * Get wishlist items with price drops
 */
const getItemsWithPriceDrops = async (userId) => {
  const items = await prisma.wishlist.findMany({
    where: {
      userId,
      notifyOnPriceDrop: true,
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          price: true,
          compareAtPrice: true,
          images: true,
        },
      },
    },
  });

  return items.filter((item) => {
    return item.product.compareAtPrice &&
      parseFloat(item.product.price) < parseFloat(item.product.compareAtPrice);
  });
};

/**
 * Share wishlist
 */
const shareWishlist = async (userId, options = {}) => {
  const { expiresIn = 7 } = options; // days

  const shareToken = require('crypto').randomBytes(16).toString('hex');
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresIn);

  // Store share token in cache
  await cache.set(`wishlist:share:${shareToken}`, { userId }, expiresIn * 24 * 60 * 60);

  const shareUrl = `${process.env.FRONTEND_URL}/wishlist/shared/${shareToken}`;

  return { shareUrl, expiresAt };
};

/**
 * Get shared wishlist
 */
const getSharedWishlist = async (shareToken) => {
  const shareData = await cache.get(`wishlist:share:${shareToken}`);
  if (!shareData) {
    throw new NotFoundError('Shared wishlist');
  }

  return getWishlist(shareData.userId, { skipCache: true });
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  addToWishlist,
  removeFromWishlist,
  getWishlist,
  updateWishlistItem,
  getWishlistCount,
  isInWishlist,
  moveToCart,
  clearWishlist,
  getItemsWithPriceDrops,
  shareWishlist,
  getSharedWishlist,
};



