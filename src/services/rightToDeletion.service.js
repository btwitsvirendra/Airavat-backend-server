// =============================================================================
// AIRAVAT B2B MARKETPLACE - RIGHT TO DELETION SERVICE
// Service for GDPR right to be forgotten (account deletion)
// =============================================================================

const crypto = require('crypto');
const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  cooldownPeriod: 30 * 24 * 60 * 60 * 1000, // 30 days
  verificationExpiry: 24 * 60 * 60 * 1000, // 24 hours
  dataRetentionForLegal: 7 * 365 * 24 * 60 * 60 * 1000, // 7 years for financial records
};

/**
 * Deletion request statuses
 */
const DELETION_STATUS = {
  PENDING_VERIFICATION: 'Pending Email Verification',
  PENDING: 'Pending Deletion',
  COOLING_OFF: 'Cooling Off Period',
  PROCESSING: 'Processing Deletion',
  COMPLETED: 'Deleted',
  CANCELLED: 'Cancelled',
  FAILED: 'Failed',
};

/**
 * Data that cannot be deleted due to legal requirements
 */
const LEGAL_RETENTION_DATA = [
  'invoices',
  'taxRecords',
  'paymentRecords',
  'gstReturns',
  'financialAuditLogs',
];

// =============================================================================
// DELETION REQUEST
// =============================================================================

/**
 * Request account deletion
 * @param {string} userId - User ID
 * @param {Object} data - Request data
 * @returns {Promise<Object>} Deletion request details
 */
exports.requestDeletion = async (userId, data) => {
  try {
    const { reason, feedback } = data;

    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        business: true,
      },
    });

    if (!user) {
      throw new AppError('User not found', 404);
    }

    // Check for existing request
    const existingRequest = await prisma.deletionRequest.findFirst({
      where: {
        userId,
        status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] },
      },
    });

    if (existingRequest) {
      throw new AppError('Deletion request already exists', 409);
    }

    // Check for pending orders or obligations
    const pendingObligations = await checkPendingObligations(userId);
    if (pendingObligations.hasPending) {
      throw new AppError(
        `Cannot delete account with pending ${pendingObligations.type}. Please resolve first.`,
        400
      );
    }

    // Generate verification token
    const verificationToken = crypto.randomBytes(32).toString('hex');

    // Create deletion request
    const deletionRequest = await prisma.deletionRequest.create({
      data: {
        userId,
        reason,
        feedback,
        verificationToken,
        verificationExpiry: new Date(Date.now() + CONFIG.verificationExpiry),
        status: 'PENDING_VERIFICATION',
        scheduledDeletionDate: new Date(Date.now() + CONFIG.cooldownPeriod),
      },
    });

    // Send verification email
    await sendVerificationEmail(user.email, verificationToken, deletionRequest.id);

    logger.info('Deletion request created', { userId, requestId: deletionRequest.id });

    return {
      requestId: deletionRequest.id,
      status: 'PENDING_VERIFICATION',
      message: 'Please verify your email to confirm deletion request.',
      scheduledDate: deletionRequest.scheduledDeletionDate,
    };
  } catch (error) {
    logger.error('Request deletion error', { error: error.message, userId });
    throw error;
  }
};

/**
 * Verify deletion request
 * @param {string} token - Verification token
 * @returns {Promise<Object>} Verification result
 */
exports.verifyDeletionRequest = async (token) => {
  const request = await prisma.deletionRequest.findFirst({
    where: {
      verificationToken: token,
      status: 'PENDING_VERIFICATION',
    },
    include: { user: true },
  });

  if (!request) {
    throw new AppError('Invalid or expired verification token', 404);
  }

  if (request.verificationExpiry < new Date()) {
    await prisma.deletionRequest.update({
      where: { id: request.id },
      data: { status: 'CANCELLED' },
    });
    throw new AppError('Verification token has expired', 410);
  }

  // Update status to cooling off
  await prisma.deletionRequest.update({
    where: { id: request.id },
    data: {
      status: 'COOLING_OFF',
      verifiedAt: new Date(),
      verificationToken: null,
    },
  });

  // Send confirmation email
  await sendCoolingOffEmail(request.user.email, request.scheduledDeletionDate);

  logger.info('Deletion request verified', {
    userId: request.userId,
    requestId: request.id,
  });

  return {
    status: 'COOLING_OFF',
    message: 'Deletion request verified. You have 30 days to cancel.',
    scheduledDate: request.scheduledDeletionDate,
  };
};

