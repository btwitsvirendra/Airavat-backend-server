// =============================================================================
// AIRAVAT B2B MARKETPLACE - SAMPLE ORDER SERVICE
// Request and manage product samples for quality evaluation
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} = require('../utils/errors');
const { generateId } = require('../utils/helpers');
const { emitToBusiness } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const SAMPLE_PURPOSE = {
  QUALITY_CHECK: 'QUALITY_CHECK',
  PRODUCT_TESTING: 'PRODUCT_TESTING',
  CERTIFICATION: 'CERTIFICATION',
  CUSTOMER_DEMO: 'CUSTOMER_DEMO',
  OTHER: 'OTHER',
};

const SAMPLE_STATUS = {
  REQUESTED: 'REQUESTED',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SHIPPED: 'SHIPPED',
  DELIVERED: 'DELIVERED',
  FEEDBACK_PENDING: 'FEEDBACK_PENDING',
  COMPLETED: 'COMPLETED',
  CANCELLED: 'CANCELLED',
};

const MAX_SAMPLES_PER_PRODUCT = 2;
const SAMPLE_EXPIRY_DAYS = 30;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const generateSampleNumber = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = generateId().substring(0, 6).toUpperCase();
  return `SMP-${timestamp}-${random}`;
};

// =============================================================================
// SAMPLE ORDER MANAGEMENT
// =============================================================================

/**
 * Request a sample
 */
const requestSample = async (userId, businessId, data) => {
  const { productId, quantity, purpose, shippingAddress, notes } = data;

  // Check product exists and is active
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: {
      id: true,
      name: true,
      sellerId: true,
      sampleAvailable: true,
      maxSampleQuantity: true,
      seller: { select: { id: true, businessName: true } },
    },
  });

  if (!product) {
    throw new NotFoundError('Product');
  }

  if (!product.sampleAvailable) {
    throw new BadRequestError('Samples not available for this product');
  }

  if (product.maxSampleQuantity && quantity > product.maxSampleQuantity) {
    throw new BadRequestError(`Maximum sample quantity is ${product.maxSampleQuantity}`);
  }

  // Check existing sample requests
  const existingCount = await prisma.sampleOrder.count({
    where: {
      userId,
      productId,
      status: { notIn: [SAMPLE_STATUS.REJECTED, SAMPLE_STATUS.CANCELLED] },
    },
  });

  if (existingCount >= MAX_SAMPLES_PER_PRODUCT) {
    throw new BadRequestError(`Maximum ${MAX_SAMPLES_PER_PRODUCT} sample requests per product`);
  }

  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + SAMPLE_EXPIRY_DAYS);

  const sampleOrder = await prisma.sampleOrder.create({
    data: {
      sampleNumber: generateSampleNumber(),
      userId,
      businessId,
      sellerId: product.sellerId,
      productId,
      quantity,
      purpose: purpose || SAMPLE_PURPOSE.QUALITY_CHECK,
      status: SAMPLE_STATUS.REQUESTED,
      shippingAddress,
      expiresAt,
    },
    include: {
      product: {
        select: { id: true, name: true, images: true },
      },
      seller: {
        select: { id: true, businessName: true },
      },
    },
  });

  // Notify seller
  emitToBusiness(product.sellerId, 'sample:requested', {
    sampleId: sampleOrder.id,
    sampleNumber: sampleOrder.sampleNumber,
    productName: product.name,
  });

  logger.info('Sample requested', {
    sampleId: sampleOrder.id,
    userId,
    productId,
    sellerId: product.sellerId,
  });

  return sampleOrder;
};

/**
 * Get sample requests for buyer
 */
