// =============================================================================
// AIRAVAT B2B MARKETPLACE - BUSINESS ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const businessController = require('../controllers/business.controller');
const { authenticate, optionalAuth, requireBusiness, requireVerifiedBusiness, requireBusinessOwner } = require('../middleware/auth');
const { validate } = require('../middleware/errorHandler');
const { createBusinessSchema, updateBusinessSchema } = require('../validators/schemas');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

// Get business by slug (public profile)
router.get(
  '/slug/:slug',
  optionalAuth,
  businessController.getBySlug
);

// Get business products
router.get(
  '/:businessId/products',
  optionalAuth,
  businessController.getProducts
);

// Get business reviews
router.get(
  '/:businessId/reviews',
  businessController.getReviews
);

// Verify GSTIN (for registration)
router.post(
  '/verify-gstin',
  businessController.verifyGSTIN
);

// =============================================================================
// PROTECTED ROUTES
// =============================================================================

// Create business profile
router.post(
  '/',
  authenticate,
  validate(createBusinessSchema),
  businessController.create
);

// Get current user's business
router.get(
  '/me',
  authenticate,
  requireBusiness,
  businessController.getMyBusiness
);

// Update business
router.patch(
  '/me',
  authenticate,
  requireBusiness,
  requireBusinessOwner,
  validate(updateBusinessSchema),
  businessController.update
);

// Upload business documents
router.post(
  '/me/documents',
  authenticate,
  requireBusiness,
  requireBusinessOwner,
  businessController.uploadDocuments
);

// Delete business document
router.delete(
  '/me/documents/:documentId',
  authenticate,
  requireBusiness,
  requireBusinessOwner,
  businessController.deleteDocument
);

// Get business settings
router.get(
  '/me/settings',
  authenticate,
  requireBusiness,
  businessController.getSettings
);

// Update business settings
router.patch(
  '/me/settings',
  authenticate,
  requireBusiness,
  requireBusinessOwner,
  businessController.updateSettings
);

// =============================================================================
// BUSINESS ADDRESSES
// =============================================================================

// Get addresses
router.get(
  '/me/addresses',
  authenticate,
  requireBusiness,
  businessController.getAddresses
);

// Add address
router.post(
  '/me/addresses',
  authenticate,
  requireBusiness,
  businessController.addAddress
);

// Update address
router.patch(
  '/me/addresses/:addressId',
  authenticate,
  requireBusiness,
  businessController.updateAddress
);

// Delete address
router.delete(
  '/me/addresses/:addressId',
  authenticate,
  requireBusiness,
  businessController.deleteAddress
);

// =============================================================================
// TEAM MEMBERS
// =============================================================================

// Get team members
router.get(
  '/me/members',
  authenticate,
  requireBusiness,
  businessController.getMembers
);

// Invite team member
router.post(
  '/me/members/invite',
  authenticate,
  requireBusiness,
  requireBusinessOwner,
  businessController.inviteMember
);

// Update member role/permissions
router.patch(
  '/me/members/:memberId',
  authenticate,
  requireBusiness,
  requireBusinessOwner,
  businessController.updateMember
);

// Remove team member
router.delete(
  '/me/members/:memberId',
  authenticate,
  requireBusiness,
  requireBusinessOwner,
  businessController.removeMember
);

// =============================================================================
// ANALYTICS & DASHBOARD
// =============================================================================

// Get business dashboard stats
router.get(
  '/me/dashboard',
  authenticate,
  requireBusiness,
  businessController.getDashboard
);

// Get analytics data
router.get(
  '/me/analytics',
  authenticate,
  requireBusiness,
  businessController.getAnalytics
);

// Get order statistics
router.get(
  '/me/stats/orders',
  authenticate,
  requireBusiness,
  businessController.getOrderStats
);

// Get revenue statistics
router.get(
  '/me/stats/revenue',
  authenticate,
  requireBusiness,
  businessController.getRevenueStats
);

// =============================================================================
// BANK ACCOUNT
// =============================================================================

// Get bank details
router.get(
  '/me/bank',
  authenticate,
  requireBusiness,
  requireBusinessOwner,
  businessController.getBankDetails
);

// Update bank details
router.put(
  '/me/bank',
  authenticate,
  requireBusiness,
  requireBusinessOwner,
  businessController.updateBankDetails
);

// Verify bank account
router.post(
  '/me/bank/verify',
  authenticate,
  requireBusiness,
  requireBusinessOwner,
  businessController.verifyBankAccount
);

// =============================================================================
// VERIFICATION
// =============================================================================

// Submit for verification
router.post(
  '/me/verify/submit',
  authenticate,
  requireBusiness,
  requireBusinessOwner,
  businessController.submitForVerification
);

// Get verification status
router.get(
  '/me/verify/status',
  authenticate,
  requireBusiness,
  businessController.getVerificationStatus
);

module.exports = router;