/**
 * Cancel deletion request
 * @param {string} userId - User ID
 * @param {string} requestId - Request ID
 * @returns {Promise<Object>} Cancellation result
 */
exports.cancelDeletionRequest = async (userId, requestId) => {
  const request = await prisma.deletionRequest.findFirst({
    where: {
      id: requestId,
      userId,
      status: { in: ['PENDING_VERIFICATION', 'PENDING', 'COOLING_OFF'] },
    },
  });

  if (!request) {
    throw new AppError('Deletion request not found or cannot be cancelled', 404);
  }

  await prisma.deletionRequest.update({
    where: { id: request.id },
    data: {
      status: 'CANCELLED',
      cancelledAt: new Date(),
    },
  });

  logger.info('Deletion request cancelled', { userId, requestId });

  return {
    status: 'CANCELLED',
    message: 'Account deletion has been cancelled.',
  };
};

/**
 * Get deletion request status
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Request status
 */
exports.getDeletionStatus = async (userId) => {
  const request = await prisma.deletionRequest.findFirst({
    where: {
      userId,
      status: { notIn: ['COMPLETED', 'CANCELLED', 'FAILED'] },
    },
  });

  if (!request) {
    return {
      hasPendingRequest: false,
      canRequestDeletion: true,
    };
  }

  const daysRemaining = Math.ceil(
    (request.scheduledDeletionDate - Date.now()) / (24 * 60 * 60 * 1000)
  );

  return {
    hasPendingRequest: true,
    requestId: request.id,
    status: request.status,
    statusInfo: DELETION_STATUS[request.status],
    scheduledDate: request.scheduledDeletionDate,
    daysRemaining: Math.max(0, daysRemaining),
    canCancel: ['PENDING_VERIFICATION', 'PENDING', 'COOLING_OFF'].includes(request.status),
  };
};

// =============================================================================
// DELETION PROCESSING
// =============================================================================

/**
 * Process scheduled deletions
 * @returns {Promise<Object>} Processing result
 */
exports.processScheduledDeletions = async () => {
  const dueRequests = await prisma.deletionRequest.findMany({
    where: {
      status: 'COOLING_OFF',
      scheduledDeletionDate: { lte: new Date() },
    },
    include: { user: true },
  });

  let processed = 0;
  let failed = 0;

  for (const request of dueRequests) {
    try {
      await exports.processDeletion(request.id);
      processed++;
    } catch (error) {
      logger.error('Process deletion failed', {
        error: error.message,
        requestId: request.id,
      });
      failed++;
    }
  }

  logger.info('Scheduled deletions processed', { processed, failed });

  return { processed, failed };
};

/**
 * Process a single deletion
 * @param {string} requestId - Deletion request ID
 * @returns {Promise<Object>} Deletion result
 */
