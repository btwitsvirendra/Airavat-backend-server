// =============================================================================
// AIRAVAT B2B MARKETPLACE - FLASH DEAL SERVICE
// Time-Limited Offers with Countdown & Real-time Updates
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const { NotFoundError, BadRequestError, ForbiddenError } = require('../utils/errors');
const { formatCurrency } = require('../utils/helpers');
const { emitToAll, emitToBusiness } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const DEAL_STATUS = { SCHEDULED: 'SCHEDULED', ACTIVE: 'ACTIVE', ENDED: 'ENDED', CANCELLED: 'CANCELLED', SOLD_OUT: 'SOLD_OUT' };
const CACHE_TTL = { ACTIVE_DEALS: 60, DEAL: 30 };

// =============================================================================
// DEAL MANAGEMENT
// =============================================================================

const createDeal = async (businessId, dealData) => {
  const startTime = new Date(dealData.startTime);
  const endTime = new Date(dealData.endTime);
  const now = new Date();

  if (startTime >= endTime) throw new BadRequestError('End time must be after start time');
  if (startTime < now) throw new BadRequestError('Start time cannot be in the past');

  const product = await prisma.product.findFirst({ where: { id: dealData.productId, businessId, status: 'ACTIVE' } });
  if (!product) throw new NotFoundError('Product');

  const originalPrice = parseFloat(product.minPrice);
  const dealPrice = parseFloat(dealData.dealPrice);
  if (dealPrice >= originalPrice) throw new BadRequestError('Deal price must be less than original price');

  const discountPercent = ((originalPrice - dealPrice) / originalPrice) * 100;

  const deal = await prisma.flashDeal.create({
    data: {
      businessId, productId: dealData.productId, title: dealData.title || `Flash Sale: ${product.name}`,
      description: dealData.description, originalPrice, dealPrice, discountPercent: parseFloat(discountPercent.toFixed(1)),
      startTime, endTime, maxQuantity: dealData.maxQuantity || null, soldQuantity: 0,
      maxPerCustomer: dealData.maxPerCustomer || 1, minOrderQuantity: dealData.minOrderQuantity || 1,
      status: DEAL_STATUS.SCHEDULED, featured: dealData.featured || false, bannerImage: dealData.bannerImage,
    },
  });

  logger.info('Flash deal created', { dealId: deal.id, productId: product.id, discountPercent: discountPercent.toFixed(1) });
  await cache.del('deals:active');

  return { ...deal, formattedOriginalPrice: formatCurrency(originalPrice), formattedDealPrice: formatCurrency(dealPrice) };
};

const cancelDeal = async (dealId, businessId, reason) => {
  const deal = await prisma.flashDeal.findFirst({ where: { id: dealId, businessId } });
  if (!deal) throw new NotFoundError('Deal');
  if ([DEAL_STATUS.ENDED, DEAL_STATUS.CANCELLED].includes(deal.status)) throw new BadRequestError('Deal already ended or cancelled');

  await prisma.flashDeal.update({ where: { id: dealId }, data: { status: DEAL_STATUS.CANCELLED, cancelledAt: new Date(), cancelReason: reason } });
  logger.info('Flash deal cancelled', { dealId, reason });

  await cache.del('deals:active');
  emitToAll('flashdeal:cancelled', { dealId, title: deal.title });

  return { success: true };
};

// =============================================================================
// DEAL DISCOVERY
// =============================================================================

