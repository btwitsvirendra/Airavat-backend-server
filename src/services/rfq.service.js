/**
 * RFQ (Request for Quotation) Service
 * Handles RFQ creation, quotation management, and negotiation workflow
 */

const prisma = require('../config/database');
const { cache } = require('../config/redis');
const { 
  NotFoundError, 
  BadRequestError, 
  ForbiddenError,
  ConflictError 
} = require('../utils/errors');
const { 
  generateRFQNumber, 
  generateQuotationNumber,
  parsePagination,
  buildPaginationMeta 
} = require('../utils/helpers');
const logger = require('../config/logger');
const emailService = require('./email.service');

class RFQService {
  /**
   * Create new RFQ
   */
  async createRFQ(buyerBusinessId, data, userId) {
    const {
      title,
      description,
      categoryIds,
      items,
      targetSellerIds,
      isOpenRFQ,
      deliveryPincode,
      deliveryCity,
      deliveryState,
      requiredByDate,
      paymentTerms,
      attachments,
      deadline,
    } = data;

    // Validate buyer business
    const buyerBusiness = await prisma.business.findUnique({
      where: { id: buyerBusinessId },
      select: { id: true, status: true, legalName: true },
    });

    if (!buyerBusiness || buyerBusiness.status !== 'VERIFIED') {
      throw new ForbiddenError('Only verified businesses can create RFQs');
    }

    // Validate items
    if (!items || items.length === 0) {
      throw new BadRequestError('At least one item is required');
    }

    // Validate target sellers if not open RFQ
    if (!isOpenRFQ && targetSellerIds?.length > 0) {
      const sellers = await prisma.business.findMany({
        where: {
          id: { in: targetSellerIds },
          status: 'VERIFIED',
        },
      });

      if (sellers.length !== targetSellerIds.length) {
        throw new BadRequestError('Some target sellers are invalid or not verified');
      }
    }

    // Generate RFQ number
    const rfqNumber = generateRFQNumber();

    // Set expiry date (default 7 days from deadline or 14 days if no deadline)
    const expiresAt = deadline 
      ? new Date(new Date(deadline).getTime() + 7 * 24 * 60 * 60 * 1000)
      : new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);

    // Create RFQ with items in transaction
    const rfq = await prisma.$transaction(async (tx) => {
      const newRFQ = await tx.rFQ.create({
        data: {
          rfqNumber,
          buyerBusinessId,
          title,
          description,
          categoryIds: categoryIds || [],
          isOpenRFQ: isOpenRFQ || false,
          deliveryPincode,
          deliveryCity,
          deliveryState,
          requiredByDate: requiredByDate ? new Date(requiredByDate) : null,
          paymentTerms,
          attachments: attachments || [],
          status: 'SUBMITTED',
          deadline: deadline ? new Date(deadline) : null,
          expiresAt,
        },
      });

      // Create RFQ items
      const rfqItems = await Promise.all(
        items.map((item, index) =>
          tx.rFQItem.create({
            data: {
              rfqId: newRFQ.id,
              productId: item.productId || null,
              title: item.title,
              specifications: item.specifications || {},
              quantity: item.quantity,
              unit: item.unit || 'pieces',
              targetPrice: item.targetPrice || null,
              maxPrice: item.maxPrice || null,
              attachments: item.attachments || [],
            },
          })
        )
      );

      // Link target sellers
      if (!isOpenRFQ && targetSellerIds?.length > 0) {
        await tx.rFQ.update({
          where: { id: newRFQ.id },
          data: {
            targetSellers: {
              connect: targetSellerIds.map((id) => ({ id })),
            },
          },
        });
      }

      return { ...newRFQ, items: rfqItems };
    });

    // Send notifications to sellers
    await this.notifySellerRFQ(rfq, isOpenRFQ, targetSellerIds, categoryIds);

