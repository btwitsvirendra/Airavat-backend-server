// =============================================================================
// AIRAVAT B2B MARKETPLACE - ORDER SERVICE
// Order management with payment processing and logistics
// =============================================================================

const { prisma } = require('../config/database');
const { cache, inventory } = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
  InsufficientStockError,
  OrderStateError,
  PaymentFailedError,
} = require('../utils/errors');
const {
  generateOrderNumber,
  generateInvoiceNumber,
  calculateGST,
  isInterstate,
  formatCurrency,
} = require('../utils/helpers');
const paymentService = require('./payment.service');
const shippingService = require('./shipping.service');
const emailService = require('./email.service');
const smsService = require('./sms.service');
const { emitToUser, emitToBusiness, emitToOrder } = require('./socket.service');

// Valid state transitions
const ORDER_TRANSITIONS = {
  DRAFT: ['PENDING_PAYMENT', 'CANCELLED'],
  PENDING_PAYMENT: ['PAYMENT_PROCESSING', 'CANCELLED'],
  PAYMENT_PROCESSING: ['PAID', 'PENDING_PAYMENT'],
  PAID: ['CONFIRMED', 'REFUND_REQUESTED'],
  CONFIRMED: ['PROCESSING', 'CANCELLED', 'REFUND_REQUESTED'],
  PROCESSING: ['READY_TO_SHIP', 'CANCELLED'],
  READY_TO_SHIP: ['SHIPPED'],
  SHIPPED: ['OUT_FOR_DELIVERY', 'DELIVERED'],
  OUT_FOR_DELIVERY: ['DELIVERED'],
  DELIVERED: ['COMPLETED', 'REFUND_REQUESTED', 'DISPUTED'],
  COMPLETED: [],
  CANCELLED: [],
  REFUND_REQUESTED: ['REFUND_PROCESSING', 'DISPUTED'],
  REFUND_PROCESSING: ['REFUNDED'],
  REFUNDED: [],
  DISPUTED: ['RESOLVED_BUYER', 'RESOLVED_SELLER', 'RESOLVED_PARTIAL'],
};

/**
 * Create order from cart or quotation
 */
