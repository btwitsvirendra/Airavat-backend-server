// =============================================================================
// AIRAVAT B2B MARKETPLACE - DISPUTE RESOLUTION SERVICE
// Service for built-in arbitration and dispute resolution
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  responseDeadline: 7 * 24 * 60 * 60 * 1000, // 7 days
  escalationDeadline: 14 * 24 * 60 * 60 * 1000, // 14 days
  maxEvidenceFiles: 10,
  maxEvidenceSize: 50 * 1024 * 1024, // 50MB per file
};

/**
 * Dispute statuses
 */
const DISPUTE_STATUS = {
  OPEN: 'Open',
  AWAITING_RESPONSE: 'Awaiting Seller Response',
  UNDER_REVIEW: 'Under Review',
  MEDIATION: 'In Mediation',
  ESCALATED: 'Escalated to Arbitration',
  RESOLVED: 'Resolved',
  CLOSED: 'Closed',
  CANCELLED: 'Cancelled',
};

/**
 * Dispute categories
 */
const DISPUTE_CATEGORIES = {
  QUALITY: {
    name: 'Product Quality',
    description: 'Product does not match description or has defects',
    suggestedResolutions: ['REFUND', 'REPLACEMENT', 'PARTIAL_REFUND'],
  },
  DELIVERY: {
    name: 'Delivery Issues',
    description: 'Order not received, delayed, or wrong quantity',
    suggestedResolutions: ['REFUND', 'RESHIP', 'PARTIAL_REFUND'],
  },
  WRONG_ITEM: {
    name: 'Wrong Item',
    description: 'Received different product than ordered',
    suggestedResolutions: ['RETURN_REPLACE', 'REFUND'],
  },
  DAMAGED: {
    name: 'Damaged Goods',
    description: 'Products arrived damaged',
    suggestedResolutions: ['REFUND', 'REPLACEMENT', 'PARTIAL_REFUND', 'INSURANCE_CLAIM'],
  },
  PAYMENT: {
    name: 'Payment Dispute',
    description: 'Payment issues, overcharging, hidden fees',
    suggestedResolutions: ['REFUND', 'CREDIT_NOTE', 'PRICE_ADJUSTMENT'],
  },
  FRAUD: {
    name: 'Suspected Fraud',
    description: 'Fraudulent activity or misrepresentation',
    suggestedResolutions: ['FULL_REFUND', 'ACCOUNT_ACTION'],
  },
  OTHER: {
    name: 'Other',
    description: 'Other issues not covered above',
    suggestedResolutions: ['MEDIATION'],
  },
};

/**
 * Resolution types
 */
const RESOLUTION_TYPES = {
  REFUND: 'Full Refund',
  PARTIAL_REFUND: 'Partial Refund',
  REPLACEMENT: 'Product Replacement',
  RESHIP: 'Reship Order',
  RETURN_REPLACE: 'Return & Replace',
  CREDIT_NOTE: 'Credit Note',
  PRICE_ADJUSTMENT: 'Price Adjustment',
  INSURANCE_CLAIM: 'Insurance Claim',
  MEDIATION: 'Mediated Agreement',
  FULL_REFUND: 'Full Refund + Compensation',
  ACCOUNT_ACTION: 'Account Suspension',
  NO_ACTION: 'No Action Required',
};

// =============================================================================
// CREATE DISPUTE
// =============================================================================

/**
 * Raise a dispute
 * @param {string} userId - User raising dispute
 * @param {Object} data - Dispute data
 * @returns {Promise<Object>} Created dispute
 */
