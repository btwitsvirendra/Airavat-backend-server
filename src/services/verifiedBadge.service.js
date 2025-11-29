// =============================================================================
// AIRAVAT B2B MARKETPLACE - VERIFIED BADGES SERVICE
// Service for managing business and seller verification badges
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Badge types and their requirements
 */
const BADGE_TYPES = {
  // Basic Verification
  EMAIL_VERIFIED: {
    name: 'Email Verified',
    icon: 'email-check',
    color: '#4CAF50',
    level: 1,
    description: 'Email address has been verified',
  },
  PHONE_VERIFIED: {
    name: 'Phone Verified',
    icon: 'phone-check',
    color: '#2196F3',
    level: 1,
    description: 'Phone number has been verified',
  },

  // Business Verification
  GST_VERIFIED: {
    name: 'GST Verified',
    icon: 'gst-badge',
    color: '#FF9800',
    level: 2,
    description: 'GST registration verified with government database',
  },
  PAN_VERIFIED: {
    name: 'PAN Verified',
    icon: 'pan-badge',
    color: '#9C27B0',
    level: 2,
    description: 'PAN card verified',
  },
  MSME_REGISTERED: {
    name: 'MSME Registered',
    icon: 'msme-badge',
    color: '#E91E63',
    level: 2,
    description: 'Registered with MSME/Udyam',
  },

  // Quality Certifications
  ISO_CERTIFIED: {
    name: 'ISO Certified',
    icon: 'iso-badge',
    color: '#00BCD4',
    level: 3,
    description: 'ISO 9001 quality management certified',
  },
  ISO_14001: {
    name: 'ISO 14001',
    icon: 'eco-badge',
    color: '#4CAF50',
    level: 3,
    description: 'Environmental management certified',
  },
  HACCP_CERTIFIED: {
    name: 'HACCP Certified',
    icon: 'haccp-badge',
    color: '#795548',
    level: 3,
    description: 'Food safety certified',
  },
  FSSAI_LICENSED: {
    name: 'FSSAI Licensed',
    icon: 'fssai-badge',
    color: '#009688',
    level: 3,
    description: 'Food Safety licensed',
  },

  // Trust Badges
  VERIFIED_SELLER: {
    name: 'Verified Seller',
    icon: 'verified-seller',
    color: '#3F51B5',
    level: 4,
    description: 'Business verified by Airavat team',
  },
  PREMIUM_SELLER: {
    name: 'Premium Seller',
    icon: 'premium-badge',
    color: '#FFD700',
    level: 5,
    description: 'Premium subscription with enhanced features',
  },
  TRUSTED_PARTNER: {
    name: 'Trusted Partner',
    icon: 'trust-badge',
    color: '#1E88E5',
    level: 5,
    description: 'Long-term trusted business partner',
  },

  // Performance Badges
  TOP_RATED: {
    name: 'Top Rated',
    icon: 'star-badge',
    color: '#FFC107',
    level: 4,
    description: 'Maintained 4.5+ rating with 100+ reviews',
  },
  FAST_SHIPPER: {
    name: 'Fast Shipper',
    icon: 'fast-ship',
    color: '#00ACC1',
    level: 3,
    description: '95%+ orders shipped on time',
  },
  RESPONSIVE: {
    name: 'Highly Responsive',
    icon: 'response-badge',
    color: '#8BC34A',
    level: 3,
    description: 'Responds to inquiries within 24 hours',
  },

  // Trade Assurance
  TRADE_ASSURED: {
    name: 'Trade Assured',
    icon: 'trade-assurance',
    color: '#FF5722',
    level: 4,
    description: 'Protected by Airavat Trade Assurance',
  },
  ESCROW_VERIFIED: {
    name: 'Escrow Verified',
    icon: 'escrow-badge',
    color: '#607D8B',
    level: 3,
    description: 'Supports secure escrow payments',
  },
};

// =============================================================================
// BADGE ASSIGNMENT
// =============================================================================

