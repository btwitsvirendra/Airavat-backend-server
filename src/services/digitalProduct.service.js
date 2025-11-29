// =============================================================================
// AIRAVAT B2B MARKETPLACE - DIGITAL PRODUCT SERVICE
// Service for managing downloadable digital products
// =============================================================================

const crypto = require('crypto');
const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  maxFileSize: 2 * 1024 * 1024 * 1024, // 2GB
  maxFilesPerProduct: 10,
  downloadLinkExpiry: 24 * 60 * 60 * 1000, // 24 hours
  defaultDownloadLimit: 5,
  allowedFileTypes: [
    'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx',
    'zip', 'rar', '7z',
    'mp3', 'wav', 'flac',
    'mp4', 'mov', 'avi',
    'jpg', 'jpeg', 'png', 'gif', 'svg', 'psd', 'ai',
    'stl', 'obj', 'fbx',
    'exe', 'dmg', 'apk',
  ],
};

/**
 * Digital product types
 */
const DIGITAL_PRODUCT_TYPES = {
  EBOOK: { name: 'E-Book', icon: 'book' },
  SOFTWARE: { name: 'Software', icon: 'code' },
  TEMPLATE: { name: 'Template', icon: 'file-text' },
  AUDIO: { name: 'Audio', icon: 'music' },
  VIDEO: { name: 'Video Course', icon: 'video' },
  GRAPHICS: { name: 'Graphics', icon: 'image' },
  DOCUMENT: { name: 'Document', icon: 'file' },
  CAD: { name: 'CAD File', icon: 'box' },
  DATASET: { name: 'Dataset', icon: 'database' },
  LICENSE: { name: 'License Key', icon: 'key' },
};

/**
 * License types
 */
const LICENSE_TYPES = {
  SINGLE_USE: 'Single User License',
  MULTI_USE: 'Multi-User License',
  ENTERPRISE: 'Enterprise License',
  PERPETUAL: 'Perpetual License',
  SUBSCRIPTION: 'Subscription Based',
  ROYALTY_FREE: 'Royalty Free',
  EXTENDED: 'Extended License',
};

// =============================================================================
// PRODUCT CREATION
// =============================================================================

/**
 * Create digital product
 * @param {string} businessId - Business ID
 * @param {Object} data - Product data
 * @returns {Promise<Object>} Created digital product
 */
exports.createDigitalProduct = async (businessId, data) => {
  try {
    const {
      name,
      description,
      productType,
      price,
      currency = 'INR',
      licenseType,
      downloadLimit,
      files = [],
      previewFiles = [],
      version,
      requirements,
      changelog,
      categoryId,
      tags = [],
    } = data;

    // Validate business
    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });

    if (!business) {
      throw new AppError('Business not found', 404);
    }

    // Validate product type
    if (productType && !DIGITAL_PRODUCT_TYPES[productType]) {
      throw new AppError(`Invalid product type: ${productType}`, 400);
    }

    // Create the product
    const product = await prisma.product.create({
      data: {
        businessId,
        name,
        description,
        isDigital: true,
        categoryId,
        tags,
        status: 'DRAFT',
        digitalProduct: {
          create: {
            productType: productType || 'DOCUMENT',
            licenseType: licenseType || 'SINGLE_USE',
            downloadLimit: downloadLimit || CONFIG.defaultDownloadLimit,
            version: version || '1.0.0',
            requirements,
            changelog,
          },
        },
        variants: {
          create: {
            name: 'Default',
            sku: generateSKU(name),
            basePrice: price,
            isDefault: true,
            isActive: true,
            stockQuantity: -1, // Unlimited for digital
          },
        },
      },
      include: {
        digitalProduct: true,
        variants: true,
      },
    });

    logger.info('Digital product created', {
      productId: product.id,
      businessId,
      productType,
    });

    return product;
  } catch (error) {
    logger.error('Create digital product error', { error: error.message, businessId });
    throw error;
  }
};

// =============================================================================
// FILE MANAGEMENT
// =============================================================================

/**
 * Add file to digital product
 * @param {string} productId - Product ID
 * @param {string} userId - User ID
 * @param {Object} fileData - File metadata
 * @returns {Promise<Object>} Added file
 */
