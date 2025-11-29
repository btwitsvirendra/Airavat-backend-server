// =============================================================================
// AIRAVAT B2B MARKETPLACE - DATA PORTABILITY SERVICE
// Service for GDPR data portability (export user data)
// =============================================================================

const crypto = require('crypto');
const archiver = require('archiver');
const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  exportExpiry: 7 * 24 * 60 * 60 * 1000, // 7 days
  maxExportsPerMonth: 5,
  supportedFormats: ['json', 'csv'],
  chunkSize: 1000, // Records per chunk
};

/**
 * Export statuses
 */
const EXPORT_STATUS = {
  PENDING: 'Pending',
  PROCESSING: 'Processing',
  COMPLETED: 'Completed',
  FAILED: 'Failed',
  EXPIRED: 'Expired',
  DOWNLOADED: 'Downloaded',
};

/**
 * Data categories available for export
 */
const DATA_CATEGORIES = {
  PROFILE: {
    name: 'Profile Information',
    description: 'Personal details, contact info, preferences',
    tables: ['user'],
  },
  BUSINESS: {
    name: 'Business Information',
    description: 'Business profile, verification documents',
    tables: ['business', 'businessDocument'],
  },
  ORDERS: {
    name: 'Orders & Transactions',
    description: 'Purchase history, order details, invoices',
    tables: ['order', 'orderItem', 'invoice'],
  },
  PRODUCTS: {
    name: 'Products',
    description: 'Listed products, variants, pricing',
    tables: ['product', 'productVariant'],
  },
  COMMUNICATIONS: {
    name: 'Communications',
    description: 'Messages, notifications, emails sent',
    tables: ['message', 'notification'],
  },
  FINANCIAL: {
    name: 'Financial Data',
    description: 'Wallet transactions, payments, refunds',
    tables: ['walletTransaction', 'payment'],
  },
  ACTIVITY: {
    name: 'Activity Log',
    description: 'Login history, actions performed',
    tables: ['auditLog', 'loginHistory'],
  },
  REVIEWS: {
    name: 'Reviews & Ratings',
    description: 'Reviews written and received',
    tables: ['review'],
  },
  RFQ: {
    name: 'RFQs & Quotations',
    description: 'Request for quotes, quotations submitted',
    tables: ['rfq', 'quotation'],
  },
  PREFERENCES: {
    name: 'Preferences & Settings',
    description: 'Notification settings, display preferences',
    tables: ['userPreference', 'notificationSetting'],
  },
};

// =============================================================================
// EXPORT REQUEST
// =============================================================================

/**
 * Request data export
 * @param {string} userId - User ID
 * @param {Object} options - Export options
 * @returns {Promise<Object>} Export request details
 */