const getBuyerSamples = async (userId, options = {}) => {
  const { page = 1, limit = 20, status } = options;
  const skip = (page - 1) * limit;

  const where = { userId };
  if (status) where.status = status;

  const [samples, total] = await Promise.all([
    prisma.sampleOrder.findMany({
      where,
      include: {
        product: {
          select: { id: true, name: true, slug: true, images: true },
        },
        seller: {
          select: { id: true, businessName: true, logo: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.sampleOrder.count({ where }),
  ]);

  return {
    samples,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get sample requests for seller
 */
const getSellerSamples = async (sellerId, options = {}) => {
  const { page = 1, limit = 20, status } = options;
  const skip = (page - 1) * limit;

  const where = { sellerId };
  if (status) where.status = status;

  const [samples, total] = await Promise.all([
    prisma.sampleOrder.findMany({
      where,
      include: {
        product: {
          select: { id: true, name: true, images: true },
        },
        business: {
          select: { id: true, businessName: true, logo: true },
        },
        user: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.sampleOrder.count({ where }),
  ]);

  return {
    samples,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get sample by ID
 */
const getSampleById = async (sampleId, requesterId, isSeller = false) => {
  const where = { id: sampleId };
  if (isSeller) {
    where.sellerId = requesterId;
  } else {
    where.userId = requesterId;
  }

  const sample = await prisma.sampleOrder.findFirst({
    where,
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
        select: { id: true, businessName: true, logo: true, email: true },
      },
      business: {
        select: { id: true, businessName: true, logo: true },
      },
      user: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
    },
  });

  if (!sample) {
    throw new NotFoundError('Sample order');
  }

  return sample;
};

/**
 * Approve sample request (seller)
 */
const approveSample = async (sellerId, sampleId) => {
  const sample = await prisma.sampleOrder.findFirst({
    where: { id: sampleId, sellerId, status: SAMPLE_STATUS.REQUESTED },
  });

  if (!sample) {
    throw new NotFoundError('Sample order');
  }

  const updated = await prisma.sampleOrder.update({
    where: { id: sampleId },
    data: { status: SAMPLE_STATUS.APPROVED },
    include: {
      product: { select: { name: true } },
    },
  });

  // Notify buyer
  emitToBusiness(sample.businessId, 'sample:approved', {
    sampleId,
    sampleNumber: sample.sampleNumber,
    productName: updated.product.name,
  });

  logger.info('Sample approved', { sampleId, sellerId });

  return updated;
};

/**
 * Reject sample request (seller)
 */
const rejectSample = async (sellerId, sampleId, reason) => {
  const sample = await prisma.sampleOrder.findFirst({
    where: { id: sampleId, sellerId, status: SAMPLE_STATUS.REQUESTED },
  });

  if (!sample) {
    throw new NotFoundError('Sample order');
  }

  const updated = await prisma.sampleOrder.update({
    where: { id: sampleId },
    data: {
      status: SAMPLE_STATUS.REJECTED,
      feedback: reason,
    },
  });

  // Notify buyer
  emitToBusiness(sample.businessId, 'sample:rejected', {
    sampleId,
    sampleNumber: sample.sampleNumber,
    reason,
  });

  logger.info('Sample rejected', { sampleId, sellerId, reason });

  return updated;
};

/**
 * Mark sample as shipped (seller)
 */
const markAsShipped = async (sellerId, sampleId, trackingInfo) => {
  const sample = await prisma.sampleOrder.findFirst({
    where: { id: sampleId, sellerId, status: SAMPLE_STATUS.APPROVED },
  });

  if (!sample) {
    throw new NotFoundError('Sample order');
  }

  const updated = await prisma.sampleOrder.update({
    where: { id: sampleId },
    data: {
      status: SAMPLE_STATUS.SHIPPED,
      trackingNumber: trackingInfo.trackingNumber,
      shippedAt: new Date(),
    },
  });

  // Notify buyer
  emitToBusiness(sample.businessId, 'sample:shipped', {
    sampleId,
    sampleNumber: sample.sampleNumber,
    trackingNumber: trackingInfo.trackingNumber,
  });

  logger.info('Sample shipped', { sampleId, trackingNumber: trackingInfo.trackingNumber });

  return updated;
};

/**
 * Confirm delivery (buyer)
 */
const confirmDelivery = async (userId, sampleId) => {
  const sample = await prisma.sampleOrder.findFirst({
    where: { id: sampleId, userId, status: SAMPLE_STATUS.SHIPPED },
  });

  if (!sample) {
    throw new NotFoundError('Sample order');
  }

  const updated = await prisma.sampleOrder.update({
    where: { id: sampleId },
    data: {
      status: SAMPLE_STATUS.FEEDBACK_PENDING,
      deliveredAt: new Date(),
    },
  });

  logger.info('Sample delivery confirmed', { sampleId, userId });

  return updated;
};

/**
 * Submit feedback (buyer)
 */
const submitFeedback = async (userId, sampleId, feedbackData) => {
  const sample = await prisma.sampleOrder.findFirst({
    where: {
      id: sampleId,
      userId,
      status: { in: [SAMPLE_STATUS.DELIVERED, SAMPLE_STATUS.FEEDBACK_PENDING] },
    },
  });

  if (!sample) {
    throw new NotFoundError('Sample order');
  }

  const { rating, feedback, intendToPurchase } = feedbackData;

  const updated = await prisma.sampleOrder.update({
    where: { id: sampleId },
    data: {
      status: SAMPLE_STATUS.COMPLETED,
      rating,
      feedback,
      followUpOrderId: intendToPurchase ? 'PENDING' : null,
    },
  });

  // Notify seller
  emitToBusiness(sample.sellerId, 'sample:feedback', {
    sampleId,
    sampleNumber: sample.sampleNumber,
    rating,
    intendToPurchase,
  });

  logger.info('Sample feedback submitted', { sampleId, rating, intendToPurchase });

  return updated;
};

/**
 * Cancel sample request
 */
const cancelSample = async (userId, sampleId, reason) => {
  const sample = await prisma.sampleOrder.findFirst({
    where: {
      id: sampleId,
      userId,
      status: { in: [SAMPLE_STATUS.REQUESTED, SAMPLE_STATUS.APPROVED] },
    },
  });

  if (!sample) {
    throw new NotFoundError('Sample order');
  }

  const updated = await prisma.sampleOrder.update({
    where: { id: sampleId },
    data: {
      status: SAMPLE_STATUS.CANCELLED,
      feedback: reason,
    },
  });

  // Notify seller
  emitToBusiness(sample.sellerId, 'sample:cancelled', {
    sampleId,
    sampleNumber: sample.sampleNumber,
    reason,
  });

  logger.info('Sample cancelled', { sampleId, userId, reason });

  return updated;
};

/**
 * Get sample statistics
 */
const getSampleStats = async (businessId, isSeller = false) => {
  const where = isSeller ? { sellerId: businessId } : { businessId };

  const [requested, approved, shipped, completed] = await Promise.all([
    prisma.sampleOrder.count({ where: { ...where, status: SAMPLE_STATUS.REQUESTED } }),
    prisma.sampleOrder.count({ where: { ...where, status: SAMPLE_STATUS.APPROVED } }),
    prisma.sampleOrder.count({ where: { ...where, status: SAMPLE_STATUS.SHIPPED } }),
    prisma.sampleOrder.count({ where: { ...where, status: SAMPLE_STATUS.COMPLETED } }),
  ]);

  // For sellers, also get conversion rate
  let conversionRate = 0;
  if (isSeller) {
    const completedWithPurchase = await prisma.sampleOrder.count({
      where: {
        ...where,
        status: SAMPLE_STATUS.COMPLETED,
        followUpOrderId: { not: null },
      },
    });
    conversionRate = completed > 0 ? (completedWithPurchase / completed) * 100 : 0;
  }

  return {
    requested,
    approved,
    shipped,
    completed,
    total: requested + approved + shipped + completed,
    conversionRate: conversionRate.toFixed(1),
  };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  SAMPLE_PURPOSE,
  SAMPLE_STATUS,
  requestSample,
  getBuyerSamples,
  getSellerSamples,
  getSampleById,
  approveSample,
  rejectSample,
  markAsShipped,
  confirmDelivery,
  submitFeedback,
  cancelSample,
  getSampleStats,
};