exports.addFile = async (productId, userId, fileData) => {
  try {
    const {
      filename,
      fileSize,
      mimeType,
      description,
      isPreview = false,
      version,
    } = fileData;

    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        business: true,
        digitalProduct: {
          include: { files: true },
        },
      },
    });

    if (!product || !product.isDigital) {
      throw new AppError('Digital product not found', 404);
    }

    if (product.business.ownerId !== userId) {
      throw new AppError('Not authorized', 403);
    }

    // Check file limit
    const mainFiles = product.digitalProduct.files.filter((f) => !f.isPreview);
    if (!isPreview && mainFiles.length >= CONFIG.maxFilesPerProduct) {
      throw new AppError(`Maximum ${CONFIG.maxFilesPerProduct} files allowed`, 400);
    }

    // Validate file type
    const extension = filename.split('.').pop().toLowerCase();
    if (!CONFIG.allowedFileTypes.includes(extension)) {
      throw new AppError(`File type not allowed: ${extension}`, 400);
    }

    if (fileSize > CONFIG.maxFileSize) {
      throw new AppError(`File too large. Maximum: ${CONFIG.maxFileSize / (1024 * 1024 * 1024)}GB`, 400);
    }

    // Generate storage path
    const fileId = crypto.randomBytes(16).toString('hex');
    const storagePath = `digital/${productId}/${fileId}/${filename}`;

    // Create file record
    const file = await prisma.digitalProductFile.create({
      data: {
        digitalProductId: product.digitalProduct.id,
        fileId,
        filename,
        storagePath,
        fileSize,
        mimeType,
        description,
        isPreview,
        version: version || product.digitalProduct.version,
        status: 'PENDING',
      },
    });

    // Generate upload URL
    const uploadUrl = await generateUploadUrl(storagePath, mimeType);

    return {
      fileId: file.id,
      uploadUrl,
      expiresIn: 3600,
    };
  } catch (error) {
    logger.error('Add file error', { error: error.message, productId });
    throw error;
  }
};

/**
 * Complete file upload
 * @param {string} fileId - File ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Updated file
 */
exports.completeFileUpload = async (fileId, userId) => {
  const file = await prisma.digitalProductFile.findUnique({
    where: { id: fileId },
    include: {
      digitalProduct: {
        include: {
          product: { include: { business: true } },
        },
      },
    },
  });

  if (!file) {
    throw new AppError('File not found', 404);
  }

  if (file.digitalProduct.product.business.ownerId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  const updated = await prisma.digitalProductFile.update({
    where: { id: fileId },
    data: {
      status: 'READY',
      uploadedAt: new Date(),
    },
  });

  logger.info('File upload completed', { fileId });

  return updated;
};

/**
 * Remove file from product
 * @param {string} fileId - File ID
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Deletion result
 */
exports.removeFile = async (fileId, userId) => {
  const file = await prisma.digitalProductFile.findUnique({
    where: { id: fileId },
    include: {
      digitalProduct: {
        include: {
          product: { include: { business: true } },
        },
      },
    },
  });

  if (!file) {
    throw new AppError('File not found', 404);
  }

  if (file.digitalProduct.product.business.ownerId !== userId) {
    throw new AppError('Not authorized', 403);
  }

  await prisma.digitalProductFile.update({
    where: { id: fileId },
    data: {
      status: 'DELETED',
      deletedAt: new Date(),
    },
  });

  // Queue storage cleanup
  await queueFileCleanup(file.storagePath);

  return { success: true };
};

// =============================================================================
// DOWNLOAD MANAGEMENT
// =============================================================================

/**
 * Generate download link
 * @param {string} orderId - Order ID
 * @param {string} fileId - File ID
 * @param {string} userId - Buyer user ID
 * @returns {Promise<Object>} Download link
 */
exports.generateDownloadLink = async (orderId, fileId, userId) => {
  try {
    // Verify purchase
    const orderItem = await prisma.orderItem.findFirst({
      where: {
        order: {
          id: orderId,
          buyerId: userId,
          status: { in: ['COMPLETED', 'DELIVERED'] },
        },
        product: { isDigital: true },
      },
      include: {
        product: {
          include: {
            digitalProduct: {
              include: { files: { where: { id: fileId, status: 'READY' } } },
            },
          },
        },
        order: true,
      },
    });

    if (!orderItem) {
      throw new AppError('Purchase not found or not authorized', 404);
    }

    const file = orderItem.product.digitalProduct?.files[0];
    if (!file) {
      throw new AppError('File not found', 404);
    }

    // Check download limit
    const downloadCount = await prisma.digitalDownload.count({
      where: {
        orderItemId: orderItem.id,
        fileId: file.id,
      },
    });

    const limit = orderItem.product.digitalProduct.downloadLimit;
    if (limit > 0 && downloadCount >= limit) {
      throw new AppError(`Download limit reached (${limit} downloads)`, 403);
    }

    // Generate secure download token
    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + CONFIG.downloadLinkExpiry);

    // Store download token
    await prisma.downloadToken.create({
      data: {
        token,
        fileId: file.id,
        orderItemId: orderItem.id,
        userId,
        expiresAt,
      },
    });

    const downloadUrl = `${process.env.APP_URL}/api/v1/digital/download/${token}`;

    return {
      downloadUrl,
      filename: file.filename,
      fileSize: file.fileSize,
      expiresAt,
      downloadsRemaining: limit > 0 ? limit - downloadCount - 1 : 'Unlimited',
    };
  } catch (error) {
    logger.error('Generate download link error', { error: error.message, orderId, fileId });
    throw error;
  }
};