exports.requestExport = async (userId, options = {}) => {
  try {
    const {
      categories = Object.keys(DATA_CATEGORIES),
      format = 'json',
      includeAttachments = false,
    } = options;

    // Validate format
    if (!CONFIG.supportedFormats.includes(format)) {
      throw new AppError(`Unsupported format. Use: ${CONFIG.supportedFormats.join(', ')}`, 400);
    }

    // Validate categories
    const invalidCategories = categories.filter((c) => !DATA_CATEGORIES[c]);
    if (invalidCategories.length > 0) {
      throw new AppError(`Invalid categories: ${invalidCategories.join(', ')}`, 400);
    }

    // Check export limit
    const recentExports = await prisma.dataExportRequest.count({
      where: {
        userId,
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
    });

    if (recentExports >= CONFIG.maxExportsPerMonth) {
      throw new AppError(`Maximum ${CONFIG.maxExportsPerMonth} exports per month`, 429);
    }

    // Check for pending export
    const pendingExport = await prisma.dataExportRequest.findFirst({
      where: {
        userId,
        status: { in: ['PENDING', 'PROCESSING'] },
      },
    });

    if (pendingExport) {
      throw new AppError('An export is already in progress', 409);
    }

    // Create export request
    const exportId = crypto.randomBytes(16).toString('hex');

    const exportRequest = await prisma.dataExportRequest.create({
      data: {
        exportId,
        userId,
        categories,
        format,
        includeAttachments,
        status: 'PENDING',
        expiresAt: new Date(Date.now() + CONFIG.exportExpiry),
      },
    });

    // Queue export processing
    await queueExportProcessing(exportRequest.id);

    logger.info('Data export requested', { exportId, userId, categories });

    return {
      exportId,
      status: 'PENDING',
      message: 'Export request submitted. You will be notified when ready.',
      estimatedTime: calculateEstimatedTime(categories),
    };
  } catch (error) {
    logger.error('Request export error', { error: error.message, userId });
    throw error;
  }
};

/**
 * Get export status
 * @param {string} exportId - Export ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Export status
 */
exports.getExportStatus = async (exportId, userId) => {
  const exportRequest = await prisma.dataExportRequest.findFirst({
    where: { exportId, userId },
  });

  if (!exportRequest) {
    throw new AppError('Export request not found', 404);
  }

  return {
    exportId,
    status: exportRequest.status,
    statusInfo: EXPORT_STATUS[exportRequest.status],
    categories: exportRequest.categories,
    format: exportRequest.format,
    createdAt: exportRequest.createdAt,
    completedAt: exportRequest.completedAt,
    expiresAt: exportRequest.expiresAt,
    downloadUrl: exportRequest.status === 'COMPLETED' ? `/api/v1/data-portability/download/${exportId}` : null,
    fileSize: exportRequest.fileSize,
    error: exportRequest.error,
  };
};

/**
 * Get user's export history
 * @param {string} userId - User ID
 * @returns {Promise<Object[]>} Export history
 */
exports.getExportHistory = async (userId) => {
  const exports = await prisma.dataExportRequest.findMany({
    where: { userId },
    orderBy: { createdAt: 'desc' },
    take: 10,
  });

  return exports.map((exp) => ({
    exportId: exp.exportId,
    status: exp.status,
    statusInfo: EXPORT_STATUS[exp.status],
    categories: exp.categories,
    format: exp.format,
    createdAt: exp.createdAt,
    completedAt: exp.completedAt,
    expiresAt: exp.expiresAt,
    fileSize: exp.fileSize,
  }));
};

// =============================================================================
// EXPORT PROCESSING
// =============================================================================

/**
 * Process data export
 * @param {string} requestId - Export request ID
 * @returns {Promise<Object>} Processing result
 */
exports.processExport = async (requestId) => {
  try {
    const exportRequest = await prisma.dataExportRequest.findUnique({
      where: { id: requestId },
      include: { user: true },
    });

    if (!exportRequest) {
      throw new AppError('Export request not found', 404);
    }

    // Update status
    await prisma.dataExportRequest.update({
      where: { id: requestId },
      data: {
        status: 'PROCESSING',
        startedAt: new Date(),
      },
    });

    const userId = exportRequest.userId;
    const exportData = {};

    // Collect data for each category
    for (const category of exportRequest.categories) {
      exportData[category] = await collectCategoryData(category, userId);
    }

    // Generate export file
    const { filePath, fileSize } = await generateExportFile(
      exportRequest.exportId,
      exportData,
      exportRequest.format,
      exportRequest.includeAttachments
    );

    // Update request with file info
    await prisma.dataExportRequest.update({
      where: { id: requestId },
      data: {
        status: 'COMPLETED',
        completedAt: new Date(),
        filePath,
        fileSize,
      },
    });

    // Notify user
    await notifyExportReady(userId, exportRequest.exportId);

    logger.info('Data export completed', {
      exportId: exportRequest.exportId,
      userId,
      fileSize,
    });

    return { success: true, fileSize };
  } catch (error) {
    logger.error('Process export error', { error: error.message, requestId });

    await prisma.dataExportRequest.update({
      where: { id: requestId },
      data: {
        status: 'FAILED',
        error: error.message,
      },
    });

    throw error;
  }
};

/**
 * Download export file
 * @param {string} exportId - Export ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} File info for streaming
 */
exports.downloadExport = async (exportId, userId) => {
  const exportRequest = await prisma.dataExportRequest.findFirst({
    where: { exportId, userId },
  });

  if (!exportRequest) {
    throw new AppError('Export not found', 404);
  }

  if (exportRequest.status !== 'COMPLETED') {
    throw new AppError('Export not ready for download', 400);
  }

  if (exportRequest.expiresAt < new Date()) {
    throw new AppError('Export has expired', 410);
  }

  // Update download status
  await prisma.dataExportRequest.update({
    where: { id: exportRequest.id },
    data: {
      status: 'DOWNLOADED',
      downloadedAt: new Date(),
    },
  });

  const filename = `airavat-data-export-${exportId}.${exportRequest.format === 'json' ? 'zip' : 'zip'}`;

  return {
    filePath: exportRequest.filePath,
    filename,
    fileSize: exportRequest.fileSize,
    mimeType: 'application/zip',
  };
};

// =============================================================================
// DATA COLLECTION
// =============================================================================

/**
 * Collect data for a category
 */
async function collectCategoryData(category, userId) {
  const data = {};

  switch (category) {
    case 'PROFILE':
      data.user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          avatar: true,
          role: true,
          isEmailVerified: true,
          isPhoneVerified: true,
          createdAt: true,
          updatedAt: true,
          lastLoginAt: true,
        },
      });
      break;

    case 'BUSINESS':
      data.business = await prisma.business.findFirst({
        where: { ownerId: userId },
        include: {
          addresses: true,
          documents: { select: { type: true, status: true, createdAt: true } },
        },
      });
      break;

    case 'ORDERS':
      data.orders = await prisma.order.findMany({
        where: { OR: [{ buyerId: userId }, { sellerId: userId }] },
        include: {
          items: true,
        },
      });
      break;

    case 'PRODUCTS':
      const business = await prisma.business.findFirst({
        where: { ownerId: userId },
      });
      if (business) {
        data.products = await prisma.product.findMany({
          where: { businessId: business.id },
          include: {
            variants: true,
          },
        });
      }
      break;

    case 'COMMUNICATIONS':
      data.messages = await prisma.message.findMany({
        where: { OR: [{ senderId: userId }, { receiverId: userId }] },
        take: CONFIG.chunkSize,
        orderBy: { createdAt: 'desc' },
      });
      data.notifications = await prisma.notification.findMany({
        where: { userId },
        take: CONFIG.chunkSize,
        orderBy: { createdAt: 'desc' },
      });
      break;

    case 'FINANCIAL':
      data.walletTransactions = await prisma.walletTransaction.findMany({
        where: { wallet: { userId } },
        take: CONFIG.chunkSize,
        orderBy: { createdAt: 'desc' },
      });
      break;

    case 'ACTIVITY':
      data.auditLogs = await prisma.auditLog.findMany({
        where: { userId },
        take: CONFIG.chunkSize,
        orderBy: { createdAt: 'desc' },
      });
      break;

    case 'REVIEWS':
      data.reviewsWritten = await prisma.review.findMany({
        where: { userId },
      });
      data.reviewsReceived = await prisma.review.findMany({
        where: { business: { ownerId: userId } },
      });
      break;

    case 'RFQ':
      data.rfqs = await prisma.rFQ.findMany({
        where: { buyerId: userId },
        include: { quotations: true },
      });
      break;

    case 'PREFERENCES':
      data.preferences = await prisma.userPreference.findFirst({
        where: { userId },
      });
      break;
  }

  return data;
}