exports.raiseDispute = async (userId, data) => {
  try {
    const {
      orderId,
      category,
      title,
      description,
      expectedResolution,
      claimAmount,
      evidence = [],
    } = data;

    // Validate order
    const order = await prisma.order.findUnique({
      where: { id: orderId },
      include: {
        buyer: true,
        seller: true,
      },
    });

    if (!order) {
      throw new AppError('Order not found', 404);
    }

    // Verify user is party to the order
    if (order.buyerId !== userId && order.seller.ownerId !== userId) {
      throw new AppError('Not authorized to raise dispute on this order', 403);
    }

    // Check for existing active dispute
    const existingDispute = await prisma.dispute.findFirst({
      where: {
        orderId,
        status: { notIn: ['RESOLVED', 'CLOSED', 'CANCELLED'] },
      },
    });

    if (existingDispute) {
      throw new AppError('An active dispute already exists for this order', 409);
    }

    // Validate category
    if (!DISPUTE_CATEGORIES[category]) {
      throw new AppError(`Invalid dispute category: ${category}`, 400);
    }

    // Generate dispute number
    const disputeNumber = generateDisputeNumber();

    // Determine against party
    const raisedByBuyer = order.buyerId === userId;
    const againstUserId = raisedByBuyer ? order.seller.ownerId : order.buyerId;

    const dispute = await prisma.dispute.create({
      data: {
        disputeNumber,
        orderId,
        raisedBy: userId,
        againstUser: againstUserId,
        category,
        title,
        description,
        expectedResolution,
        claimAmount,
        status: 'OPEN',
        responseDeadline: new Date(Date.now() + CONFIG.responseDeadline),
        timeline: {
          create: {
            action: 'DISPUTE_OPENED',
            performedBy: userId,
            notes: title,
          },
        },
        evidence: evidence.length > 0 ? {
          create: evidence.map((e) => ({
            type: e.type,
            url: e.url,
            description: e.description,
            uploadedBy: userId,
          })),
        } : undefined,
      },
      include: {
        order: { select: { orderNumber: true } },
        raisedByUser: { select: { firstName: true, lastName: true, email: true } },
      },
    });

    // Notify the other party
    await notifyDisputeRaised(dispute, againstUserId);

    logger.info('Dispute raised', {
      disputeNumber,
      orderId,
      category,
      raisedBy: userId,
    });

    return {
      ...dispute,
      categoryInfo: DISPUTE_CATEGORIES[category],
      statusInfo: DISPUTE_STATUS[dispute.status],
    };
  } catch (error) {
    logger.error('Raise dispute error', { error: error.message, userId });
    throw error;
  }
};

// =============================================================================
// READ OPERATIONS
// =============================================================================

/**
 * Get dispute by ID
 * @param {string} disputeId - Dispute ID
 * @param {string} userId - Requesting user ID
 * @returns {Promise<Object>} Dispute details
 */
