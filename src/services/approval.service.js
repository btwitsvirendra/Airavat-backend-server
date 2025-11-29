// =============================================================================
// AIRAVAT B2B MARKETPLACE - APPROVAL WORKFLOW SERVICE
// Multi-level approval system for orders, payments, and business operations
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
const { emitToUser, emitToBusiness } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const APPROVAL_TYPE = {
  ORDER: 'ORDER',
  PURCHASE_ORDER: 'PURCHASE_ORDER',
  QUOTATION: 'QUOTATION',
  CONTRACT: 'CONTRACT',
  PAYMENT: 'PAYMENT',
  REFUND: 'REFUND',
  CREDIT_REQUEST: 'CREDIT_REQUEST',
  VENDOR_ONBOARD: 'VENDOR_ONBOARD',
  PRICE_CHANGE: 'PRICE_CHANGE',
  DISCOUNT: 'DISCOUNT',
};

const APPROVAL_STATUS = {
  PENDING: 'PENDING',
  IN_PROGRESS: 'IN_PROGRESS',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  CANCELLED: 'CANCELLED',
  ESCALATED: 'ESCALATED',
};

const APPROVAL_PRIORITY = {
  LOW: 'LOW',
  NORMAL: 'NORMAL',
  HIGH: 'HIGH',
  URGENT: 'URGENT',
};

const STEP_STATUS = {
  PENDING: 'PENDING',
  APPROVED: 'APPROVED',
  REJECTED: 'REJECTED',
  SKIPPED: 'SKIPPED',
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const generateRequestNumber = () => {
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = generateId().substring(0, 6).toUpperCase();
  return `APR-${timestamp}-${random}`;
};

// =============================================================================
// APPROVAL WORKFLOW MANAGEMENT
// =============================================================================

/**
 * Create approval request
 */
const createApprovalRequest = async (requesterId, businessId, data) => {
  const {
    type,
    referenceId,
    referenceType,
    title,
    description,
    amount,
    priority = APPROVAL_PRIORITY.NORMAL,
    approvers,
    dueDate,
    metadata,
  } = data;

  if (!approvers || approvers.length === 0) {
    throw new BadRequestError('At least one approver is required');
  }

  // Verify all approvers exist
  const approverUsers = await prisma.user.findMany({
    where: { id: { in: approvers } },
    select: { id: true, firstName: true, lastName: true },
  });

  if (approverUsers.length !== approvers.length) {
    throw new BadRequestError('One or more approvers not found');
  }

  const request = await prisma.approvalRequest.create({
    data: {
      requestNumber: generateRequestNumber(),
      businessId,
      requesterId,
      type,
      referenceId,
      referenceType,
      title,
      description,
      amount,
      priority,
      status: APPROVAL_STATUS.PENDING,
      currentLevel: 1,
      maxLevel: approvers.length,
      dueDate: dueDate ? new Date(dueDate) : null,
      metadata,
      approvers: {
        create: approvers.map((approverId, index) => ({
          level: index + 1,
          approverId,
          status: index === 0 ? STEP_STATUS.PENDING : STEP_STATUS.PENDING,
        })),
      },
    },
    include: {
      approvers: {
        include: {
          approver: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { level: 'asc' },
      },
      requester: { select: { id: true, firstName: true, lastName: true } },
    },
  });

  // Notify first approver
  const firstApprover = approvers[0];
  emitToUser(firstApprover, 'approval:new_request', {
    requestId: request.id,
    requestNumber: request.requestNumber,
    type,
    title,
    priority,
  });

  logger.info('Approval request created', {
    requestId: request.id,
    type,
    requesterId,
    businessId,
  });

  return request;
};

/**
 * Get approval request by ID
 */
const getApprovalById = async (requestId, userId) => {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: {
      approvers: {
        include: {
          approver: { select: { id: true, firstName: true, lastName: true, email: true } },
        },
        orderBy: { level: 'asc' },
      },
      requester: { select: { id: true, firstName: true, lastName: true, email: true } },
      business: { select: { id: true, businessName: true } },
    },
  });

  if (!request) {
    throw new NotFoundError('Approval request');
  }

  // Check if user has access
  const isRequester = request.requesterId === userId;
  const isApprover = request.approvers.some((a) => a.approverId === userId);

  if (!isRequester && !isApprover) {
    throw new ForbiddenError('Access denied');
  }

  const currentStep = request.approvers.find((a) => a.level === request.currentLevel);
  const isCurrentApprover = currentStep?.approverId === userId;

  return {
    ...request,
    isRequester,
    isApprover,
    isCurrentApprover,
    canApprove: isCurrentApprover && request.status === APPROVAL_STATUS.PENDING,
  };
};

