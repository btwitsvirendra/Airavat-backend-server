// =============================================================================
// AIRAVAT B2B MARKETPLACE - PRODUCT SERVICE
// Product catalog management with SPU/SKU model
// =============================================================================

const { prisma } = require('../config/database');
const { cache, inventory } = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} = require('../utils/errors');
const {
  generateSlug,
  generateSKU,
  isValidHSN,
} = require('../utils/helpers');
const uploadService = require('./upload.service');

const CACHE_TTL = 1800; // 30 minutes

/**
 * Create product (SPU)
 */
const createProduct = async (businessId, data) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { id: true, businessName: true, verificationStatus: true },
  });

  if (!business) {
    throw new NotFoundError('Business');
  }

  // Validate HSN code if provided
  if (data.hsnCode && !isValidHSN(data.hsnCode)) {
    throw new BadRequestError('Invalid HSN code format');
  }

  // Generate unique slug
  const slug = await generateUniqueProductSlug(businessId, data.name);

  // Create product
  const product = await prisma.product.create({
    data: {
      businessId,
      categoryId: data.categoryId,
      name: data.name,
      slug,
      brand: data.brand,
      manufacturer: data.manufacturer,
      description: data.description,
      shortDescription: data.shortDescription,
      hsnCode: data.hsnCode,
      gstRate: data.gstRate || 18,
      specifications: data.specifications || {},
      highlights: data.highlights || [],
      images: data.images || [],
      videos: data.videos || [],
      documents: data.documents || [],
      metaTitle: data.metaTitle || data.name,
      metaDescription: data.metaDescription || data.shortDescription,
      metaKeywords: data.metaKeywords || [],
      status: business.verificationStatus === 'VERIFIED' ? 'PENDING_APPROVAL' : 'DRAFT',
      minOrderQuantity: data.minOrderQuantity || 1,
      orderMultiple: data.orderMultiple || 1,
      leadTimeDays: data.leadTimeDays || 1,
      weight: data.weight,
      length: data.length,
      width: data.width,
      height: data.height,
      countryOfOrigin: data.countryOfOrigin || 'India',
      manufactureState: data.manufactureState,
      tags: data.tags || [],
    },
    include: {
      category: {
        select: { id: true, name: true, slug: true },
      },
      business: {
        select: { id: true, businessName: true, slug: true },
      },
    },
  });

  // Update business product count
  await updateProductCount(businessId);

  logger.logAudit('PRODUCT_CREATED', null, { businessId, productId: product.id });

  return product;
};

/**
 * Generate unique product slug
 */
const generateUniqueProductSlug = async (businessId, name) => {
  let slug = generateSlug(name, { unique: false });
  let counter = 0;
  let uniqueSlug = slug;

  while (true) {
    const existing = await prisma.product.findUnique({
      where: { businessId_slug: { businessId, slug: uniqueSlug } },
    });

    if (!existing) {
      return uniqueSlug;
    }

    counter++;
    uniqueSlug = `${slug}-${counter}`;
  }
};

/**
 * Update product
 */
const updateProduct = async (productId, businessId, data) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) {
    throw new NotFoundError('Product');
  }

  if (product.businessId !== businessId) {
    throw new ForbiddenError('Cannot update this product');
  }

  // If name changed, generate new slug
  let slug = product.slug;
  if (data.name && data.name !== product.name) {
    slug = await generateUniqueProductSlug(businessId, data.name);
  }

  const updatedProduct = await prisma.product.update({
    where: { id: productId },
    data: {
      ...data,
      slug,
      updatedAt: new Date(),
    },
    include: {
      category: {
        select: { id: true, name: true, slug: true },
      },
      variants: true,
    },
  });

  // Clear cache
  await cache.delPattern(`product:${productId}*`);

  logger.logAudit('PRODUCT_UPDATED', null, { productId });

  return updatedProduct;
};

/**
 * Add product variant (SKU)
 */
