// =============================================================================
// AIRAVAT B2B MARKETPLACE - RFQ CONTROLLER
// =============================================================================

const { prisma } = require('../config/database');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, created, paginated } = require('../utils/response');
const { parsePagination, generateRFQNumber, generateQuotationNumber } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

/**
 * Get my RFQs (as buyer)
 * GET /api/v1/rfq/my-rfqs
 */
exports.getMyRFQs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status } = req.query;
  
  const where = {
    buyerId: req.business.id,
    ...(status && { status }),
  };
  
  const [rfqs, total] = await Promise.all([
    prisma.rFQ.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        _count: { select: { quotations: true } },
      },
    }),
    prisma.rFQ.count({ where }),
  ]);
  
  paginated(res, rfqs, { page, limit, total });
});

/**
 * Get available RFQs for quoting (seller)
 * GET /api/v1/rfq/seller/available
 */
exports.getAvailableRFQs = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { category } = req.query;
  
  // Get seller's categories
  const business = await prisma.business.findUnique({
    where: { id: req.business.id },
    include: {
      categories: { select: { categoryId: true } },
    },
  });
  
  const categoryIds = business?.categories.map((c) => c.categoryId) || [];
  
  const where = {
    status: 'OPEN',
    expiresAt: { gt: new Date() },
    buyerId: { not: req.business.id }, // Can't quote own RFQ
    // Match seller's categories
    OR: [
      { categoryId: { in: categoryIds } },
      { categoryId: null },
    ],
    // Haven't already quoted
    quotations: {
      none: { sellerId: req.business.id },
    },
  };
  
  if (category) {
    where.categoryId = category;
  }
  
  const [rfqs, total] = await Promise.all([
    prisma.rFQ.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        items: true,
        buyer: {
          select: { id: true, businessName: true, city: true, state: true, verificationStatus: true },
        },
        category: { select: { id: true, name: true } },
      },
    }),
    prisma.rFQ.count({ where }),
  ]);
  
  paginated(res, rfqs, { page, limit, total });
});

/**
 * Create RFQ
 * POST /api/v1/rfq
 */
exports.create = asyncHandler(async (req, res) => {
  const {
    title,
    description,
    categoryId,
    items,
    deliveryLocation,
    requiredBy,
    expiresAt,
    attachments,
    isPrivate,
    invitedSellers,
  } = req.body;
  
  if (!title || !items || items.length === 0) {
    throw new BadRequestError('Title and items are required');
  }
  
  const rfq = await prisma.rFQ.create({
    data: {
      rfqNumber: generateRFQNumber(),
      buyerId: req.business.id,
      title,
      description,
      categoryId,
      deliveryLocation,
      requiredBy: requiredBy ? new Date(requiredBy) : null,
      expiresAt: expiresAt ? new Date(expiresAt) : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000), // 14 days default
      attachments: attachments || [],
      isPrivate: isPrivate || false,
      status: 'DRAFT',
      items: {
        create: items.map((item, index) => ({
          productName: item.productName,
          description: item.description,
          quantity: item.quantity,
          unit: item.unit,
          specifications: item.specifications || {},
          targetPrice: item.targetPrice,
          displayOrder: index,
        })),
      },
    },
    include: { items: true },
  });
  
  // Invite specific sellers if private RFQ
  if (isPrivate && invitedSellers?.length > 0) {
    await prisma.rFQInvitation.createMany({
      data: invitedSellers.map((sellerId) => ({
        rfqId: rfq.id,
        sellerId,
      })),
    });
  }
  
  created(res, { rfq }, 'RFQ created');
});

/**
 * Get RFQ by ID
 * GET /api/v1/rfq/:rfqId
 */