exports.processDeletion = async (requestId) => {
  try {
    const request = await prisma.deletionRequest.findUnique({
      where: { id: requestId },
      include: { user: { include: { business: true } } },
    });

    if (!request) {
      throw new AppError('Deletion request not found', 404);
    }

    if (request.status === 'COMPLETED') {
      throw new AppError('Deletion already completed', 400);
    }

    // Update status
    await prisma.deletionRequest.update({
      where: { id: requestId },
      data: { status: 'PROCESSING' },
    });

    const userId = request.userId;
    const businessId = request.user.business?.id;

    // Create deletion log
    const deletionLog = {
      userId,
      businessId,
      deletedData: [],
      retainedData: [],
      errors: [],
    };

    // Process deletion in transaction
    await prisma.$transaction(async (tx) => {
      // 1. Anonymize user data
      await anonymizeUserData(tx, userId, deletionLog);

      // 2. Delete user-related data
      await deleteUserData(tx, userId, deletionLog);

      // 3. Handle business data if owner
      if (businessId) {
        await handleBusinessDeletion(tx, businessId, deletionLog);
      }

      // 4. Retain legally required data
      await retainLegalData(tx, userId, businessId, deletionLog);

      // 5. Revoke all sessions and tokens
      await revokeAllAccess(tx, userId);
    });

    // Update request status
    await prisma.deletionRequest.update({
      where: { id: requestId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        deletionLog,
      },
    });

    // Send confirmation email (to retained email if any)
    if (request.user.email) {
      await sendDeletionConfirmationEmail(request.user.email);
    }

    logger.info('Account deletion completed', {
      requestId,
      userId,
      deletedCategories: deletionLog.deletedData,
      retainedCategories: deletionLog.retainedData,
    });

    return {
      status: 'COMPLETED',
      deletionLog,
    };
  } catch (error) {
    logger.error('Process deletion error', { error: error.message, requestId });

    await prisma.deletionRequest.update({
      where: { id: requestId },
      data: {
        status: 'FAILED',
        error: error.message,
      },
    });

    throw error;
  }
};

// =============================================================================
// DATA DELETION HELPERS
// =============================================================================

/**
 * Anonymize user data (keep structure, remove PII)
 */
async function anonymizeUserData(tx, userId, log) {
  const anonymizedId = crypto.randomBytes(8).toString('hex');

  await tx.user.update({
    where: { id: userId },
    data: {
      email: `deleted_${anonymizedId}@deleted.airavat.com`,
      firstName: 'Deleted',
      lastName: 'User',
      phone: null,
      avatar: null,
      isActive: false,
      isDeleted: true,
      deletedAt: new Date(),
    },
  });

  log.deletedData.push('user_pii');
}

/**
 * Delete user-related data
 */
async function deleteUserData(tx, userId, log) {
  // Delete wishlists
  await tx.wishlist.deleteMany({ where: { userId } });
  log.deletedData.push('wishlists');

  // Delete price alerts
  await tx.priceAlert.deleteMany({ where: { userId } });
  log.deletedData.push('price_alerts');

  // Delete cart
  await tx.cart.deleteMany({ where: { userId } });
  log.deletedData.push('cart');

  // Delete messages (keep for other party, anonymize sender)
  await tx.message.updateMany({
    where: { senderId: userId },
    data: { senderDeleted: true },
  });
  log.deletedData.push('messages_anonymized');

  // Delete notifications
  await tx.notification.deleteMany({ where: { userId } });
  log.deletedData.push('notifications');

  // Delete saved addresses (non-order related)
  await tx.address.deleteMany({
    where: { userId, orderId: null },
  });
  log.deletedData.push('addresses');

  // Delete sessions
  await tx.session.deleteMany({ where: { userId } });
  log.deletedData.push('sessions');

  // Delete refresh tokens
  await tx.refreshToken.deleteMany({ where: { userId } });
  log.deletedData.push('refresh_tokens');

  // Delete login history older than 1 year
  await tx.loginHistory.deleteMany({
    where: {
      userId,
      createdAt: { lt: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000) },
    },
  });
  log.deletedData.push('old_login_history');
}

/**
 * Handle business data deletion
 */
async function handleBusinessDeletion(tx, businessId, log) {
  // Archive products (don't delete - may have order history)
  await tx.product.updateMany({
    where: { businessId },
    data: { status: 'ARCHIVED', isDeleted: true },
  });
  log.deletedData.push('products_archived');

  // Anonymize business
  const anonymizedId = crypto.randomBytes(8).toString('hex');
  await tx.business.update({
    where: { id: businessId },
    data: {
      businessName: `Deleted Business ${anonymizedId}`,
      description: null,
      phone: null,
      email: null,
      website: null,
      logo: null,
      isActive: false,
      isDeleted: true,
      deletedAt: new Date(),
    },
  });
  log.deletedData.push('business_anonymized');
}

