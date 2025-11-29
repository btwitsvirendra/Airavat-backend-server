// =============================================================================
// AIRAVAT B2B MARKETPLACE - COUPON SERVICE
// Discount Codes with Validation & Usage Tracking
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const { NotFoundError, BadRequestError, ConflictError } = require('../utils/errors');
const { formatCurrency } = require('../utils/helpers');
const { emitToBusiness } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const COUPON_STATUS = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', EXPIRED: 'EXPIRED', DEPLETED: 'DEPLETED' };
const DISCOUNT_TYPE = { PERCENTAGE: 'PERCENTAGE', FIXED: 'FIXED', FREE_SHIPPING: 'FREE_SHIPPING' };
const CACHE_TTL = { COUPON: 300 };

// =============================================================================
// COUPON MANAGEMENT
// =============================================================================

const createCoupon = async (businessId, couponData) => {
  const code = couponData.code.toUpperCase().replace(/\s/g, '');

  const existing = await prisma.coupon.findFirst({ where: { code, businessId: businessId || null } });
  if (existing) throw new ConflictError('Coupon code already exists');

  const startDate = new Date(couponData.startDate || Date.now());
  const endDate = couponData.endDate ? new Date(couponData.endDate) : null;
  if (endDate && startDate >= endDate) throw new BadRequestError('End date must be after start date');
  if (couponData.discountType === DISCOUNT_TYPE.PERCENTAGE && couponData.discountValue > 100) {
    throw new BadRequestError('Percentage discount cannot exceed 100%');
  }

  const coupon = await prisma.coupon.create({
    data: {
      code, businessId: businessId || null, name: couponData.name || code, description: couponData.description,
      discountType: couponData.discountType, discountValue: parseFloat(couponData.discountValue),
      maxDiscountAmount: couponData.maxDiscountAmount ? parseFloat(couponData.maxDiscountAmount) : null,
      minOrderAmount: couponData.minOrderAmount ? parseFloat(couponData.minOrderAmount) : 0,
      startDate, endDate, maxUsageLimit: couponData.maxUsageLimit || null, maxUsagePerUser: couponData.maxUsagePerUser || 1,
      currentUsage: 0, status: COUPON_STATUS.ACTIVE, applicableCategories: couponData.applicableCategories || [],
      applicableProducts: couponData.applicableProducts || [], excludedProducts: couponData.excludedProducts || [],
      forNewCustomers: couponData.forNewCustomers || false, forSpecificUsers: couponData.forSpecificUsers || [],
      termsConditions: couponData.termsConditions, isPublic: couponData.isPublic !== false,
    },
  });

  logger.info('Coupon created', { couponId: coupon.id, code, businessId, discountType: couponData.discountType });
  return coupon;
};

const deleteCoupon = async (couponId, businessId) => {
  const coupon = await prisma.coupon.findFirst({ where: { id: couponId, businessId } });
  if (!coupon) throw new NotFoundError('Coupon');

  if (coupon.currentUsage > 0) {
    await prisma.coupon.update({ where: { id: couponId }, data: { status: COUPON_STATUS.INACTIVE, deletedAt: new Date() } });
  } else {
    await prisma.coupon.delete({ where: { id: couponId } });
  }

  await cache.del(`coupon:${coupon.code}`);
  return { success: true };
};

// =============================================================================
// COUPON VALIDATION
// =============================================================================