exports.getById = asyncHandler(async (req, res) => {
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.rfqId },
    include: {
      items: { orderBy: { displayOrder: 'asc' } },
      buyer: {
        select: { id: true, businessName: true, city: true, state: true, verificationStatus: true },
      },
      category: true,
      _count: { select: { quotations: true } },
    },
  });
  
  if (!rfq) {
    throw new NotFoundError('RFQ');
  }
  
  // Check access
  const isOwner = rfq.buyerId === req.business.id;
  const isInvited = rfq.isPrivate 
    ? await prisma.rFQInvitation.findFirst({
        where: { rfqId: rfq.id, sellerId: req.business.id },
      })
    : true;
  
  if (!isOwner && !isInvited && rfq.status !== 'OPEN') {
    throw new ForbiddenError('Access denied');
  }
  
  success(res, { rfq, isOwner });
});

/**
 * Update RFQ
 * PATCH /api/v1/rfq/:rfqId
 */
exports.update = asyncHandler(async (req, res) => {
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.rfqId },
  });
  
  if (!rfq || rfq.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  if (rfq.status !== 'DRAFT') {
    throw new BadRequestError('Can only update draft RFQs');
  }
  
  const updatedRFQ = await prisma.rFQ.update({
    where: { id: req.params.rfqId },
    data: {
      title: req.body.title,
      description: req.body.description,
      categoryId: req.body.categoryId,
      deliveryLocation: req.body.deliveryLocation,
      requiredBy: req.body.requiredBy ? new Date(req.body.requiredBy) : undefined,
      expiresAt: req.body.expiresAt ? new Date(req.body.expiresAt) : undefined,
      attachments: req.body.attachments,
    },
    include: { items: true },
  });
  
  success(res, { rfq: updatedRFQ }, 'RFQ updated');
});

/**
 * Submit RFQ
 * POST /api/v1/rfq/:rfqId/submit
 */
exports.submit = asyncHandler(async (req, res) => {
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.rfqId },
    include: { items: true },
  });
  
  if (!rfq || rfq.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  if (rfq.status !== 'DRAFT') {
    throw new BadRequestError('RFQ is already submitted');
  }
  
  if (rfq.items.length === 0) {
    throw new BadRequestError('RFQ must have at least one item');
  }
  
  const updatedRFQ = await prisma.rFQ.update({
    where: { id: req.params.rfqId },
    data: {
      status: 'OPEN',
      submittedAt: new Date(),
    },
    include: { items: true },
  });
  
  // TODO: Notify matching sellers
  
  success(res, { rfq: updatedRFQ }, 'RFQ submitted');
});

/**
 * Cancel RFQ
 * POST /api/v1/rfq/:rfqId/cancel
 */
exports.cancel = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.rfqId },
  });
  
  if (!rfq || rfq.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  if (!['DRAFT', 'OPEN'].includes(rfq.status)) {
    throw new BadRequestError('Cannot cancel this RFQ');
  }
  
  const updatedRFQ = await prisma.rFQ.update({
    where: { id: req.params.rfqId },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
      cancelReason: reason,
    },
  });
  
  success(res, { rfq: updatedRFQ }, 'RFQ cancelled');
});

/**
 * Close RFQ
 * POST /api/v1/rfq/:rfqId/close
 */
exports.close = asyncHandler(async (req, res) => {
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.rfqId },
  });
  
  if (!rfq || rfq.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const updatedRFQ = await prisma.rFQ.update({
    where: { id: req.params.rfqId },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
    },
  });
  
  success(res, { rfq: updatedRFQ }, 'RFQ closed');
});

/**
 * Get quotations for RFQ
 * GET /api/v1/rfq/:rfqId/quotations
 */
exports.getQuotations = asyncHandler(async (req, res) => {
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.rfqId },
  });
  
  if (!rfq || rfq.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const quotations = await prisma.quotation.findMany({
    where: { rfqId: req.params.rfqId },
    include: {
      seller: {
        select: { id: true, businessName: true, city: true, averageRating: true, verificationStatus: true },
      },
      items: true,
    },
    orderBy: { totalAmount: 'asc' },
  });
  
  success(res, { quotations });
});