/**
 * Process download request
 * @param {string} token - Download token
 * @returns {Promise<Object>} File info for streaming
 */
exports.processDownload = async (token) => {
  const downloadToken = await prisma.downloadToken.findUnique({
    where: { token },
    include: {
      file: true,
      orderItem: {
        include: {
          order: true,
          product: { include: { digitalProduct: true } },
        },
      },
    },
  });

  if (!downloadToken) {
    throw new AppError('Invalid download link', 404);
  }

  if (downloadToken.expiresAt < new Date()) {
    throw new AppError('Download link expired', 410);
  }

  if (downloadToken.usedAt) {
    throw new AppError('Download link already used', 410);
  }

  // Mark token as used
  await prisma.downloadToken.update({
    where: { id: downloadToken.id },
    data: { usedAt: new Date() },
  });

  // Record download
  await prisma.digitalDownload.create({
    data: {
      fileId: downloadToken.file.id,
      orderItemId: downloadToken.orderItem.id,
      userId: downloadToken.userId,
      ipAddress: null, // Set from request
    },
  });

  // Update download count
  await prisma.digitalProductFile.update({
    where: { id: downloadToken.file.id },
    data: { downloadCount: { increment: 1 } },
  });

  logger.info('Download processed', {
    fileId: downloadToken.file.id,
    userId: downloadToken.userId,
  });

  return {
    storagePath: downloadToken.file.storagePath,
    filename: downloadToken.file.filename,
    mimeType: downloadToken.file.mimeType,
    fileSize: downloadToken.file.fileSize,
  };
};

// =============================================================================
// LICENSE KEY MANAGEMENT
// =============================================================================

/**
 * Generate license key for purchase
 * @param {string} orderItemId - Order item ID
 * @returns {Promise<Object>} Generated license
 */
exports.generateLicenseKey = async (orderItemId) => {
  const orderItem = await prisma.orderItem.findUnique({
    where: { id: orderItemId },
    include: {
      product: { include: { digitalProduct: true } },
      order: true,
    },
  });

  if (!orderItem || !orderItem.product.digitalProduct) {
    throw new AppError('Digital product order not found', 404);
  }

  // Generate unique license key
  const licenseKey = generateLicenseKeyFormat(orderItem.product.digitalProduct.productType);

  const license = await prisma.digitalLicense.create({
    data: {
      orderItemId,
      productId: orderItem.productId,
      buyerId: orderItem.order.buyerId,
      licenseKey,
      licenseType: orderItem.product.digitalProduct.licenseType,
      isActive: true,
      activatedAt: new Date(),
      expiresAt: calculateLicenseExpiry(orderItem.product.digitalProduct.licenseType),
      maxActivations: getLicenseActivationLimit(orderItem.product.digitalProduct.licenseType),
      currentActivations: 0,
    },
  });

  logger.info('License key generated', {
    licenseId: license.id,
    orderItemId,
  });

  return license;
};

/**
 * Validate and activate license
 * @param {string} licenseKey - License key
 * @param {string} machineId - Machine identifier
 * @returns {Promise<Object>} Activation result
 */
exports.activateLicense = async (licenseKey, machineId) => {
  const license = await prisma.digitalLicense.findUnique({
    where: { licenseKey },
    include: { product: true },
  });

  if (!license) {
    throw new AppError('Invalid license key', 404);
  }

  if (!license.isActive) {
    throw new AppError('License is deactivated', 400);
  }

  if (license.expiresAt && license.expiresAt < new Date()) {
    throw new AppError('License has expired', 400);
  }

  // Check activation limit
  if (license.currentActivations >= license.maxActivations) {
    // Check if this machine is already activated
    const existingActivation = await prisma.licenseActivation.findFirst({
      where: {
        licenseId: license.id,
        machineId,
        isActive: true,
      },
    });

    if (!existingActivation) {
      throw new AppError('Maximum activations reached', 400);
    }

    return {
      success: true,
      message: 'Already activated on this device',
      license: {
        key: license.licenseKey,
        type: license.licenseType,
        expiresAt: license.expiresAt,
      },
    };
  }

  // Create activation
  await prisma.licenseActivation.create({
    data: {
      licenseId: license.id,
      machineId,
      activatedAt: new Date(),
      isActive: true,
    },
  });

  // Update activation count
  await prisma.digitalLicense.update({
    where: { id: license.id },
    data: { currentActivations: { increment: 1 } },
  });

  logger.info('License activated', {
    licenseId: license.id,
    machineId,
  });

  return {
    success: true,
    message: 'License activated successfully',
    license: {
      key: license.licenseKey,
      type: license.licenseType,
      product: license.product.name,
      expiresAt: license.expiresAt,
      activationsRemaining: license.maxActivations - license.currentActivations - 1,
    },
  };
};

