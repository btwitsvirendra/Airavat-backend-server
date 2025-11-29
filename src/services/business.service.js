// =============================================================================
// AIRAVAT B2B MARKETPLACE - BUSINESS SERVICE
// Business profile management, verification, and settings
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
  ConflictError,
  ForbiddenError,
} = require('../utils/errors');
const {
  generateSlug,
  isValidGSTIN,
  isValidPAN,
  isValidIFSC,
  maskGSTIN,
  maskPAN,
} = require('../utils/helpers');
const uploadService = require('./upload.service');
const gstService = require('./gst.service');

const CACHE_TTL = 3600; // 1 hour

/**
 * Create business profile
 */
const createBusiness = async (userId, data) => {
  // Check if user already has a business
  const existingBusiness = await prisma.business.findUnique({
    where: { ownerId: userId },
  });

  if (existingBusiness) {
    throw new ConflictError('You already have a business profile');
  }

  // Validate GSTIN if provided
  if (data.gstin) {
    if (!isValidGSTIN(data.gstin)) {
      throw new BadRequestError('Invalid GSTIN format');
    }

    // Check if GSTIN is already registered
    const existingGSTIN = await prisma.business.findUnique({
      where: { gstin: data.gstin },
    });

    if (existingGSTIN) {
      throw new ConflictError('This GSTIN is already registered');
    }
  }

  // Generate unique slug
  const slug = await generateUniqueSlug(data.businessName);

  // Create business
  const business = await prisma.business.create({
    data: {
      ownerId: userId,
      businessName: data.businessName,
      legalName: data.legalName,
      slug,
      businessType: data.businessType,
      description: data.description,
      shortDescription: data.shortDescription,
      email: data.email,
      phone: data.phone,
      alternatePhone: data.alternatePhone,
      website: data.website,
      addressLine1: data.addressLine1,
      addressLine2: data.addressLine2,
      city: data.city,
      state: data.state,
      pincode: data.pincode,
      gstin: data.gstin,
      pan: data.pan,
      establishedYear: data.establishedYear,
      verificationStatus: 'PENDING',
    },
    include: {
      owner: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  });

  // Update user role if needed
  await prisma.user.update({
    where: { id: userId },
    data: {
      role: data.businessType === 'RETAILER' ? 'BUYER' : 'SELLER',
    },
  });

  // Create default settings
  await prisma.businessSettings.create({
    data: {
      businessId: business.id,
      acceptedPaymentMethods: ['UPI', 'NETBANKING', 'CREDIT_CARD', 'DEBIT_CARD'],
    },
  });

  logger.logAudit('BUSINESS_CREATED', userId, { businessId: business.id });

  return business;
};

/**
 * Generate unique slug
 */
const generateUniqueSlug = async (name) => {
  let slug = generateSlug(name, { unique: false });
  let counter = 0;
  let uniqueSlug = slug;

  while (true) {
    const existing = await prisma.business.findUnique({
      where: { slug: uniqueSlug },
    });

    if (!existing) {
      return uniqueSlug;
    }

    counter++;
    uniqueSlug = `${slug}-${counter}`;
  }
};

/**
 * Get business by ID
 */
const getBusinessById = async (businessId, includePrivate = false) => {
  const cacheKey = `business:${businessId}`;
  
  // Try cache first
  const cached = await cache.get(cacheKey);
  if (cached && !includePrivate) {
    return cached;
  }

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      owner: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
          email: includePrivate,
          phone: includePrivate,
        },
      },
      categories: {
        include: {
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      },
      settings: includePrivate,
      subscription: includePrivate
        ? {
            include: {
              plan: true,
            },
          }
        : false,
    },
  });

  if (!business) {
    throw new NotFoundError('Business');
  }

  // Mask sensitive data for public view
  if (!includePrivate) {
    business.gstin = business.gstin ? maskGSTIN(business.gstin) : null;
    business.pan = business.pan ? maskPAN(business.pan) : null;
    delete business.bankAccountNumber;
    delete business.bankIfsc;
    delete business.razorpayAccountId;
    
    // Cache public data
    await cache.set(cacheKey, business, CACHE_TTL);
  }

  return business;
};

/**
 * Get business by slug (public)
 */
