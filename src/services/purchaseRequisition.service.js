// =============================================================================
// AIRAVAT B2B MARKETPLACE - PURCHASE REQUISITION SERVICE
// Service for internal purchase requests before PO creation
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  maxItemsPerRequisition: 50,
  defaultExpiry: 30, // days
};

/**
 * Requisition statuses
 */
const REQUISITION_STATUS = {
  DRAFT: 'Draft',
  PENDING: 'Pending Approval',
  APPROVED: 'Approved',
  PARTIALLY_APPROVED: 'Partially Approved',
  REJECTED: 'Rejected',
  CONVERTED: 'Converted to PO',
  CANCELLED: 'Cancelled',
  EXPIRED: 'Expired',
};

/**
 * Priority levels
 */
const PRIORITY_LEVELS = {
  LOW: { value: 1, label: 'Low', color: '#4CAF50' },
  MEDIUM: { value: 2, label: 'Medium', color: '#FF9800' },
  HIGH: { value: 3, label: 'High', color: '#F44336' },
  URGENT: { value: 4, label: 'Urgent', color: '#9C27B0' },
};

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * Create purchase requisition
 * @param {string} userId - Requester user ID
 * @param {string} businessId - Business ID
 * @param {Object} data - Requisition data
 * @returns {Promise<Object>} Created requisition
 */
exports.createRequisition = async (userId, businessId, data) => {
  try {
    const {
      title,
      description,
      items,
      priority = 'MEDIUM',
      requiredBy,
      budgetCode,
      costCenter,
      department,
      notes,
    } = data;

    // Validate business
    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });

    if (!business) {
      throw new AppError('Business not found', 404);
    }

    // Validate items
    if (!items || items.length === 0) {
      throw new AppError('At least one item is required', 400);
    }

    if (items.length > CONFIG.maxItemsPerRequisition) {
      throw new AppError(`Maximum ${CONFIG.maxItemsPerRequisition} items allowed`, 400);
    }

    // Calculate totals
    let estimatedTotal = 0;
    const processedItems = items.map((item, index) => {
      const lineTotal = (item.estimatedPrice || 0) * item.quantity;
      estimatedTotal += lineTotal;
      return {
        lineNumber: index + 1,
        description: item.description,
        productId: item.productId || null,
        quantity: item.quantity,
        unit: item.unit || 'units',
        estimatedPrice: item.estimatedPrice || 0,
        lineTotal,
        specifications: item.specifications || null,
        preferredVendor: item.preferredVendor || null,
        status: 'PENDING',
      };
    });

    // Generate requisition number
    const requisitionNumber = generateRequisitionNumber(businessId);

    const requisition = await prisma.purchaseRequisition.create({
      data: {
        requisitionNumber,
        businessId,
        requesterId: userId,
        title,
        description,
        priority,
        requiredBy: requiredBy ? new Date(requiredBy) : null,
        budgetCode,
        costCenter,
        department,
        notes,
        estimatedTotal,
        currency: 'INR',
        status: 'DRAFT',
        items: {
          create: processedItems,
        },
        expiresAt: new Date(Date.now() + CONFIG.defaultExpiry * 24 * 60 * 60 * 1000),
      },
      include: {
        items: true,
        requester: {
          select: { id: true, firstName: true, lastName: true, email: true },
        },
      },
    });

    logger.info('Purchase requisition created', {
      requisitionNumber,
      userId,
      businessId,
      itemCount: items.length,
    });

    return requisition;
  } catch (error) {
    logger.error('Create requisition error', { error: error.message, userId });
    throw error;
  }
};

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * Get requisition by ID
 * @param {string} requisitionId - Requisition ID
 * @param {string} userId - User ID
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Requisition details
 */
