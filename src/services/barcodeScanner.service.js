// =============================================================================
// AIRAVAT B2B MARKETPLACE - BARCODE/QR SCANNER SERVICE
// Service for scanning barcodes and QR codes to search/add products
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  supportedFormats: ['EAN13', 'EAN8', 'UPC_A', 'UPC_E', 'CODE39', 'CODE128', 'QR_CODE', 'DATA_MATRIX'],
  maxScanHistory: 100,
  cacheTimeout: 3600, // 1 hour
};

// =============================================================================
// BARCODE LOOKUP
// =============================================================================

/**
 * Look up product by barcode/SKU
 * @param {string} barcode - Barcode or SKU to search
 * @param {string} userId - User performing the search
 * @returns {Promise<Object>} Product details or null
 */
exports.lookupByBarcode = async (barcode, userId) => {
  try {
    if (!barcode || typeof barcode !== 'string') {
      throw new AppError('Valid barcode is required', 400);
    }

    const cleanBarcode = barcode.trim().toUpperCase();

    // Search in product variants by SKU
    const variant = await prisma.productVariant.findFirst({
      where: {
        OR: [
          { sku: cleanBarcode },
          { barcode: cleanBarcode },
        ],
        isActive: true,
      },
      include: {
        product: {
          include: {
            business: {
              select: { id: true, businessName: true, slug: true },
            },
            category: {
              select: { id: true, name: true, slug: true },
            },
          },
        },
      },
    });

    if (variant) {
      // Log successful scan
      await logScan(userId, cleanBarcode, 'PRODUCT_FOUND', variant.product.id);

      return {
        found: true,
        type: 'PRODUCT',
        product: {
          id: variant.product.id,
          name: variant.product.name,
          slug: variant.product.slug,
          images: variant.product.images,
          business: variant.product.business,
          category: variant.product.category,
          variant: {
            id: variant.id,
            sku: variant.sku,
            barcode: variant.barcode,
            price: variant.basePrice,
            stockQuantity: variant.stockQuantity,
            attributes: variant.attributes,
          },
        },
      };
    }

    // Search in products by HSN code
    const productByHsn = await prisma.product.findFirst({
      where: {
        hsnCode: cleanBarcode,
        status: 'ACTIVE',
      },
      include: {
        business: {
          select: { id: true, businessName: true, slug: true },
        },
        category: {
          select: { id: true, name: true, slug: true },
        },
        variants: {
          where: { isActive: true },
          take: 1,
        },
      },
    });

    if (productByHsn) {
      await logScan(userId, cleanBarcode, 'HSN_MATCH', productByHsn.id);

      return {
        found: true,
        type: 'HSN_CODE',
        product: productByHsn,
      };
    }

    // Not found - log and return
    await logScan(userId, cleanBarcode, 'NOT_FOUND', null);

    return {
      found: false,
      barcode: cleanBarcode,
      suggestions: await getSuggestions(cleanBarcode),
    };
  } catch (error) {
    logger.error('Barcode lookup error', { error: error.message, barcode });
    throw error;
  }
};

// =============================================================================
// QR CODE OPERATIONS
// =============================================================================

/**
 * Generate QR code data for a product
 * @param {string} productId - Product ID
 * @param {string} variantId - Variant ID (optional)
 * @returns {Promise<Object>} QR code data
 */
exports.generateProductQR = async (productId, variantId = null) => {
  try {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: {
        variants: variantId ? { where: { id: variantId } } : { where: { isDefault: true } },
        business: { select: { id: true, businessName: true } },
      },
    });

    if (!product) {
      throw new AppError('Product not found', 404);
    }

    const variant = product.variants[0];
    const baseUrl = process.env.APP_URL || 'https://airavat.com';

    return {
      productId: product.id,
      variantId: variant?.id,
      sku: variant?.sku,
      qrData: {
        type: 'PRODUCT',
        id: product.id,
        v: variant?.id,
        url: `${baseUrl}/p/${product.slug}`,
      },
      deepLink: `airavat://product/${product.id}`,
      webUrl: `${baseUrl}/p/${product.slug}`,
    };
  } catch (error) {
    logger.error('Generate QR error', { error: error.message, productId });
    throw error;
  }
};

/**
 * Parse QR code data
 * @param {string} qrData - Raw QR code data
 * @returns {Promise<Object>} Parsed QR code information
 */
exports.parseQRCode = async (qrData) => {
  try {
    if (!qrData) {
      throw new AppError('QR data is required', 400);
    }

    // Try to parse as JSON (internal QR)
    try {
      const parsed = JSON.parse(qrData);
      if (parsed.type === 'PRODUCT' && parsed.id) {
        return await exports.lookupByBarcode(parsed.id, null);
      }
      return { type: 'CUSTOM_DATA', data: parsed };
    } catch (e) {
      // Not JSON, try as URL or barcode
    }

    // Check if it's a URL
    if (qrData.startsWith('http') || qrData.startsWith('airavat://')) {
      return parseDeepLink(qrData);
    }

    // Treat as barcode
    return exports.lookupByBarcode(qrData, null);
  } catch (error) {
    logger.error('Parse QR error', { error: error.message });
    throw error;
  }
};

// =============================================================================
// BULK SCAN
// =============================================================================

/**
 * Process multiple barcodes at once
 * @param {string[]} barcodes - Array of barcodes
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Results for each barcode
 */
