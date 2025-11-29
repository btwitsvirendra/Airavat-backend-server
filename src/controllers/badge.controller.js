// =============================================================================
// AIRAVAT B2B MARKETPLACE - VERIFIED BADGE CONTROLLER
// Controller for business verification badges
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const verifiedBadgeService = require('../services/verifiedBadge.service');
const logger = require('../config/logger');

// =============================================================================
// PUBLIC BADGE DISPLAY
// =============================================================================

/**
 * @desc    Get public badges for a business
 * @route   GET /api/v1/badges/business/:businessId
 * @access  Public
 */
exports.getBusinessPublicBadges = asyncHandler(async (req, res) => {
  const { businessId } = req.params;

  const badges = await verifiedBadgeService.getPublicBadges(businessId);

  res.status(200).json({
    success: true,
    data: badges,
  });
});

/**
 * @desc    Get available badge types
 * @route   GET /api/v1/badges/types
 * @access  Public
 */
exports.getBadgeTypes = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: verifiedBadgeService.BADGE_TYPES,
  });
});

// =============================================================================
// BUSINESS BADGE MANAGEMENT
// =============================================================================

/**
 * @desc    Get all badges for user's business
 * @route   GET /api/v1/badges/my-badges
 * @access  Private
 */
exports.getMyBadges = asyncHandler(async (req, res) => {
  const { includeExpired, includeRevoked } = req.query;

  const result = await verifiedBadgeService.getBusinessBadges(req.user.businessId, {
    includeExpired: includeExpired === 'true',
    includeRevoked: includeRevoked === 'true',
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Get badge eligibility for user's business
 * @route   GET /api/v1/badges/eligibility
 * @access  Private
 */
exports.getMyEligibility = asyncHandler(async (req, res) => {
  const result = await verifiedBadgeService.getBadgeEligibility(req.user.businessId);

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Request badge verification
 * @route   POST /api/v1/badges/request
 * @access  Private
 */
exports.requestVerification = asyncHandler(async (req, res) => {
  const { badgeType, documents } = req.body;

  const result = await verifiedBadgeService.requestVerification(
    req.user.businessId,
    badgeType,
    documents
  );

  res.status(201).json({
    success: true,
    message: 'Verification request submitted successfully',
    data: result,
  });
});

/**
 * @desc    Check badge auto-verification
 * @route   POST /api/v1/badges/auto-verify
 * @access  Private
 */
exports.triggerAutoVerification = asyncHandler(async (req, res) => {
  const result = await verifiedBadgeService.autoVerifyBadges(req.user.businessId);

  res.status(200).json({
    success: true,
    message: result.assignedBadges.length > 0 
      ? `${result.assignedBadges.length} badge(s) automatically verified`
      : 'No badges eligible for auto-verification',
    data: result,
  });
});

// =============================================================================
// ADMIN BADGE MANAGEMENT
// =============================================================================

/**
 * @desc    Assign badge to business (Admin)
 * @route   POST /api/v1/badges/admin/assign
 * @access  Private (Admin)
 */
exports.assignBadge = asyncHandler(async (req, res) => {
  const { businessId, badgeType, expiresAt, metadata, documents } = req.body;

  const result = await verifiedBadgeService.assignBadge(businessId, badgeType, {
    verifiedBy: req.user.id,
    expiresAt,
    metadata,
    documents,
  });

  res.status(201).json({
    success: true,
    message: 'Badge assigned successfully',
    data: result,
  });
});

/**
 * @desc    Revoke badge from business (Admin)
 * @route   POST /api/v1/badges/admin/revoke
 * @access  Private (Admin)
 */
exports.revokeBadge = asyncHandler(async (req, res) => {
  const { businessId, badgeType, reason } = req.body;

  const result = await verifiedBadgeService.revokeBadge(
    businessId,
    badgeType,
    req.user.id,
    reason
  );

  res.status(200).json({
    success: true,
    message: 'Badge revoked successfully',
    data: result,
  });
});

/**
 * @desc    Get pending verification requests (Admin)
 * @route   GET /api/v1/badges/admin/requests
 * @access  Private (Admin)
 */
exports.getPendingRequests = asyncHandler(async (req, res) => {
  const { page, limit, status } = req.query;

  const where = {};
  if (status) where.status = status;
  else where.status = { in: ['PENDING', 'UNDER_REVIEW'] };

  const [requests, total] = await Promise.all([
    prisma.badgeVerificationRequest.findMany({
      where,
      skip: (parseInt(page) - 1 || 0) * (parseInt(limit) || 20),
      take: parseInt(limit) || 20,
      orderBy: { submittedAt: 'desc' },
      include: {
        business: {
          select: { id: true, businessName: true, slug: true },
        },
      },
    }),
    prisma.badgeVerificationRequest.count({ where }),
  ]);

  res.status(200).json({
    success: true,
    data: requests,
    pagination: {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
      total,
      totalPages: Math.ceil(total / (parseInt(limit) || 20)),
    },
  });
});

/**
 * @desc    Process verification request (Admin)
 * @route   POST /api/v1/badges/admin/requests/:requestId/process
 * @access  Private (Admin)
 */
exports.processVerificationRequest = asyncHandler(async (req, res) => {
  const { requestId } = req.params;
  const { decision, notes } = req.body;

  const result = await verifiedBadgeService.processVerificationRequest(
    requestId,
    req.user.id,
    decision,
    notes
  );

  res.status(200).json({
    success: true,
    message: `Verification request ${decision.toLowerCase()}`,
    data: result,
  });
});

/**
 * @desc    Get business badges (Admin)
 * @route   GET /api/v1/badges/admin/business/:businessId
 * @access  Private (Admin)
 */
exports.getBusinessBadgesAdmin = asyncHandler(async (req, res) => {
  const { businessId } = req.params;

  const result = await verifiedBadgeService.getBusinessBadges(businessId, {
    includeExpired: true,
    includeRevoked: true,
  });

  res.status(200).json({
    success: true,
    data: result,
  });
});

module.exports = exports;