const getBusinessBySlug = async (slug) => {
  const cacheKey = `business:slug:${slug}`;
  
  const cached = await cache.get(cacheKey);
  if (cached) {
    return cached;
  }

  const business = await prisma.business.findUnique({
    where: { slug },
    include: {
      owner: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
      categories: {
        include: {
          category: {
            select: {
              id: true,
              name: true,
              slug: true,
            },
          },
        },
      },
    },
  });

  if (!business) {
    throw new NotFoundError('Business');
  }

  // Mask sensitive data
  const publicBusiness = {
    ...business,
    gstin: business.gstin ? maskGSTIN(business.gstin) : null,
    pan: null,
    bankAccountNumber: undefined,
    bankIfsc: undefined,
    razorpayAccountId: undefined,
  };

  await cache.set(cacheKey, publicBusiness, CACHE_TTL);

  return publicBusiness;
};

/**
 * Update business profile
 */
const updateBusiness = async (businessId, userId, data) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!business) {
    throw new NotFoundError('Business');
  }

  if (business.ownerId !== userId) {
    throw new ForbiddenError('You can only update your own business');
  }

  // If updating GSTIN, validate and check uniqueness
  if (data.gstin && data.gstin !== business.gstin) {
    if (!isValidGSTIN(data.gstin)) {
      throw new BadRequestError('Invalid GSTIN format');
    }

    const existingGSTIN = await prisma.business.findUnique({
      where: { gstin: data.gstin },
    });

    if (existingGSTIN) {
      throw new ConflictError('This GSTIN is already registered');
    }

    // Reset verification status if GSTIN changed
    data.gstVerified = false;
    data.verificationStatus = 'PENDING';
  }

  // Update business
  const updatedBusiness = await prisma.business.update({
    where: { id: businessId },
    data: {
      ...data,
      updatedAt: new Date(),
    },
  });

  // Clear cache
  await cache.delPattern(`business:${businessId}*`);
  await cache.del(`business:slug:${business.slug}`);

  logger.logAudit('BUSINESS_UPDATED', userId, { businessId });

  return updatedBusiness;
};

/**
 * Upload business logo
 */
const uploadLogo = async (businessId, userId, file) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!business || business.ownerId !== userId) {
    throw new ForbiddenError('Cannot update this business');
  }

  // Upload to S3
  const url = await uploadService.uploadFile(file, {
    folder: `businesses/${businessId}/logo`,
    resize: { width: 400, height: 400, fit: 'contain' },
  });

  // Update business
  await prisma.business.update({
    where: { id: businessId },
    data: { logo: url },
  });

  // Clear cache
  await cache.delPattern(`business:${businessId}*`);

  return { logo: url };
};

/**
 * Upload business banner
 */
const uploadBanner = async (businessId, userId, file) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!business || business.ownerId !== userId) {
    throw new ForbiddenError('Cannot update this business');
  }

  const url = await uploadService.uploadFile(file, {
    folder: `businesses/${businessId}/banner`,
    resize: { width: 1920, height: 400, fit: 'cover' },
  });

  await prisma.business.update({
    where: { id: businessId },
    data: { banner: url },
  });

  await cache.delPattern(`business:${businessId}*`);

  return { banner: url };
};

/**
 * Add business document for verification
 */
const addDocument = async (businessId, userId, data, file) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!business || business.ownerId !== userId) {
    throw new ForbiddenError('Cannot update this business');
  }

  // Upload document
  const url = await uploadService.uploadFile(file, {
    folder: `businesses/${businessId}/documents`,
    allowedTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  });

  // Create document record
  const document = await prisma.businessDocument.create({
    data: {
      businessId,
      type: data.type,
      name: data.name || file.originalname,
      fileUrl: url,
      fileSize: file.size,
      mimeType: file.mimetype,
      expiryDate: data.expiryDate ? new Date(data.expiryDate) : null,
    },
  });

  logger.logAudit('DOCUMENT_UPLOADED', userId, { businessId, documentId: document.id });

  return document;
};

/**
 * Get business documents
 */
const getDocuments = async (businessId, userId) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!business || business.ownerId !== userId) {
    throw new ForbiddenError('Cannot access this business');
  }

  return prisma.businessDocument.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * Verify GSTIN using GST API
 */
