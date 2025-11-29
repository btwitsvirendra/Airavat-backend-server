// =============================================================================
// AIRAVAT B2B MARKETPLACE - BLANKET ORDER SERVICE
// Service for standing orders with scheduled delivery
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  maxDurationMonths: 24,
  minQuantity: 1,
  maxReleases: 52, // Weekly for a year
};

/**
 * Blanket order statuses
 */
const BLANKET_ORDER_STATUS = {
  DRAFT: 'Draft',
  PENDING_APPROVAL: 'Pending Approval',
  ACTIVE: 'Active',
  PARTIALLY_RELEASED: 'Partially Released',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

/**
 * Release frequencies
 */
const RELEASE_FREQUENCIES = {
  WEEKLY: { days: 7, label: 'Weekly' },
  BIWEEKLY: { days: 14, label: 'Bi-Weekly' },
  MONTHLY: { days: 30, label: 'Monthly' },
  QUARTERLY: { days: 90, label: 'Quarterly' },
  CUSTOM: { days: null, label: 'Custom Schedule' },
};

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * Create a blanket order
 * @param {string} buyerId - Buyer user ID
 * @param {Object} data - Blanket order data
 * @returns {Promise<Object>} Created blanket order
 */
exports.createBlanketOrder = async (buyerId, data) => {
  try {
    const {
      sellerId,
      productId,
      variantId,
      totalQuantity,
      unitPrice,
      currency = 'INR',
      startDate,
      endDate,
      releaseFrequency,
      customSchedule,
      deliveryAddress,
      terms,
      notes,
    } = data;

    // Validate seller
    const seller = await prisma.business.findUnique({
      where: { id: sellerId },
    });

    if (!seller) {
      throw new AppError('Seller not found', 404);
    }

    // Validate product
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: variantId ? { where: { id: variantId } } : { where: { isDefault: true } },
      },
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    const variant = product.variants[0];
    if (!variant) {
      throw new AppError('Product variant not found', 404);
    }

    // Validate dates
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (end <= start) {
      throw new AppError('End date must be after start date', 400);
    }

    const durationMonths = (end - start) / (1000 * 60 * 60 * 24 * 30);
    if (durationMonths > CONFIG.maxDurationMonths) {
      throw new AppError(`Maximum duration is ${CONFIG.maxDurationMonths} months`, 400);
    }

    // Generate order number
    const orderNumber = generateOrderNumber();

    // Calculate release schedule
    const releases = calculateReleaseSchedule(
      totalQuantity,
      start,
      end,
      releaseFrequency,
      customSchedule
    );

    const blanketOrder = await prisma.blanketOrder.create({
      data: {
        orderNumber,
        buyerId,
        sellerId,
        productId,
        variantId: variant.id,
        totalQuantity,
        releasedQuantity: 0,
        remainingQuantity: totalQuantity,
        unitPrice,
        currency,
        totalValue: totalQuantity * unitPrice,
        startDate: start,
        endDate: end,
        releaseFrequency,
        releaseSchedule: releases,
        deliveryAddress,
        terms,
        notes,
        status: 'DRAFT',
      },
      include: {
        product: { select: { id: true, name: true, images: true } },
        seller: { select: { id: true, businessName: true } },
      },
    });

    logger.info('Blanket order created', {
      orderNumber,
      buyerId,
      sellerId,
      totalQuantity,
    });

    return blanketOrder;
  } catch (error) {
    logger.error('Create blanket order error', { error: error.message, buyerId });
    throw error;
  }
};

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * Get blanket order by ID
 * @param {string} orderId - Order ID
 * @param {string} userId - User ID (buyer or seller)
 * @returns {Promise<Object>} Blanket order
 */
