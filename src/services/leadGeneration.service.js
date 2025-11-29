// =============================================================================
// AIRAVAT B2B MARKETPLACE - LEAD GENERATION SERVICE
// Handles buyer intent data, lead packages, and CRM integration
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError, BadRequestError, NotFoundError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Lead quality scores
 */
const LEAD_QUALITY = {
  HOT: { score: 80, label: 'Hot Lead', color: '#ef4444', priority: 1 },
  WARM: { score: 50, label: 'Warm Lead', color: '#f59e0b', priority: 2 },
  COLD: { score: 20, label: 'Cold Lead', color: '#6b7280', priority: 3 },
};

/**
 * Lead sources
 */
const LEAD_SOURCES = {
  RFQ: 'RFQ Submission',
  INQUIRY: 'Product Inquiry',
  QUOTE_REQUEST: 'Quote Request',
  CONTACT_FORM: 'Contact Form',
  CALLBACK: 'Callback Request',
  CHAT: 'Live Chat',
  SEARCH: 'Search Intent',
  COMPARE: 'Product Comparison',
  WISHLIST: 'Wishlist Addition',
};

/**
 * Lead packages and pricing
 */
const LEAD_PACKAGES = {
  STARTER: {
    id: 'starter',
    name: 'Starter Pack',
    leads: 10,
    price: 2999,
    pricePerLead: 299.9,
    validity: 30, // days
    features: ['Basic contact info', 'Inquiry details', 'Email support'],
  },
  GROWTH: {
    id: 'growth',
    name: 'Growth Pack',
    leads: 50,
    price: 9999,
    pricePerLead: 199.98,
    validity: 60,
    features: ['Full contact info', 'Company details', 'Priority support', 'CRM export'],
  },
  PROFESSIONAL: {
    id: 'professional',
    name: 'Professional Pack',
    leads: 150,
    price: 24999,
    pricePerLead: 166.66,
    validity: 90,
    features: ['Premium leads', 'Verified contacts', 'Dedicated manager', 'API access', 'Real-time alerts'],
  },
  ENTERPRISE: {
    id: 'enterprise',
    name: 'Enterprise',
    leads: -1, // Unlimited
    price: null, // Custom
    pricePerLead: null,
    validity: 365,
    features: ['Unlimited leads', 'Exclusive leads', 'Custom integration', 'Analytics dashboard'],
  },
};

/**
 * Intent signals and weights
 */
const INTENT_SIGNALS = {
  RFQ_SUBMITTED: { weight: 30, description: 'Submitted RFQ' },
  QUOTE_REQUESTED: { weight: 25, description: 'Requested quote' },
  CALLBACK_REQUESTED: { weight: 25, description: 'Requested callback' },
  CONTACT_VIEWED: { weight: 10, description: 'Viewed contact details' },
  PRODUCT_COMPARED: { weight: 15, description: 'Compared products' },
  WISHLIST_ADDED: { weight: 10, description: 'Added to wishlist' },
  MULTIPLE_VIEWS: { weight: 8, description: 'Multiple product views' },
  CATEGORY_BROWSING: { weight: 5, description: 'Category browsing' },
  SEARCH_PERFORMED: { weight: 5, description: 'Search performed' },
  RETURN_VISITOR: { weight: 10, description: 'Return visitor' },
};

// =============================================================================
// LEAD CAPTURE
// =============================================================================

/**
 * Capture a lead from buyer activity
 * @param {Object} data - Lead data
 * @returns {Promise<Object>} Captured lead
 */
exports.captureLead = async (data) => {
  try {
    const {
      buyerId,
      businessId,
      sellerId,
      source,
      productId,
      categoryId,
      inquiryDetails,
      contactInfo,
      intentSignals = [],
    } = data;

    // Calculate lead score
    const score = calculateLeadScore(intentSignals);
    const quality = getLeadQuality(score);

    // Check for existing lead (avoid duplicates within 24 hours)
    const existingLead = await prisma.lead.findFirst({
      where: {
        buyerId,
        sellerId,
        createdAt: {
          gte: new Date(Date.now() - 24 * 60 * 60 * 1000),
        },
      },
    });

    if (existingLead) {
      // Update existing lead with new signals
      const updatedLead = await prisma.lead.update({
        where: { id: existingLead.id },
        data: {
          score: Math.max(existingLead.score, score),
          quality: score > existingLead.score ? quality : existingLead.quality,
          intentSignals: {
            push: intentSignals,
          },
          lastActivityAt: new Date(),
        },
      });

      return updatedLead;
    }

    // Create new lead
    const lead = await prisma.lead.create({
      data: {
        leadNumber: generateLeadNumber(),
        buyerId,
        buyerBusinessId: businessId,
        sellerId,
        source,
        productId,
        categoryId,
        inquiryDetails,
        contactInfo,
        intentSignals,
        score,
        quality,
        status: 'NEW',
        isVerified: false,
        lastActivityAt: new Date(),
      },
      include: {
        buyer: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        buyerBusiness: {
          select: {
            businessName: true,
            industry: true,
            city: true,
            state: true,
          },
        },
        product: {
          select: {
            name: true,
            category: { select: { name: true } },
          },
        },
      },
    });

    logger.info('Lead captured', { leadId: lead.id, score, quality, source });

    return lead;
  } catch (error) {
    logger.error('Capture lead error', { error: error.message });
    throw error;
  }
};