const verifyGSTIN = async (businessId, userId) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!business || business.ownerId !== userId) {
    throw new ForbiddenError('Cannot verify this business');
  }

  if (!business.gstin) {
    throw new BadRequestError('GSTIN not provided');
  }

  if (business.gstVerified) {
    throw new BadRequestError('GSTIN already verified');
  }

  // Call GST verification API
  const gstData = await gstService.verifyGSTIN(business.gstin);

  if (!gstData.valid) {
    throw new BadRequestError('Invalid GSTIN');
  }

  // Update business with verified GST data
  await prisma.business.update({
    where: { id: businessId },
    data: {
      gstVerified: true,
      legalName: gstData.legalName || business.legalName,
      // Can update other GST-related fields
    },
  });

  logger.logAudit('GSTIN_VERIFIED', userId, { businessId, gstin: business.gstin });

  return { verified: true, gstData };
};

/**
 * Update business settings
 */
const updateSettings = async (businessId, userId, settings) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!business || business.ownerId !== userId) {
    throw new ForbiddenError('Cannot update this business');
  }

  const updatedSettings = await prisma.businessSettings.upsert({
    where: { businessId },
    update: settings,
    create: {
      businessId,
      ...settings,
    },
  });

  logger.logAudit('SETTINGS_UPDATED', userId, { businessId });

  return updatedSettings;
};

/**
 * Get business settings
 */
const getSettings = async (businessId, userId) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!business || business.ownerId !== userId) {
    throw new ForbiddenError('Cannot access this business');
  }

  let settings = await prisma.businessSettings.findUnique({
    where: { businessId },
  });

  if (!settings) {
    settings = await prisma.businessSettings.create({
      data: { businessId },
    });
  }

  return settings;
};

/**
 * Add business address
 */
const addAddress = async (businessId, userId, addressData) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!business || business.ownerId !== userId) {
    throw new ForbiddenError('Cannot update this business');
  }

  // If setting as default, unset other defaults
  if (addressData.isDefault) {
    await prisma.businessAddress.updateMany({
      where: { businessId, type: addressData.type },
      data: { isDefault: false },
    });
  }

  const address = await prisma.businessAddress.create({
    data: {
      businessId,
      ...addressData,
    },
  });

  return address;
};

/**
 * Get business addresses
 */
const getAddresses = async (businessId) => {
  return prisma.businessAddress.findMany({
    where: { businessId, isActive: true },
    orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
  });
};

/**
 * Update business address
 */
const updateAddress = async (businessId, addressId, userId, data) => {
  const address = await prisma.businessAddress.findFirst({
    where: { id: addressId, businessId },
    include: { business: true },
  });

  if (!address || address.business.ownerId !== userId) {
    throw new ForbiddenError('Cannot update this address');
  }

  if (data.isDefault) {
    await prisma.businessAddress.updateMany({
      where: { businessId, type: address.type, NOT: { id: addressId } },
      data: { isDefault: false },
    });
  }

  return prisma.businessAddress.update({
    where: { id: addressId },
    data,
  });
};

/**
 * Delete business address
 */
const deleteAddress = async (businessId, addressId, userId) => {
  const address = await prisma.businessAddress.findFirst({
    where: { id: addressId, businessId },
    include: { business: true },
  });

  if (!address || address.business.ownerId !== userId) {
    throw new ForbiddenError('Cannot delete this address');
  }

  await prisma.businessAddress.update({
    where: { id: addressId },
    data: { isActive: false },
  });

  return { message: 'Address deleted' };
};

/**
 * Calculate and update trust score
 */
const updateTrustScore = async (businessId) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!business) return;

  const weights = config.businessRules.trustScoreWeights;
  let score = 0;

  // Verification status (30%)
  if (business.verificationStatus === 'VERIFIED') {
    score += weights.verificationStatus;
  } else if (business.verificationStatus === 'UNDER_REVIEW') {
    score += weights.verificationStatus * 0.5;
  }

  // Review rating (25%)
  if (business.totalReviews > 0) {
    score += (business.averageRating / 5) * weights.reviewRating;
  }

  // Response rate (15%)
  score += (business.responseRate / 100) * weights.responseRate;

  // Order completion (15%) - calculated from orders
  const orderStats = await prisma.order.groupBy({
    by: ['status'],
    where: { sellerId: businessId },
    _count: true,
  });

  const totalOrders = orderStats.reduce((sum, s) => sum + s._count, 0);
  const completedOrders = orderStats.find((s) => s.status === 'COMPLETED')?._count || 0;

  if (totalOrders > 0) {
    const completionRate = completedOrders / totalOrders;
    score += completionRate * weights.orderCompletion;
  }

  // Account age (10%)
  const accountAgeDays = Math.floor(
    (Date.now() - new Date(business.createdAt).getTime()) / (1000 * 60 * 60 * 24)
  );
  const ageScore = Math.min(accountAgeDays / 365, 1); // Max 1 year for full score
  score += ageScore * weights.accountAge;

  // Document verification (5%)
  const verifiedDocs = await prisma.businessDocument.count({
    where: { businessId, isVerified: true },
  });
  if (verifiedDocs >= 3) {
    score += weights.documentVerification;
  } else if (verifiedDocs >= 1) {
    score += weights.documentVerification * 0.5;
  }

  // Round to integer
  const trustScore = Math.round(score);

  await prisma.business.update({
    where: { id: businessId },
    data: { trustScore },
  });

  return trustScore;
};