const addVariant = async (productId, businessId, data) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product) {
    throw new NotFoundError('Product');
  }

  if (product.businessId !== businessId) {
    throw new ForbiddenError('Cannot update this product');
  }

  // Generate SKU if not provided
  const sku = data.sku || generateSKU(
    businessId.substring(0, 3),
    product.categoryId.substring(0, 3),
    productId
  );

  // Create variant
  const variant = await prisma.productVariant.create({
    data: {
      productId,
      sku,
      barcode: data.barcode,
      variantName: data.variantName,
      attributes: data.attributes || {},
      basePrice: data.basePrice,
      comparePrice: data.comparePrice,
      costPrice: data.costPrice,
      stockQuantity: data.stockQuantity || 0,
      lowStockThreshold: data.lowStockThreshold || 10,
      trackInventory: data.trackInventory !== false,
      allowBackorder: data.allowBackorder || false,
      warehouseLocation: data.warehouseLocation,
      images: data.images,
      weight: data.weight || product.weight,
      length: data.length || product.length,
      width: data.width || product.width,
      height: data.height || product.height,
    },
  });

  // Initialize inventory in Redis
  if (data.stockQuantity) {
    await inventory.initialize(variant.id, data.stockQuantity);
  }

  // Update product price range
  await updateProductPriceRange(productId);

  logger.logAudit('VARIANT_CREATED', null, { productId, variantId: variant.id });

  return variant;
};

/**
 * Update product variant
 */
const updateVariant = async (variantId, businessId, data) => {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { product: true },
  });

  if (!variant) {
    throw new NotFoundError('Variant');
  }

  if (variant.product.businessId !== businessId) {
    throw new ForbiddenError('Cannot update this variant');
  }

  const updatedVariant = await prisma.productVariant.update({
    where: { id: variantId },
    data,
  });

  // Update Redis inventory if stock changed
  if (data.stockQuantity !== undefined) {
    await inventory.syncFromDB(variantId, data.stockQuantity);
  }

  // Update product price range
  await updateProductPriceRange(variant.productId);

  return updatedVariant;
};

/**
 * Add pricing tier to variant
 */
const addPricingTier = async (variantId, businessId, data) => {
  const variant = await prisma.productVariant.findUnique({
    where: { id: variantId },
    include: { product: true },
  });

  if (!variant || variant.product.businessId !== businessId) {
    throw new ForbiddenError('Cannot update this variant');
  }

  // Validate quantity range doesn't overlap
  const existingTiers = await prisma.pricingTier.findMany({
    where: { variantId },
    orderBy: { minQuantity: 'asc' },
  });

  for (const tier of existingTiers) {
    if (
      (data.minQuantity >= tier.minQuantity && data.minQuantity <= (tier.maxQuantity || Infinity)) ||
      (data.maxQuantity && data.maxQuantity >= tier.minQuantity && data.maxQuantity <= (tier.maxQuantity || Infinity))
    ) {
      throw new BadRequestError('Pricing tier quantity range overlaps with existing tier');
    }
  }

  return prisma.pricingTier.create({
    data: {
      variantId,
      minQuantity: data.minQuantity,
      maxQuantity: data.maxQuantity,
      unitPrice: data.unitPrice,
      customerGroupId: data.customerGroupId,
      validFrom: data.validFrom ? new Date(data.validFrom) : null,
      validUntil: data.validUntil ? new Date(data.validUntil) : null,
    },
  });
};

/**
 * Update product price range from variants
 */
const updateProductPriceRange = async (productId) => {
  const priceRange = await prisma.productVariant.aggregate({
    where: { productId, isActive: true },
    _min: { basePrice: true },
    _max: { basePrice: true },
  });

  await prisma.product.update({
    where: { id: productId },
    data: {
      minPrice: priceRange._min.basePrice,
      maxPrice: priceRange._max.basePrice,
    },
  });
};

/**
 * Update business product count
 */