const createOrder = async (buyerId, data) => {
  const {
    sellerId,
    items,
    quotationId,
    billingAddressId,
    shippingAddressId,
    paymentMethod,
    buyerNote,
  } = data;

  // Get buyer business
  const buyer = await prisma.business.findUnique({
    where: { id: buyerId },
    include: {
      addresses: true,
      owner: { select: { email: true, phone: true, firstName: true } },
    },
  });

  if (!buyer) {
    throw new NotFoundError('Buyer business');
  }

  // Get seller business
  const seller = await prisma.business.findUnique({
    where: { id: sellerId },
    include: {
      owner: { select: { email: true, phone: true, firstName: true } },
      settings: true,
    },
  });

  if (!seller) {
    throw new NotFoundError('Seller business');
  }

  if (seller.verificationStatus !== 'VERIFIED') {
    throw new BadRequestError('Seller is not verified');
  }

  // Get addresses
  const billingAddress = buyer.addresses.find((a) => a.id === billingAddressId);
  const shippingAddress = buyer.addresses.find((a) => a.id === shippingAddressId);

  if (!billingAddress || !shippingAddress) {
    throw new BadRequestError('Invalid address');
  }

  // Process items and check inventory
  const orderItems = [];
  let subtotal = 0;

  for (const item of items) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: item.variantId },
      include: {
        product: true,
        pricingTiers: {
          orderBy: { minQuantity: 'asc' },
        },
      },
    });

    if (!variant) {
      throw new NotFoundError(`Product variant ${item.variantId}`);
    }

    if (variant.product.businessId !== sellerId) {
      throw new BadRequestError('Product does not belong to seller');
    }

    // Check inventory using Redis
    const availableStock = await inventory.get(variant.id) ?? variant.stockQuantity;

    if (variant.trackInventory && availableStock < item.quantity) {
      throw new InsufficientStockError(
        variant.product.name,
        availableStock,
        item.quantity
      );
    }

    // Calculate unit price (check tiered pricing)
    let unitPrice = variant.basePrice;
    for (const tier of variant.pricingTiers) {
      if (
        item.quantity >= tier.minQuantity &&
        (!tier.maxQuantity || item.quantity <= tier.maxQuantity)
      ) {
        unitPrice = tier.unitPrice;
        break;
      }
    }

    // Calculate tax
    const taxRate = variant.product.gstRate || 18;
    const itemTotal = parseFloat(unitPrice) * item.quantity;
    const taxAmount = calculateGST(
      itemTotal,
      taxRate,
      isInterstate(seller.state, shippingAddress.state)
    );

    orderItems.push({
      variantId: variant.id,
      productName: variant.product.name,
      variantName: variant.variantName,
      sku: variant.sku,
      hsnCode: variant.product.hsnCode,
      quantity: item.quantity,
      unitPrice,
      taxRate,
      taxAmount: taxAmount.total,
      totalPrice: itemTotal + taxAmount.total,
    });

    subtotal += itemTotal;
  }

  // Calculate totals
  const taxBreakdown = calculateGST(
    subtotal,
    18, // Average GST
    isInterstate(seller.state, shippingAddress.state)
  );

  const totalTax = orderItems.reduce((sum, item) => sum + parseFloat(item.taxAmount), 0);

  // Calculate platform fee
  const platformFeeRate = config.businessRules.defaultCommissionRate;
  const platformFee = (subtotal * platformFeeRate) / 100;

  // Generate order number
  const orderNumber = await generateOrderNumber(prisma);

  // Create order in transaction
  const order = await prisma.$transaction(async (tx) => {
    // Create order
    const newOrder = await tx.order.create({
      data: {
        orderNumber,
        buyerId,
        sellerId,
        quotationId,
        status: 'PENDING_PAYMENT',
        billingAddress: {
          ...billingAddress,
          id: undefined,
          businessId: undefined,
        },
        shippingAddress: {
          ...shippingAddress,
          id: undefined,
          businessId: undefined,
        },
        subtotal,
        taxAmount: totalTax,
        taxBreakdown,
        shippingAmount: 0, // Calculate based on shipping service
        discountAmount: 0,
        totalAmount: subtotal + totalTax,
        platformFee,
        platformFeeRate,
        buyerNote,
        paymentTerms: seller.settings?.paymentTerms,
        items: {
          create: orderItems,
        },
        timeline: {
          create: {
            status: 'PENDING_PAYMENT',
            title: 'Order Created',
            description: 'Order has been created and is pending payment',
            createdBy: 'system',
          },
        },
      },
      include: {
        items: true,
        buyer: {
          select: { id: true, businessName: true },
        },
        seller: {
          select: { id: true, businessName: true },
        },
      },
    });

    // Reserve inventory
    for (const item of orderItems) {
      const reserved = await inventory.deduct(item.variantId, item.quantity);
      if (!reserved) {
        throw new InsufficientStockError(item.productName, 0, item.quantity);
      }

      // Update database reserved stock
      await tx.productVariant.update({
        where: { id: item.variantId },
        data: { reservedStock: { increment: item.quantity } },
      });
    }

    return newOrder;
  });

  // Create Razorpay order for payment
  const paymentOrder = await paymentService.createOrder({
    orderId: order.id,
    amount: order.totalAmount,
    currency: 'INR',
    receipt: order.orderNumber,
    notes: {
      buyerId,
      sellerId,
      orderNumber: order.orderNumber,
    },
  });

  logger.logAudit('ORDER_CREATED', null, { orderId: order.id, orderNumber });

  // Send notifications
  await emitToBusiness(sellerId, 'order:new', {
    orderId: order.id,
    orderNumber: order.orderNumber,
    buyerName: buyer.businessName,
    amount: order.totalAmount,
  });

  return {
    order,
    payment: {
      razorpayOrderId: paymentOrder.id,
      amount: paymentOrder.amount,
      currency: paymentOrder.currency,
    },
  };
};

/**
 * Get order by ID
 */