exports.getDispute = async (disputeId, userId) => {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: {
      order: {
        select: {
          id: true,
          orderNumber: true,
          total: true,
          items: true,
          buyer: { select: { id: true, firstName: true, lastName: true } },
          seller: { select: { id: true, businessName: true } },
        },
      },
      raisedByUser: { select: { id: true, firstName: true, lastName: true, email: true } },
      againstUserRecord: { select: { id: true, firstName: true, lastName: true, email: true } },
      evidence: {
        orderBy: { createdAt: 'desc' },
      },
      timeline: {
        orderBy: { createdAt: 'asc' },
        include: {
          performedByUser: { select: { firstName: true, lastName: true } },
        },
      },
      messages: {
        orderBy: { createdAt: 'asc' },
        include: {
          sender: { select: { id: true, firstName: true, lastName: true } },
        },
      },
      assignedTo: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  if (!dispute) {
    throw new AppError('Dispute not found', 404);
  }

  // Check access
  const isParty = dispute.raisedBy === userId || dispute.againstUser === userId;
  const isAdmin = await checkIsAdmin(userId);

  if (!isParty && !isAdmin) {
    throw new AppError('Not authorized to view this dispute', 403);
  }

  return {
    ...dispute,
    categoryInfo: DISPUTE_CATEGORIES[dispute.category],
    statusInfo: DISPUTE_STATUS[dispute.status],
    resolutionInfo: dispute.resolution ? RESOLUTION_TYPES[dispute.resolution] : null,
    isOwner: dispute.raisedBy === userId,
    canRespond: dispute.againstUser === userId && dispute.status === 'AWAITING_RESPONSE',
  };
};

/**
 * Get user's disputes
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} User's disputes
 */
exports.getUserDisputes = async (userId, options = {}) => {
  const { page = 1, limit = 20, status = null, role = 'all' } = options;
  const skip = (page - 1) * limit;

  const where = {};

  if (role === 'raised') {
    where.raisedBy = userId;
  } else if (role === 'against') {
    where.againstUser = userId;
  } else {
    where.OR = [{ raisedBy: userId }, { againstUser: userId }];
  }

  if (status) where.status = status;

  const [disputes, total] = await Promise.all([
    prisma.dispute.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        order: { select: { orderNumber: true, total: true } },
        raisedByUser: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.dispute.count({ where }),
  ]);

  return {
    disputes: disputes.map((d) => ({
      ...d,
      categoryInfo: DISPUTE_CATEGORIES[d.category],
      statusInfo: DISPUTE_STATUS[d.status],
      isOwner: d.raisedBy === userId,
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
// RESPONSE & COMMUNICATION
// =============================================================================

/**
 * Respond to dispute
 * @param {string} disputeId - Dispute ID
 * @param {string} userId - Responding user ID
 * @param {Object} data - Response data
 * @returns {Promise<Object>} Updated dispute
 */
exports.respondToDispute = async (disputeId, userId, data) => {
  const { response, proposedResolution, counterOffer, evidence = [] } = data;

  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
  });

  if (!dispute) {
    throw new AppError('Dispute not found', 404);
  }

  if (dispute.againstUser !== userId) {
    throw new AppError('Not authorized to respond to this dispute', 403);
  }

  if (dispute.status !== 'OPEN' && dispute.status !== 'AWAITING_RESPONSE') {
    throw new AppError('Dispute is not awaiting response', 400);
  }

  const result = await prisma.$transaction(async (tx) => {
    // Update dispute
    const updated = await tx.dispute.update({
      where: { id: disputeId },
      data: {
        status: 'UNDER_REVIEW',
        sellerResponse: response,
        proposedResolution,
        counterOfferAmount: counterOffer,
        respondedAt: new Date(),
      },
    });

    // Add evidence if provided
    if (evidence.length > 0) {
      await tx.disputeEvidence.createMany({
        data: evidence.map((e) => ({
          disputeId,
          type: e.type,
          url: e.url,
          description: e.description,
          uploadedBy: userId,
        })),
      });
    }

    // Add to timeline
    await tx.disputeTimeline.create({
      data: {
        disputeId,
        action: 'RESPONSE_SUBMITTED',
        performedBy: userId,
        notes: `Response submitted. Proposed: ${proposedResolution || 'Mutual discussion'}`,
      },
    });

    return updated;
  });

  // Notify the dispute raiser
  await notifyDisputeResponse(disputeId, dispute.raisedBy);

  logger.info('Dispute response submitted', { disputeId, userId });

  return result;
};

/**
 * Add message to dispute
 * @param {string} disputeId - Dispute ID
 * @param {string} userId - Sender user ID
 * @param {Object} data - Message data
 * @returns {Promise<Object>} Created message
 */
exports.addMessage = async (disputeId, userId, data) => {
  const { content, attachments = [] } = data;

  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
  });

  if (!dispute) {
    throw new AppError('Dispute not found', 404);
  }

  // Check if user is party to dispute or admin
  const isParty = dispute.raisedBy === userId || dispute.againstUser === userId;
  const isAdmin = await checkIsAdmin(userId);

  if (!isParty && !isAdmin) {
    throw new AppError('Not authorized', 403);
  }

  const message = await prisma.disputeMessage.create({
    data: {
      disputeId,
      senderId: userId,
      content,
      attachments,
      isAdminMessage: isAdmin && !isParty,
    },
    include: {
      sender: { select: { firstName: true, lastName: true } },
    },
  });

  // Notify other party
  const recipientId = userId === dispute.raisedBy ? dispute.againstUser : dispute.raisedBy;
  await notifyNewMessage(disputeId, recipientId);

  return message;
};

/**
 * Add evidence to dispute
 * @param {string} disputeId - Dispute ID
 * @param {string} userId - User ID
 * @param {Object} evidence - Evidence data
 * @returns {Promise<Object>} Added evidence
 */
exports.addEvidence = async (disputeId, userId, evidence) => {
  const { type, url, description } = evidence;

  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
    include: { evidence: true },
  });

  if (!dispute) {
    throw new AppError('Dispute not found', 404);
  }

  const isParty = dispute.raisedBy === userId || dispute.againstUser === userId;
  if (!isParty) {
    throw new AppError('Not authorized', 403);
  }

  if (dispute.evidence.length >= CONFIG.maxEvidenceFiles) {
    throw new AppError(`Maximum ${CONFIG.maxEvidenceFiles} evidence files allowed`, 400);
  }

  const newEvidence = await prisma.disputeEvidence.create({
    data: {
      disputeId,
      type,
      url,
      description,
      uploadedBy: userId,
    },
  });

  // Add to timeline
  await prisma.disputeTimeline.create({
    data: {
      disputeId,
      action: 'EVIDENCE_ADDED',
      performedBy: userId,
      notes: `Evidence added: ${type}`,
    },
  });

  return newEvidence;
};