/**
 * Update lead status
 * @param {string} leadId - Lead ID
 * @param {string} sellerId - Seller ID (for authorization)
 * @param {Object} updates - Status updates
 * @returns {Promise<Object>} Updated lead
 */
exports.updateLeadStatus = async (leadId, sellerId, updates) => {
  const { status, notes, followUpDate } = updates;

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, sellerId },
  });

  if (!lead) {
    throw new NotFoundError('Lead not found');
  }

  const updated = await prisma.lead.update({
    where: { id: leadId },
    data: {
      status,
      notes,
      followUpDate: followUpDate ? new Date(followUpDate) : null,
      updatedAt: new Date(),
    },
  });

  // Log activity
  await prisma.leadActivity.create({
    data: {
      leadId,
      action: 'STATUS_UPDATED',
      details: { from: lead.status, to: status, notes },
    },
  });

  return updated;
};

// =============================================================================
// LEAD PACKAGES
// =============================================================================

/**
 * Get available lead packages
 * @returns {Object[]} Lead packages
 */
exports.getLeadPackages = () => {
  return Object.values(LEAD_PACKAGES);
};

/**
 * Purchase a lead package
 * @param {string} sellerId - Seller business ID
 * @param {string} packageId - Package ID
 * @param {Object} options - Purchase options
 * @returns {Promise<Object>} Purchase result
 */
exports.purchaseLeadPackage = async (sellerId, packageId, options = {}) => {
  try {
    const { paymentMethodId, categoryFilters = [], regionFilters = [] } = options;

    const pkg = LEAD_PACKAGES[packageId.toUpperCase()];
    if (!pkg) {
      throw new NotFoundError(`Package ${packageId} not found`);
    }

    if (pkg.price === null) {
      throw new BadRequestError('Enterprise package requires custom pricing. Contact sales.');
    }

    // Create lead credit purchase
    const purchase = await prisma.leadCreditPurchase.create({
      data: {
        businessId: sellerId,
        packageId: pkg.id,
        packageName: pkg.name,
        creditsTotal: pkg.leads,
        creditsRemaining: pkg.leads,
        amountPaid: pkg.price,
        currency: 'INR',
        validUntil: new Date(Date.now() + pkg.validity * 24 * 60 * 60 * 1000),
        filters: {
          categories: categoryFilters,
          regions: regionFilters,
        },
        status: 'ACTIVE',
      },
    });

    logger.info('Lead package purchased', { sellerId, packageId, credits: pkg.leads });

    return {
      purchase,
      package: pkg,
      message: `Successfully purchased ${pkg.leads} lead credits`,
    };
  } catch (error) {
    logger.error('Purchase lead package error', { error: error.message, sellerId });
    throw error;
  }
};

/**
 * Get seller's lead credit balance
 * @param {string} sellerId - Seller business ID
 * @returns {Promise<Object>} Credit balance
 */
exports.getLeadCredits = async (sellerId) => {
  const activePurchases = await prisma.leadCreditPurchase.findMany({
    where: {
      businessId: sellerId,
      status: 'ACTIVE',
      validUntil: { gte: new Date() },
      creditsRemaining: { gt: 0 },
    },
    orderBy: { validUntil: 'asc' },
  });

  const totalCredits = activePurchases.reduce((sum, p) => sum + p.creditsRemaining, 0);
  const nearestExpiry = activePurchases[0]?.validUntil;

  return {
    totalCredits,
    activePurchases: activePurchases.length,
    purchases: activePurchases,
    nearestExpiry,
    expiringCredits: activePurchases
      .filter((p) => p.validUntil < new Date(Date.now() + 7 * 24 * 60 * 60 * 1000))
      .reduce((sum, p) => sum + p.creditsRemaining, 0),
  };
};