const getOrderById = async (orderId, businessId, userId) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: {
        include: {
          variant: {
            include: {
              product: {
                select: { images: true },
              },
            },
          },
        },
      },
      buyer: {
        select: {
          id: true,
          businessName: true,
          slug: true,
          logo: true,
          phone: true,
          email: true,
        },
      },
      seller: {
        select: {
          id: true,
          businessName: true,
          slug: true,
          logo: true,
          phone: true,
          email: true,
        },
      },
      payments: {
        orderBy: { createdAt: 'desc' },
      },
      shipments: {
        include: {
          tracking: {
            orderBy: { timestamp: 'desc' },
            take: 10,
          },
        },
      },
      timeline: {
        orderBy: { createdAt: 'desc' },
      },
      quotation: {
        select: { id: true, quotationNumber: true },
      },
    },
  });

  if (!order) {
    throw new NotFoundError('Order');
  }

  // Check access
  if (order.buyerId !== businessId && order.sellerId !== businessId) {
    throw new ForbiddenError('Cannot access this order');
  }

  return order;
};

/**
 * Update order status
 */
const updateOrderStatus = async (orderId, businessId, newStatus, metadata = {}) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      buyer: {
        select: { id: true, businessName: true },
        include: { owner: { select: { email: true, phone: true, firstName: true } } },
      },
      seller: {
        select: { id: true, businessName: true },
        include: { owner: { select: { email: true, phone: true } } },
      },
    },
  });

  if (!order) {
    throw new NotFoundError('Order');
  }

  // Check permission
  const isBuyer = order.buyerId === businessId;
  const isSeller = order.sellerId === businessId;

  if (!isBuyer && !isSeller) {
    throw new ForbiddenError('Cannot update this order');
  }

  // Validate transition
  const allowedTransitions = ORDER_TRANSITIONS[order.status];
  if (!allowedTransitions || !allowedTransitions.includes(newStatus)) {
    throw new OrderStateError(order.status, `change to ${newStatus}`);
  }

  // Handle status-specific logic
  const updateData = { status: newStatus };

  switch (newStatus) {
    case 'CONFIRMED':
      if (!isSeller) throw new ForbiddenError('Only seller can confirm');
      updateData.confirmedAt = new Date();
      break;

    case 'PROCESSING':
      if (!isSeller) throw new ForbiddenError('Only seller can process');
      updateData.processedAt = new Date();
      break;

    case 'SHIPPED':
      if (!isSeller) throw new ForbiddenError('Only seller can ship');
      updateData.shippedAt = new Date();
      break;

    case 'DELIVERED':
      updateData.deliveredAt = new Date();
      break;

    case 'COMPLETED':
      updateData.completedAt = new Date();
      // Release escrow payment to seller
      await paymentService.releaseEscrow(orderId);
      // Update seller metrics
      await updateSellerMetrics(order.sellerId, order.totalAmount);
      break;

    case 'CANCELLED':
      updateData.cancelledAt = new Date();
      updateData.cancellationReason = metadata.reason;
      // Release reserved inventory
      await releaseOrderInventory(order);
      // Process refund if paid
      if (['PAID', 'CONFIRMED', 'PROCESSING'].includes(order.status)) {
        await paymentService.refundPayment(orderId, 'Order cancelled');
      }
      break;

    case 'REFUND_REQUESTED':
      // Only buyer can request refund
      if (!isBuyer) throw new ForbiddenError('Only buyer can request refund');
      break;

    case 'REFUNDED':
      // Process refund
      await paymentService.refundPayment(orderId, metadata.reason);
      break;
  }

  // Update order
  const updatedOrder = await prisma.order.update({
    where: { id: orderId },
    data: {
      ...updateData,
      timeline: {
        create: {
          status: newStatus,
          title: getStatusTitle(newStatus),
          description: metadata.description || getStatusDescription(newStatus),
          metadata: metadata.extra || undefined,
          createdBy: businessId,
        },
      },
    },
  });

  // Send notifications
  await sendOrderNotifications(updatedOrder, order, newStatus);

  // Emit real-time updates
  emitToOrder(orderId, 'order:status', {
    orderId,
    status: newStatus,
    timestamp: new Date(),
  });

  logger.logAudit('ORDER_STATUS_UPDATED', null, {
    orderId,
    previousStatus: order.status,
    newStatus,
  });

  return updatedOrder;
};

/**
 * Release inventory for cancelled/refunded orders
 */