exports.getBlanketOrder = async (orderId, userId) => {
  const order = await prisma.blanketOrder.findUnique({
    where: { id: orderId },
    include: {
      product: {
        select: { id: true, name: true, images: true, slug: true },
      },
      variant: {
        select: { id: true, sku: true, attributes: true },
      },
      seller: {
        select: { id: true, businessName: true, slug: true },
      },
      buyer: {
        select: { id: true, firstName: true, lastName: true, businessId: true },
      },
      releases: {
        orderBy: { scheduledDate: 'asc' },
      },
    },
  });

  if (!order) {
    throw new AppError('Blanket order not found', 404);
  }

  // Check access
  if (order.buyerId !== userId && order.seller.id !== userId) {
    throw new AppError('Not authorized to view this order', 403);
  }

  return {
    ...order,
    statusInfo: BLANKET_ORDER_STATUS[order.status],
    frequencyInfo: RELEASE_FREQUENCIES[order.releaseFrequency],
  };
};

/**
 * Get blanket orders with filters
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated orders
 */
exports.getBlanketOrders = async (userId, options = {}) => {
  const {
    page = 1,
    limit = 20,
    role = 'buyer', // buyer or seller
    status = null,
    search = null,
  } = options;

  const skip = (page - 1) * limit;

  const where = {};
  if (role === 'buyer') {
    where.buyerId = userId;
  } else {
    const business = await prisma.business.findFirst({
      where: { ownerId: userId },
    });
    if (business) {
      where.sellerId = business.id;
    }
  }

  if (status) where.status = status;

  if (search) {
    where.OR = [
      { orderNumber: { contains: search, mode: 'insensitive' } },
      { product: { name: { contains: search, mode: 'insensitive' } } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.blanketOrder.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        product: { select: { id: true, name: true, images: true } },
        seller: { select: { id: true, businessName: true } },
      },
    }),
    prisma.blanketOrder.count({ where }),
  ]);

  return {
    orders: orders.map((o) => ({
      ...o,
      statusInfo: BLANKET_ORDER_STATUS[o.status],
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
// UPDATE OPERATIONS
// =============================================================================

/**
 * Update blanket order
 * @param {string} orderId - Order ID
 * @param {string} userId - User ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated order
 */
exports.updateBlanketOrder = async (orderId, userId, data) => {
  const order = await prisma.blanketOrder.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new AppError('Blanket order not found', 404);
  }

  if (order.buyerId !== userId) {
    throw new AppError('Not authorized to update this order', 403);
  }

  if (order.status !== 'DRAFT') {
    throw new AppError('Only draft orders can be modified', 400);
  }

  const updateData = {};
  const allowedFields = ['totalQuantity', 'deliveryAddress', 'terms', 'notes'];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updateData[field] = data[field];
    }
  }

  if (data.totalQuantity) {
    updateData.remainingQuantity = data.totalQuantity;
    updateData.totalValue = data.totalQuantity * order.unitPrice;
  }

  const updated = await prisma.blanketOrder.update({
    where: { id: orderId },
    data: updateData,
  });

  logger.info('Blanket order updated', { orderId, userId });

  return updated;
};

/**
 * Submit blanket order for approval
 * @param {string} orderId - Order ID
 * @param {string} userId - Buyer user ID
 * @returns {Promise<Object>} Submitted order
 */
exports.submitForApproval = async (orderId, userId) => {
  const order = await prisma.blanketOrder.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new AppError('Blanket order not found', 404);
  }

  if (order.buyerId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  if (order.status !== 'DRAFT') {
    throw new AppError('Only draft orders can be submitted', 400);
  }

  const updated = await prisma.blanketOrder.update({
    where: { id: orderId },
    data: {
      status: 'PENDING_APPROVAL',
      submittedAt: new Date(),
    },
  });

  logger.info('Blanket order submitted for approval', { orderId });

  return updated;
};

/**
 * Approve or reject blanket order (Seller)
 * @param {string} orderId - Order ID
 * @param {string} sellerId - Seller business ID
 * @param {string} decision - APPROVE or REJECT
 * @param {string} notes - Decision notes
 * @returns {Promise<Object>} Updated order
 */
exports.processApproval = async (orderId, sellerId, decision, notes = '') => {
  const order = await prisma.blanketOrder.findUnique({
    where: { id: orderId },
  });

  if (!order) {
    throw new AppError('Blanket order not found', 404);
  }

  if (order.sellerId !== sellerId) {
    throw new AppError('Not authorized', 403);
  }

  if (order.status !== 'PENDING_APPROVAL') {
    throw new AppError('Order is not pending approval', 400);
  }

  const newStatus = decision === 'APPROVE' ? 'ACTIVE' : 'CANCELLED';

  const updated = await prisma.blanketOrder.update({
    where: { id: orderId },
    data: {
      status: newStatus,
      approvedAt: decision === 'APPROVE' ? new Date() : null,
      approvalNotes: notes,
    },
  });

  logger.info('Blanket order processed', { orderId, decision });

  return updated;
};

// =============================================================================
// RELEASE OPERATIONS
// =============================================================================

/**
 * Create a release from blanket order
 * @param {string} orderId - Blanket order ID
 * @param {string} userId - User ID
 * @param {Object} data - Release data
 * @returns {Promise<Object>} Created release order
 */
exports.createRelease = async (orderId, userId, data) => {
  try {
    const { quantity, deliveryDate, notes } = data;

    const blanketOrder = await prisma.blanketOrder.findUnique({
      where: { id: orderId },
      include: {
        product: true,
        variant: true,
      },
    });

    if (!blanketOrder) {
      throw new AppError('Blanket order not found', 404);
    }

    if (blanketOrder.buyerId !== userId) {
      throw new AppError('Not authorized', 403);
    }

    if (blanketOrder.status !== 'ACTIVE' && blanketOrder.status !== 'PARTIALLY_RELEASED') {
      throw new AppError('Blanket order is not active', 400);
    }

    if (quantity > blanketOrder.remainingQuantity) {
      throw new AppError(`Maximum available quantity is ${blanketOrder.remainingQuantity}`, 400);
    }

    // Create release order in a transaction
    const result = await prisma.$transaction(async (tx) => {
      // Create the release
      const release = await tx.blanketOrderRelease.create({
        data: {
          blanketOrderId: orderId,
          quantity,
          unitPrice: blanketOrder.unitPrice,
          totalAmount: quantity * blanketOrder.unitPrice,
          scheduledDate: new Date(deliveryDate),
          status: 'PENDING',
          notes,
        },
      });

      // Update blanket order quantities
      const newReleasedQty = blanketOrder.releasedQuantity + quantity;
      const newRemainingQty = blanketOrder.remainingQuantity - quantity;
      const newStatus = newRemainingQty === 0 ? 'COMPLETED' : 'PARTIALLY_RELEASED';

      await tx.blanketOrder.update({
        where: { id: orderId },
        data: {
          releasedQuantity: newReleasedQty,
          remainingQuantity: newRemainingQty,
          status: newStatus,
        },
      });

      // Create actual order
      const order = await tx.order.create({
        data: {
          buyerId: blanketOrder.buyerId,
          sellerId: blanketOrder.sellerId,
          orderNumber: generateReleaseOrderNumber(blanketOrder.orderNumber),
          status: 'PENDING',
          subtotal: quantity * blanketOrder.unitPrice,
          total: quantity * blanketOrder.unitPrice,
          currency: blanketOrder.currency,
          shippingAddress: blanketOrder.deliveryAddress,
          blanketOrderId: orderId,
          blanketReleaseId: release.id,
          items: {
            create: {
              productId: blanketOrder.productId,
              variantId: blanketOrder.variantId,
              quantity,
              unitPrice: blanketOrder.unitPrice,
              totalPrice: quantity * blanketOrder.unitPrice,
            },
          },
        },
      });

      // Update release with order ID
      await tx.blanketOrderRelease.update({
        where: { id: release.id },
        data: { orderId: order.id },
      });

      return { release, order };
    });

    logger.info('Blanket order release created', {
      blanketOrderId: orderId,
      releaseId: result.release.id,
      quantity,
    });

    return result;
  } catch (error) {
    logger.error('Create release error', { error: error.message, orderId });
    throw error;
  }
};

/**
 * Get release history
 * @param {string} orderId - Blanket order ID
 * @param {string} userId - User ID
 * @returns {Promise<Object[]>} Release history
 */
exports.getReleaseHistory = async (orderId, userId) => {
  const order = await prisma.blanketOrder.findUnique({
    where: { id: orderId },
    select: { buyerId: true, sellerId: true },
  });

  if (!order) {
    throw new AppError('Blanket order not found', 404);
  }

  // Check access
  const business = await prisma.business.findFirst({
    where: { ownerId: userId },
  });
  
  if (order.buyerId !== userId && (!business || order.sellerId !== business.id)) {
    throw new AppError('Not authorized', 403);
  }

  const releases = await prisma.blanketOrderRelease.findMany({
    where: { blanketOrderId: orderId },
    orderBy: { createdAt: 'desc' },
    include: {
      order: {
        select: { id: true, orderNumber: true, status: true },
      },
    },
  });

  return releases;
};

// =============================================================================
// SCHEDULED OPERATIONS
// =============================================================================

/**
 * Process scheduled releases
 * @returns {Promise<Object>} Processing result
 */
exports.processScheduledReleases = async () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Find blanket orders with pending scheduled releases
  const orders = await prisma.blanketOrder.findMany({
    where: {
      status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] },
      releaseSchedule: { isEmpty: false },
    },
  });

  let processed = 0;
  let notifications = [];

  for (const order of orders) {
    const schedule = order.releaseSchedule || [];
    const dueReleases = schedule.filter((s) => {
      const releaseDate = new Date(s.date);
      releaseDate.setHours(0, 0, 0, 0);
      return releaseDate <= today && !s.released;
    });

    for (const due of dueReleases) {
      // Notify buyer about due release
      notifications.push({
        userId: order.buyerId,
        type: 'BLANKET_RELEASE_DUE',
        data: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          quantity: due.quantity,
          dueDate: due.date,
        },
      });
      processed++;
    }
  }

  logger.info('Scheduled releases processed', { processed });

  return { processed, notifications };
};

