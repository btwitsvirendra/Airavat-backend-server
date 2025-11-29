// =============================================================================
// AIRAVAT B2B MARKETPLACE - QUICK ORDER SERVICE
// Fast reordering and one-click ordering functionality
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
} = require('../utils/errors');
const { generateId } = require('../utils/helpers');

// =============================================================================
// CONSTANTS
// =============================================================================

const QUICK_ORDER_STATUS = {
  DRAFT: 'DRAFT',
  VALIDATED: 'VALIDATED',
  CONVERTED: 'CONVERTED',
  CANCELLED: 'CANCELLED',
};

const CACHE_TTL = { QUICK_ORDER: 300 };

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const generateQuickOrderNumber = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = generateId().substring(0, 6).toUpperCase();
  return `QO-${timestamp}-${random}`;
};

// =============================================================================
// QUICK ORDER MANAGEMENT
// =============================================================================

/**
 * Create quick order from template
 */
const createFromTemplate = async (userId, businessId, templateId) => {
  const template = await prisma.orderTemplate.findFirst({
    where: { id: templateId, userId },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              price: true,
              stockQuantity: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!template) {
    throw new NotFoundError('Order template');
  }

  // Validate all products are available
  const unavailableItems = template.items.filter(
    (item) => item.product.status !== 'ACTIVE' || item.product.stockQuantity < item.quantity
  );

  if (unavailableItems.length > 0) {
    throw new BadRequestError('Some items are unavailable', {
      unavailableItems: unavailableItems.map((i) => ({
        productId: i.productId,
        name: i.product.name,
        available: i.product.stockQuantity,
        requested: i.quantity,
      })),
    });
  }

  // Calculate totals
  let subtotal = 0;
  const orderItems = template.items.map((item) => {
    const unitPrice = parseFloat(item.product.price);
    const totalPrice = unitPrice * item.quantity;
    subtotal += totalPrice;

    return {
      productId: item.productId,
      quantity: item.quantity,
      unitPrice,
      totalPrice,
    };
  });

  const taxRate = 0.18; // 18% GST
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  const quickOrder = await prisma.quickOrder.create({
    data: {
      orderNumber: generateQuickOrderNumber(),
      userId,
      businessId,
      templateId,
      subtotal,
      tax,
      total,
      status: QUICK_ORDER_STATUS.VALIDATED,
      items: {
        create: orderItems,
      },
    },
    include: {
      items: {
        include: {
          product: {
            select: { id: true, name: true, images: true },
          },
        },
      },
      template: {
        select: { id: true, name: true },
      },
    },
  });

  // Record template usage
  await prisma.orderTemplate.update({
    where: { id: templateId },
    data: {
      usageCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });

  logger.info('Quick order created from template', {
    quickOrderId: quickOrder.id,
    templateId,
    userId,
  });

  return quickOrder;
};

/**
 * Create quick order from previous order (reorder)
 */
const createFromOrder = async (userId, businessId, sourceOrderId) => {
  const sourceOrder = await prisma.order.findFirst({
    where: { id: sourceOrderId, buyerId: businessId },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              price: true,
              stockQuantity: true,
              status: true,
            },
          },
        },
      },
    },
  });

  if (!sourceOrder) {
    throw new NotFoundError('Order');
  }

  // Check product availability
  const unavailableItems = sourceOrder.items.filter(
    (item) => item.product.status !== 'ACTIVE' || item.product.stockQuantity < item.quantity
  );

  // Calculate totals with current prices
  let subtotal = 0;
  const orderItems = sourceOrder.items
    .filter((item) => item.product.status === 'ACTIVE')
    .map((item) => {
      const unitPrice = parseFloat(item.product.price);
      const quantity = Math.min(item.quantity, item.product.stockQuantity);
      const totalPrice = unitPrice * quantity;
      subtotal += totalPrice;

      return {
        productId: item.productId,
        quantity,
        unitPrice,
        totalPrice,
      };
    });

  if (orderItems.length === 0) {
    throw new BadRequestError('No items available for reorder');
  }

  const taxRate = 0.18;
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  const quickOrder = await prisma.quickOrder.create({
    data: {
      orderNumber: generateQuickOrderNumber(),
      userId,
      businessId,
      sourceOrderId,
      subtotal,
      tax,
      total,
      status: QUICK_ORDER_STATUS.VALIDATED,
      notes: unavailableItems.length > 0
        ? `${unavailableItems.length} items were unavailable and excluded`
        : null,
      items: {
        create: orderItems,
      },
    },
    include: {
      items: {
        include: {
          product: {
            select: { id: true, name: true, images: true },
          },
        },
      },
      sourceOrder: {
        select: { id: true, orderNumber: true },
      },
    },
  });

  logger.info('Quick order created from previous order', {
    quickOrderId: quickOrder.id,
    sourceOrderId,
    userId,
  });

  return {
    ...quickOrder,
    warnings: unavailableItems.length > 0 ? {
      message: 'Some items were unavailable',
      items: unavailableItems.map((i) => i.product.name),
    } : null,
  };
};