/**
 * Assign a badge to a business
 * @param {string} businessId - Business ID
 * @param {string} badgeType - Badge type from BADGE_TYPES
 * @param {Object} options - Additional options
 * @returns {Promise<Object>} Assigned badge
 */
exports.assignBadge = async (businessId, badgeType, options = {}) => {
  try {
    const {
      verifiedBy = null,
      expiresAt = null,
      metadata = {},
      documents = [],
    } = options;

    if (!BADGE_TYPES[badgeType]) {
      throw new AppError(`Invalid badge type: ${badgeType}`, 400);
    }

    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });

    if (!business) {
      throw new AppError('Business not found', 404);
    }

    // Check if badge already exists
    const existingBadge = await prisma.businessBadge.findFirst({
      where: {
        businessId,
        badgeType,
        status: 'ACTIVE',
      },
    });

    if (existingBadge) {
      throw new AppError('Badge already assigned to this business', 409);
    }

    const badge = await prisma.businessBadge.create({
      data: {
        businessId,
        badgeType,
        status: 'ACTIVE',
        verifiedBy,
        verifiedAt: new Date(),
        expiresAt,
        metadata,
        documents,
      },
    });

    // Update business badge count
    await updateBadgeCount(businessId);

    logger.info('Badge assigned', { businessId, badgeType, verifiedBy });

    return {
      ...badge,
      badgeInfo: BADGE_TYPES[badgeType],
    };
  } catch (error) {
    logger.error('Assign badge error', { error: error.message, businessId, badgeType });
    throw error;
  }
};

/**
 * Revoke a badge from a business
 * @param {string} businessId - Business ID
 * @param {string} badgeType - Badge type
 * @param {string} revokedBy - User ID revoking the badge
 * @param {string} reason - Revocation reason
 * @returns {Promise<Object>} Revoked badge
 */
exports.revokeBadge = async (businessId, badgeType, revokedBy, reason) => {
  try {
    const badge = await prisma.businessBadge.findFirst({
      where: {
        businessId,
        badgeType,
        status: 'ACTIVE',
      },
    });

    if (!badge) {
      throw new AppError('Active badge not found', 404);
    }

    const revokedBadge = await prisma.businessBadge.update({
      where: { id: badge.id },
      data: {
        status: 'REVOKED',
        revokedBy,
        revokedAt: new Date(),
        revocationReason: reason,
      },
    });

    await updateBadgeCount(businessId);

    logger.info('Badge revoked', { businessId, badgeType, revokedBy, reason });

    return revokedBadge;
  } catch (error) {
    logger.error('Revoke badge error', { error: error.message, businessId, badgeType });
    throw error;
  }
};

// =============================================================================
// BADGE QUERIES
// =============================================================================

/**
 * Get all badges for a business
 * @param {string} businessId - Business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Business badges
 */
exports.getBusinessBadges = async (businessId, options = {}) => {
  const { includeExpired = false, includeRevoked = false } = options;

  const where = { businessId };

  if (!includeExpired && !includeRevoked) {
    where.status = 'ACTIVE';
    where.OR = [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } },
    ];
  }

  const badges = await prisma.businessBadge.findMany({
    where,
    orderBy: [
      { status: 'asc' },
      { verifiedAt: 'desc' },
    ],
  });

  return {
    badges: badges.map((badge) => ({
      ...badge,
      badgeInfo: BADGE_TYPES[badge.badgeType],
      isExpired: badge.expiresAt && badge.expiresAt < new Date(),
    })),
    summary: {
      total: badges.length,
      active: badges.filter((b) => b.status === 'ACTIVE').length,
      highestLevel: Math.max(...badges.map((b) => BADGE_TYPES[b.badgeType]?.level || 0)),
    },
  };
};

/**
 * Get badge requirements for a business
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Badge requirements and eligibility
 */
