// =============================================================================
// AIRAVAT B2B MARKETPLACE - PRICE ALERT SERVICE
// Price drop notifications and stock alerts for buyers
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

const ALERT_TYPE = {
  PRICE_DROP: 'PRICE_DROP',
  PRICE_THRESHOLD: 'PRICE_THRESHOLD',
  BACK_IN_STOCK: 'BACK_IN_STOCK',
  PRICE_MATCH: 'PRICE_MATCH',
};

const ALERT_STATUS = {
  ACTIVE: 'ACTIVE',
  TRIGGERED: 'TRIGGERED',
  EXPIRED: 'EXPIRED',
  CANCELLED: 'CANCELLED',
};

const CACHE_TTL = { ALERTS: 300 };
const MAX_ALERTS_PER_USER = 100;
const DEFAULT_EXPIRY_DAYS = 90;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const getAlertsCacheKey = (userId) => `alerts:${userId}`;

const invalidateAlertsCache = async (userId) => {
  await cache.del(getAlertsCacheKey(userId));
};

// =============================================================================
// ALERT MANAGEMENT
// =============================================================================

/**
 * Create a new price alert
 */
const createAlert = async (userId, data) => {
  const { productId, targetPrice, alertType = ALERT_TYPE.PRICE_DROP, expiresIn = DEFAULT_EXPIRY_DAYS } = data;

  // Check product exists
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, price: true, stockQuantity: true },
  });

  if (!product) {
    throw new NotFoundError('Product');
  }

  // Check alert limit
  const alertCount = await prisma.priceAlert.count({
    where: { userId, status: ALERT_STATUS.ACTIVE },
  });

  if (alertCount >= MAX_ALERTS_PER_USER) {
    throw new BadRequestError(`Maximum alerts limit (${MAX_ALERTS_PER_USER}) reached`);
  }

  // Check for duplicate
  const existing = await prisma.priceAlert.findFirst({
    where: {
      userId,
      productId,
      status: ALERT_STATUS.ACTIVE,
      alertType,
    },
  });

  if (existing) {
    throw new ConflictError('Alert already exists for this product');
  }

  // Validate target price
  if (alertType === ALERT_TYPE.PRICE_THRESHOLD && targetPrice >= parseFloat(product.price)) {
    throw new BadRequestError('Target price must be lower than current price');
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiresIn);

  const alert = await prisma.priceAlert.create({
    data: {
      userId,
      productId,
      targetPrice: targetPrice || product.price,
      alertType,
      status: ALERT_STATUS.ACTIVE,
      currentPrice: product.price,
      expiresAt,
    },
    include: {
      product: {
        select: { id: true, name: true, slug: true, price: true, images: true },
      },
    },
  });

  await invalidateAlertsCache(userId);

  logger.info('Price alert created', { userId, productId, alertType, targetPrice });

  return alert;
};

/**
 * Get user's alerts
 */
const getAlerts = async (userId, options = {}) => {
  const { page = 1, limit = 20, status, alertType } = options;
  const skip = (page - 1) * limit;

  const where = { userId };
  if (status) where.status = status;
  if (alertType) where.alertType = alertType;

  const [alerts, total] = await Promise.all([
    prisma.priceAlert.findMany({
      where,
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
            seller: { select: { id: true, businessName: true } },
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.priceAlert.count({ where }),
  ]);

  // Enrich with price change info
  const enrichedAlerts = alerts.map((alert) => {
    const currentPrice = parseFloat(alert.product.price);
    const targetPrice = parseFloat(alert.targetPrice);
    const priceDropPercent = ((targetPrice - currentPrice) / targetPrice) * 100;
    const isTriggerable = currentPrice <= targetPrice;

    return {
      ...alert,
      priceDropPercent: Math.max(0, priceDropPercent).toFixed(1),
      isTriggerable,
      priceDifference: (targetPrice - currentPrice).toFixed(2),
    };
  });

  return {
    alerts: enrichedAlerts,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: page * limit < total,
    },
  };
};

/**
 * Update alert
 */
const updateAlert = async (userId, alertId, updates) => {
  const alert = await prisma.priceAlert.findFirst({
    where: { id: alertId, userId },
  });

  if (!alert) {
    throw new NotFoundError('Alert');
  }

  if (alert.status !== ALERT_STATUS.ACTIVE) {
    throw new BadRequestError('Cannot update non-active alert');
  }

  const { targetPrice, expiresIn } = updates;
  const updateData = {};

  if (targetPrice !== undefined) {
    updateData.targetPrice = targetPrice;
  }

  if (expiresIn !== undefined) {
    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + expiresIn);
    updateData.expiresAt = expiresAt;
  }

  const updated = await prisma.priceAlert.update({
    where: { id: alertId },
    data: updateData,
    include: {
      product: {
        select: { id: true, name: true, price: true, images: true },
      },
    },
  });

  await invalidateAlertsCache(userId);

  return updated;
};