/**
 * Deactivate license from device
 * @param {string} licenseKey - License key
 * @param {string} machineId - Machine identifier
 * @returns {Promise<Object>} Deactivation result
 */
exports.deactivateLicense = async (licenseKey, machineId) => {
  const license = await prisma.digitalLicense.findUnique({
    where: { licenseKey },
  });

  if (!license) {
    throw new AppError('Invalid license key', 404);
  }

  const activation = await prisma.licenseActivation.findFirst({
    where: {
      licenseId: license.id,
      machineId,
      isActive: true,
    },
  });

  if (!activation) {
    throw new AppError('No active activation found for this device', 404);
  }

  await prisma.licenseActivation.update({
    where: { id: activation.id },
    data: { isActive: false, deactivatedAt: new Date() },
  });

  await prisma.digitalLicense.update({
    where: { id: license.id },
    data: { currentActivations: { decrement: 1 } },
  });

  return { success: true };
};

// =============================================================================
// BUYER PURCHASES
// =============================================================================

/**
 * Get buyer's digital purchases
 * @param {string} userId - Buyer user ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Purchased products
 */
exports.getMyPurchases = async (userId, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const [purchases, total] = await Promise.all([
    prisma.orderItem.findMany({
      where: {
        order: {
          buyerId: userId,
          status: { in: ['COMPLETED', 'DELIVERED'] },
        },
        product: { isDigital: true },
      },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          include: {
            digitalProduct: {
              include: {
                files: { where: { status: 'READY', isPreview: false } },
              },
            },
          },
        },
        order: { select: { id: true, orderNumber: true, createdAt: true } },
      },
    }),
    prisma.orderItem.count({
      where: {
        order: {
          buyerId: userId,
          status: { in: ['COMPLETED', 'DELIVERED'] },
        },
        product: { isDigital: true },
      },
    }),
  ]);

  // Get download counts for each purchase
  const purchasesWithCounts = await Promise.all(
    purchases.map(async (purchase) => {
      const downloadCount = await prisma.digitalDownload.count({
        where: { orderItemId: purchase.id },
      });

      const license = await prisma.digitalLicense.findFirst({
        where: { orderItemId: purchase.id },
      });

      return {
        ...purchase,
        downloadCount,
        license: license ? {
          key: license.licenseKey,
          type: license.licenseType,
          expiresAt: license.expiresAt,
        } : null,
      };
    })
  );

  return {
    purchases: purchasesWithCounts,
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

/**
 * Generate SKU for digital product
 */
function generateSKU(name) {
  const prefix = name.substring(0, 3).toUpperCase().replace(/[^A-Z]/g, 'X');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `DIG-${prefix}-${random}`;
}

/**
 * Generate upload URL
 */
async function generateUploadUrl(storagePath, mimeType) {
  const baseUrl = process.env.STORAGE_URL || 'https://storage.airavat.com';
  return `${baseUrl}/${storagePath}?upload=true`;
}

/**
 * Queue file cleanup
 */
async function queueFileCleanup(storagePath) {
  logger.info('File cleanup queued', { storagePath });
}

/**
 * Generate license key format
 */
function generateLicenseKeyFormat(productType) {
  const segments = [];
  for (let i = 0; i < 4; i++) {
    segments.push(crypto.randomBytes(2).toString('hex').toUpperCase());
  }
  return segments.join('-');
}

/**
 * Calculate license expiry
 */
function calculateLicenseExpiry(licenseType) {
  switch (licenseType) {
    case 'SUBSCRIPTION':
      return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000); // 1 year
    case 'PERPETUAL':
    case 'ROYALTY_FREE':
      return null; // Never expires
    default:
      return new Date(Date.now() + 365 * 24 * 60 * 60 * 1000);
  }
}

/**
 * Get license activation limit
 */
function getLicenseActivationLimit(licenseType) {
  switch (licenseType) {
    case 'SINGLE_USE':
      return 1;
    case 'MULTI_USE':
      return 5;
    case 'ENTERPRISE':
      return 100;
    default:
      return 3;
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  DIGITAL_PRODUCT_TYPES,
  LICENSE_TYPES,
  CONFIG,
};