// =============================================================================
// LEAD MARKETPLACE
// =============================================================================

/**
 * Get available leads for a seller
 * @param {string} sellerId - Seller business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Available leads
 */
exports.getAvailableLeads = async (sellerId, options = {}) => {
  const { 
    page = 1, 
    limit = 20, 
    categoryId, 
    quality, 
    region,
    source,
    minScore,
  } = options;
  const skip = (page - 1) * limit;

  // Get seller's categories
  const seller = await prisma.business.findUnique({
    where: { id: sellerId },
    include: { products: { select: { categoryId: true }, distinct: ['categoryId'] } },
  });

  const sellerCategories = seller?.products?.map((p) => p.categoryId) || [];

  // Build query
  const where = {
    status: 'NEW',
    sellerId: null, // Not yet claimed
    isVerified: true,
    // Match seller's categories or specified category
    categoryId: categoryId ? categoryId : { in: sellerCategories },
  };

  if (quality) where.quality = quality;
  if (minScore) where.score = { gte: minScore };
  if (source) where.source = source;

  const [leads, total] = await Promise.all([
    prisma.lead.findMany({
      where,
      skip,
      take: limit,
      orderBy: [
        { score: 'desc' },
        { createdAt: 'desc' },
      ],
      select: {
        id: true,
        leadNumber: true,
        source: true,
        score: true,
        quality: true,
        categoryId: true,
        createdAt: true,
        // Masked contact info (full info after purchase)
        contactInfo: false,
        buyer: {
          select: {
            firstName: true,
            // Email and phone masked
          },
        },
        buyerBusiness: {
          select: {
            industry: true,
            city: true,
            state: true,
            // Company name masked
          },
        },
        product: {
          select: {
            name: true,
            category: { select: { name: true } },
          },
        },
        inquiryDetails: true,
      },
    }),
    prisma.lead.count({ where }),
  ]);

  return {
    leads: leads.map((lead) => ({
      ...lead,
      // Mask sensitive info
      contactPreview: `${lead.buyer?.firstName?.[0] || 'B'}***`,
      locationPreview: lead.buyerBusiness?.city 
        ? `${lead.buyerBusiness.city}, ${lead.buyerBusiness.state}`
        : 'India',
    })),
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    credits: await exports.getLeadCredits(sellerId),
  };
};

/**
 * Purchase/claim a lead
 * @param {string} sellerId - Seller business ID
 * @param {string} leadId - Lead ID
 * @returns {Promise<Object>} Purchased lead with full details
 */
exports.purchaseLead = async (sellerId, leadId) => {
  try {
    // Check credits
    const credits = await exports.getLeadCredits(sellerId);
    if (credits.totalCredits <= 0) {
      throw new BadRequestError('Insufficient lead credits. Please purchase a lead package.');
    }

    // Get lead
    const lead = await prisma.lead.findUnique({
      where: { id: leadId },
    });

    if (!lead) {
      throw new NotFoundError('Lead not found');
    }

    if (lead.sellerId) {
      throw new BadRequestError('Lead already claimed');
    }

    // Use oldest credit first
    const oldestPurchase = await prisma.leadCreditPurchase.findFirst({
      where: {
        businessId: sellerId,
        status: 'ACTIVE',
        validUntil: { gte: new Date() },
        creditsRemaining: { gt: 0 },
      },
      orderBy: { validUntil: 'asc' },
    });

    if (!oldestPurchase) {
      throw new BadRequestError('No valid lead credits available');
    }

    // Transaction: claim lead and deduct credit
    const result = await prisma.$transaction(async (tx) => {
      // Update lead
      const claimedLead = await tx.lead.update({
        where: { id: leadId },
        data: {
          sellerId,
          status: 'CLAIMED',
          claimedAt: new Date(),
          creditPurchaseId: oldestPurchase.id,
        },
        include: {
          buyer: {
            select: {
              firstName: true,
              lastName: true,
              email: true,
              phone: true,
            },
          },
          buyerBusiness: {
            select: {
              businessName: true,
              industry: true,
              city: true,
              state: true,
              gstin: true,
              website: true,
            },
          },
          product: {
            select: {
              id: true,
              name: true,
              category: { select: { name: true } },
            },
          },
        },
      });

      // Deduct credit
      await tx.leadCreditPurchase.update({
        where: { id: oldestPurchase.id },
        data: {
          creditsRemaining: { decrement: 1 },
        },
      });

      // Log activity
      await tx.leadActivity.create({
        data: {
          leadId,
          action: 'LEAD_CLAIMED',
          details: { sellerId, creditPurchaseId: oldestPurchase.id },
        },
      });

      return claimedLead;
    });

    logger.info('Lead purchased', { leadId, sellerId });

    return {
      lead: result,
      creditsRemaining: credits.totalCredits - 1,
      message: 'Lead successfully claimed',
    };
  } catch (error) {
    logger.error('Purchase lead error', { error: error.message, sellerId, leadId });
    throw error;
  }
};