    return rfq;
  }

  /**
   * Get RFQ by ID
   */
  async getRFQById(rfqId, userId, businessId) {
    const rfq = await prisma.rFQ.findUnique({
      where: { id: rfqId },
      include: {
        buyerBusiness: {
          select: {
            id: true,
            legalName: true,
            displayName: true,
            logo: true,
            city: true,
            state: true,
            averageRating: true,
          },
        },
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                images: true,
              },
            },
          },
        },
        targetSellers: {
          select: {
            id: true,
            legalName: true,
            displayName: true,
          },
        },
        quotations: businessId ? {
          where: {
            sellerBusinessId: businessId,
          },
        } : false,
        _count: {
          select: { quotations: true },
        },
      },
    });

    if (!rfq) {
      throw new NotFoundError('RFQ not found');
    }

    // Check access - buyer can see their RFQs, sellers can see if targeted or open
    const isBuyer = rfq.buyerBusinessId === businessId;
    const isTargetedSeller = rfq.targetSellers.some((s) => s.id === businessId);
    const isOpenRFQ = rfq.isOpenRFQ;

    if (!isBuyer && !isTargetedSeller && !isOpenRFQ) {
      throw new ForbiddenError('You do not have access to this RFQ');
    }

    // Increment view count if seller viewing
    if (!isBuyer) {
      await prisma.rFQ.update({
        where: { id: rfqId },
        data: { viewCount: { increment: 1 } },
      });
    }

    return rfq;
  }

  /**
   * List RFQs for buyer
   */
  async listBuyerRFQs(buyerBusinessId, filters = {}, pagination = {}) {
    const { page, limit, skip } = parsePagination(pagination);
    const { status, search } = filters;

    const where = {
      buyerBusinessId,
      ...(status && { status }),
      ...(search && {
        OR: [
          { title: { contains: search, mode: 'insensitive' } },
          { rfqNumber: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [rfqs, total] = await Promise.all([
      prisma.rFQ.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          items: {
            take: 3,
          },
          _count: {
            select: { quotations: true },
          },
        },
      }),
      prisma.rFQ.count({ where }),
    ]);

    return {
      rfqs,
      pagination: buildPaginationMeta(total, page, limit),
    };
  }

  /**
   * List RFQs for seller (open + targeted)
   */
  async listSellerRFQs(sellerBusinessId, filters = {}, pagination = {}) {
    const { page, limit, skip } = parsePagination(pagination);
    const { status, categoryId, hasQuoted } = filters;

    // Get seller's categories
    const sellerCategories = await prisma.businessCategory.findMany({
      where: { businessId: sellerBusinessId },
      select: { categoryId: true },
    });
    const categoryIds = sellerCategories.map((c) => c.categoryId);

    // Build where clause for RFQs accessible to seller
    const where = {
      status: { in: ['SUBMITTED', 'OPEN', 'QUOTED', 'NEGOTIATION'] },
      OR: [
        { isOpenRFQ: true },
        { targetSellers: { some: { id: sellerBusinessId } } },
      ],
      // Filter by category if seller has categories
      ...(categoryIds.length > 0 && {
        categoryIds: { hasSome: categoryIds },
      }),
      ...(status && { status }),
      ...(categoryId && { categoryIds: { has: categoryId } }),
    };

    // Filter by quoted status
    if (hasQuoted !== undefined) {
      where.quotations = hasQuoted
        ? { some: { sellerBusinessId } }
        : { none: { sellerBusinessId } };
    }

    const [rfqs, total] = await Promise.all([
      prisma.rFQ.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          buyerBusiness: {
            select: {
              id: true,
              legalName: true,
              displayName: true,
              city: true,
              state: true,
            },
          },
          items: {
            take: 3,
          },
          quotations: {
            where: { sellerBusinessId },
            select: {
              id: true,
              status: true,
              totalAmount: true,
            },
          },
          _count: {
            select: { quotations: true },
          },
        },
      }),
      prisma.rFQ.count({ where }),
    ]);

    return {
      rfqs,
      pagination: buildPaginationMeta(total, page, limit),
    };
  }

  /**
   * Submit quotation for RFQ
   */
  async submitQuotation(rfqId, sellerBusinessId, data, userId) {
    const {
      items,
      paymentTerms,
      deliveryTerms,
      validityDays,
      estimatedDeliveryDays,
      notes,
      termsAndConditions,
      attachments,
    } = data;

    // Validate RFQ
    const rfq = await prisma.rFQ.findUnique({
      where: { id: rfqId },
      include: {
        items: true,
        targetSellers: { select: { id: true } },
      },
    });

    if (!rfq) {
      throw new NotFoundError('RFQ not found');
    }

    // Check if RFQ is still open
    if (!['SUBMITTED', 'OPEN', 'QUOTED'].includes(rfq.status)) {
      throw new BadRequestError('This RFQ is no longer accepting quotations');
    }

    // Check if RFQ expired
    if (rfq.expiresAt && new Date(rfq.expiresAt) < new Date()) {
      throw new BadRequestError('This RFQ has expired');
    }

    // Check seller eligibility
    const isTrustSellersTargeted = rfq.targetSellers.some((s) => s.id === sellerBusinessId);
    if (!rfq.isOpenRFQ && !isTrustSellersTargeted) {
      throw new ForbiddenError('You are not eligible to quote on this RFQ');
    }

    // Check for existing quotation
    const existingQuotation = await prisma.quotation.findFirst({
      where: {
        rfqId,
        sellerBusinessId,
        status: { notIn: ['REJECTED', 'EXPIRED'] },
      },
    });

    if (existingQuotation) {
      throw new ConflictError('You have already submitted a quotation for this RFQ');
    }

    // Validate seller business
    const sellerBusiness = await prisma.business.findUnique({
      where: { id: sellerBusinessId },
      select: { status: true },
    });

    if (!sellerBusiness || sellerBusiness.status !== 'VERIFIED') {
      throw new ForbiddenError('Only verified businesses can submit quotations');
    }

    // Calculate totals
    let subtotal = 0;
    let totalTax = 0;

    const quotationItems = items.map((item) => {
      const rfqItem = rfq.items.find((ri) => ri.id === item.rfqItemId);
      if (!rfqItem) {
        throw new BadRequestError(`Invalid RFQ item: ${item.rfqItemId}`);
      }

      const itemTotal = item.quantity * item.unitPrice;
      const itemTax = itemTotal * (item.taxRate || 18) / 100;
      
      subtotal += itemTotal;
      totalTax += itemTax;

      return {
        rfqItemId: item.rfqItemId,
        specifications: item.specifications || rfqItem.specifications,
        quantity: item.quantity,
        unit: item.unit || rfqItem.unit,
        unitPrice: item.unitPrice,
        taxRate: item.taxRate || 18,
        taxAmount: itemTax,
        totalAmount: itemTotal + itemTax,
        leadTimeDays: item.leadTimeDays,
      };
    });

    const shippingCost = data.shippingCost || 0;
    const discount = data.discount || 0;
    const totalAmount = subtotal + totalTax + shippingCost - discount;

    // Generate quotation number
    const quotationNumber = generateQuotationNumber();

    // Create quotation
    const quotation = await prisma.$transaction(async (tx) => {
      const newQuotation = await tx.quotation.create({
        data: {
          quotationNumber,
          rfqId,
          sellerBusinessId,
          buyerBusinessId: rfq.buyerBusinessId,
          status: 'SUBMITTED',
          subtotal,
          taxAmount: totalTax,
          shippingCost,
          discount,
          totalAmount,
          paymentTerms,
          deliveryTerms,
          validityDays: validityDays || 7,
          estimatedDeliveryDays,
          notes,
          termsAndConditions,
          attachments: attachments || [],
          submittedAt: new Date(),
        },
      });

      // Create quotation items
      await tx.quotationItem.createMany({
        data: quotationItems.map((item) => ({
          ...item,
          quotationId: newQuotation.id,
        })),
      });

      // Update RFQ status and count
      await tx.rFQ.update({
        where: { id: rfqId },
        data: {
          status: 'QUOTED',
          quotationCount: { increment: 1 },
        },
      });

      return newQuotation;
    });

    // Notify buyer
    await this.notifyBuyerQuotation(quotation, rfq);

    return quotation;
  }

  /**
   * Get quotation by ID
   */
  async getQuotationById(quotationId, businessId) {
    const quotation = await prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        sellerBusiness: {
          select: {
            id: true,
            legalName: true,
            displayName: true,
            logo: true,
            city: true,
            state: true,
            averageRating: true,
            responseRate: true,
          },
        },
        buyerBusiness: {
          select: {
            id: true,
            legalName: true,
            displayName: true,
          },
        },
        rfq: {
          select: {
            id: true,
            rfqNumber: true,
            title: true,
          },
        },
        items: {
          include: {
            rfqItem: true,
          },
        },
        parentQuotation: true,
        counterOffers: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    });

    if (!quotation) {
      throw new NotFoundError('Quotation not found');
    }

    // Check access
    if (quotation.sellerBusinessId !== businessId && quotation.buyerBusinessId !== businessId) {
      throw new ForbiddenError('You do not have access to this quotation');
    }

    // Mark as viewed if buyer viewing for first time
    if (quotation.buyerBusinessId === businessId && !quotation.viewedAt) {
      await prisma.quotation.update({
        where: { id: quotationId },
        data: {
          status: quotation.status === 'SUBMITTED' ? 'VIEWED' : quotation.status,
          viewedAt: new Date(),
        },
      });
    }

    return quotation;
  }

  /**
   * List quotations for an RFQ (buyer view)
   */
  async listRFQQuotations(rfqId, buyerBusinessId, pagination = {}) {
    const { page, limit, skip } = parsePagination(pagination);

    // Verify buyer owns the RFQ
    const rfq = await prisma.rFQ.findUnique({
      where: { id: rfqId },
      select: { buyerBusinessId: true },
    });

    if (!rfq || rfq.buyerBusinessId !== buyerBusinessId) {
      throw new ForbiddenError('You do not have access to this RFQ');
    }

    const where = {
      rfqId,
      parentQuotationId: null, // Only root quotations
    };

    const [quotations, total] = await Promise.all([
      prisma.quotation.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          sellerBusiness: {
            select: {
              id: true,
              legalName: true,
              displayName: true,
              logo: true,
              city: true,
              state: true,
              averageRating: true,
            },
          },
          items: true,
          _count: {
            select: { counterOffers: true },
          },
        },
      }),
      prisma.quotation.count({ where }),
    ]);

    return {
      quotations,
      pagination: buildPaginationMeta(total, page, limit),
    };
  }

  /**
   * Accept quotation
   */
  async acceptQuotation(quotationId, buyerBusinessId, userId) {
    const quotation = await prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        rfq: true,
        items: true,
      },
    });

    if (!quotation) {
      throw new NotFoundError('Quotation not found');
    }

    if (quotation.buyerBusinessId !== buyerBusinessId) {
      throw new ForbiddenError('You can only accept quotations for your own RFQs');
    }

    if (!['SUBMITTED', 'VIEWED', 'COUNTER_OFFERED', 'REVISED'].includes(quotation.status)) {
      throw new BadRequestError('This quotation cannot be accepted');
    }

    // Check validity
    const validUntil = new Date(quotation.submittedAt);
    validUntil.setDate(validUntil.getDate() + quotation.validityDays);
    
    if (new Date() > validUntil) {
      throw new BadRequestError('This quotation has expired');
    }

    // Update quotation and RFQ in transaction
    const result = await prisma.$transaction(async (tx) => {
      // Accept this quotation
      const accepted = await tx.quotation.update({
        where: { id: quotationId },
        data: {
          status: 'ACCEPTED',
          acceptedAt: new Date(),
        },
      });

      // Reject other quotations for same RFQ
      await tx.quotation.updateMany({
        where: {
          rfqId: quotation.rfqId,
          id: { not: quotationId },
          status: { notIn: ['REJECTED', 'EXPIRED'] },
        },
        data: {
          status: 'REJECTED',
          rejectedAt: new Date(),
        },
      });

      // Update RFQ status
      await tx.rFQ.update({
        where: { id: quotation.rfqId },
        data: { status: 'ACCEPTED' },
      });

      return accepted;
    });

    // Notify seller
    await this.notifySellerQuotationAccepted(quotation);

    return result;
  }

  /**
   * Reject quotation
   */
  async rejectQuotation(quotationId, buyerBusinessId, reason) {
    const quotation = await prisma.quotation.findUnique({
      where: { id: quotationId },
    });

    if (!quotation) {
      throw new NotFoundError('Quotation not found');
    }

    if (quotation.buyerBusinessId !== buyerBusinessId) {
      throw new ForbiddenError('You can only reject quotations for your own RFQs');
    }

    const updated = await prisma.quotation.update({
      where: { id: quotationId },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        notes: reason ? `Rejection reason: ${reason}` : quotation.notes,
      },
    });

    // Notify seller
    await this.notifySellerQuotationRejected(quotation, reason);

    return updated;
  }

  /**
   * Counter offer on quotation
   */
  async counterOffer(quotationId, buyerBusinessId, data) {
    const originalQuotation = await prisma.quotation.findUnique({
      where: { id: quotationId },
      include: { items: true, rfq: true },
    });

    if (!originalQuotation) {
      throw new NotFoundError('Quotation not found');
    }

    if (originalQuotation.buyerBusinessId !== buyerBusinessId) {
      throw new ForbiddenError('You can only counter-offer on your own RFQs');
    }

    // Create counter offer as new quotation
    const counterQuotation = await prisma.quotation.create({
      data: {
        quotationNumber: generateQuotationNumber(),
        rfqId: originalQuotation.rfqId,
        sellerBusinessId: originalQuotation.sellerBusinessId,
        buyerBusinessId,
        parentQuotationId: quotationId,
        status: 'COUNTER_OFFERED',
        subtotal: data.subtotal,
        taxAmount: data.taxAmount,
        shippingCost: data.shippingCost || 0,
        discount: data.discount || 0,
        totalAmount: data.totalAmount,
        paymentTerms: data.paymentTerms,
        deliveryTerms: data.deliveryTerms,
        validityDays: data.validityDays || 3,
        notes: data.notes,
        submittedAt: new Date(),
      },
    });

    // Update original quotation status
    await prisma.quotation.update({
      where: { id: quotationId },
      data: { status: 'COUNTER_OFFERED' },
    });

    // Update RFQ status
    await prisma.rFQ.update({
      where: { id: originalQuotation.rfqId },
      data: { status: 'NEGOTIATION' },
    });

    // Notify seller
    await this.notifySellerCounterOffer(counterQuotation, originalQuotation);

    return counterQuotation;
  }

  /**
   * Revise quotation (seller response to counter offer)
   */
  async reviseQuotation(quotationId, sellerBusinessId, data) {
    const originalQuotation = await prisma.quotation.findUnique({
      where: { id: quotationId },
    });

    if (!originalQuotation) {
      throw new NotFoundError('Quotation not found');
    }

    if (originalQuotation.sellerBusinessId !== sellerBusinessId) {
      throw new ForbiddenError('You can only revise your own quotations');
    }

    // Create revised quotation
    const revisedQuotation = await prisma.quotation.create({
      data: {
        quotationNumber: generateQuotationNumber(),
        rfqId: originalQuotation.rfqId,
        sellerBusinessId,
        buyerBusinessId: originalQuotation.buyerBusinessId,
        parentQuotationId: quotationId,
        status: 'REVISED',
        subtotal: data.subtotal,
        taxAmount: data.taxAmount,
        shippingCost: data.shippingCost || 0,
        discount: data.discount || 0,
        totalAmount: data.totalAmount,
        paymentTerms: data.paymentTerms,
        deliveryTerms: data.deliveryTerms,
        validityDays: data.validityDays || 3,
        estimatedDeliveryDays: data.estimatedDeliveryDays,
        notes: data.notes,
        termsAndConditions: data.termsAndConditions,
        submittedAt: new Date(),
      },
    });

    // Update original quotation status
    await prisma.quotation.update({
      where: { id: quotationId },
      data: { status: 'REVISED' },
    });

    return revisedQuotation;
  }

  /**
   * Create order from accepted quotation
   */
  async createOrderFromQuotation(quotationId, buyerBusinessId) {
    const quotation = await prisma.quotation.findUnique({
      where: { id: quotationId },
      include: {
        items: {
          include: { rfqItem: true },
        },
        rfq: true,
        sellerBusiness: true,
        buyerBusiness: true,
      },
    });

    if (!quotation) {
      throw new NotFoundError('Quotation not found');
    }

    if (quotation.status !== 'ACCEPTED') {
      throw new BadRequestError('Only accepted quotations can be converted to orders');
    }

    if (quotation.buyerBusinessId !== buyerBusinessId) {
      throw new ForbiddenError('You can only create orders from your own quotations');
    }

    // Import order service to avoid circular dependency
    const orderService = require('./order.service');
    
    // Create order
    const order = await orderService.createOrderFromQuotation(quotation);

    // Update RFQ status
    await prisma.rFQ.update({
      where: { id: quotation.rfqId },
      data: { status: 'ORDER_CREATED' },
    });

    return order;
  }

  /**
   * Cancel RFQ
   */
  async cancelRFQ(rfqId, buyerBusinessId, reason) {
    const rfq = await prisma.rFQ.findUnique({
      where: { id: rfqId },
    });

    if (!rfq) {
      throw new NotFoundError('RFQ not found');
    }

    if (rfq.buyerBusinessId !== buyerBusinessId) {
      throw new ForbiddenError('You can only cancel your own RFQs');
    }

    if (['ACCEPTED', 'ORDER_CREATED', 'CANCELLED'].includes(rfq.status)) {
      throw new BadRequestError('This RFQ cannot be cancelled');
    }

    const updated = await prisma.$transaction(async (tx) => {
      // Cancel RFQ
      const cancelledRFQ = await tx.rFQ.update({
        where: { id: rfqId },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
        },
      });

      // Expire all quotations
      await tx.quotation.updateMany({
        where: {
          rfqId,
          status: { notIn: ['REJECTED', 'EXPIRED'] },
        },
        data: { status: 'EXPIRED' },
      });

      return cancelledRFQ;
    });

    return updated;
  }

  /**
   * Extend RFQ deadline
   */
  async extendRFQDeadline(rfqId, buyerBusinessId, newDeadline) {
    const rfq = await prisma.rFQ.findUnique({
      where: { id: rfqId },
    });

    if (!rfq) {
      throw new NotFoundError('RFQ not found');
    }

    if (rfq.buyerBusinessId !== buyerBusinessId) {
      throw new ForbiddenError('You can only extend your own RFQs');
    }

    const newExpiresAt = new Date(new Date(newDeadline).getTime() + 7 * 24 * 60 * 60 * 1000);

    return prisma.rFQ.update({
      where: { id: rfqId },
      data: {
        deadline: new Date(newDeadline),
        expiresAt: newExpiresAt,
      },
    });
  }

  // Notification helpers

  async notifySellerRFQ(rfq, isOpenRFQ, targetSellerIds, categoryIds) {
    try {
      // For targeted RFQs, notify specific sellers
      if (!isOpenRFQ && targetSellerIds?.length > 0) {
        const sellers = await prisma.business.findMany({
          where: { id: { in: targetSellerIds } },
          include: { owner: true },
        });

        for (const seller of sellers) {
          if (seller.owner?.email) {
            await emailService.sendRFQInvitation(seller.owner.email, rfq, seller);
          }
        }
      }
      
      // For open RFQs, we could send to sellers in matching categories
      // This would be handled by a background job to avoid blocking
    } catch (error) {
      logger.error('Failed to send RFQ notifications:', error);
    }
  }

  async notifyBuyerQuotation(quotation, rfq) {
    try {
      const buyer = await prisma.business.findUnique({
        where: { id: rfq.buyerBusinessId },
        include: { owner: true },
      });

      const seller = await prisma.business.findUnique({
        where: { id: quotation.sellerBusinessId },
      });

      if (buyer?.owner?.email) {
        await emailService.sendQuotationReceived(buyer.owner.email, quotation, rfq, seller);
      }
    } catch (error) {
      logger.error('Failed to send quotation notification:', error);
    }
  }

  async notifySellerQuotationAccepted(quotation) {
    try {
      const seller = await prisma.business.findUnique({
        where: { id: quotation.sellerBusinessId },
        include: { owner: true },
      });

      if (seller?.owner?.email) {
        await emailService.sendQuotationAccepted(seller.owner.email, quotation);
      }
    } catch (error) {
      logger.error('Failed to send acceptance notification:', error);
    }
  }

  async notifySellerQuotationRejected(quotation, reason) {
    try {
      const seller = await prisma.business.findUnique({
        where: { id: quotation.sellerBusinessId },
        include: { owner: true },
      });

      if (seller?.owner?.email) {
        await emailService.sendQuotationRejected(seller.owner.email, quotation, reason);
      }
    } catch (error) {
      logger.error('Failed to send rejection notification:', error);
    }
  }

  async notifySellerCounterOffer(counterQuotation, originalQuotation) {
    try {
      const seller = await prisma.business.findUnique({
        where: { id: originalQuotation.sellerBusinessId },
        include: { owner: true },
      });

      if (seller?.owner?.email) {
        await emailService.sendCounterOffer(seller.owner.email, counterQuotation, originalQuotation);
      }
    } catch (error) {
      logger.error('Failed to send counter offer notification:', error);
    }
  }
}

module.exports = new RFQService();
