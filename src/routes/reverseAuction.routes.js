// =============================================================================
// AIRAVAT B2B MARKETPLACE - REVERSE AUCTION ROUTES
// Routes for buyer-initiated procurement auctions
// =============================================================================

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const reverseAuctionController = require('../controllers/reverseAuction.controller');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const createAuctionValidation = [
  body('title').notEmpty().trim().isLength({ min: 5, max: 200 }),
  body('description').notEmpty().isLength({ min: 20 }),
  body('quantity').isInt({ min: 1 }),
  body('maxBudget').isDecimal({ min: 0 }),
  body('startDate').isISO8601(),
  body('endDate').isISO8601(),
  body('deliveryDeadline').optional().isISO8601(),
];

const updateAuctionValidation = [
  param('id').isUUID(),
  body('title').optional().trim().isLength({ min: 5, max: 200 }),
  body('description').optional().isLength({ min: 20 }),
  body('quantity').optional().isInt({ min: 1 }),
];

const placeBidValidation = [
  param('id').isUUID(),
  body('amount').isDecimal({ min: 0 }),
  body('deliveryDays').optional().isInt({ min: 1 }),
  body('warranty').optional().isString(),
  body('notes').optional().isString(),
];

const inviteValidation = [
  param('id').isUUID(),
  body('sellerIds').isArray({ min: 1 }),
  body('sellerIds.*').isUUID(),
];

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

router.get(
  '/',
  optionalAuth,
  reverseAuctionController.getAuctions
);

router.get(
  '/:id',
  optionalAuth,
  param('id').isUUID(),
  validate,
  reverseAuctionController.getAuctionById
);

router.get(
  '/:id/live',
  param('id').isUUID(),
  validate,
  reverseAuctionController.getLiveUpdates
);

// =============================================================================
// BUYER ROUTES
// =============================================================================

router.post(
  '/',
  authenticate,
  authorize('buyer', 'admin'),
  createAuctionValidation,
  validate,
  reverseAuctionController.createAuction
);

router.get(
  '/my-auctions',
  authenticate,
  reverseAuctionController.getMyAuctions
);

router.put(
  '/:id',
  authenticate,
  authorize('buyer', 'admin'),
  updateAuctionValidation,
  validate,
  reverseAuctionController.updateAuction
);

router.post(
  '/:id/publish',
  authenticate,
  authorize('buyer', 'admin'),
  param('id').isUUID(),
  validate,
  reverseAuctionController.publishAuction
);

router.post(
  '/:id/cancel',
  authenticate,
  authorize('buyer', 'admin'),
  param('id').isUUID(),
  body('reason').optional().isString(),
  validate,
  reverseAuctionController.cancelAuction
);

router.post(
  '/:id/extend',
  authenticate,
  authorize('buyer', 'admin'),
  param('id').isUUID(),
  body('extensionMinutes').isInt({ min: 5, max: 1440 }),
  validate,
  reverseAuctionController.extendAuction
);

router.post(
  '/:id/award',
  authenticate,
  authorize('buyer', 'admin'),
  param('id').isUUID(),
  body('bidId').isUUID(),
  body('notes').optional().isString(),
  validate,
  reverseAuctionController.awardAuction
);

router.post(
  '/:id/invite',
  authenticate,
  authorize('buyer', 'admin'),
  inviteValidation,
  validate,
  reverseAuctionController.inviteSellers
);

router.get(
  '/:id/invitations',
  authenticate,
  param('id').isUUID(),
  validate,
  reverseAuctionController.getInvitations
);

router.get(
  '/:id/analytics',
  authenticate,
  param('id').isUUID(),
  validate,
  reverseAuctionController.getAuctionAnalytics
);

// =============================================================================
// SELLER/BIDDER ROUTES
// =============================================================================

router.get(
  '/my-participations',
  authenticate,
  authorize('seller', 'admin'),
  reverseAuctionController.getMyParticipations
);

router.post(
  '/:id/bids',
  authenticate,
  authorize('seller', 'admin'),
  placeBidValidation,
  validate,
  reverseAuctionController.placeBid
);

router.get(
  '/:id/bids',
  authenticate,
  param('id').isUUID(),
  validate,
  reverseAuctionController.getBids
);

router.get(
  '/:id/my-bid',
  authenticate,
  param('id').isUUID(),
  validate,
  reverseAuctionController.getMyBid
);

router.post(
  '/:id/bids/:bidId/withdraw',
  authenticate,
  param('id').isUUID(),
  param('bidId').isUUID(),
  validate,
  reverseAuctionController.withdrawBid
);

router.post(
  '/:id/accept-invitation',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  validate,
  reverseAuctionController.acceptInvitation
);

router.post(
  '/:id/decline-invitation',
  authenticate,
  authorize('seller', 'admin'),
  param('id').isUUID(),
  validate,
  reverseAuctionController.declineInvitation
);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;