const releaseOrderInventory = async (order) => {
  for (const item of order.items) {
    // Release from Redis
    await inventory.release(item.variantId, item.quantity);

    // Update database
    await prisma.productVariant.update({
      where: { id: item.variantId },
      data: {
        stockQuantity: { increment: item.quantity },
        reservedStock: { decrement: item.quantity },
      },
    });

    // Log inventory movement
    await prisma.inventoryLog.create({
      data: {
        variantId: item.variantId,
        type: 'released',
        quantity: item.quantity,
        previousQty: 0,
        newQty: item.quantity,
        reason: `Order ${order.orderNumber} cancelled`,
        reference: order.id,
      },
    });
  }
};

/**
 * Update seller metrics after order completion
 */
const updateSellerMetrics = async (sellerId, orderAmount) => {
  await prisma.business.update({
    where: { id: sellerId },
    data: {
      totalOrders: { increment: 1 },
      totalRevenue: { increment: orderAmount },
    },
  });
};

/**
 * Get order status title
 */
const getStatusTitle = (status) => {
  const titles = {
    PENDING_PAYMENT: 'Awaiting Payment',
    PAYMENT_PROCESSING: 'Processing Payment',
    PAID: 'Payment Confirmed',
    CONFIRMED: 'Order Confirmed',
    PROCESSING: 'Processing Order',
    READY_TO_SHIP: 'Ready to Ship',
    SHIPPED: 'Shipped',
    OUT_FOR_DELIVERY: 'Out for Delivery',
    DELIVERED: 'Delivered',
    COMPLETED: 'Order Completed',
    CANCELLED: 'Order Cancelled',
    REFUND_REQUESTED: 'Refund Requested',
    REFUND_PROCESSING: 'Processing Refund',
    REFUNDED: 'Refunded',
    DISPUTED: 'Under Dispute',
  };
  return titles[status] || status;
};

/**
 * Get order status description
 */
const getStatusDescription = (status) => {
  const descriptions = {
    PENDING_PAYMENT: 'Order is waiting for payment',
    PAID: 'Payment has been received',
    CONFIRMED: 'Seller has confirmed the order',
    PROCESSING: 'Order is being prepared',
    READY_TO_SHIP: 'Order is packed and ready for pickup',
    SHIPPED: 'Order has been shipped',
    OUT_FOR_DELIVERY: 'Order is out for delivery',
    DELIVERED: 'Order has been delivered',
    COMPLETED: 'Order completed successfully',
    CANCELLED: 'Order has been cancelled',
    REFUNDED: 'Payment has been refunded',
  };
  return descriptions[status] || '';
};

/**
 * Send order notifications
 */
const sendOrderNotifications = async (updatedOrder, originalOrder, newStatus) => {
  const buyer = originalOrder.buyer;
  const seller = originalOrder.seller;

  // Email notifications
  switch (newStatus) {
    case 'PAID':
      await emailService.sendOrderConfirmationEmail(buyer.owner.email, {
        name: buyer.owner.firstName,
        orderNumber: updatedOrder.orderNumber,
        totalAmount: formatCurrency(updatedOrder.totalAmount),
        sellerName: seller.businessName,
        itemCount: originalOrder.items.length,
        orderId: updatedOrder.id,
      });
      break;

    case 'SHIPPED':
      await smsService.sendOrderStatusSMS(
        buyer.owner.phone,
        updatedOrder.orderNumber,
        'SHIPPED'
      );
      break;

    case 'DELIVERED':
      await smsService.sendOrderStatusSMS(
        buyer.owner.phone,
        updatedOrder.orderNumber,
        'DELIVERED'
      );
      break;
  }

  // Real-time notifications
  emitToBusiness(buyer.id, 'notification:new', {
    type: 'ORDER',
    title: getStatusTitle(newStatus),
    body: `Order #${updatedOrder.orderNumber} - ${getStatusDescription(newStatus)}`,
    orderId: updatedOrder.id,
  });
};

/**
 * List orders for a business
 */