/**
 * Retain legally required data
 */
async function retainLegalData(tx, userId, businessId, log) {
  // Mark financial records as retained
  const retentionDate = new Date(Date.now() + CONFIG.dataRetentionForLegal);

  if (businessId) {
    // Keep invoices
    await tx.invoice.updateMany({
      where: { businessId },
      data: { retainedUntil: retentionDate },
    });
    log.retainedData.push({
      type: 'invoices',
      reason: 'Legal tax requirements',
      retainedUntil: retentionDate,
    });

    // Keep GST records
    await tx.gstReturn.updateMany({
      where: { businessId },
      data: { retainedUntil: retentionDate },
    });
    log.retainedData.push({
      type: 'gst_records',
      reason: 'Legal tax requirements',
      retainedUntil: retentionDate,
    });
  }

  // Keep payment records
  await tx.payment.updateMany({
    where: { userId },
    data: { retainedUntil: retentionDate },
  });
  log.retainedData.push({
    type: 'payment_records',
    reason: 'Financial audit requirements',
    retainedUntil: retentionDate,
  });
}

/**
 * Revoke all access tokens and sessions
 */
async function revokeAllAccess(tx, userId) {
  // Invalidate all JWT tokens by updating user's tokenVersion
  await tx.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });

  // Delete all active sessions
  await tx.session.deleteMany({ where: { userId } });

  // Delete all refresh tokens
  await tx.refreshToken.deleteMany({ where: { userId } });
}

// =============================================================================
// OBLIGATION CHECKS
// =============================================================================

/**
 * Check for pending obligations
 */
async function checkPendingObligations(userId) {
  // Check pending orders as buyer
  const pendingBuyerOrders = await prisma.order.count({
    where: {
      buyerId: userId,
      status: { in: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED'] },
    },
  });

  if (pendingBuyerOrders > 0) {
    return { hasPending: true, type: 'orders as buyer' };
  }

  // Check pending orders as seller
  const business = await prisma.business.findFirst({
    where: { ownerId: userId },
  });

  if (business) {
    const pendingSellerOrders = await prisma.order.count({
      where: {
        sellerId: business.id,
        status: { in: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED'] },
      },
    });

    if (pendingSellerOrders > 0) {
      return { hasPending: true, type: 'orders as seller' };
    }

    // Check pending wallet withdrawals
    const pendingWithdrawals = await prisma.walletTransaction.count({
      where: {
        wallet: { businessId: business.id },
        type: 'WITHDRAWAL',
        status: 'PENDING',
      },
    });

    if (pendingWithdrawals > 0) {
      return { hasPending: true, type: 'wallet withdrawals' };
    }
  }

  // Check active disputes
  const activeDisputes = await prisma.dispute.count({
    where: {
      OR: [{ raisedBy: userId }, { againstUser: userId }],
      status: { in: ['OPEN', 'UNDER_REVIEW'] },
    },
  });

  if (activeDisputes > 0) {
    return { hasPending: true, type: 'disputes' };
  }

  return { hasPending: false };
}

// =============================================================================
// EMAIL NOTIFICATIONS
// =============================================================================

async function sendVerificationEmail(email, token, requestId) {
  const verifyUrl = `${process.env.APP_URL}/api/v1/account/verify-deletion?token=${token}`;
  // Implement email sending
  logger.info('Deletion verification email sent', { email });
}

async function sendCoolingOffEmail(email, scheduledDate) {
  // Implement email sending
  logger.info('Cooling off period email sent', { email, scheduledDate });
}

async function sendDeletionConfirmationEmail(email) {
  // Implement email sending
  logger.info('Deletion confirmation email sent', { email });
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  DELETION_STATUS,
  LEGAL_RETENTION_DATA,
  CONFIG,
};