/**
 * Get purchased leads for a seller
 * @param {string} sellerId - Seller business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Purchased leads
 */
exports.getPurchasedLeads = async (sellerId, options = {}) => {
  const { page = 1, limit = 20, status, quality } = options;
  const skip = (page - 1) * limit;

  const where = { sellerId };
  if (status) where.status = status;
  if (quality) where.quality = quality;

  const [leads, total, statusCounts] = await Promise.all([
    prisma.lead.findMany({
      where,
      skip,
      take: limit,
      orderBy: { claimedAt: 'desc' },
      include: {
        buyer: {
          select: {
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
        buyerBusiness: {
          select: {
            businessName: true,
            industry: true,
            city: true,
            state: true,
          },
        },
        product: {
          select: {
            name: true,
            category: { select: { name: true } },
          },
        },
        activities: {
          orderBy: { createdAt: 'desc' },
          take: 5,
        },
      },
    }),
    prisma.lead.count({ where }),
    prisma.lead.groupBy({
      by: ['status'],
      where: { sellerId },
      _count: true,
    }),
  ]);

  return {
    leads,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
    statusCounts: statusCounts.reduce((acc, s) => {
      acc[s.status] = s._count;
      return acc;
    }, {}),
  };
};

// =============================================================================
// INTENT TRACKING
// =============================================================================

/**
 * Track buyer intent signal
 * @param {string} buyerId - Buyer ID
 * @param {string} signal - Intent signal type
 * @param {Object} context - Signal context
 * @returns {Promise<void>}
 */
exports.trackIntent = async (buyerId, signal, context = {}) => {
  try {
    const { productId, categoryId, sellerId, metadata } = context;

    const signalConfig = INTENT_SIGNALS[signal];
    if (!signalConfig) {
      logger.warn('Unknown intent signal', { signal });
      return;
    }

    // Record intent signal
    await prisma.intentSignal.create({
      data: {
        buyerId,
        signal,
        weight: signalConfig.weight,
        productId,
        categoryId,
        sellerId,
        metadata,
      },
    });

    // Check if we should create/update a lead
    if (sellerId && signalConfig.weight >= 20) {
      await exports.captureLead({
        buyerId,
        sellerId,
        source: signal,
        productId,
        categoryId,
        intentSignals: [signal],
      });
    }

    logger.debug('Intent tracked', { buyerId, signal, weight: signalConfig.weight });
  } catch (error) {
    logger.error('Track intent error', { error: error.message, buyerId, signal });
  }
};

/**
 * Get buyer intent score
 * @param {string} buyerId - Buyer ID
 * @returns {Promise<Object>} Intent analysis
 */
exports.getBuyerIntent = async (buyerId) => {
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const signals = await prisma.intentSignal.findMany({
    where: {
      buyerId,
      createdAt: { gte: thirtyDaysAgo },
    },
    orderBy: { createdAt: 'desc' },
  });

  const totalScore = signals.reduce((sum, s) => sum + s.weight, 0);
  const normalizedScore = Math.min(100, totalScore);

  // Group by category
  const categoryInterest = signals.reduce((acc, s) => {
    if (s.categoryId) {
      acc[s.categoryId] = (acc[s.categoryId] || 0) + s.weight;
    }
    return acc;
  }, {});

  // Recent activity
  const recentSignals = signals.slice(0, 10).map((s) => ({
    signal: s.signal,
    description: INTENT_SIGNALS[s.signal]?.description || s.signal,
    weight: s.weight,
    timestamp: s.createdAt,
  }));

  return {
    buyerId,
    intentScore: normalizedScore,
    quality: getLeadQuality(normalizedScore),
    signalCount: signals.length,
    categoryInterest,
    recentSignals,
    lastActivity: signals[0]?.createdAt,
  };
};

// =============================================================================
// ANALYTICS
// =============================================================================

/**
 * Get lead analytics for a seller
 * @param {string} sellerId - Seller business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Analytics
 */
exports.getLeadAnalytics = async (sellerId, options = {}) => {
  const { startDate, endDate } = options;

  const dateFilter = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);

  const [
    totalLeads,
    byQuality,
    bySource,
    byStatus,
    conversionRate,
  ] = await Promise.all([
    // Total leads
    prisma.lead.count({
      where: {
        sellerId,
        ...(Object.keys(dateFilter).length && { claimedAt: dateFilter }),
      },
    }),

    // By quality
    prisma.lead.groupBy({
      by: ['quality'],
      where: {
        sellerId,
        ...(Object.keys(dateFilter).length && { claimedAt: dateFilter }),
      },
      _count: true,
    }),

    // By source
    prisma.lead.groupBy({
      by: ['source'],
      where: {
        sellerId,
        ...(Object.keys(dateFilter).length && { claimedAt: dateFilter }),
      },
      _count: true,
    }),

    // By status
    prisma.lead.groupBy({
      by: ['status'],
      where: {
        sellerId,
        ...(Object.keys(dateFilter).length && { claimedAt: dateFilter }),
      },
      _count: true,
    }),

    // Conversion rate
    prisma.lead.aggregate({
      where: {
        sellerId,
        status: 'CONVERTED',
        ...(Object.keys(dateFilter).length && { claimedAt: dateFilter }),
      },
      _count: true,
    }),
  ]);

  const converted = conversionRate._count || 0;

  return {
    summary: {
      totalLeads,
      hotLeads: byQuality.find((q) => q.quality === 'HOT')?._count || 0,
      warmLeads: byQuality.find((q) => q.quality === 'WARM')?._count || 0,
      coldLeads: byQuality.find((q) => q.quality === 'COLD')?._count || 0,
      converted,
      conversionRate: totalLeads > 0 ? ((converted / totalLeads) * 100).toFixed(2) : 0,
    },
    byQuality,
    bySource: bySource.map((s) => ({
      source: s.source,
      sourceName: LEAD_SOURCES[s.source] || s.source,
      count: s._count,
    })),
    byStatus,
  };
};

/**
 * Get platform lead generation revenue
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Revenue data
 */
exports.getLeadRevenue = async (options = {}) => {
  const { startDate, endDate } = options;

  const dateFilter = {};
  if (startDate) dateFilter.gte = new Date(startDate);
  if (endDate) dateFilter.lte = new Date(endDate);

  const [totalRevenue, byPackage, topBuyers] = await Promise.all([
    prisma.leadCreditPurchase.aggregate({
      where: Object.keys(dateFilter).length ? { createdAt: dateFilter } : undefined,
      _sum: { amountPaid: true },
      _count: true,
    }),

    prisma.leadCreditPurchase.groupBy({
      by: ['packageId'],
      where: Object.keys(dateFilter).length ? { createdAt: dateFilter } : undefined,
      _sum: { amountPaid: true },
      _count: true,
    }),

    prisma.leadCreditPurchase.groupBy({
      by: ['businessId'],
      _sum: { amountPaid: true },
      orderBy: { _sum: { amountPaid: 'desc' } },
      take: 10,
    }),
  ]);

  return {
    summary: {
      totalRevenue: totalRevenue._sum.amountPaid || 0,
      totalPurchases: totalRevenue._count || 0,
    },
    byPackage: byPackage.map((p) => ({
      packageId: p.packageId,
      packageName: LEAD_PACKAGES[p.packageId.toUpperCase()]?.name || p.packageId,
      revenue: p._sum.amountPaid || 0,
      purchases: p._count || 0,
    })),
    topBuyers,
  };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateLeadNumber() {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 7).toUpperCase();
  return `LD${year}${month}-${random}`;
}

function calculateLeadScore(signals) {
  let score = 0;

  for (const signal of signals) {
    const signalConfig = INTENT_SIGNALS[signal];
    if (signalConfig) {
      score += signalConfig.weight;
    }
  }

  return Math.min(100, score);
}

function getLeadQuality(score) {
  if (score >= LEAD_QUALITY.HOT.score) return 'HOT';
  if (score >= LEAD_QUALITY.WARM.score) return 'WARM';
  return 'COLD';
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  LEAD_QUALITY,
  LEAD_SOURCES,
  LEAD_PACKAGES,
  INTENT_SIGNALS,
};