const validateCoupon = async (code, userId, businessId, orderDetails) => {
  const normalizedCode = code.toUpperCase().trim();

  let coupon = await cache.get(`coupon:${normalizedCode}`);
  if (!coupon) {
    coupon = await prisma.coupon.findFirst({ where: { code: normalizedCode, status: COUPON_STATUS.ACTIVE } });
    if (coupon) await cache.set(`coupon:${normalizedCode}`, coupon, CACHE_TTL.COUPON);
  }

  if (!coupon) return { valid: false, error: 'Invalid coupon code' };

  const now = new Date();
  if (new Date(coupon.startDate) > now) return { valid: false, error: 'Coupon is not yet active' };
  if (coupon.endDate && new Date(coupon.endDate) < now) return { valid: false, error: 'Coupon has expired' };
  if (coupon.maxUsageLimit && coupon.currentUsage >= coupon.maxUsageLimit) return { valid: false, error: 'Coupon usage limit reached' };

  const userUsage = await prisma.couponUsage.count({ where: { couponId: coupon.id, userId } });
  if (userUsage >= coupon.maxUsagePerUser) return { valid: false, error: 'You have already used this coupon' };

  if (orderDetails.subtotal < coupon.minOrderAmount) {
    return { valid: false, error: `Minimum order amount is ${formatCurrency(coupon.minOrderAmount)}` };
  }

  if (coupon.forNewCustomers) {
    const previousOrders = await prisma.order.count({ where: { buyerId: businessId, status: { in: ['COMPLETED', 'DELIVERED'] } } });
    if (previousOrders > 0) return { valid: false, error: 'Coupon is for new customers only' };
  }

  if (coupon.forSpecificUsers?.length > 0 && !coupon.forSpecificUsers.includes(userId)) {
    return { valid: false, error: 'Coupon is not applicable for your account' };
  }

  if (coupon.businessId && orderDetails.sellerId !== coupon.businessId) {
    return { valid: false, error: 'Coupon is not applicable for this seller' };
  }

  const discount = calculateDiscount(coupon, orderDetails);

  return {
    valid: true,
    coupon: { id: coupon.id, code: coupon.code, name: coupon.name, discountType: coupon.discountType, discountValue: coupon.discountValue },
    discount, formattedDiscount: formatCurrency(discount),
    message: `${coupon.name} applied! You save ${formatCurrency(discount)}`,
  };
};

const calculateDiscount = (coupon, orderDetails) => {
  let discount = 0;
  let applicableAmount = orderDetails.subtotal;

  if (coupon.applicableProducts?.length > 0 && orderDetails.items) {
    applicableAmount = orderDetails.items.filter((item) => coupon.applicableProducts.includes(item.productId)).reduce((sum, item) => sum + parseFloat(item.totalPrice), 0);
  }

  if (coupon.excludedProducts?.length > 0 && orderDetails.items) {
    applicableAmount = orderDetails.items.filter((item) => !coupon.excludedProducts.includes(item.productId)).reduce((sum, item) => sum + parseFloat(item.totalPrice), 0);
  }

  switch (coupon.discountType) {
    case DISCOUNT_TYPE.PERCENTAGE: discount = (applicableAmount * coupon.discountValue) / 100; break;
    case DISCOUNT_TYPE.FIXED: discount = coupon.discountValue; break;
    case DISCOUNT_TYPE.FREE_SHIPPING: discount = orderDetails.shippingCost || 0; break;
  }

  if (coupon.maxDiscountAmount && discount > coupon.maxDiscountAmount) discount = coupon.maxDiscountAmount;
  discount = Math.min(discount, applicableAmount);

  return Math.round(discount * 100) / 100;
};

const applyCoupon = async (couponId, orderId, userId, discountAmount) => {
  const coupon = await prisma.coupon.findUnique({ where: { id: couponId } });
  if (!coupon) throw new NotFoundError('Coupon');

  await prisma.$transaction([
    prisma.couponUsage.create({ data: { couponId, userId, orderId, discountAmount } }),
    prisma.coupon.update({ where: { id: couponId }, data: { currentUsage: { increment: 1 } } }),
  ]);

  const updatedCoupon = await prisma.coupon.findUnique({ where: { id: couponId } });
  if (updatedCoupon.maxUsageLimit && updatedCoupon.currentUsage >= updatedCoupon.maxUsageLimit) {
    await prisma.coupon.update({ where: { id: couponId }, data: { status: COUPON_STATUS.DEPLETED } });
    if (coupon.businessId) emitToBusiness(coupon.businessId, 'coupon:depleted', { couponId, code: coupon.code });
  }

  await cache.del(`coupon:${coupon.code}`);
  logger.info('Coupon applied', { couponId, orderId, discountAmount });

  return { success: true };
};

const reverseCouponUsage = async (orderId) => {
  const usage = await prisma.couponUsage.findFirst({ where: { orderId }, include: { coupon: true } });
  if (!usage) return { success: true, reversed: false };

  await prisma.$transaction([
    prisma.couponUsage.delete({ where: { id: usage.id } }),
    prisma.coupon.update({ where: { id: usage.couponId }, data: { currentUsage: { decrement: 1 } } }),
  ]);

  if (usage.coupon.status === COUPON_STATUS.DEPLETED) {
    await prisma.coupon.update({ where: { id: usage.couponId }, data: { status: COUPON_STATUS.ACTIVE } });
  }

  await cache.del(`coupon:${usage.coupon.code}`);
  logger.info('Coupon usage reversed', { orderId, couponId: usage.couponId });

  return { success: true, reversed: true };
};