/**
 * Accept quotation
 * POST /api/v1/rfq/:rfqId/quotations/:quotationId/accept
 */
exports.acceptQuotation = asyncHandler(async (req, res) => {
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.rfqId },
  });
  
  if (!rfq || rfq.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const quotation = await prisma.quotation.findUnique({
    where: { id: req.params.quotationId },
  });
  
  if (!quotation || quotation.rfqId !== rfq.id) {
    throw new NotFoundError('Quotation');
  }
  
  await prisma.$transaction(async (tx) => {
    // Accept this quotation
    await tx.quotation.update({
      where: { id: req.params.quotationId },
      data: { status: 'ACCEPTED', acceptedAt: new Date() },
    });
    
    // Reject other quotations
    await tx.quotation.updateMany({
      where: {
        rfqId: rfq.id,
        id: { not: req.params.quotationId },
        status: 'SUBMITTED',
      },
      data: { status: 'REJECTED' },
    });
    
    // Close RFQ
    await tx.rFQ.update({
      where: { id: rfq.id },
      data: { status: 'AWARDED', awardedTo: quotation.sellerId },
    });
  });
  
  // TODO: Notify seller
  
  success(res, null, 'Quotation accepted');
});

/**
 * Reject quotation
 * POST /api/v1/rfq/:rfqId/quotations/:quotationId/reject
 */
exports.rejectQuotation = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.rfqId },
  });
  
  if (!rfq || rfq.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  await prisma.quotation.update({
    where: { id: req.params.quotationId },
    data: {
      status: 'REJECTED',
      rejectionReason: reason,
    },
  });
  
  success(res, null, 'Quotation rejected');
});

/**
 * Counter-offer quotation
 * POST /api/v1/rfq/:rfqId/quotations/:quotationId/counter
 */
exports.counterOffer = asyncHandler(async (req, res) => {
  const { items, message, expiresAt } = req.body;
  
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.rfqId },
  });
  
  if (!rfq || rfq.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const quotation = await prisma.quotation.update({
    where: { id: req.params.quotationId },
    data: {
      status: 'COUNTER_OFFERED',
      counterOffer: {
        items,
        message,
        expiresAt,
        createdAt: new Date(),
      },
    },
  });
  
  // TODO: Notify seller
  
  success(res, { quotation }, 'Counter-offer sent');
});

/**
 * Get my quotations (as seller)
 * GET /api/v1/rfq/seller/quotations
 */
exports.getMyQuotations = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status } = req.query;
  
  const where = {
    sellerId: req.business.id,
    ...(status && { status }),
  };
  
  const [quotations, total] = await Promise.all([
    prisma.quotation.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        rfq: {
          include: {
            buyer: { select: { id: true, businessName: true, city: true } },
          },
        },
        items: true,
      },
    }),
    prisma.quotation.count({ where }),
  ]);
  
  paginated(res, quotations, { page, limit, total });
});

/**
 * Create quotation for RFQ
 * POST /api/v1/rfq/:rfqId/quote
 */