/**
 * Get pending approvals for user
 */
const getPendingApprovals = async (userId, options = {}) => {
  const { page = 1, limit = 20, type, priority } = options;
  const skip = (page - 1) * limit;

  const where = {
    status: APPROVAL_STATUS.PENDING,
    approvers: {
      some: {
        approverId: userId,
        status: STEP_STATUS.PENDING,
      },
    },
  };

  if (type) where.type = type;
  if (priority) where.priority = priority;

  const [requests, total] = await Promise.all([
    prisma.approvalRequest.findMany({
      where,
      include: {
        requester: { select: { id: true, firstName: true, lastName: true } },
        business: { select: { id: true, businessName: true } },
        approvers: {
          where: { approverId: userId },
          select: { level: true, status: true },
        },
      },
      orderBy: [
        { priority: 'desc' },
        { createdAt: 'asc' },
      ],
      skip,
      take: limit,
    }),
    prisma.approvalRequest.count({ where }),
  ]);

  // Filter to only show requests where user is current approver
  const pendingForUser = requests.filter((req) => {
    const userStep = req.approvers[0];
    return userStep && userStep.level === req.currentLevel;
  });

  return {
    requests: pendingForUser,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Get requests submitted by user
 */
const getMyRequests = async (userId, options = {}) => {
  const { page = 1, limit = 20, status, type } = options;
  const skip = (page - 1) * limit;

  const where = { requesterId: userId };
  if (status) where.status = status;
  if (type) where.type = type;

  const [requests, total] = await Promise.all([
    prisma.approvalRequest.findMany({
      where,
      include: {
        approvers: {
          include: {
            approver: { select: { id: true, firstName: true, lastName: true } },
          },
          orderBy: { level: 'asc' },
        },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.approvalRequest.count({ where }),
  ]);

  return {
    requests,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Approve request
 */
const approveRequest = async (approverId, requestId, comments) => {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: {
      approvers: { orderBy: { level: 'asc' } },
    },
  });

  if (!request) {
    throw new NotFoundError('Approval request');
  }

  if (request.status !== APPROVAL_STATUS.PENDING) {
    throw new BadRequestError('Request is not pending');
  }

  const currentStep = request.approvers.find((a) => a.level === request.currentLevel);
  if (!currentStep || currentStep.approverId !== approverId) {
    throw new ForbiddenError('You are not the current approver');
  }

  // Update current step
  await prisma.approvalStep.update({
    where: { id: currentStep.id },
    data: {
      status: STEP_STATUS.APPROVED,
      decision: 'APPROVED',
      comments,
      decidedAt: new Date(),
    },
  });

  // Check if more approvers
  const nextLevel = request.currentLevel + 1;
  const isFullyApproved = nextLevel > request.maxLevel;

  const updateData = isFullyApproved
    ? { status: APPROVAL_STATUS.APPROVED }
    : { currentLevel: nextLevel, status: APPROVAL_STATUS.IN_PROGRESS };

  const updated = await prisma.approvalRequest.update({
    where: { id: requestId },
    data: updateData,
    include: {
      approvers: {
        include: {
          approver: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { level: 'asc' },
      },
    },
  });

  // Notify requester
  emitToUser(request.requesterId, isFullyApproved ? 'approval:approved' : 'approval:step_approved', {
    requestId,
    requestNumber: request.requestNumber,
    level: request.currentLevel,
  });

  // Notify next approver if exists
  if (!isFullyApproved) {
    const nextApprover = request.approvers.find((a) => a.level === nextLevel);
    if (nextApprover) {
      emitToUser(nextApprover.approverId, 'approval:your_turn', {
        requestId,
        requestNumber: request.requestNumber,
        type: request.type,
      });
    }
  }

  logger.info('Approval step completed', {
    requestId,
    approverId,
    level: request.currentLevel,
    isFullyApproved,
  });

  return updated;
};

/**
 * Reject request
 */
const rejectRequest = async (approverId, requestId, reason) => {
  const request = await prisma.approvalRequest.findUnique({
    where: { id: requestId },
    include: {
      approvers: { orderBy: { level: 'asc' } },
    },
  });

  if (!request) {
    throw new NotFoundError('Approval request');
  }

  if (request.status !== APPROVAL_STATUS.PENDING && request.status !== APPROVAL_STATUS.IN_PROGRESS) {
    throw new BadRequestError('Request cannot be rejected');
  }

  const currentStep = request.approvers.find((a) => a.level === request.currentLevel);
  if (!currentStep || currentStep.approverId !== approverId) {
    throw new ForbiddenError('You are not the current approver');
  }

  if (!reason) {
    throw new BadRequestError('Rejection reason is required');
  }

  // Update current step
  await prisma.approvalStep.update({
    where: { id: currentStep.id },
    data: {
      status: STEP_STATUS.REJECTED,
      decision: 'REJECTED',
      comments: reason,
      decidedAt: new Date(),
    },
  });

  // Update request
  const updated = await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { status: APPROVAL_STATUS.REJECTED },
  });

  // Notify requester
  emitToUser(request.requesterId, 'approval:rejected', {
    requestId,
    requestNumber: request.requestNumber,
    reason,
  });

  logger.info('Approval rejected', { requestId, approverId, reason });

  return updated;
};

/**
 * Cancel request (by requester)
 */
const cancelRequest = async (requesterId, requestId, reason) => {
  const request = await prisma.approvalRequest.findFirst({
    where: {
      id: requestId,
      requesterId,
      status: { in: [APPROVAL_STATUS.PENDING, APPROVAL_STATUS.IN_PROGRESS] },
    },
  });

  if (!request) {
    throw new NotFoundError('Approval request');
  }

  const updated = await prisma.approvalRequest.update({
    where: { id: requestId },
    data: {
      status: APPROVAL_STATUS.CANCELLED,
      metadata: {
        ...request.metadata,
        cancellationReason: reason,
        cancelledAt: new Date().toISOString(),
      },
    },
  });

  logger.info('Approval request cancelled', { requestId, requesterId, reason });

  return updated;
};

/**
 * Escalate request
 */
const escalateRequest = async (userId, requestId, escalateToId, reason) => {
  const request = await prisma.approvalRequest.findFirst({
    where: {
      id: requestId,
      status: { in: [APPROVAL_STATUS.PENDING, APPROVAL_STATUS.IN_PROGRESS] },
    },
    include: {
      approvers: { orderBy: { level: 'asc' } },
    },
  });

  if (!request) {
    throw new NotFoundError('Approval request');
  }

  // Verify escalation target
  const escalateTo = await prisma.user.findUnique({
    where: { id: escalateToId },
    select: { id: true, firstName: true, lastName: true },
  });

  if (!escalateTo) {
    throw new NotFoundError('Escalation target user');
  }

  // Add new approver at current level
  await prisma.approvalStep.create({
    data: {
      requestId,
      level: request.currentLevel,
      approverId: escalateToId,
      status: STEP_STATUS.PENDING,
    },
  });

  const updated = await prisma.approvalRequest.update({
    where: { id: requestId },
    data: { status: APPROVAL_STATUS.ESCALATED },
  });

  // Notify escalation target
  emitToUser(escalateToId, 'approval:escalated_to_you', {
    requestId,
    requestNumber: request.requestNumber,
    reason,
  });

  logger.info('Approval escalated', { requestId, escalateToId, reason });

  return updated;
};

/**
 * Get approval statistics
 */
const getApprovalStats = async (businessId) => {
  const [pending, approved, rejected, avgTime] = await Promise.all([
    prisma.approvalRequest.count({ where: { businessId, status: APPROVAL_STATUS.PENDING } }),
    prisma.approvalRequest.count({ where: { businessId, status: APPROVAL_STATUS.APPROVED } }),
    prisma.approvalRequest.count({ where: { businessId, status: APPROVAL_STATUS.REJECTED } }),
    prisma.approvalStep.aggregate({
      where: {
        request: { businessId },
        status: { in: [STEP_STATUS.APPROVED, STEP_STATUS.REJECTED] },
        decidedAt: { not: null },
      },
      _avg: {
        // This would need a computed field for time difference
      },
    }),
  ]);

  return {
    pending,
    approved,
    rejected,
    total: pending + approved + rejected,
    approvalRate: approved + rejected > 0 
      ? ((approved / (approved + rejected)) * 100).toFixed(1) 
      : 0,
  };
};

/**
 * Get approval history for reference
 */
const getApprovalHistory = async (referenceType, referenceId) => {
  const requests = await prisma.approvalRequest.findMany({
    where: { referenceType, referenceId },
    include: {
      approvers: {
        include: {
          approver: { select: { id: true, firstName: true, lastName: true } },
        },
        orderBy: { level: 'asc' },
      },
      requester: { select: { id: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: 'desc' },
  });

  return requests;
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  APPROVAL_TYPE,
  APPROVAL_STATUS,
  APPROVAL_PRIORITY,
  STEP_STATUS,
  createApprovalRequest,
  getApprovalById,
  getPendingApprovals,
  getMyRequests,
  approveRequest,
  rejectRequest,
  cancelRequest,
  escalateRequest,
  getApprovalStats,
  getApprovalHistory,
};



