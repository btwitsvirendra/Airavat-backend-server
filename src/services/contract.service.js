// =============================================================================
// AIRAVAT B2B MARKETPLACE - CONTRACT SERVICE
// Long-term supply agreements and contract management
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} = require('../utils/errors');
const { generateId, formatCurrency } = require('../utils/helpers');
const { emitToBusiness } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const CONTRACT_TYPE = {
  SUPPLY_AGREEMENT: 'SUPPLY_AGREEMENT',
  EXCLUSIVE_DISTRIBUTION: 'EXCLUSIVE_DISTRIBUTION',
  FRAMEWORK_AGREEMENT: 'FRAMEWORK_AGREEMENT',
  ANNUAL_PURCHASE: 'ANNUAL_PURCHASE',
  CONSIGNMENT: 'CONSIGNMENT',
  SERVICE_LEVEL: 'SERVICE_LEVEL',
};

const CONTRACT_STATUS = {
  DRAFT: 'DRAFT',
  PENDING_APPROVAL: 'PENDING_APPROVAL',
  NEGOTIATION: 'NEGOTIATION',
  PENDING_SIGNATURE: 'PENDING_SIGNATURE',
  ACTIVE: 'ACTIVE',
  SUSPENDED: 'SUSPENDED',
  EXPIRED: 'EXPIRED',
  TERMINATED: 'TERMINATED',
  RENEWED: 'RENEWED',
};

const CACHE_TTL = { CONTRACT: 300 };

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const generateContractNumber = () => {
  const year = new Date().getFullYear();
  const timestamp = Date.now().toString(36).toUpperCase();
  const random = generateId().substring(0, 4).toUpperCase();
  return `CTR-${year}-${timestamp}-${random}`;
};

const getContractCacheKey = (contractId) => `contract:${contractId}`;

const invalidateContractCache = async (contractId) => {
  await cache.del(getContractCacheKey(contractId));
};

// =============================================================================
// CONTRACT MANAGEMENT
// =============================================================================

/**
 * Create contract draft
 */
const createContract = async (creatorId, creatorRole, data) => {
  const {
    partnerId,
    title,
    description,
    type = CONTRACT_TYPE.SUPPLY_AGREEMENT,
    startDate,
    endDate,
    autoRenew = false,
    renewalTermDays,
    terms,
    pricing,
    deliveryTerms,
    paymentTerms,
    penalties,
    totalValue,
    minOrderValue,
    maxOrderValue,
  } = data;

  // Determine buyer/seller
  const buyerId = creatorRole === 'buyer' ? creatorId : partnerId;
  const sellerId = creatorRole === 'seller' ? creatorId : partnerId;

  // Validate partner exists
  const partner = await prisma.business.findUnique({
    where: { id: partnerId },
    select: { id: true, businessName: true },
  });

  if (!partner) {
    throw new NotFoundError('Partner business');
  }

  // Validate dates
  const start = new Date(startDate);
  const end = new Date(endDate);

  if (start >= end) {
    throw new BadRequestError('End date must be after start date');
  }

  const contract = await prisma.contract.create({
    data: {
      contractNumber: generateContractNumber(),
      buyerId,
      sellerId,
      title,
      description,
      type,
      status: CONTRACT_STATUS.DRAFT,
      startDate: start,
      endDate: end,
      autoRenew,
      renewalTermDays,
      terms,
      pricing,
      deliveryTerms,
      paymentTerms,
      penalties,
      totalValue,
      minOrderValue,
      maxOrderValue,
    },
    include: {
      buyer: { select: { id: true, businessName: true, logo: true } },
      seller: { select: { id: true, businessName: true, logo: true } },
    },
  });

  logger.info('Contract created', {
    contractId: contract.id,
    buyerId,
    sellerId,
    type,
  });

  return contract;
};

/**
 * Get contract by ID
 */
