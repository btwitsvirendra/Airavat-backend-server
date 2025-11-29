// =============================================================================
// AIRAVAT B2B MARKETPLACE - V4 ROUTES INDEX
// Consolidates all Phase 1-4 feature routes
// =============================================================================

const express = require('express');
const router = express.Router();

// =============================================================================
// PHASE 1: QUICK WINS
// =============================================================================

const scannerRoutes = require('./scanner.routes');
const deepLinkRoutes = require('./deepLink.routes');
const badgeRoutes = require('./badge.routes');
const consentRoutes = require('./consent.routes');
const announcementRoutes = require('./announcement.routes');
const socialShareRoutes = require('./socialShare.routes');
const sellerStoryRoutes = require('./sellerStory.routes');

// =============================================================================
// PHASE 2: MEDIUM PRIORITY
// =============================================================================

const blanketOrderRoutes = require('./blanketOrder.routes');
const requisitionRoutes = require('./requisition.routes');
const forumRoutes = require('./forum.routes');
// const productVideoRoutes = require('./productVideo.routes');
// const digitalProductRoutes = require('./digitalProduct.routes');
const privacyRoutes = require('./privacy.routes');

// =============================================================================
// PHASE 3: HIGH IMPACT B2B
// =============================================================================

const reverseAuctionRoutes = require('./reverseAuction.routes');
const disputeRoutes = require('./dispute.routes');

// =============================================================================
// PHASE 4: ADVANCED AI
// =============================================================================

const chatbotRoutes = require('./chatbot.routes');
const smartPricingRoutes = require('./smartPricing.routes');

// =============================================================================
// MOUNT ROUTES
// =============================================================================

// Phase 1 Routes
router.use('/scanner', scannerRoutes);
router.use('/deep-links', deepLinkRoutes);
router.use('/badges', badgeRoutes);
router.use('/consent', consentRoutes);
router.use('/announcements', announcementRoutes);
router.use('/social-share', socialShareRoutes);
router.use('/seller-stories', sellerStoryRoutes);

// Phase 2 Routes
router.use('/blanket-orders', blanketOrderRoutes);
router.use('/requisitions', requisitionRoutes);
router.use('/forum', forumRoutes);
// router.use('/videos', productVideoRoutes);
// router.use('/digital-products', digitalProductRoutes);
router.use('/privacy', privacyRoutes);

// Phase 3 Routes
router.use('/reverse-auctions', reverseAuctionRoutes);
router.use('/disputes', disputeRoutes);

// Phase 4 Routes
router.use('/chatbot', chatbotRoutes);
router.use('/pricing', smartPricingRoutes);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;