/**
 * Cancel alert
 */
const cancelAlert = async (userId, alertId) => {
  const alert = await prisma.priceAlert.findFirst({
    where: { id: alertId, userId },
  });

  if (!alert) {
    throw new NotFoundError('Alert');
  }

  await prisma.priceAlert.update({
    where: { id: alertId },
    data: { status: ALERT_STATUS.CANCELLED },
  });

  await invalidateAlertsCache(userId);

  logger.info('Alert cancelled', { userId, alertId });

  return { success: true };
};

/**
 * Process price alerts (called by scheduler)
 */
const processAlerts = async () => {
  const batchSize = 100;
  let processed = 0;
  let triggered = 0;

  // Get active alerts
  const alerts = await prisma.priceAlert.findMany({
    where: {
      status: ALERT_STATUS.ACTIVE,
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    include: {
      product: { select: { id: true, price: true, stockQuantity: true } },
      user: { select: { id: true, email: true, firstName: true } },
    },
    take: batchSize,
  });

  for (const alert of alerts) {
    processed++;
    const currentPrice = parseFloat(alert.product.price);
    const targetPrice = parseFloat(alert.targetPrice);

    let shouldTrigger = false;

    switch (alert.alertType) {
      case ALERT_TYPE.PRICE_DROP:
        shouldTrigger = currentPrice < parseFloat(alert.currentPrice);
        break;
      case ALERT_TYPE.PRICE_THRESHOLD:
        shouldTrigger = currentPrice <= targetPrice;
        break;
      case ALERT_TYPE.BACK_IN_STOCK:
        shouldTrigger = alert.product.stockQuantity > 0;
        break;
      default:
        break;
    }

    if (shouldTrigger) {
      await triggerAlert(alert, currentPrice);
      triggered++;
    }
  }

  // Expire old alerts
  await prisma.priceAlert.updateMany({
    where: {
      status: ALERT_STATUS.ACTIVE,
      expiresAt: { lt: new Date() },
    },
    data: { status: ALERT_STATUS.EXPIRED },
  });

  logger.info('Price alerts processed', { processed, triggered });

  return { processed, triggered };
};

/**
 * Trigger an alert
 */
const triggerAlert = async (alert, currentPrice) => {
  await prisma.priceAlert.update({
    where: { id: alert.id },
    data: {
      status: ALERT_STATUS.TRIGGERED,
      triggeredAt: new Date(),
      notifiedAt: new Date(),
    },
  });

  // Emit real-time notification
  emitToUser(alert.userId, 'alert:triggered', {
    alertId: alert.id,
    productId: alert.productId,
    alertType: alert.alertType,
    previousPrice: alert.currentPrice,
    currentPrice,
  });

  // Queue email notification
  // await emailService.sendPriceAlert(alert.user.email, { ... });

  await invalidateAlertsCache(alert.userId);

  logger.info('Alert triggered', { alertId: alert.id, userId: alert.userId });
};

/**
 * Get alert statistics
 */
const getAlertStats = async (userId) => {
  const [active, triggered, expired] = await Promise.all([
    prisma.priceAlert.count({ where: { userId, status: ALERT_STATUS.ACTIVE } }),
    prisma.priceAlert.count({ where: { userId, status: ALERT_STATUS.TRIGGERED } }),
    prisma.priceAlert.count({ where: { userId, status: ALERT_STATUS.EXPIRED } }),
  ]);

  return { active, triggered, expired, total: active + triggered + expired };
};

/**
 * Create back-in-stock alert
 */
const createBackInStockAlert = async (userId, productId) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, stockQuantity: true },
  });

  if (!product) {
    throw new NotFoundError('Product');
  }

  if (product.stockQuantity > 0) {
    throw new BadRequestError('Product is already in stock');
  }

  return createAlert(userId, {
    productId,
    alertType: ALERT_TYPE.BACK_IN_STOCK,
  });
};

/**
 * Bulk create alerts from wishlist
 */
const createAlertsFromWishlist = async (userId) => {
  const wishlistItems = await prisma.wishlist.findMany({
    where: { userId, notifyOnPriceDrop: true },
    include: { product: { select: { id: true, price: true } } },
  });

  let created = 0;
  for (const item of wishlistItems) {
    try {
      await createAlert(userId, {
        productId: item.productId,
        alertType: ALERT_TYPE.PRICE_DROP,
      });
      created++;
    } catch (err) {
      // Skip duplicates
      if (!(err instanceof ConflictError)) {
        logger.warn('Failed to create alert from wishlist', { productId: item.productId, error: err.message });
      }
    }
  }

  return { created, total: wishlistItems.length };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ALERT_TYPE,
  ALERT_STATUS,
  createAlert,
  getAlerts,
  updateAlert,
  cancelAlert,
  processAlerts,
  getAlertStats,
  createBackInStockAlert,
  createAlertsFromWishlist,
};