const getActiveDeals = async (options = {}) => {
  const { page = 1, limit = 20, featured } = options;
  const skip = (page - 1) * limit;
  const now = new Date();

  const cacheKey = `deals:active:${page}:${limit}:${featured || 'all'}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const where = { status: DEAL_STATUS.ACTIVE, startTime: { lte: now }, endTime: { gt: now } };
  if (featured) where.featured = true;

  const [deals, total] = await Promise.all([
    prisma.flashDeal.findMany({
      where, include: { product: { include: { images: { take: 1 }, business: { select: { businessName: true, trustScore: true } } } } },
      skip, take: limit, orderBy: [{ featured: 'desc' }, { endTime: 'asc' }],
    }),
    prisma.flashDeal.count({ where }),
  ]);

  const dealsWithCountdown = deals.map((deal) => {
    const remainingMs = new Date(deal.endTime).getTime() - now.getTime();
    return {
      ...deal, formattedOriginalPrice: formatCurrency(deal.originalPrice), formattedDealPrice: formatCurrency(deal.dealPrice),
      countdown: { endsAt: deal.endTime, remainingMs, remainingHours: Math.floor(remainingMs / (1000 * 60 * 60)) },
      stockStatus: deal.maxQuantity ? { total: deal.maxQuantity, sold: deal.soldQuantity, remaining: deal.maxQuantity - deal.soldQuantity, percentSold: Math.round((deal.soldQuantity / deal.maxQuantity) * 100) } : null,
    };
  });

  const result = { deals: dealsWithCountdown, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
  await cache.set(cacheKey, result, CACHE_TTL.ACTIVE_DEALS);
  return result;
};

const getUpcomingDeals = async (options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;
  const now = new Date();

  const where = { status: DEAL_STATUS.SCHEDULED, startTime: { gt: now } };

  const [deals, total] = await Promise.all([
    prisma.flashDeal.findMany({
      where, include: { product: { include: { images: { take: 1 }, business: { select: { businessName: true } } } } },
      skip, take: limit, orderBy: { startTime: 'asc' },
    }),
    prisma.flashDeal.count({ where }),
  ]);

  return {
    deals: deals.map((deal) => ({
      ...deal, formattedOriginalPrice: formatCurrency(deal.originalPrice), formattedDealPrice: formatCurrency(deal.dealPrice),
      startsIn: { startsAt: deal.startTime, remainingMs: new Date(deal.startTime).getTime() - now.getTime(), remainingHours: Math.floor((new Date(deal.startTime).getTime() - now.getTime()) / (1000 * 60 * 60)) },
    })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

const getDeal = async (dealId) => {
  const cacheKey = `deal:${dealId}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const deal = await prisma.flashDeal.findUnique({
    where: { id: dealId },
    include: { product: { include: { images: true, business: { select: { businessName: true, logo: true, trustScore: true } }, variants: true } } },
  });
  if (!deal) throw new NotFoundError('Deal');

  const now = new Date();
  const isActive = deal.status === DEAL_STATUS.ACTIVE && now >= new Date(deal.startTime) && now < new Date(deal.endTime);

  const result = {
    ...deal, formattedOriginalPrice: formatCurrency(deal.originalPrice), formattedDealPrice: formatCurrency(deal.dealPrice), isActive,
    countdown: { endsAt: deal.endTime, remainingMs: Math.max(0, new Date(deal.endTime).getTime() - now.getTime()) },
    stockStatus: deal.maxQuantity ? { total: deal.maxQuantity, sold: deal.soldQuantity, remaining: deal.maxQuantity - deal.soldQuantity, soldOut: deal.soldQuantity >= deal.maxQuantity } : null,
  };

  await cache.set(cacheKey, result, CACHE_TTL.DEAL);
  return result;
};

// =============================================================================
// DEAL PURCHASE
// =============================================================================

const reserveStock = async (dealId, userId, quantity) => {
  const deal = await prisma.flashDeal.findUnique({ where: { id: dealId } });
  if (!deal) throw new NotFoundError('Deal');

  const now = new Date();
  if (now < new Date(deal.startTime) || now >= new Date(deal.endTime)) throw new BadRequestError('Deal is not active');
  if (deal.status !== DEAL_STATUS.ACTIVE) throw new BadRequestError('Deal is not available');

  if (deal.maxQuantity && deal.soldQuantity + quantity > deal.maxQuantity) {
    throw new BadRequestError(`Not enough stock. Only ${deal.maxQuantity - deal.soldQuantity} available`);
  }
  if (quantity > deal.maxPerCustomer) throw new BadRequestError(`Maximum ${deal.maxPerCustomer} units per customer`);
  if (quantity < deal.minOrderQuantity) throw new BadRequestError(`Minimum order quantity is ${deal.minOrderQuantity}`);

  await prisma.flashDeal.update({ where: { id: dealId }, data: { soldQuantity: { increment: quantity } } });

  const updatedDeal = await prisma.flashDeal.findUnique({ where: { id: dealId } });
  if (updatedDeal.maxQuantity && updatedDeal.soldQuantity >= updatedDeal.maxQuantity) {
    await prisma.flashDeal.update({ where: { id: dealId }, data: { status: DEAL_STATUS.SOLD_OUT } });
    emitToAll('flashdeal:soldout', { dealId, title: deal.title });
  }

  await cache.del(`deal:${dealId}`);
  await cache.del('deals:active');

  logger.info('Deal stock reserved', { dealId, userId, quantity });
  return { reserved: true, dealPrice: deal.dealPrice, quantity, expiresIn: 10 * 60 * 1000 };
};

