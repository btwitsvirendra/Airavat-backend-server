// =============================================================================
// AIRAVAT B2B MARKETPLACE - BUSINESS CONTROLLER
// =============================================================================

const businessService = require('../services/business.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ConflictError } = require('../utils/errors');

/**
 * Create business profile
 * POST /api/v1/businesses
 */
exports.create = asyncHandler(async (req, res) => {
  // Check if user already has a business
  if (req.business) {
    throw new ConflictError('You already have a business profile');
  }
  
  const business = await businessService.create({
    ...req.body,
    ownerId: req.user.id,
  });
  
  created(res, { business }, 'Business profile created successfully');
});

/**
 * Get current user's business
 * GET /api/v1/businesses/me
 */
exports.getMyBusiness = asyncHandler(async (req, res) => {
  const business = await businessService.getById(req.business.id, {
    includeDocuments: true,
    includeSettings: true,
  });
  
  success(res, { business });
});

/**
 * Get business by slug (public)
 * GET /api/v1/businesses/slug/:slug
 */
exports.getBySlug = asyncHandler(async (req, res) => {
  const business = await businessService.getBySlug(req.params.slug);
  
  if (!business) {
    throw new NotFoundError('Business');
  }
  
  // Track view if not own business
  if (!req.user || req.business?.id !== business.id) {
    await businessService.trackView(business.id);
  }
  
  success(res, { business });
});

/**
 * Update business
 * PATCH /api/v1/businesses/me
 */
exports.update = asyncHandler(async (req, res) => {
  const business = await businessService.update(req.business.id, req.body);
  
  success(res, { business }, 'Business updated successfully');
});

/**
 * Get business products
 * GET /api/v1/businesses/:businessId/products
 */
exports.getProducts = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { category, status, sort } = req.query;
  
  const { products, total } = await businessService.getProducts(req.params.businessId, {
    skip,
    limit,
    category,
    status,
    sort,
  });
  
  paginated(res, products, { page, limit, total });
});

/**
 * Get business reviews
 * GET /api/v1/businesses/:businessId/reviews
 */
exports.getReviews = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { rating, sort } = req.query;
  
  const { reviews, total, stats } = await businessService.getReviews(req.params.businessId, {
    skip,
    limit,
    rating: rating ? parseInt(rating) : undefined,
    sort,
  });
  
  paginated(res, { reviews, stats }, { page, limit, total });
});

/**
 * Verify GSTIN
 * POST /api/v1/businesses/verify-gstin
 */
exports.verifyGSTIN = asyncHandler(async (req, res) => {
  const { gstin } = req.body;
  
  if (!gstin) {
    throw new BadRequestError('GSTIN is required');
  }
  
  const result = await businessService.verifyGSTIN(gstin);
  
  success(res, result);
});

/**
 * Upload business documents
 * POST /api/v1/businesses/me/documents
 */
exports.uploadDocuments = asyncHandler(async (req, res) => {
  const { type, fileUrl, name, expiryDate } = req.body;
  
  if (!type || !fileUrl) {
    throw new BadRequestError('Document type and file URL are required');
  }
  
  const document = await businessService.addDocument(req.business.id, {
    type,
    fileUrl,
    name: name || type,
    expiryDate,
  });
  
  created(res, { document }, 'Document uploaded successfully');
});

/**
 * Delete business document
 * DELETE /api/v1/businesses/me/documents/:documentId
 */
exports.deleteDocument = asyncHandler(async (req, res) => {
  await businessService.deleteDocument(req.business.id, req.params.documentId);
  
  success(res, null, 'Document deleted successfully');
});

/**
 * Get business settings
 * GET /api/v1/businesses/me/settings
 */
exports.getSettings = asyncHandler(async (req, res) => {
  const settings = await businessService.getSettings(req.business.id);
  
  success(res, { settings });
});

/**
 * Update business settings
 * PATCH /api/v1/businesses/me/settings
 */
exports.updateSettings = asyncHandler(async (req, res) => {
  const settings = await businessService.updateSettings(req.business.id, req.body);
  
  success(res, { settings }, 'Settings updated successfully');
});

/**
 * Get addresses
 * GET /api/v1/businesses/me/addresses
 */
exports.getAddresses = asyncHandler(async (req, res) => {
  const addresses = await businessService.getAddresses(req.business.id);
  
  success(res, { addresses });
});

/**
 * Add address
 * POST /api/v1/businesses/me/addresses
 */
exports.addAddress = asyncHandler(async (req, res) => {
  const address = await businessService.addAddress(req.business.id, req.body);
  
  created(res, { address }, 'Address added successfully');
});