exports.bulkLookup = async (barcodes, userId) => {
  try {
    if (!Array.isArray(barcodes) || barcodes.length === 0) {
      throw new AppError('Barcodes array is required', 400);
    }

    if (barcodes.length > 50) {
      throw new AppError('Maximum 50 barcodes per request', 400);
    }

    const results = await Promise.all(
      barcodes.map(async (barcode) => {
        try {
          const result = await exports.lookupByBarcode(barcode, userId);
          return { barcode, ...result };
        } catch (error) {
          return { barcode, found: false, error: error.message };
        }
      })
    );

    const found = results.filter((r) => r.found);
    const notFound = results.filter((r) => !r.found);

    logger.info('Bulk barcode lookup completed', {
      userId,
      total: barcodes.length,
      found: found.length,
      notFound: notFound.length,
    });

    return {
      total: barcodes.length,
      found: found.length,
      notFound: notFound.length,
      results,
    };
  } catch (error) {
    logger.error('Bulk lookup error', { error: error.message, userId });
    throw error;
  }
};

// =============================================================================
// SCAN TO CART
// =============================================================================

/**
 * Scan barcode and add to cart
 * @param {string} userId - User ID
 * @param {string} barcode - Barcode to scan
 * @param {number} quantity - Quantity to add
 * @returns {Promise<Object>} Cart update result
 */
exports.scanToCart = async (userId, barcode, quantity = 1) => {
  try {
    const result = await exports.lookupByBarcode(barcode, userId);

    if (!result.found) {
      throw new AppError(`Product not found for barcode: ${barcode}`, 404);
    }

    const variant = result.product.variant || result.product.variants?.[0];

    if (!variant) {
      throw new AppError('No variant available for this product', 400);
    }

    if (variant.stockQuantity < quantity) {
      throw new AppError(`Insufficient stock. Available: ${variant.stockQuantity}`, 400);
    }

    // Get or create cart
    let cart = await prisma.cart.findFirst({
      where: { userId, status: 'ACTIVE' },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId, status: 'ACTIVE' },
      });
    }

    // Check if item already in cart
    const existingItem = await prisma.cartItem.findFirst({
      where: {
        cartId: cart.id,
        productId: result.product.id,
        variantId: variant.id,
      },
    });

    let cartItem;
    if (existingItem) {
      cartItem = await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { quantity: existingItem.quantity + quantity },
      });
    } else {
      cartItem = await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: result.product.id,
          variantId: variant.id,
          quantity,
          price: variant.price,
        },
      });
    }

    logger.info('Product added to cart via scan', {
      userId,
      barcode,
      productId: result.product.id,
      quantity,
    });

    return {
      success: true,
      product: result.product,
      cartItem,
      message: `Added ${quantity} x ${result.product.name} to cart`,
    };
  } catch (error) {
    logger.error('Scan to cart error', { error: error.message, userId, barcode });
    throw error;
  }
};

// =============================================================================
// SCAN HISTORY
// =============================================================================

/**
 * Get user's scan history
 * @param {string} userId - User ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Scan history
 */
exports.getScanHistory = async (userId, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const [scans, total] = await Promise.all([
    prisma.scanHistory.findMany({
      where: { userId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        product: {
          select: { id: true, name: true, slug: true, images: true },
        },
      },
    }),
    prisma.scanHistory.count({ where: { userId } }),
  ]);

  return {
    scans,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Clear scan history
 * @param {string} userId - User ID
 * @returns {Promise<Object>} Deletion result
 */
exports.clearScanHistory = async (userId) => {
  const result = await prisma.scanHistory.deleteMany({
    where: { userId },
  });

  logger.info('Scan history cleared', { userId, count: result.count });

  return { success: true, deleted: result.count };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Log a scan event
 */
async function logScan(userId, barcode, result, productId) {
  if (!userId) return;

  try {
    await prisma.scanHistory.create({
      data: {
        userId,
        barcode,
        result,
        productId,
      },
    });
  } catch (error) {
    logger.warn('Failed to log scan', { error: error.message });
  }
}

/**
 * Get product suggestions based on partial barcode match
 */
async function getSuggestions(barcode) {
  const suggestions = await prisma.productVariant.findMany({
    where: {
      OR: [
        { sku: { contains: barcode, mode: 'insensitive' } },
        { barcode: { contains: barcode, mode: 'insensitive' } },
      ],
      isActive: true,
    },
    take: 5,
    include: {
      product: {
        select: { id: true, name: true, slug: true, images: true },
      },
    },
  });

  return suggestions.map((s) => ({
    sku: s.sku,
    barcode: s.barcode,
    product: s.product,
  }));
}

/**
 * Parse deep link URL
 */
function parseDeepLink(url) {
  try {
    const urlObj = new URL(url);
    const path = urlObj.pathname;

    // Match product URL patterns
    if (path.includes('/p/') || path.includes('/product/')) {
      const slug = path.split('/').pop();
      return {
        type: 'PRODUCT_LINK',
        slug,
        url,
      };
    }

    // Match category
    if (path.includes('/c/') || path.includes('/category/')) {
      const slug = path.split('/').pop();
      return {
        type: 'CATEGORY_LINK',
        slug,
        url,
      };
    }

    // Match business
    if (path.includes('/b/') || path.includes('/business/')) {
      const slug = path.split('/').pop();
      return {
        type: 'BUSINESS_LINK',
        slug,
        url,
      };
    }

    return { type: 'GENERIC_LINK', url };
  } catch (error) {
    return { type: 'INVALID_URL', original: url };
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = exports;