// =============================================================================
// RESOLUTION OPERATIONS
// =============================================================================

/**
 * Accept proposed resolution
 * @param {string} disputeId - Dispute ID
 * @param {string} userId - User accepting
 * @returns {Promise<Object>} Resolved dispute
 */
exports.acceptResolution = async (disputeId, userId) => {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
  });

  if (!dispute) {
    throw new AppError('Dispute not found', 404);
  }

  if (dispute.raisedBy !== userId) {
    throw new AppError('Only dispute raiser can accept resolution', 403);
  }

  if (!dispute.proposedResolution) {
    throw new AppError('No resolution has been proposed', 400);
  }

  const updated = await prisma.dispute.update({
    where: { id: disputeId },
    data: {
      status: 'RESOLVED',
      resolution: dispute.proposedResolution,
      resolutionAmount: dispute.counterOfferAmount,
      resolvedAt: new Date(),
      resolvedBy: userId,
    },
  });

  // Add to timeline
  await prisma.disputeTimeline.create({
    data: {
      disputeId,
      action: 'RESOLUTION_ACCEPTED',
      performedBy: userId,
      notes: `Resolution accepted: ${dispute.proposedResolution}`,
    },
  });

  // Process resolution (refund, replacement, etc.)
  await processResolution(dispute);

  logger.info('Dispute resolution accepted', { disputeId, userId });

  return updated;
};

/**
 * Reject proposed resolution and escalate
 * @param {string} disputeId - Dispute ID
 * @param {string} userId - User rejecting
 * @param {string} reason - Rejection reason
 * @returns {Promise<Object>} Escalated dispute
 */
exports.rejectAndEscalate = async (disputeId, userId, reason) => {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
  });

  if (!dispute) {
    throw new AppError('Dispute not found', 404);
  }

  if (dispute.raisedBy !== userId) {
    throw new AppError('Only dispute raiser can escalate', 403);
  }

  const updated = await prisma.dispute.update({
    where: { id: disputeId },
    data: {
      status: 'ESCALATED',
      escalatedAt: new Date(),
      escalationReason: reason,
    },
  });

  // Add to timeline
  await prisma.disputeTimeline.create({
    data: {
      disputeId,
      action: 'ESCALATED',
      performedBy: userId,
      notes: `Escalated to arbitration: ${reason}`,
    },
  });

  // Notify admins
  await notifyEscalation(disputeId);

  logger.info('Dispute escalated', { disputeId, userId, reason });

  return updated;
};

/**
 * Resolve dispute (Admin)
 * @param {string} disputeId - Dispute ID
 * @param {string} adminId - Admin user ID
 * @param {Object} resolution - Resolution details
 * @returns {Promise<Object>} Resolved dispute
 */
exports.resolveDispute = async (disputeId, adminId, resolution) => {
  const { resolutionType, amount, notes, favoredParty } = resolution;

  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
  });

  if (!dispute) {
    throw new AppError('Dispute not found', 404);
  }

  if (!RESOLUTION_TYPES[resolutionType]) {
    throw new AppError('Invalid resolution type', 400);
  }

  const updated = await prisma.dispute.update({
    where: { id: disputeId },
    data: {
      status: 'RESOLVED',
      resolution: resolutionType,
      resolutionAmount: amount,
      resolutionNotes: notes,
      favoredParty,
      resolvedAt: new Date(),
      resolvedBy: adminId,
    },
  });

  // Add to timeline
  await prisma.disputeTimeline.create({
    data: {
      disputeId,
      action: 'ADMIN_RESOLVED',
      performedBy: adminId,
      notes: `Admin resolution: ${resolutionType} - ${notes}`,
    },
  });

  // Process the resolution
  await processResolution({ ...dispute, resolution: resolutionType, resolutionAmount: amount });

  // Notify both parties
  await notifyResolution(disputeId);

  logger.info('Dispute resolved by admin', {
    disputeId,
    adminId,
    resolutionType,
  });

  return updated;
};