/**
 * Update address
 * PATCH /api/v1/businesses/me/addresses/:addressId
 */
exports.updateAddress = asyncHandler(async (req, res) => {
  const address = await businessService.updateAddress(
    req.business.id,
    req.params.addressId,
    req.body
  );
  
  success(res, { address }, 'Address updated successfully');
});

/**
 * Delete address
 * DELETE /api/v1/businesses/me/addresses/:addressId
 */
exports.deleteAddress = asyncHandler(async (req, res) => {
  await businessService.deleteAddress(req.business.id, req.params.addressId);
  
  success(res, null, 'Address deleted successfully');
});

/**
 * Get team members
 * GET /api/v1/businesses/me/members
 */
exports.getMembers = asyncHandler(async (req, res) => {
  const members = await businessService.getMembers(req.business.id);
  
  success(res, { members });
});

/**
 * Invite team member
 * POST /api/v1/businesses/me/members/invite
 */
exports.inviteMember = asyncHandler(async (req, res) => {
  const { email, role, permissions } = req.body;
  
  if (!email) {
    throw new BadRequestError('Email is required');
  }
  
  const invitation = await businessService.inviteMember(req.business.id, {
    email,
    role,
    permissions,
    invitedBy: req.user.id,
  });
  
  created(res, { invitation }, 'Invitation sent successfully');
});

/**
 * Update member
 * PATCH /api/v1/businesses/me/members/:memberId
 */
exports.updateMember = asyncHandler(async (req, res) => {
  const member = await businessService.updateMember(
    req.business.id,
    req.params.memberId,
    req.body
  );
  
  success(res, { member }, 'Member updated successfully');
});

/**
 * Remove member
 * DELETE /api/v1/businesses/me/members/:memberId
 */
exports.removeMember = asyncHandler(async (req, res) => {
  await businessService.removeMember(req.business.id, req.params.memberId);
  
  success(res, null, 'Member removed successfully');
});

/**
 * Get dashboard stats
 * GET /api/v1/businesses/me/dashboard
 */
exports.getDashboard = asyncHandler(async (req, res) => {
  const dashboard = await businessService.getDashboard(req.business.id);
  
  success(res, { dashboard });
});

/**
 * Get analytics
 * GET /api/v1/businesses/me/analytics
 */
exports.getAnalytics = asyncHandler(async (req, res) => {
  const { period = 'last30days' } = req.query;
  
  const analytics = await businessService.getAnalytics(req.business.id, period);
  
  success(res, { analytics });
});

/**
 * Get order stats
 * GET /api/v1/businesses/me/stats/orders
 */
exports.getOrderStats = asyncHandler(async (req, res) => {
  const { period = 'last30days' } = req.query;
  
  const stats = await businessService.getOrderStats(req.business.id, period);
  
  success(res, { stats });
});

/**
 * Get revenue stats
 * GET /api/v1/businesses/me/stats/revenue
 */
exports.getRevenueStats = asyncHandler(async (req, res) => {
  const { period = 'last30days' } = req.query;
  
  const stats = await businessService.getRevenueStats(req.business.id, period);
  
  success(res, { stats });
});

/**
 * Get bank details
 * GET /api/v1/businesses/me/bank
 */
exports.getBankDetails = asyncHandler(async (req, res) => {
  const bankDetails = await businessService.getBankDetails(req.business.id);
  
  success(res, { bankDetails });
});

/**
 * Update bank details
 * PUT /api/v1/businesses/me/bank
 */
exports.updateBankDetails = asyncHandler(async (req, res) => {
  const bankDetails = await businessService.updateBankDetails(req.business.id, req.body);
  
  success(res, { bankDetails }, 'Bank details updated successfully');
});

/**
 * Verify bank account
 * POST /api/v1/businesses/me/bank/verify
 */
exports.verifyBankAccount = asyncHandler(async (req, res) => {
  const result = await businessService.verifyBankAccount(req.business.id);
  
  success(res, result, 'Bank verification initiated');
});

/**
 * Submit for verification
 * POST /api/v1/businesses/me/verify/submit
 */
exports.submitForVerification = asyncHandler(async (req, res) => {
  const result = await businessService.submitForVerification(req.business.id);
  
  success(res, result, 'Verification request submitted');
});

/**
 * Get verification status
 * GET /api/v1/businesses/me/verify/status
 */
exports.getVerificationStatus = asyncHandler(async (req, res) => {
  const status = await businessService.getVerificationStatus(req.business.id);
  
  success(res, { status });
});