const releaseStock = async (dealId, quantity) => {
  await prisma.flashDeal.update({ where: { id: dealId }, data: { soldQuantity: { decrement: quantity } } });
  await cache.del(`deal:${dealId}`);
  return { released: true };
};

// =============================================================================
// SELLER ANALYTICS
// =============================================================================

const getDealAnalytics = async (dealId, businessId) => {
  const deal = await prisma.flashDeal.findFirst({ where: { id: dealId, businessId }, include: { product: { select: { name: true } } } });
  if (!deal) throw new NotFoundError('Deal');

  const revenue = deal.soldQuantity * parseFloat(deal.dealPrice);
  const originalRevenue = deal.soldQuantity * parseFloat(deal.originalPrice);
  const discountGiven = originalRevenue - revenue;
  const conversionRate = deal.maxQuantity ? ((deal.soldQuantity / deal.maxQuantity) * 100).toFixed(1) : 'N/A';

  return {
    deal,
    analytics: {
      totalRevenue: revenue, formattedRevenue: formatCurrency(revenue), originalRevenue, discountGiven,
      formattedDiscountGiven: formatCurrency(discountGiven), unitsSold: deal.soldQuantity, conversionRate,
      averageOrderValue: deal.soldQuantity > 0 ? revenue / deal.soldQuantity : 0, status: deal.status,
      durationHours: (new Date(deal.endTime) - new Date(deal.startTime)) / (1000 * 60 * 60),
    },
  };
};

const getSellerDeals = async (businessId, options = {}) => {
  const { page = 1, limit = 20, status } = options;
  const skip = (page - 1) * limit;
  const where = { businessId };
  if (status) where.status = status;

  const [deals, total] = await Promise.all([
    prisma.flashDeal.findMany({ where, include: { product: { include: { images: { take: 1 } } } }, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.flashDeal.count({ where }),
  ]);

  return { deals: deals.map((d) => ({ ...d, formattedOriginalPrice: formatCurrency(d.originalPrice), formattedDealPrice: formatCurrency(d.dealPrice) })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

// =============================================================================
// CRON JOBS
// =============================================================================

const activateScheduledDeals = async () => {
  const now = new Date();
  const result = await prisma.flashDeal.updateMany({ where: { status: DEAL_STATUS.SCHEDULED, startTime: { lte: now } }, data: { status: DEAL_STATUS.ACTIVE } });
  if (result.count > 0) { logger.info(`Activated ${result.count} flash deals`); await cache.del('deals:active'); emitToAll('flashdeal:new_active', { count: result.count }); }
  return { activated: result.count };
};

const endExpiredDeals = async () => {
  const now = new Date();
  const result = await prisma.flashDeal.updateMany({ where: { status: DEAL_STATUS.ACTIVE, endTime: { lte: now } }, data: { status: DEAL_STATUS.ENDED } });
  if (result.count > 0) { logger.info(`Ended ${result.count} flash deals`); await cache.del('deals:active'); }
  return { ended: result.count };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  DEAL_STATUS, createDeal, cancelDeal, getActiveDeals, getUpcomingDeals, getDeal,
  reserveStock, releaseStock, getDealAnalytics, getSellerDeals, activateScheduledDeals, endExpiredDeals,
};