const updateProductCount = async (businessId) => {
  const count = await prisma.product.count({
    where: { businessId, status: 'ACTIVE' },
  });

  await prisma.business.update({
    where: { id: businessId },
    data: { totalProducts: count },
  });
};

/**
 * Get product by ID (public)
 */
const getProductById = async (productId, options = {}) => {
  const cacheKey = `product:${productId}`;

  if (!options.skipCache) {
    const cached = await cache.get(cacheKey);
    if (cached) return cached;
  }

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: {
      category: {
        select: { id: true, name: true, slug: true, parentId: true },
      },
      business: {
        select: {
          id: true,
          businessName: true,
          slug: true,
          logo: true,
          verificationStatus: true,
          averageRating: true,
          totalReviews: true,
          responseRate: true,
          city: true,
          state: true,
        },
      },
      variants: {
        where: { isActive: true },
        include: {
          pricingTiers: {
            where: {
              OR: [
                { validUntil: null },
                { validUntil: { gte: new Date() } },
              ],
            },
            orderBy: { minQuantity: 'asc' },
          },
        },
      },
      reviews: {
        where: { isApproved: true, isHidden: false },
        take: 5,
        orderBy: { createdAt: 'desc' },
        include: {
          author: {
            select: { firstName: true, lastName: true },
          },
        },
      },
    },
  });

  if (!product) {
    throw new NotFoundError('Product');
  }

  // Increment view count
  await prisma.product.update({
    where: { id: productId },
    data: { viewCount: { increment: 1 } },
  });

  // Cache for public products
  if (product.status === 'ACTIVE') {
    await cache.set(cacheKey, product, CACHE_TTL);
  }

  return product;
};

/**
 * Get product by slug
 */
const getProductBySlug = async (businessSlug, productSlug) => {
  const business = await prisma.business.findUnique({
    where: { slug: businessSlug },
    select: { id: true },
  });

  if (!business) {
    throw new NotFoundError('Business');
  }

  const product = await prisma.product.findFirst({
    where: {
      businessId: business.id,
      slug: productSlug,
      status: 'ACTIVE',
    },
    include: {
      category: {
        select: { id: true, name: true, slug: true },
      },
      business: {
        select: {
          id: true,
          businessName: true,
          slug: true,
          logo: true,
          verificationStatus: true,
          averageRating: true,
          city: true,
          state: true,
        },
      },
      variants: {
        where: { isActive: true },
        include: {
          pricingTiers: {
            orderBy: { minQuantity: 'asc' },
          },
        },
      },
    },
  });

  if (!product) {
    throw new NotFoundError('Product');
  }

  return product;
};

/**
 * List products with filters and pagination
 */