/**
 * Expire old blanket orders
 * @returns {Promise<Object>} Expiration result
 */
exports.expireOrders = async () => {
  const now = new Date();

  const result = await prisma.blanketOrder.updateMany({
    where: {
      status: { in: ['ACTIVE', 'PARTIALLY_RELEASED'] },
      endDate: { lt: now },
    },
    data: {
      status: 'EXPIRED',
    },
  });

  if (result.count > 0) {
    logger.info('Blanket orders expired', { count: result.count });
  }

  return { expired: result.count };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate blanket order number
 */
function generateOrderNumber() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `BO${year}${month}-${random}`;
}

/**
 * Generate release order number
 */
function generateReleaseOrderNumber(blanketOrderNumber) {
  const suffix = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `${blanketOrderNumber}-R${suffix}`;
}

/**
 * Calculate release schedule
 */
function calculateReleaseSchedule(totalQuantity, startDate, endDate, frequency, customSchedule) {
  if (frequency === 'CUSTOM' && customSchedule) {
    return customSchedule;
  }

  const releases = [];
  const freqConfig = RELEASE_FREQUENCIES[frequency];
  
  if (!freqConfig || !freqConfig.days) {
    return releases;
  }

  const daysBetween = freqConfig.days;
  const start = new Date(startDate);
  const end = new Date(endDate);
  const totalDays = (end - start) / (1000 * 60 * 60 * 24);
  const numberOfReleases = Math.floor(totalDays / daysBetween) + 1;
  const quantityPerRelease = Math.floor(totalQuantity / numberOfReleases);
  let remainingQuantity = totalQuantity;

  for (let i = 0; i < numberOfReleases && remainingQuantity > 0; i++) {
    const releaseDate = new Date(start);
    releaseDate.setDate(releaseDate.getDate() + (i * daysBetween));

    const qty = i === numberOfReleases - 1 ? remainingQuantity : quantityPerRelease;

    releases.push({
      date: releaseDate.toISOString(),
      quantity: qty,
      released: false,
    });

    remainingQuantity -= qty;
  }

  return releases;
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  BLANKET_ORDER_STATUS,
  RELEASE_FREQUENCIES,
};