/**
 * Generate export file
 */
async function generateExportFile(exportId, data, format, includeAttachments) {
  const storagePath = `exports/${exportId}`;
  
  // In production, use actual file system or cloud storage
  // This is a placeholder implementation
  
  const fileSize = JSON.stringify(data).length;
  const filePath = `${storagePath}/export.zip`;

  // Create archive with data
  // In production, use archiver or similar to create actual zip

  logger.info('Export file generated', { exportId, fileSize });

  return { filePath, fileSize };
}

/**
 * Queue export processing
 */
async function queueExportProcessing(requestId) {
  // Implement with your job queue (Bull, etc.)
  // For now, process immediately in background
  setImmediate(() => exports.processExport(requestId).catch((e) => {
    logger.error('Background export failed', { error: e.message, requestId });
  }));
}

/**
 * Notify user export is ready
 */
async function notifyExportReady(userId, exportId) {
  // Send email/notification
  logger.info('Export ready notification sent', { userId, exportId });
}

/**
 * Calculate estimated processing time
 */
function calculateEstimatedTime(categories) {
  const baseTime = 30; // seconds
  const perCategory = 15; // seconds per category
  const total = baseTime + (categories.length * perCategory);
  
  if (total < 60) return `${total} seconds`;
  return `${Math.ceil(total / 60)} minutes`;
}

// =============================================================================
// SCHEDULED OPERATIONS
// =============================================================================

/**
 * Clean up expired exports
 * @returns {Promise<Object>} Cleanup result
 */
exports.cleanupExpiredExports = async () => {
  const expired = await prisma.dataExportRequest.findMany({
    where: {
      status: 'COMPLETED',
      expiresAt: { lt: new Date() },
    },
  });

  for (const exp of expired) {
    // Delete file from storage
    // await deleteFile(exp.filePath);

    await prisma.dataExportRequest.update({
      where: { id: exp.id },
      data: { status: 'EXPIRED' },
    });
  }

  logger.info('Expired exports cleaned up', { count: expired.length });

  return { cleaned: expired.length };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  DATA_CATEGORIES,
  EXPORT_STATUS,
  CONFIG,
};