const listProducts = async (filters = {}, pagination = {}, sort = {}) => {
  const { page = 1, limit = 20 } = pagination;
  const skip = (page - 1) * limit;

  // Build where clause
  const where = {
    status: 'ACTIVE',
    deletedAt: null,
  };

  if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }

  if (filters.businessId) {
    where.businessId = filters.businessId;
  }

  if (filters.minPrice !== undefined || filters.maxPrice !== undefined) {
    where.minPrice = {};
    if (filters.minPrice !== undefined) {
      where.minPrice.gte = parseFloat(filters.minPrice);
    }
    if (filters.maxPrice !== undefined) {
      where.maxPrice = { lte: parseFloat(filters.maxPrice) };
    }
  }

  if (filters.brand) {
    where.brand = { contains: filters.brand, mode: 'insensitive' };
  }

  if (filters.city) {
    where.business = { city: { contains: filters.city, mode: 'insensitive' } };
  }

  if (filters.state) {
    where.business = { ...where.business, state: filters.state };
  }

  if (filters.verified) {
    where.business = { ...where.business, verificationStatus: 'VERIFIED' };
  }

  if (filters.tags && filters.tags.length > 0) {
    where.tags = { hasSome: filters.tags };
  }

  if (filters.query) {
    where.OR = [
      { name: { contains: filters.query, mode: 'insensitive' } },
      { description: { contains: filters.query, mode: 'insensitive' } },
      { brand: { contains: filters.query, mode: 'insensitive' } },
      { tags: { has: filters.query.toLowerCase() } },
    ];
  }

  // Build orderBy
  let orderBy = [];
  
  // Organic ranking with paid listings boost
  if (sort.type === 'relevance' || !sort.sortBy) {
    // Mix organic and paid listings (90/10 ratio)
    orderBy = [
      { listingType: 'desc' }, // Featured/Promoted first
      { organicScore: 'desc' },
      { averageRating: 'desc' },
    ];
  } else {
    switch (sort.sortBy) {
      case 'price_low':
        orderBy = [{ minPrice: 'asc' }];
        break;
      case 'price_high':
        orderBy = [{ minPrice: 'desc' }];
        break;
      case 'rating':
        orderBy = [{ averageRating: 'desc' }, { reviewCount: 'desc' }];
        break;
      case 'newest':
        orderBy = [{ createdAt: 'desc' }];
        break;
      case 'popular':
        orderBy = [{ orderCount: 'desc' }, { viewCount: 'desc' }];
        break;
      default:
        orderBy = [{ organicScore: 'desc' }];
    }
  }

  // Execute query
  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      select: {
        id: true,
        name: true,
        slug: true,
        brand: true,
        shortDescription: true,
        images: true,
        minPrice: true,
        maxPrice: true,
        minOrderQuantity: true,
        averageRating: true,
        reviewCount: true,
        listingType: true,
        business: {
          select: {
            id: true,
            businessName: true,
            slug: true,
            verificationStatus: true,
            city: true,
            state: true,
          },
        },
        category: {
          select: {
            id: true,
            name: true,
            slug: true,
          },
        },
      },
      orderBy,
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get seller's products
 */
const getSellerProducts = async (businessId, filters = {}, pagination = {}) => {
  const { page = 1, limit = 20 } = pagination;
  const skip = (page - 1) * limit;

  const where = {
    businessId,
    deletedAt: null,
  };

  if (filters.status) {
    where.status = filters.status;
  }

  if (filters.categoryId) {
    where.categoryId = filters.categoryId;
  }

  if (filters.query) {
    where.OR = [
      { name: { contains: filters.query, mode: 'insensitive' } },
      { variants: { some: { sku: { contains: filters.query, mode: 'insensitive' } } } },
    ];
  }

  const [products, total] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        category: {
          select: { id: true, name: true },
        },
        variants: {
          select: {
            id: true,
            sku: true,
            variantName: true,
            basePrice: true,
            stockQuantity: true,
            isActive: true,
          },
        },
        _count: {
          select: { reviews: true },
        },
      },
      orderBy: { updatedAt: 'desc' },
      skip,
      take: limit,
    }),
    prisma.product.count({ where }),
  ]);

  return {
    products,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Upload product images
 */
const uploadImages = async (productId, businessId, files) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product || product.businessId !== businessId) {
    throw new ForbiddenError('Cannot update this product');
  }

  const uploadedUrls = [];

  for (const file of files) {
    const url = await uploadService.uploadFile(file, {
      folder: `products/${productId}`,
      resize: { width: 1200, height: 1200, fit: 'inside' },
    });
    uploadedUrls.push(url);
  }

  // Append to existing images
  const updatedImages = [...(product.images || []), ...uploadedUrls];

  await prisma.product.update({
    where: { id: productId },
    data: { images: updatedImages },
  });

  return { images: updatedImages };
};

/**
 * Delete product image
 */
const deleteImage = async (productId, businessId, imageUrl) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product || product.businessId !== businessId) {
    throw new ForbiddenError('Cannot update this product');
  }

  const updatedImages = (product.images || []).filter((img) => img !== imageUrl);

  await prisma.product.update({
    where: { id: productId },
    data: { images: updatedImages },
  });

  // Delete from S3
  await uploadService.deleteFile(imageUrl);

  return { images: updatedImages };
};