const listOrders = async (businessId, role, filters = {}, pagination = {}) => {
  const { page = 1, limit = 20 } = pagination;
  const skip = (page - 1) * limit;

  const where = {
    ...(role === 'seller' ? { sellerId: businessId } : { buyerId: businessId }),
  };

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.dateFrom || filters.dateTo) {
    where.createdAt = {};
    if (filters.dateFrom) {
      where.createdAt.gte = new Date(filters.dateFrom);
    }
    if (filters.dateTo) {
      where.createdAt.lte = new Date(filters.dateTo);
    }
  }

  if (filters.search) {
    where.OR = [
      { orderNumber: { contains: filters.search, mode: 'insensitive' } },
      { buyer: { businessName: { contains: filters.search, mode: 'insensitive' } } },
      { seller: { businessName: { contains: filters.search, mode: 'insensitive' } } },
    ];
  }

  const [orders, total] = await Promise.all([
    prisma.order.findMany({
      where,
      select: {
        id: true,
        orderNumber: true,
        status: true,
        totalAmount: true,
        createdAt: true,
        confirmedAt: true,
        deliveredAt: true,
        buyer: {
          select: { id: true, businessName: true, logo: true },
        },
        seller: {
          select: { id: true, businessName: true, logo: true },
        },
        items: {
          select: { productName: true, quantity: true },
          take: 3,
        },
        _count: {
          select: { items: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.order.count({ where }),
  ]);

  return {
    orders,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Generate invoice for order
 */
const generateInvoice = async (orderId, businessId) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: true,
      buyer: true,
      seller: true,
    },
  });

  if (!order) {
    throw new NotFoundError('Order');
  }

  if (order.sellerId !== businessId) {
    throw new ForbiddenError('Only seller can generate invoice');
  }

  if (!['PAID', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'COMPLETED'].includes(order.status)) {
    throw new BadRequestError('Cannot generate invoice for this order status');
  }

  // Generate invoice number if not exists
  let invoiceNumber = order.invoiceNumber;
  if (!invoiceNumber) {
    invoiceNumber = await generateInvoiceNumber(prisma);
    await prisma.order.update({
      where: { id: orderId },
      data: {
        invoiceNumber,
        invoiceGeneratedAt: new Date(),
      },
    });
  }

  // Return invoice data (PDF generation would be handled separately)
  return {
    invoiceNumber,
    order,
    generatedAt: new Date(),
  };
};

/**
 * Add seller note to order
 */
const addSellerNote = async (orderId, businessId, note) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });

  if (!order || order.sellerId !== businessId) {
    throw new ForbiddenError('Cannot update this order');
  }

  return prisma.order.update({
    where: { id: orderId },
    data: { sellerNote: note },
  });
};

/**
 * Get order statistics
 */
const getOrderStats = async (businessId, role, period = 'month') => {
  const whereBase = role === 'seller' ? { sellerId: businessId } : { buyerId: businessId };

  const now = new Date();
  let dateFrom;

  switch (period) {
    case 'week':
      dateFrom = new Date(now.setDate(now.getDate() - 7));
      break;
    case 'month':
      dateFrom = new Date(now.setMonth(now.getMonth() - 1));
      break;
    case 'quarter':
      dateFrom = new Date(now.setMonth(now.getMonth() - 3));
      break;
    case 'year':
      dateFrom = new Date(now.setFullYear(now.getFullYear() - 1));
      break;
    default:
      dateFrom = new Date(now.setMonth(now.getMonth() - 1));
  }

  const where = {
    ...whereBase,
    createdAt: { gte: dateFrom },
  };

  const [
    totalOrders,
    statusCounts,
    revenue,
    avgOrderValue,
  ] = await Promise.all([
    prisma.order.count({ where }),
    prisma.order.groupBy({
      by: ['status'],
      where,
      _count: true,
    }),
    prisma.order.aggregate({
      where: { ...where, status: { in: ['DELIVERED', 'COMPLETED'] } },
      _sum: { totalAmount: true },
    }),
    prisma.order.aggregate({
      where,
      _avg: { totalAmount: true },
    }),
  ]);

  return {
    totalOrders,
    statusBreakdown: statusCounts.reduce((acc, s) => {
      acc[s.status] = s._count;
      return acc;
    }, {}),
    totalRevenue: revenue._sum.totalAmount || 0,
    avgOrderValue: avgOrderValue._avg.totalAmount || 0,
    period,
  };
};

module.exports = {
  createOrder,
  getOrderById,
  updateOrderStatus,
  listOrders,
  generateInvoice,
  addSellerNote,
  getOrderStats,
  releaseOrderInventory,
};