/**
 * Create quick order from cart
 */
const createFromCart = async (userId, businessId) => {
  const cartItems = await prisma.cartItem.findMany({
    where: {
      cart: { userId },
    },
    include: {
      product: {
        select: {
          id: true,
          name: true,
          price: true,
          stockQuantity: true,
          status: true,
        },
      },
    },
  });

  if (cartItems.length === 0) {
    throw new BadRequestError('Cart is empty');
  }

  // Calculate totals
  let subtotal = 0;
  const orderItems = cartItems
    .filter((item) => item.product.status === 'ACTIVE')
    .map((item) => {
      const unitPrice = parseFloat(item.product.price);
      const quantity = Math.min(item.quantity, item.product.stockQuantity);
      const totalPrice = unitPrice * quantity;
      subtotal += totalPrice;

      return {
        productId: item.productId,
        quantity,
        unitPrice,
        totalPrice,
      };
    });

  const taxRate = 0.18;
  const tax = subtotal * taxRate;
  const total = subtotal + tax;

  const quickOrder = await prisma.quickOrder.create({
    data: {
      orderNumber: generateQuickOrderNumber(),
      userId,
      businessId,
      subtotal,
      tax,
      total,
      status: QUICK_ORDER_STATUS.VALIDATED,
      items: {
        create: orderItems,
      },
    },
    include: {
      items: {
        include: {
          product: {
            select: { id: true, name: true, images: true },
          },
        },
      },
    },
  });

  logger.info('Quick order created from cart', {
    quickOrderId: quickOrder.id,
    userId,
    itemCount: orderItems.length,
  });

  return quickOrder;
};

/**
 * Get quick order by ID
 */
const getQuickOrder = async (userId, quickOrderId) => {
  const quickOrder = await prisma.quickOrder.findFirst({
    where: { id: quickOrderId, userId },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              price: true,
              images: true,
              stockQuantity: true,
              seller: { select: { id: true, businessName: true } },
            },
          },
        },
      },
      template: { select: { id: true, name: true } },
      sourceOrder: { select: { id: true, orderNumber: true } },
      convertedOrder: { select: { id: true, orderNumber: true } },
    },
  });

  if (!quickOrder) {
    throw new NotFoundError('Quick order');
  }

  // Check for price changes
  const itemsWithChanges = quickOrder.items.map((item) => {
    const currentPrice = parseFloat(item.product.price);
    const originalPrice = parseFloat(item.unitPrice);
    const priceChanged = currentPrice !== originalPrice;

    return {
      ...item,
      currentPrice,
      priceChanged,
      priceDifference: priceChanged ? currentPrice - originalPrice : 0,
    };
  });

  return {
    ...quickOrder,
    items: itemsWithChanges,
  };
};

/**
 * Get user's quick orders
 */