exports.getBadgeEligibility = async (businessId) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      badges: { where: { status: 'ACTIVE' } },
      owner: true,
      _count: {
        select: {
          products: true,
          orders: true,
          reviews: true,
        },
      },
    },
  });

  if (!business) {
    throw new AppError('Business not found', 404);
  }

  const currentBadges = business.badges.map((b) => b.badgeType);
  const eligibility = {};

  // Check each badge type
  for (const [type, info] of Object.entries(BADGE_TYPES)) {
    if (currentBadges.includes(type)) {
      eligibility[type] = { earned: true, badgeInfo: info };
      continue;
    }

    const requirements = await checkBadgeRequirements(type, business);
    eligibility[type] = {
      earned: false,
      eligible: requirements.eligible,
      requirements: requirements.details,
      badgeInfo: info,
    };
  }

  return {
    businessId,
    currentBadges: currentBadges.length,
    eligibility,
  };
};

/**
 * Check if business has a specific badge
 * @param {string} businessId - Business ID
 * @param {string} badgeType - Badge type
 * @returns {Promise<boolean>} Whether business has the badge
 */
exports.hasBadge = async (businessId, badgeType) => {
  const badge = await prisma.businessBadge.findFirst({
    where: {
      businessId,
      badgeType,
      status: 'ACTIVE',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  });

  return !!badge;
};

/**
 * Get public badge display for a business
 * @param {string} businessId - Business ID
 * @returns {Promise<Object[]>} Public badge display data
 */
exports.getPublicBadges = async (businessId) => {
  const badges = await prisma.businessBadge.findMany({
    where: {
      businessId,
      status: 'ACTIVE',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
    orderBy: { verifiedAt: 'desc' },
  });

  return badges.map((badge) => ({
    type: badge.badgeType,
    ...BADGE_TYPES[badge.badgeType],
    verifiedAt: badge.verifiedAt,
  }));
};

// =============================================================================
// VERIFICATION REQUESTS
// =============================================================================

/**
 * Request badge verification
 * @param {string} businessId - Business ID
 * @param {string} badgeType - Badge type
 * @param {Object} documents - Supporting documents
 * @returns {Promise<Object>} Verification request
 */
exports.requestVerification = async (businessId, badgeType, documents = {}) => {
  try {
    if (!BADGE_TYPES[badgeType]) {
      throw new AppError(`Invalid badge type: ${badgeType}`, 400);
    }

    // Check if already has badge or pending request
    const existing = await prisma.badgeVerificationRequest.findFirst({
      where: {
        businessId,
        badgeType,
        status: { in: ['PENDING', 'UNDER_REVIEW'] },
      },
    });

    if (existing) {
      throw new AppError('Verification request already pending', 409);
    }

    const hasBadge = await exports.hasBadge(businessId, badgeType);
    if (hasBadge) {
      throw new AppError('Badge already earned', 409);
    }

    const request = await prisma.badgeVerificationRequest.create({
      data: {
        businessId,
        badgeType,
        status: 'PENDING',
        documents,
        submittedAt: new Date(),
      },
    });

    logger.info('Badge verification requested', { businessId, badgeType });

    return request;
  } catch (error) {
    logger.error('Request verification error', { error: error.message, businessId, badgeType });
    throw error;
  }
};

/**
 * Process verification request (Admin)
 * @param {string} requestId - Request ID
 * @param {string} adminId - Admin user ID
 * @param {string} decision - APPROVED or REJECTED
 * @param {string} notes - Admin notes
 * @returns {Promise<Object>} Processed request
 */
exports.processVerificationRequest = async (requestId, adminId, decision, notes) => {
  try {
    const request = await prisma.badgeVerificationRequest.findUnique({
      where: { id: requestId },
    });

    if (!request) {
      throw new AppError('Verification request not found', 404);
    }

    if (request.status !== 'PENDING' && request.status !== 'UNDER_REVIEW') {
      throw new AppError('Request already processed', 400);
    }

    const updatedRequest = await prisma.badgeVerificationRequest.update({
      where: { id: requestId },
      data: {
        status: decision === 'APPROVED' ? 'APPROVED' : 'REJECTED',
        reviewedBy: adminId,
        reviewedAt: new Date(),
        reviewNotes: notes,
      },
    });

    // If approved, assign the badge
    if (decision === 'APPROVED') {
      await exports.assignBadge(request.businessId, request.badgeType, {
        verifiedBy: adminId,
        metadata: { requestId },
      });
    }

    logger.info('Verification request processed', {
      requestId,
      decision,
      adminId,
    });

    return updatedRequest;
  } catch (error) {
    logger.error('Process verification error', { error: error.message, requestId });
    throw error;
  }
};

// =============================================================================
// AUTO-VERIFICATION
// =============================================================================

/**
 * Auto-assign badges based on criteria
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Auto-assigned badges
 */
exports.autoVerifyBadges = async (businessId) => {
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    include: {
      owner: true,
      badges: { where: { status: 'ACTIVE' } },
      orders: { where: { status: 'DELIVERED' } },
      reviews: true,
    },
  });

  if (!business) {
    throw new AppError('Business not found', 404);
  }

  const assignedBadges = [];
  const currentBadges = business.badges.map((b) => b.badgeType);

  // Check GST verification
  if (business.gstNumber && business.gstVerified && !currentBadges.includes('GST_VERIFIED')) {
    await exports.assignBadge(businessId, 'GST_VERIFIED', {
      verifiedBy: 'SYSTEM',
      metadata: { autoVerified: true },
    });
    assignedBadges.push('GST_VERIFIED');
  }

  // Check email verification
  if (business.owner.isEmailVerified && !currentBadges.includes('EMAIL_VERIFIED')) {
    await exports.assignBadge(businessId, 'EMAIL_VERIFIED', {
      verifiedBy: 'SYSTEM',
      metadata: { autoVerified: true },
    });
    assignedBadges.push('EMAIL_VERIFIED');
  }

  // Check phone verification
  if (business.owner.isPhoneVerified && !currentBadges.includes('PHONE_VERIFIED')) {
    await exports.assignBadge(businessId, 'PHONE_VERIFIED', {
      verifiedBy: 'SYSTEM',
      metadata: { autoVerified: true },
    });
    assignedBadges.push('PHONE_VERIFIED');
  }

  // Check top rated (4.5+ rating with 100+ reviews)
  if (business.reviews.length >= 100) {
    const avgRating = business.reviews.reduce((sum, r) => sum + r.rating, 0) / business.reviews.length;
    if (avgRating >= 4.5 && !currentBadges.includes('TOP_RATED')) {
      await exports.assignBadge(businessId, 'TOP_RATED', {
        verifiedBy: 'SYSTEM',
        metadata: { autoVerified: true, avgRating, reviewCount: business.reviews.length },
      });
      assignedBadges.push('TOP_RATED');
    }
  }

  logger.info('Auto-verification completed', { businessId, assignedBadges });

  return { assignedBadges };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Update business badge count
 */
async function updateBadgeCount(businessId) {
  const count = await prisma.businessBadge.count({
    where: {
      businessId,
      status: 'ACTIVE',
      OR: [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ],
    },
  });

  await prisma.business.update({
    where: { id: businessId },
    data: { badgeCount: count },
  });
}

/**
 * Check badge requirements
 */
async function checkBadgeRequirements(badgeType, business) {
  const requirements = [];
  let eligible = true;

  switch (badgeType) {
    case 'GST_VERIFIED':
      if (!business.gstNumber) {
        requirements.push({ requirement: 'GST Number', met: false });
        eligible = false;
      } else {
        requirements.push({ requirement: 'GST Number', met: true });
      }
      break;

    case 'TOP_RATED':
      const reviewCount = business._count?.reviews || 0;
      requirements.push({
        requirement: '100+ reviews',
        met: reviewCount >= 100,
        current: reviewCount,
      });
      if (reviewCount < 100) eligible = false;
      break;

    case 'VERIFIED_SELLER':
      requirements.push({
        requirement: 'Manual verification required',
        met: false,
        action: 'Request verification from admin',
      });
      eligible = false;
      break;

    default:
      requirements.push({
        requirement: 'Contact support for requirements',
        met: false,
      });
      eligible = false;
  }

  return { eligible, details: requirements };
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  BADGE_TYPES,
};