exports.createQuotation = asyncHandler(async (req, res) => {
  const { items, validUntil, deliveryDays, terms, notes, attachments } = req.body;
  
  if (!items || items.length === 0) {
    throw new BadRequestError('Items are required');
  }
  
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.rfqId },
    include: { items: true },
  });
  
  if (!rfq) {
    throw new NotFoundError('RFQ');
  }
  
  if (rfq.status !== 'OPEN') {
    throw new BadRequestError('RFQ is not open for quotations');
  }
  
  if (rfq.buyerId === req.business.id) {
    throw new BadRequestError('Cannot quote on your own RFQ');
  }
  
  // Check if already quoted
  const existingQuote = await prisma.quotation.findFirst({
    where: { rfqId: rfq.id, sellerId: req.business.id },
  });
  
  if (existingQuote) {
    throw new BadRequestError('You have already submitted a quotation');
  }
  
  // Calculate totals
  let totalAmount = 0;
  const quotationItems = items.map((item) => {
    const lineTotal = item.unitPrice * item.quantity;
    totalAmount += lineTotal;
    return {
      rfqItemId: item.rfqItemId,
      productName: item.productName,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      lineTotal,
      notes: item.notes,
    };
  });
  
  const quotation = await prisma.quotation.create({
    data: {
      quotationNumber: generateQuotationNumber(),
      rfqId: rfq.id,
      sellerId: req.business.id,
      totalAmount,
      validUntil: validUntil ? new Date(validUntil) : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
      deliveryDays,
      terms,
      notes,
      attachments: attachments || [],
      status: 'DRAFT',
      items: {
        create: quotationItems,
      },
    },
    include: { items: true },
  });
  
  created(res, { quotation }, 'Quotation created');
});

/**
 * Get quotation by ID
 * GET /api/v1/rfq/quotations/:quotationId
 */
exports.getQuotationById = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: req.params.quotationId },
    include: {
      rfq: {
        include: {
          buyer: { select: { id: true, businessName: true, city: true } },
          items: true,
        },
      },
      seller: { select: { id: true, businessName: true, city: true } },
      items: true,
    },
  });
  
  if (!quotation) {
    throw new NotFoundError('Quotation');
  }
  
  // Check access
  if (quotation.sellerId !== req.business.id && quotation.rfq.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  success(res, { quotation });
});

/**
 * Update quotation
 * PATCH /api/v1/rfq/quotations/:quotationId
 */
exports.updateQuotation = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: req.params.quotationId },
  });
  
  if (!quotation || quotation.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  if (quotation.status !== 'DRAFT') {
    throw new BadRequestError('Can only update draft quotations');
  }
  
  const updatedQuotation = await prisma.quotation.update({
    where: { id: req.params.quotationId },
    data: {
      validUntil: req.body.validUntil ? new Date(req.body.validUntil) : undefined,
      deliveryDays: req.body.deliveryDays,
      terms: req.body.terms,
      notes: req.body.notes,
      attachments: req.body.attachments,
    },
    include: { items: true },
  });
  
  success(res, { quotation: updatedQuotation }, 'Quotation updated');
});

/**
 * Submit quotation
 * POST /api/v1/rfq/quotations/:quotationId/submit
 */
exports.submitQuotation = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: req.params.quotationId },
    include: { items: true },
  });
  
  if (!quotation || quotation.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  if (quotation.status !== 'DRAFT') {
    throw new BadRequestError('Quotation is already submitted');
  }
  
  if (quotation.items.length === 0) {
    throw new BadRequestError('Quotation must have items');
  }
  
  const updatedQuotation = await prisma.quotation.update({
    where: { id: req.params.quotationId },
    data: {
      status: 'SUBMITTED',
      submittedAt: new Date(),
    },
  });
  
  // TODO: Notify buyer
  
  success(res, { quotation: updatedQuotation }, 'Quotation submitted');
});

/**
 * Withdraw quotation
 * POST /api/v1/rfq/quotations/:quotationId/withdraw
 */
exports.withdrawQuotation = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: req.params.quotationId },
  });
  
  if (!quotation || quotation.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  if (!['DRAFT', 'SUBMITTED'].includes(quotation.status)) {
    throw new BadRequestError('Cannot withdraw this quotation');
  }
  
  await prisma.quotation.update({
    where: { id: req.params.quotationId },
    data: { status: 'WITHDRAWN' },
  });
  
  success(res, null, 'Quotation withdrawn');
});

/**
 * Revise quotation
 * POST /api/v1/rfq/quotations/:quotationId/revise
 */