/**
 * Search businesses
 */
const searchBusinesses = async (query, filters = {}, pagination = {}) => {
  const { page = 1, limit = 20 } = pagination;
  const skip = (page - 1) * limit;

  const where = {
    verificationStatus: 'VERIFIED',
    deletedAt: null,
  };

  if (query) {
    where.OR = [
      { businessName: { contains: query, mode: 'insensitive' } },
      { description: { contains: query, mode: 'insensitive' } },
    ];
  }

  if (filters.businessType) {
    where.businessType = filters.businessType;
  }

  if (filters.city) {
    where.city = { contains: filters.city, mode: 'insensitive' };
  }

  if (filters.state) {
    where.state = filters.state;
  }

  if (filters.categoryId) {
    where.categories = {
      some: { categoryId: filters.categoryId },
    };
  }

  const [businesses, total] = await Promise.all([
    prisma.business.findMany({
      where,
      select: {
        id: true,
        businessName: true,
        slug: true,
        businessType: true,
        shortDescription: true,
        logo: true,
        city: true,
        state: true,
        averageRating: true,
        totalReviews: true,
        trustScore: true,
        verificationStatus: true,
        totalProducts: true,
        responseRate: true,
      },
      orderBy: [{ trustScore: 'desc' }, { averageRating: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.business.count({ where }),
  ]);

  return {
    businesses,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get business statistics
 */
const getBusinessStats = async (businessId, userId) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });

  if (!business || business.ownerId !== userId) {
    throw new ForbiddenError('Cannot access this business');
  }

  const [
    totalProducts,
    activeProducts,
    totalOrders,
    pendingOrders,
    totalRevenue,
    unreadMessages,
    activeRFQs,
  ] = await Promise.all([
    prisma.product.count({ where: { businessId } }),
    prisma.product.count({ where: { businessId, status: 'ACTIVE' } }),
    prisma.order.count({ where: { sellerId: businessId } }),
    prisma.order.count({
      where: {
        sellerId: businessId,
        status: { in: ['PAID', 'CONFIRMED', 'PROCESSING'] },
      },
    }),
    prisma.order.aggregate({
      where: { sellerId: businessId, status: { in: ['DELIVERED', 'COMPLETED'] } },
      _sum: { totalAmount: true },
    }),
    prisma.chatParticipant.aggregate({
      where: { businessId, unreadCount: { gt: 0 } },
      _sum: { unreadCount: true },
    }),
    prisma.rFQ.count({
      where: {
        targetSellers: { some: { id: businessId } },
        status: { in: ['SUBMITTED', 'OPEN'] },
      },
    }),
  ]);

  return {
    products: {
      total: totalProducts,
      active: activeProducts,
    },
    orders: {
      total: totalOrders,
      pending: pendingOrders,
    },
    revenue: totalRevenue._sum.totalAmount || 0,
    messages: {
      unread: unreadMessages._sum?.unreadCount || 0,
    },
    rfqs: {
      active: activeRFQs,
    },
    metrics: {
      trustScore: business.trustScore,
      rating: business.averageRating,
      reviews: business.totalReviews,
      responseRate: business.responseRate,
    },
  };
};

module.exports = {
  createBusiness,
  getBusinessById,
  getBusinessBySlug,
  updateBusiness,
  uploadLogo,
  uploadBanner,
  addDocument,
  getDocuments,
  verifyGSTIN,
  updateSettings,
  getSettings,
  addAddress,
  getAddresses,
  updateAddress,
  deleteAddress,
  updateTrustScore,
  searchBusinesses,
  getBusinessStats,
};