exports.getRequisition = async (requisitionId, userId, businessId) => {
  const requisition = await prisma.purchaseRequisition.findUnique({
    where: { id: requisitionId },
    include: {
      items: {
        include: {
          product: {
            select: { id: true, name: true, images: true },
          },
        },
      },
      requester: {
        select: { id: true, firstName: true, lastName: true, email: true },
      },
      approvals: {
        include: {
          approver: {
            select: { id: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  if (!requisition) {
    throw new AppError('Purchase requisition not found', 404);
  }

  if (requisition.businessId !== businessId) {
    throw new AppError('Not authorized to view this requisition', 403);
  }

  return {
    ...requisition,
    statusInfo: REQUISITION_STATUS[requisition.status],
    priorityInfo: PRIORITY_LEVELS[requisition.priority],
  };
};

/**
 * Get requisitions with filters
 * @param {string} businessId - Business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Paginated requisitions
 */
exports.getRequisitions = async (businessId, options = {}) => {
  const {
    page = 1,
    limit = 20,
    status = null,
    priority = null,
    requesterId = null,
    department = null,
    search = null,
    startDate = null,
    endDate = null,
  } = options;

  const skip = (page - 1) * limit;

  const where = { businessId };

  if (status) where.status = status;
  if (priority) where.priority = priority;
  if (requesterId) where.requesterId = requesterId;
  if (department) where.department = department;

  if (search) {
    where.OR = [
      { requisitionNumber: { contains: search, mode: 'insensitive' } },
      { title: { contains: search, mode: 'insensitive' } },
      { description: { contains: search, mode: 'insensitive' } },
    ];
  }

  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const [requisitions, total] = await Promise.all([
    prisma.purchaseRequisition.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'desc' },
      ],
      include: {
        requester: {
          select: { id: true, firstName: true, lastName: true },
        },
        _count: { select: { items: true } },
      },
    }),
    prisma.purchaseRequisition.count({ where }),
  ]);

  return {
    requisitions: requisitions.map((r) => ({
      ...r,
      statusInfo: REQUISITION_STATUS[r.status],
      priorityInfo: PRIORITY_LEVELS[r.priority],
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
 * Get pending approvals for user
 * @param {string} userId - Approver user ID
 * @param {string} businessId - Business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Pending requisitions
 */
exports.getPendingApprovals = async (userId, businessId, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  // Get user's approval authority
  const authority = await prisma.approvalAuthority.findFirst({
    where: {
      userId,
      businessId,
      isActive: true,
    },
  });

  if (!authority) {
    return {
      requisitions: [],
      pagination: { page, limit, total: 0, totalPages: 0 },
    };
  }

  const where = {
    businessId,
    status: 'PENDING',
    estimatedTotal: { lte: authority.maxApprovalLimit },
  };

  const [requisitions, total] = await Promise.all([
    prisma.purchaseRequisition.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' },
      ],
      include: {
        requester: {
          select: { id: true, firstName: true, lastName: true },
        },
        items: true,
      },
    }),
    prisma.purchaseRequisition.count({ where }),
  ]);

  return {
    requisitions,
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
 * Update requisition
 * @param {string} requisitionId - Requisition ID
 * @param {string} userId - User ID
 * @param {Object} data - Update data
 * @returns {Promise<Object>} Updated requisition
 */
exports.updateRequisition = async (requisitionId, userId, data) => {
  const requisition = await prisma.purchaseRequisition.findUnique({
    where: { id: requisitionId },
  });

  if (!requisition) {
    throw new AppError('Requisition not found', 404);
  }

  if (requisition.requesterId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  if (requisition.status !== 'DRAFT') {
    throw new AppError('Only draft requisitions can be modified', 400);
  }

  const updateData = {};
  const allowedFields = ['title', 'description', 'priority', 'requiredBy', 
                         'budgetCode', 'costCenter', 'department', 'notes'];

  for (const field of allowedFields) {
    if (data[field] !== undefined) {
      updateData[field] = data[field];
    }
  }

  const updated = await prisma.purchaseRequisition.update({
    where: { id: requisitionId },
    data: updateData,
  });

  logger.info('Requisition updated', { requisitionId, userId });

  return updated;
};

/**
 * Add item to requisition
 * @param {string} requisitionId - Requisition ID
 * @param {string} userId - User ID
 * @param {Object} item - Item data
 * @returns {Promise<Object>} Added item
 */
exports.addItem = async (requisitionId, userId, item) => {
  const requisition = await prisma.purchaseRequisition.findUnique({
    where: { id: requisitionId },
    include: { items: true },
  });

  if (!requisition) {
    throw new AppError('Requisition not found', 404);
  }

  if (requisition.requesterId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  if (requisition.status !== 'DRAFT') {
    throw new AppError('Only draft requisitions can be modified', 400);
  }

  if (requisition.items.length >= CONFIG.maxItemsPerRequisition) {
    throw new AppError(`Maximum ${CONFIG.maxItemsPerRequisition} items allowed`, 400);
  }

  const lineNumber = requisition.items.length + 1;
  const lineTotal = (item.estimatedPrice || 0) * item.quantity;

  const newItem = await prisma.requisitionItem.create({
    data: {
      requisitionId,
      lineNumber,
      description: item.description,
      productId: item.productId || null,
      quantity: item.quantity,
      unit: item.unit || 'units',
      estimatedPrice: item.estimatedPrice || 0,
      lineTotal,
      specifications: item.specifications || null,
      preferredVendor: item.preferredVendor || null,
      status: 'PENDING',
    },
  });

  // Update total
  await prisma.purchaseRequisition.update({
    where: { id: requisitionId },
    data: {
      estimatedTotal: { increment: lineTotal },
    },
  });

  return newItem;
};

/**
 * Remove item from requisition
 * @param {string} requisitionId - Requisition ID
 * @param {string} itemId - Item ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Deletion result
 */
exports.removeItem = async (requisitionId, itemId, userId) => {
  const requisition = await prisma.purchaseRequisition.findUnique({
    where: { id: requisitionId },
  });

  if (!requisition) {
    throw new AppError('Requisition not found', 404);
  }

  if (requisition.requesterId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  if (requisition.status !== 'DRAFT') {
    throw new AppError('Only draft requisitions can be modified', 400);
  }

  const item = await prisma.requisitionItem.findUnique({
    where: { id: itemId },
  });

  if (!item || item.requisitionId !== requisitionId) {
    throw new AppError('Item not found', 404);
  }

  await prisma.requisitionItem.delete({
    where: { id: itemId },
  });

  // Update total
  await prisma.purchaseRequisition.update({
    where: { id: requisitionId },
    data: {
      estimatedTotal: { decrement: item.lineTotal },
    },
  });

  return { success: true };
};

// =============================================================================
// WORKFLOW OPERATIONS
// =============================================================================

/**
 * Submit requisition for approval
 * @param {string} requisitionId - Requisition ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Submitted requisition
 */
exports.submitForApproval = async (requisitionId, userId) => {
  const requisition = await prisma.purchaseRequisition.findUnique({
    where: { id: requisitionId },
    include: { items: true },
  });

  if (!requisition) {
    throw new AppError('Requisition not found', 404);
  }

  if (requisition.requesterId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  if (requisition.status !== 'DRAFT') {
    throw new AppError('Only draft requisitions can be submitted', 400);
  }

  if (requisition.items.length === 0) {
    throw new AppError('Requisition must have at least one item', 400);
  }

  const updated = await prisma.purchaseRequisition.update({
    where: { id: requisitionId },
    data: {
      status: 'PENDING',
      submittedAt: new Date(),
    },
  });

  logger.info('Requisition submitted for approval', { requisitionId });

  return updated;
};

/**
 * Approve requisition
 * @param {string} requisitionId - Requisition ID
 * @param {string} approverId - Approver user ID
 * @param {Object} data - Approval data
 * @returns {Promise<Object>} Approved requisition
 */
exports.approveRequisition = async (requisitionId, approverId, data = {}) => {
  const { notes, approvedItems } = data;

  const requisition = await prisma.purchaseRequisition.findUnique({
    where: { id: requisitionId },
    include: { items: true },
  });

  if (!requisition) {
    throw new AppError('Requisition not found', 404);
  }

  if (requisition.status !== 'PENDING') {
    throw new AppError('Requisition is not pending approval', 400);
  }

  // Check approval authority
  const authority = await prisma.approvalAuthority.findFirst({
    where: {
      userId: approverId,
      businessId: requisition.businessId,
      isActive: true,
      maxApprovalLimit: { gte: requisition.estimatedTotal },
    },
  });

  if (!authority) {
    throw new AppError('Insufficient approval authority', 403);
  }

  // Determine if partial or full approval
  let status = 'APPROVED';
  if (approvedItems && approvedItems.length < requisition.items.length) {
    status = 'PARTIALLY_APPROVED';
  }

  const result = await prisma.$transaction(async (tx) => {
    // Create approval record
    await tx.requisitionApproval.create({
      data: {
        requisitionId,
        approverId,
        action: 'APPROVED',
        notes,
      },
    });

    // Update item statuses if partial approval
    if (approvedItems) {
      await tx.requisitionItem.updateMany({
        where: {
          requisitionId,
          id: { in: approvedItems },
        },
        data: { status: 'APPROVED' },
      });

      await tx.requisitionItem.updateMany({
        where: {
          requisitionId,
          id: { notIn: approvedItems },
        },
        data: { status: 'REJECTED' },
      });
    } else {
      await tx.requisitionItem.updateMany({
        where: { requisitionId },
        data: { status: 'APPROVED' },
      });
    }

    // Update requisition
    const updated = await tx.purchaseRequisition.update({
      where: { id: requisitionId },
      data: {
        status,
        approvedAt: new Date(),
        approvedBy: approverId,
      },
    });

    return updated;
  });

  logger.info('Requisition approved', { requisitionId, approverId, status });

  return result;
};

/**
 * Reject requisition
 * @param {string} requisitionId - Requisition ID
 * @param {string} approverId - Approver user ID
 * @param {string} reason - Rejection reason
 * @returns {Promise<Object>} Rejected requisition
 */
exports.rejectRequisition = async (requisitionId, approverId, reason) => {
  const requisition = await prisma.purchaseRequisition.findUnique({
    where: { id: requisitionId },
  });

  if (!requisition) {
    throw new AppError('Requisition not found', 404);
  }

  if (requisition.status !== 'PENDING') {
    throw new AppError('Requisition is not pending approval', 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    await tx.requisitionApproval.create({
      data: {
        requisitionId,
        approverId,
        action: 'REJECTED',
        notes: reason,
      },
    });

    const updated = await tx.purchaseRequisition.update({
      where: { id: requisitionId },
      data: {
        status: 'REJECTED',
        rejectedAt: new Date(),
        rejectedBy: approverId,
        rejectionReason: reason,
      },
    });

    return updated;
  });

  logger.info('Requisition rejected', { requisitionId, approverId });

  return result;
};

/**
 * Convert requisition to purchase order
 * @param {string} requisitionId - Requisition ID
 * @param {string} userId - User ID
 * @param {Object} data - PO data
 * @returns {Promise<Object>} Created purchase order
 */
exports.convertToPO = async (requisitionId, userId, data) => {
  const { sellerId, deliveryAddress, paymentTerms } = data;

  const requisition = await prisma.purchaseRequisition.findUnique({
    where: { id: requisitionId },
    include: {
      items: { where: { status: 'APPROVED' } },
    },
  });

  if (!requisition) {
    throw new AppError('Requisition not found', 404);
  }

  if (requisition.status !== 'APPROVED' && requisition.status !== 'PARTIALLY_APPROVED') {
    throw new AppError('Only approved requisitions can be converted to PO', 400);
  }

  if (requisition.items.length === 0) {
    throw new AppError('No approved items to convert', 400);
  }

  // Create order from approved items
  const order = await prisma.order.create({
    data: {
      buyerId: requisition.requesterId,
      sellerId,
      orderNumber: generatePONumber(),
      status: 'PENDING',
      subtotal: requisition.items.reduce((sum, item) => sum + item.lineTotal, 0),
      total: requisition.items.reduce((sum, item) => sum + item.lineTotal, 0),
      currency: requisition.currency,
      shippingAddress: deliveryAddress,
      paymentTerms,
      requisitionId,
      items: {
        create: requisition.items.map((item) => ({
          productId: item.productId,
          description: item.description,
          quantity: item.quantity,
          unitPrice: item.estimatedPrice,
          totalPrice: item.lineTotal,
        })),
      },
    },
  });

  // Update requisition status
  await prisma.purchaseRequisition.update({
    where: { id: requisitionId },
    data: {
      status: 'CONVERTED',
      convertedToOrderId: order.id,
      convertedAt: new Date(),
    },
  });

  logger.info('Requisition converted to PO', {
    requisitionId,
    orderId: order.id,
  });

  return order;
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate requisition number
 */
function generateRequisitionNumber(businessId) {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 6).toUpperCase();
  return `PR${year}${month}-${random}`;
}

/**
 * Generate PO number
 */
function generatePONumber() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `PO${year}${month}-${random}`;
}

// =============================================================================
// SCHEDULED OPERATIONS
// =============================================================================

/**
 * Expire old requisitions
 * @returns {Promise<Object>} Expiration result
 */
exports.expireRequisitions = async () => {
  const result = await prisma.purchaseRequisition.updateMany({
    where: {
      status: { in: ['DRAFT', 'PENDING'] },
      expiresAt: { lt: new Date() },
    },
    data: {
      status: 'EXPIRED',
    },
  });

  if (result.count > 0) {
    logger.info('Requisitions expired', { count: result.count });
  }

  return { expired: result.count };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  REQUISITION_STATUS,
  PRIORITY_LEVELS,
};