exports.reviseQuotation = asyncHandler(async (req, res) => {
  const quotation = await prisma.quotation.findUnique({
    where: { id: req.params.quotationId },
    include: { items: true },
  });
  
  if (!quotation || quotation.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  // Create new revision
  const newQuotation = await prisma.quotation.create({
    data: {
      quotationNumber: generateQuotationNumber(),
      rfqId: quotation.rfqId,
      sellerId: req.business.id,
      totalAmount: quotation.totalAmount,
      validUntil: quotation.validUntil,
      deliveryDays: quotation.deliveryDays,
      terms: quotation.terms,
      notes: req.body.notes || quotation.notes,
      attachments: quotation.attachments,
      status: 'DRAFT',
      version: quotation.version + 1,
      previousVersionId: quotation.id,
      items: {
        create: quotation.items.map((item) => ({
          rfqItemId: item.rfqItemId,
          productName: item.productName,
          quantity: item.quantity,
          unit: item.unit,
          unitPrice: item.unitPrice,
          lineTotal: item.lineTotal,
          notes: item.notes,
        })),
      },
    },
    include: { items: true },
  });
  
  // Mark old quotation as superseded
  await prisma.quotation.update({
    where: { id: quotation.id },
    data: { status: 'SUPERSEDED' },
  });
  
  created(res, { quotation: newQuotation }, 'New revision created');
});

/**
 * Add item to RFQ
 * POST /api/v1/rfq/:rfqId/items
 */
exports.addItem = asyncHandler(async (req, res) => {
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.rfqId },
    include: { items: true },
  });
  
  if (!rfq || rfq.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  if (rfq.status !== 'DRAFT') {
    throw new BadRequestError('Can only add items to draft RFQs');
  }
  
  const item = await prisma.rFQItem.create({
    data: {
      rfqId: rfq.id,
      productName: req.body.productName,
      description: req.body.description,
      quantity: req.body.quantity,
      unit: req.body.unit,
      specifications: req.body.specifications || {},
      targetPrice: req.body.targetPrice,
      displayOrder: rfq.items.length,
    },
  });
  
  created(res, { item }, 'Item added');
});

/**
 * Update RFQ item
 * PATCH /api/v1/rfq/:rfqId/items/:itemId
 */
exports.updateItem = asyncHandler(async (req, res) => {
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.rfqId },
  });
  
  if (!rfq || rfq.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  if (rfq.status !== 'DRAFT') {
    throw new BadRequestError('Can only update items in draft RFQs');
  }
  
  const item = await prisma.rFQItem.update({
    where: { id: req.params.itemId },
    data: {
      productName: req.body.productName,
      description: req.body.description,
      quantity: req.body.quantity,
      unit: req.body.unit,
      specifications: req.body.specifications,
      targetPrice: req.body.targetPrice,
    },
  });
  
  success(res, { item }, 'Item updated');
});

/**
 * Remove RFQ item
 * DELETE /api/v1/rfq/:rfqId/items/:itemId
 */
exports.removeItem = asyncHandler(async (req, res) => {
  const rfq = await prisma.rFQ.findUnique({
    where: { id: req.params.rfqId },
  });
  
  if (!rfq || rfq.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  if (rfq.status !== 'DRAFT') {
    throw new BadRequestError('Can only remove items from draft RFQs');
  }
  
  await prisma.rFQItem.delete({
    where: { id: req.params.itemId },
  });
  
  success(res, null, 'Item removed');
});

/**
 * Get RFQ stats
 * GET /api/v1/rfq/stats/overview
 */
exports.getStats = asyncHandler(async (req, res) => {
  const businessId = req.business.id;
  
  const [buyerStats, sellerStats] = await Promise.all([
    // As buyer
    prisma.rFQ.groupBy({
      by: ['status'],
      where: { buyerId: businessId },
      _count: true,
    }),
    // As seller
    prisma.quotation.groupBy({
      by: ['status'],
      where: { sellerId: businessId },
      _count: true,
    }),
  ]);
  
  success(res, {
    asbuyer: buyerStats,
    asSeller: sellerStats,
  });
});