/**
 * Delete product (soft delete)
 */
const deleteProduct = async (productId, businessId) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
  });

  if (!product || product.businessId !== businessId) {
    throw new ForbiddenError('Cannot delete this product');
  }

  await prisma.product.update({
    where: { id: productId },
    data: {
      status: 'DISCONTINUED',
      deletedAt: new Date(),
    },
  });

  // Update product count
  await updateProductCount(businessId);

  // Clear cache
  await cache.delPattern(`product:${productId}*`);

  return { message: 'Product deleted' };
};

/**
 * Calculate organic ranking score
 */
const calculateOrganicScore = async (productId) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { business: true },
  });

  if (!product) return 0;

  const weights = config.businessRules.organicRankingWeights;
  let score = 0;

  // Trust score (25%)
  score += (product.business.trustScore / 100) * weights.trustScore;

  // Review rating (20%)
  if (product.reviewCount > 0) {
    score += (product.averageRating / 5) * weights.reviewRating;
  }

  // Review count (10%)
  const reviewScore = Math.min(product.reviewCount / 50, 1);
  score += reviewScore * weights.reviewCount;

  // Response rate (10%)
  score += (product.business.responseRate / 100) * weights.responseRate;

  // Order count (10%)
  const orderScore = Math.min(product.orderCount / 100, 1);
  score += orderScore * weights.orderCount;

  // Product quality based on completeness (10%)
  let qualityScore = 0;
  if (product.images && product.images.length >= 3) qualityScore += 0.3;
  if (product.description && product.description.length > 200) qualityScore += 0.3;
  if (product.specifications && Object.keys(product.specifications).length > 3) qualityScore += 0.2;
  if (product.highlights && product.highlights.length >= 3) qualityScore += 0.2;
  score += qualityScore * weights.productQuality;

  // Recency (10%)
  const daysSinceUpdate = Math.floor(
    (Date.now() - new Date(product.updatedAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  const recencyScore = Math.max(0, 1 - daysSinceUpdate / 90);
  score += recencyScore * weights.recency;

  // Round to integer (0-100)
  const organicScore = Math.round(score);

  await prisma.product.update({
    where: { id: productId },
    data: { organicScore },
  });

  return organicScore;
};

/**
 * Bulk update organic scores (for cron job)
 */
const updateAllOrganicScores = async () => {
  const products = await prisma.product.findMany({
    where: { status: 'ACTIVE' },
    select: { id: true },
  });

  for (const product of products) {
    await calculateOrganicScore(product.id);
  }

  logger.info(`Updated organic scores for ${products.length} products`);
};

/**
 * Get related products
 */
const getRelatedProducts = async (productId, limit = 6) => {
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { categoryId: true, businessId: true, tags: true },
  });

  if (!product) {
    throw new NotFoundError('Product');
  }

  return prisma.product.findMany({
    where: {
      id: { not: productId },
      status: 'ACTIVE',
      OR: [
        { categoryId: product.categoryId },
        { tags: { hasSome: product.tags || [] } },
      ],
    },
    select: {
      id: true,
      name: true,
      slug: true,
      images: true,
      minPrice: true,
      averageRating: true,
      business: {
        select: {
          id: true,
          businessName: true,
          slug: true,
        },
      },
    },
    orderBy: { organicScore: 'desc' },
    take: limit,
  });
};

module.exports = {
  createProduct,
  updateProduct,
  addVariant,
  updateVariant,
  addPricingTier,
  getProductById,
  getProductBySlug,
  listProducts,
  getSellerProducts,
  uploadImages,
  deleteImage,
  deleteProduct,
  calculateOrganicScore,
  updateAllOrganicScores,
  getRelatedProducts,
};