// =============================================================================
// COUPON DISCOVERY
// =============================================================================

const getPublicCoupons = async (options = {}) => {
  const { page = 1, limit = 20, sellerId } = options;
  const skip = (page - 1) * limit;
  const now = new Date();

  const where = { status: COUPON_STATUS.ACTIVE, isPublic: true, startDate: { lte: now }, OR: [{ endDate: null }, { endDate: { gt: now } }] };
  if (sellerId) where.businessId = sellerId;

  const [coupons, total] = await Promise.all([
    prisma.coupon.findMany({ where, skip, take: limit, orderBy: { discountValue: 'desc' }, select: { id: true, code: true, name: true, description: true, discountType: true, discountValue: true, maxDiscountAmount: true, minOrderAmount: true, endDate: true } }),
    prisma.coupon.count({ where }),
  ]);

  return {
    coupons: coupons.map((c) => ({ ...c, formattedMinOrder: formatCurrency(c.minOrderAmount), formattedMaxDiscount: c.maxDiscountAmount ? formatCurrency(c.maxDiscountAmount) : null, expiresIn: c.endDate ? Math.ceil((new Date(c.endDate) - now) / (1000 * 60 * 60 * 24)) : null })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

const getSellerCoupons = async (businessId, options = {}) => {
  const { page = 1, limit = 20, status } = options;
  const skip = (page - 1) * limit;
  const where = { businessId };
  if (status) where.status = status;

  const [coupons, total] = await Promise.all([
    prisma.coupon.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.coupon.count({ where }),
  ]);

  return { coupons: coupons.map((c) => ({ ...c, usagePercentage: c.maxUsageLimit > 0 ? ((c.currentUsage / c.maxUsageLimit) * 100).toFixed(1) : null })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

const getCouponAnalytics = async (couponId, businessId) => {
  const coupon = await prisma.coupon.findFirst({ where: { id: couponId, businessId } });
  if (!coupon) throw new NotFoundError('Coupon');

  const usage = await prisma.couponUsage.findMany({ where: { couponId }, include: { order: { select: { totalAmount: true } } } });
  const totalDiscount = usage.reduce((sum, u) => sum + parseFloat(u.discountAmount), 0);
  const totalOrderValue = usage.reduce((sum, u) => sum + parseFloat(u.order?.totalAmount || 0), 0);
  const uniqueUsers = new Set(usage.map((u) => u.userId)).size;

  return {
    coupon,
    analytics: {
      totalUsage: coupon.currentUsage, uniqueUsers, totalDiscountGiven: totalDiscount, formattedTotalDiscount: formatCurrency(totalDiscount),
      totalOrderValue, formattedTotalOrderValue: formatCurrency(totalOrderValue),
      avgOrderValue: usage.length > 0 ? totalOrderValue / usage.length : 0, avgDiscount: usage.length > 0 ? totalDiscount / usage.length : 0,
      roi: totalDiscount > 0 ? (((totalOrderValue - totalDiscount) / totalDiscount) * 100).toFixed(1) : 0,
      remainingUsage: coupon.maxUsageLimit ? coupon.maxUsageLimit - coupon.currentUsage : 'Unlimited',
    },
  };
};

// =============================================================================
// CRON JOBS
// =============================================================================

const expireOldCoupons = async () => {
  const now = new Date();
  const result = await prisma.coupon.updateMany({ where: { status: COUPON_STATUS.ACTIVE, endDate: { lte: now } }, data: { status: COUPON_STATUS.EXPIRED } });
  if (result.count > 0) logger.info(`Expired ${result.count} coupons`);
  return { expired: result.count };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  COUPON_STATUS, DISCOUNT_TYPE, createCoupon, deleteCoupon, validateCoupon, calculateDiscount,
  applyCoupon, reverseCouponUsage, getPublicCoupons, getSellerCoupons, getCouponAnalytics, expireOldCoupons,
};