const getQuickOrders = async (userId, options = {}) => {
  const { page = 1, limit = 20, status } = options;
  const skip = (page - 1) * limit;

  const where = { userId };
  if (status) where.status = status;

  const [orders, total] = await Promise.all([
    prisma.quickOrder.findMany({
      where,
      include: {
        items: {
          take: 3,
          include: {
            product: {
              select: { id: true, name: true, images: true },
            },
          },
        },
        template: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.quickOrder.count({ where }),
  ]);

  return {
    orders: orders.map((order) => ({
      ...order,
      itemCount: order.items.length,
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Update quick order item
 */
const updateQuickOrderItem = async (userId, quickOrderId, itemId, updates) => {
  const quickOrder = await prisma.quickOrder.findFirst({
    where: { id: quickOrderId, userId, status: { in: [QUICK_ORDER_STATUS.DRAFT, QUICK_ORDER_STATUS.VALIDATED] } },
  });

  if (!quickOrder) {
    throw new NotFoundError('Quick order');
  }

  const item = await prisma.quickOrderItem.findFirst({
    where: { id: itemId, quickOrderId },
    include: { product: { select: { price: true, stockQuantity: true } } },
  });

  if (!item) {
    throw new NotFoundError('Quick order item');
  }

  if (updates.quantity !== undefined) {
    if (updates.quantity > item.product.stockQuantity) {
      throw new BadRequestError(`Only ${item.product.stockQuantity} available`);
    }

    const newTotalPrice = parseFloat(item.product.price) * updates.quantity;

    await prisma.quickOrderItem.update({
      where: { id: itemId },
      data: {
        quantity: updates.quantity,
        unitPrice: item.product.price,
        totalPrice: newTotalPrice,
      },
    });
  }

  // Recalculate order totals
  const allItems = await prisma.quickOrderItem.findMany({
    where: { quickOrderId },
  });

  const subtotal = allItems.reduce((sum, i) => sum + parseFloat(i.totalPrice), 0);
  const tax = subtotal * 0.18;
  const total = subtotal + tax;

  await prisma.quickOrder.update({
    where: { id: quickOrderId },
    data: { subtotal, tax, total },
  });

  return getQuickOrder(userId, quickOrderId);
};

/**
 * Convert quick order to actual order
 */
const convertToOrder = async (userId, businessId, quickOrderId, orderData) => {
  const quickOrder = await prisma.quickOrder.findFirst({
    where: {
      id: quickOrderId,
      userId,
      status: QUICK_ORDER_STATUS.VALIDATED,
    },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              sellerId: true,
              price: true,
              stockQuantity: true,
            },
          },
        },
      },
    },
  });

  if (!quickOrder) {
    throw new NotFoundError('Quick order');
  }

  // Final stock validation
  for (const item of quickOrder.items) {
    if (item.product.stockQuantity < item.quantity) {
      throw new BadRequestError(
        `Insufficient stock for product. Available: ${item.product.stockQuantity}`
      );
    }
  }

  // Create the actual order (this should integrate with order.service)
  // For now, we'll just mark the quick order as converted
  const updated = await prisma.quickOrder.update({
    where: { id: quickOrderId },
    data: {
      status: QUICK_ORDER_STATUS.CONVERTED,
      // convertedOrderId would be set here after actual order creation
    },
  });

  logger.info('Quick order converted', { quickOrderId, userId });

  return {
    success: true,
    quickOrder: updated,
    message: 'Quick order converted successfully',
  };
};

/**
 * Cancel quick order
 */
const cancelQuickOrder = async (userId, quickOrderId) => {
  const quickOrder = await prisma.quickOrder.findFirst({
    where: {
      id: quickOrderId,
      userId,
      status: { in: [QUICK_ORDER_STATUS.DRAFT, QUICK_ORDER_STATUS.VALIDATED] },
    },
  });

  if (!quickOrder) {
    throw new NotFoundError('Quick order');
  }

  await prisma.quickOrder.update({
    where: { id: quickOrderId },
    data: { status: QUICK_ORDER_STATUS.CANCELLED },
  });

  logger.info('Quick order cancelled', { quickOrderId, userId });

  return { success: true };
};

/**
 * Get reorder suggestions
 */
const getReorderSuggestions = async (userId, businessId, limit = 5) => {
  // Get frequently ordered products
  const frequentProducts = await prisma.orderItem.groupBy({
    by: ['productId'],
    where: {
      order: { buyerId: businessId },
    },
    _count: { productId: true },
    _sum: { quantity: true },
    orderBy: { _count: { productId: 'desc' } },
    take: limit,
  });

  const productIds = frequentProducts.map((p) => p.productId);

  const products = await prisma.product.findMany({
    where: {
      id: { in: productIds },
      status: 'ACTIVE',
    },
    select: {
      id: true,
      name: true,
      slug: true,
      price: true,
      images: true,
      seller: { select: { id: true, businessName: true } },
    },
  });

  return products.map((product) => {
    const stats = frequentProducts.find((p) => p.productId === product.id);
    return {
      ...product,
      orderCount: stats?._count?.productId || 0,
      totalQuantity: stats?._sum?.quantity || 0,
    };
  });
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  QUICK_ORDER_STATUS,
  createFromTemplate,
  createFromOrder,
  createFromCart,
  getQuickOrder,
  getQuickOrders,
  updateQuickOrderItem,
  convertToOrder,
  cancelQuickOrder,
  getReorderSuggestions,
};