const getContractById = async (contractId, businessId) => {
  const contract = await prisma.contract.findFirst({
    where: {
      id: contractId,
      OR: [{ buyerId: businessId }, { sellerId: businessId }],
    },
    include: {
      buyer: { select: { id: true, businessName: true, logo: true, email: true } },
      seller: { select: { id: true, businessName: true, logo: true, email: true } },
    },
  });

  if (!contract) {
    throw new NotFoundError('Contract');
  }

  const isBuyer = contract.buyerId === businessId;
  const daysUntilExpiry = Math.ceil((new Date(contract.endDate) - new Date()) / (1000 * 60 * 60 * 24));

  return {
    ...contract,
    role: isBuyer ? 'buyer' : 'seller',
    counterparty: isBuyer ? contract.seller : contract.buyer,
    daysUntilExpiry,
    isExpiringSoon: daysUntilExpiry <= 30 && daysUntilExpiry > 0,
    formattedTotalValue: contract.totalValue ? formatCurrency(contract.totalValue) : null,
  };
};

/**
 * Get business contracts
 */
const getContracts = async (businessId, options = {}) => {
  const { page = 1, limit = 20, status, type, role } = options;
  const skip = (page - 1) * limit;

  let where = {};

  if (role === 'buyer') {
    where.buyerId = businessId;
  } else if (role === 'seller') {
    where.sellerId = businessId;
  } else {
    where.OR = [{ buyerId: businessId }, { sellerId: businessId }];
  }

  if (status) where.status = status;
  if (type) where.type = type;

  const [contracts, total] = await Promise.all([
    prisma.contract.findMany({
      where,
      include: {
        buyer: { select: { id: true, businessName: true, logo: true } },
        seller: { select: { id: true, businessName: true, logo: true } },
      },
      orderBy: { createdAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.contract.count({ where }),
  ]);

  const contractsWithRole = contracts.map((contract) => ({
    ...contract,
    role: contract.buyerId === businessId ? 'buyer' : 'seller',
    counterparty: contract.buyerId === businessId ? contract.seller : contract.buyer,
  }));

  return {
    contracts: contractsWithRole,
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

/**
 * Update contract (draft only)
 */
const updateContract = async (contractId, businessId, updates) => {
  const contract = await prisma.contract.findFirst({
    where: {
      id: contractId,
      OR: [{ buyerId: businessId }, { sellerId: businessId }],
      status: { in: [CONTRACT_STATUS.DRAFT, CONTRACT_STATUS.NEGOTIATION] },
    },
  });

  if (!contract) {
    throw new NotFoundError('Contract');
  }

  const allowedUpdates = [
    'title', 'description', 'type', 'startDate', 'endDate',
    'autoRenew', 'renewalTermDays', 'terms', 'pricing',
    'deliveryTerms', 'paymentTerms', 'penalties',
    'totalValue', 'minOrderValue', 'maxOrderValue',
  ];

  const updateData = {};
  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      updateData[key] = updates[key];
    }
  }

  const updated = await prisma.contract.update({
    where: { id: contractId },
    data: updateData,
    include: {
      buyer: { select: { id: true, businessName: true } },
      seller: { select: { id: true, businessName: true } },
    },
  });

  await invalidateContractCache(contractId);

  logger.info('Contract updated', { contractId, businessId });

  return updated;
};

/**
 * Submit for approval
 */
const submitForApproval = async (contractId, businessId) => {
  const contract = await prisma.contract.findFirst({
    where: {
      id: contractId,
      OR: [{ buyerId: businessId }, { sellerId: businessId }],
      status: CONTRACT_STATUS.DRAFT,
    },
  });

  if (!contract) {
    throw new NotFoundError('Contract');
  }

  const updated = await prisma.contract.update({
    where: { id: contractId },
    data: { status: CONTRACT_STATUS.PENDING_APPROVAL },
  });

  // Notify counterparty
  const counterpartyId = contract.buyerId === businessId ? contract.sellerId : contract.buyerId;
  emitToBusiness(counterpartyId, 'contract:pending_approval', {
    contractId,
    contractNumber: contract.contractNumber,
  });

  logger.info('Contract submitted for approval', { contractId, businessId });

  return updated;
};

/**
 * Respond to contract (approve/reject/negotiate)
 */
const respondToContract = async (contractId, businessId, action, comments) => {
  const contract = await prisma.contract.findFirst({
    where: {
      id: contractId,
      OR: [{ buyerId: businessId }, { sellerId: businessId }],
      status: CONTRACT_STATUS.PENDING_APPROVAL,
    },
  });

  if (!contract) {
    throw new NotFoundError('Contract');
  }

  let newStatus;
  switch (action) {
    case 'approve':
      newStatus = CONTRACT_STATUS.PENDING_SIGNATURE;
      break;
    case 'reject':
      newStatus = CONTRACT_STATUS.DRAFT;
      break;
    case 'negotiate':
      newStatus = CONTRACT_STATUS.NEGOTIATION;
      break;
    default:
      throw new BadRequestError('Invalid action');
  }

  const updated = await prisma.contract.update({
    where: { id: contractId },
    data: { status: newStatus },
  });

  // Notify initiator
  const initiatorId = contract.buyerId === businessId ? contract.sellerId : contract.buyerId;
  emitToBusiness(initiatorId, `contract:${action}`, {
    contractId,
    contractNumber: contract.contractNumber,
    comments,
  });

  logger.info('Contract response', { contractId, businessId, action });

  return updated;
};

/**
 * Sign contract
 */
const signContract = async (contractId, businessId) => {
  const contract = await prisma.contract.findFirst({
    where: {
      id: contractId,
      OR: [{ buyerId: businessId }, { sellerId: businessId }],
      status: CONTRACT_STATUS.PENDING_SIGNATURE,
    },
  });

  if (!contract) {
    throw new NotFoundError('Contract');
  }

  const isBuyer = contract.buyerId === businessId;
  const updateData = isBuyer
    ? { signedByBuyer: true, buyerSignedAt: new Date() }
    : { signedBySeller: true, sellerSignedAt: new Date() };

  // Check if both have signed
  const otherSigned = isBuyer ? contract.signedBySeller : contract.signedByBuyer;
  if (otherSigned) {
    updateData.status = CONTRACT_STATUS.ACTIVE;
    updateData.activatedAt = new Date();
  }

  const updated = await prisma.contract.update({
    where: { id: contractId },
    data: updateData,
  });

  // Notify counterparty
  const counterpartyId = isBuyer ? contract.sellerId : contract.buyerId;
  emitToBusiness(counterpartyId, 'contract:signed', {
    contractId,
    contractNumber: contract.contractNumber,
    fullyExecuted: !!otherSigned,
  });

  await invalidateContractCache(contractId);

  logger.info('Contract signed', { contractId, businessId, fullyExecuted: !!otherSigned });

  return updated;
};

/**
 * Terminate contract
 */
const terminateContract = async (contractId, businessId, reason) => {
  const contract = await prisma.contract.findFirst({
    where: {
      id: contractId,
      OR: [{ buyerId: businessId }, { sellerId: businessId }],
      status: CONTRACT_STATUS.ACTIVE,
    },
  });

  if (!contract) {
    throw new NotFoundError('Contract');
  }

  const updated = await prisma.contract.update({
    where: { id: contractId },
    data: {
      status: CONTRACT_STATUS.TERMINATED,
      terminatedAt: new Date(),
      terminationReason: reason,
    },
  });

  // Notify counterparty
  const counterpartyId = contract.buyerId === businessId ? contract.sellerId : contract.buyerId;
  emitToBusiness(counterpartyId, 'contract:terminated', {
    contractId,
    contractNumber: contract.contractNumber,
    reason,
  });

  await invalidateContractCache(contractId);

  logger.info('Contract terminated', { contractId, businessId, reason });

  return updated;
};

/**
 * Renew contract
 */
const renewContract = async (contractId, businessId, newEndDate) => {
  const contract = await prisma.contract.findFirst({
    where: {
      id: contractId,
      OR: [{ buyerId: businessId }, { sellerId: businessId }],
      status: { in: [CONTRACT_STATUS.ACTIVE, CONTRACT_STATUS.EXPIRED] },
    },
  });

  if (!contract) {
    throw new NotFoundError('Contract');
  }

  const end = new Date(newEndDate);
  if (end <= new Date()) {
    throw new BadRequestError('New end date must be in the future');
  }

  // Create renewal (new contract based on old)
  const renewed = await prisma.contract.create({
    data: {
      contractNumber: generateContractNumber(),
      buyerId: contract.buyerId,
      sellerId: contract.sellerId,
      title: `${contract.title} (Renewed)`,
      description: contract.description,
      type: contract.type,
      status: CONTRACT_STATUS.PENDING_SIGNATURE,
      startDate: new Date(),
      endDate: end,
      autoRenew: contract.autoRenew,
      renewalTermDays: contract.renewalTermDays,
      terms: contract.terms,
      pricing: contract.pricing,
      deliveryTerms: contract.deliveryTerms,
      paymentTerms: contract.paymentTerms,
      penalties: contract.penalties,
      totalValue: contract.totalValue,
      minOrderValue: contract.minOrderValue,
      maxOrderValue: contract.maxOrderValue,
    },
  });

  // Update old contract
  await prisma.contract.update({
    where: { id: contractId },
    data: { status: CONTRACT_STATUS.RENEWED },
  });

  logger.info('Contract renewed', { oldContractId: contractId, newContractId: renewed.id });

  return renewed;
};

/**
 * Process expiring contracts (scheduled job)
 */
const processExpiringContracts = async () => {
  const now = new Date();
  let expired = 0;
  let autoRenewed = 0;

  // Find expired contracts
  const expiredContracts = await prisma.contract.findMany({
    where: {
      status: CONTRACT_STATUS.ACTIVE,
      endDate: { lte: now },
    },
  });

  for (const contract of expiredContracts) {
    if (contract.autoRenew && contract.renewalTermDays) {
      // Auto-renew
      const newEndDate = new Date(contract.endDate);
      newEndDate.setDate(newEndDate.getDate() + contract.renewalTermDays);

      await prisma.contract.update({
        where: { id: contract.id },
        data: { endDate: newEndDate },
      });

      // Notify both parties
      emitToBusiness(contract.buyerId, 'contract:auto_renewed', {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        newEndDate,
      });
      emitToBusiness(contract.sellerId, 'contract:auto_renewed', {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
        newEndDate,
      });

      autoRenewed++;
    } else {
      await prisma.contract.update({
        where: { id: contract.id },
        data: { status: CONTRACT_STATUS.EXPIRED },
      });

      // Notify both parties
      emitToBusiness(contract.buyerId, 'contract:expired', {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
      });
      emitToBusiness(contract.sellerId, 'contract:expired', {
        contractId: contract.id,
        contractNumber: contract.contractNumber,
      });

      expired++;
    }

    await invalidateContractCache(contract.id);
  }

  logger.info('Expiring contracts processed', { expired, autoRenewed });

  return { expired, autoRenewed };
};

/**
 * Get contract statistics
 */
const getContractStats = async (businessId) => {
  const where = { OR: [{ buyerId: businessId }, { sellerId: businessId }] };

  const [active, pending, expiringSoon, totalValue] = await Promise.all([
    prisma.contract.count({ where: { ...where, status: CONTRACT_STATUS.ACTIVE } }),
    prisma.contract.count({ where: { ...where, status: CONTRACT_STATUS.PENDING_SIGNATURE } }),
    prisma.contract.count({
      where: {
        ...where,
        status: CONTRACT_STATUS.ACTIVE,
        endDate: { lte: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) },
      },
    }),
    prisma.contract.aggregate({
      where: { ...where, status: CONTRACT_STATUS.ACTIVE },
      _sum: { totalValue: true },
    }),
  ]);

  return {
    active,
    pending,
    expiringSoon,
    totalValue: totalValue._sum.totalValue || 0,
    formattedTotalValue: formatCurrency(totalValue._sum.totalValue || 0),
  };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  CONTRACT_TYPE,
  CONTRACT_STATUS,
  createContract,
  getContractById,
  getContracts,
  updateContract,
  submitForApproval,
  respondToContract,
  signContract,
  terminateContract,
  renewContract,
  processExpiringContracts,
  getContractStats,
};