/**
 * Close dispute
 * @param {string} disputeId - Dispute ID
 * @param {string} userId - User closing
 * @returns {Promise<Object>} Closed dispute
 */
exports.closeDispute = async (disputeId, userId) => {
  const dispute = await prisma.dispute.findUnique({
    where: { id: disputeId },
  });

  if (!dispute) {
    throw new AppError('Dispute not found', 404);
  }

  if (dispute.raisedBy !== userId) {
    throw new AppError('Only dispute raiser can close', 403);
  }

  if (dispute.status === 'RESOLVED' || dispute.status === 'CLOSED') {
    throw new AppError('Dispute already closed or resolved', 400);
  }

  const updated = await prisma.dispute.update({
    where: { id: disputeId },
    data: {
      status: 'CLOSED',
      closedAt: new Date(),
    },
  });

  await prisma.disputeTimeline.create({
    data: {
      disputeId,
      action: 'CLOSED',
      performedBy: userId,
      notes: 'Dispute closed by raiser',
    },
  });

  logger.info('Dispute closed', { disputeId, userId });

  return updated;
};

// =============================================================================
// ADMIN OPERATIONS
// =============================================================================

/**
 * Assign dispute to admin
 * @param {string} disputeId - Dispute ID
 * @param {string} adminId - Admin to assign
 * @param {string} assignedBy - Admin assigning
 * @returns {Promise<Object>} Updated dispute
 */
exports.assignDispute = async (disputeId, adminId, assignedBy) => {
  const updated = await prisma.dispute.update({
    where: { id: disputeId },
    data: {
      assignedToId: adminId,
      assignedAt: new Date(),
    },
  });

  await prisma.disputeTimeline.create({
    data: {
      disputeId,
      action: 'ASSIGNED',
      performedBy: assignedBy,
      notes: `Assigned to admin`,
    },
  });

  return updated;
};

/**
 * Get all disputes (Admin)
 * @param {Object} options - Query options
 * @returns {Promise<Object>} All disputes
 */
exports.getAllDisputes = async (options = {}) => {
  const {
    page = 1,
    limit = 20,
    status = null,
    category = null,
    assignedToId = null,
    priority = null,
  } = options;

  const skip = (page - 1) * limit;

  const where = {};
  if (status) where.status = status;
  if (category) where.category = category;
  if (assignedToId) where.assignedToId = assignedToId;

  const [disputes, total] = await Promise.all([
    prisma.dispute.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { status: 'asc' },
        { createdAt: 'desc' },
      ],
      include: {
        order: { select: { orderNumber: true, total: true } },
        raisedByUser: { select: { firstName: true, lastName: true } },
        assignedTo: { select: { firstName: true, lastName: true } },
      },
    }),
    prisma.dispute.count({ where }),
  ]);

  return {
    disputes: disputes.map((d) => ({
      ...d,
      categoryInfo: DISPUTE_CATEGORIES[d.category],
      statusInfo: DISPUTE_STATUS[d.status],
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
// HELPER FUNCTIONS
// =============================================================================

function generateDisputeNumber() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `DSP${year}${month}-${random}`;
}

async function checkIsAdmin(userId) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { role: true },
  });
  return user?.role === 'ADMIN' || user?.role === 'SUPER_ADMIN';
}

async function processResolution(dispute) {
  // Implement resolution processing based on type
  logger.info('Processing dispute resolution', {
    disputeId: dispute.id,
    resolution: dispute.resolution,
  });
}

async function notifyDisputeRaised(dispute, recipientId) {
  logger.info('Notifying dispute raised', { disputeId: dispute.id, recipientId });
}

async function notifyDisputeResponse(disputeId, recipientId) {
  logger.info('Notifying dispute response', { disputeId, recipientId });
}

async function notifyNewMessage(disputeId, recipientId) {
  logger.info('Notifying new message', { disputeId, recipientId });
}

async function notifyEscalation(disputeId) {
  logger.info('Notifying escalation', { disputeId });
}

async function notifyResolution(disputeId) {
  logger.info('Notifying resolution', { disputeId });
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  DISPUTE_STATUS,
  DISPUTE_CATEGORIES,
  RESOLUTION_TYPES,
  CONFIG,
};



