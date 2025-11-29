// =============================================================================
// AIRAVAT B2B MARKETPLACE - ROUTES INDEX
// =============================================================================

const express = require('express');
const router = express.Router();

// Import all route modules
const authRoutes = require('./auth.routes');
const userRoutes = require('./user.routes');
const businessRoutes = require('./business.routes');
const productRoutes = require('./product.routes');
const categoryRoutes = require('./category.routes');
const cartRoutes = require('./cart.routes');
const orderRoutes = require('./order.routes');
const rfqRoutes = require('./rfq.routes');
const chatRoutes = require('./chat.routes');
const paymentRoutes = require('./payment.routes');
const reviewRoutes = require('./review.routes');
const searchRoutes = require('./search.routes');
const subscriptionRoutes = require('./subscription.routes');
const promotionRoutes = require('./promotion.routes');
const uploadRoutes = require('./upload.routes');
const webhookRoutes = require('./webhook.routes');
const adminRoutes = require('./admin.routes');
const financialRoutes = require('./financial.routes');
const financialAdminRoutes = require('./financialAdmin.routes');
const financialWebhooksRoutes = require('./financialWebhooks.routes');
const financialReportsRoutes = require('./financialReports.routes');

// V2 Feature Routes
const wishlistRoutes = require('./wishlist.routes');
const alertRoutes = require('./alert.routes');
const orderTemplateRoutes = require('./orderTemplate.routes');
const quickOrderRoutes = require('./quickOrder.routes');
const sampleRoutes = require('./sample.routes');
const auctionRoutes = require('./auction.routes');
const contractRoutes = require('./contract.routes');
const approvalRoutes = require('./approval.routes');
const referralRoutes = require('./referral.routes');
const loyaltyRoutes = require('./loyalty.routes');
const tradeAssuranceRoutes = require('./tradeAssurance.routes');
const vendorScorecardRoutes = require('./vendorScorecard.routes');

// V3 Feature Routes
const walletRoutes = require('./wallet.routes');
const creditLineRoutes = require('./creditLine.routes');
const eInvoiceRoutes = require('./eInvoice.routes');
const eWayBillRoutes = require('./eWayBill.routes');
const bulkUploadRoutes = require('./bulkUpload.routes');
const analyticsRoutes = require('./analytics.routes');
const flashDealRoutes = require('./flashDeal.routes');
const couponRoutes = require('./coupon.routes');
const notificationRoutes = require('./notification.routes');
const warehouseRoutes = require('./warehouse.routes');
const shippingRoutes = require('./shipping.routes');
const twoFactorAuthRoutes = require('./twoFactorAuth.routes');
const documentVaultRoutes = require('./documentVault.routes');

// =============================================================================
// API ROUTES (v1)
// =============================================================================

// Health check
router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
  });
});

// API info
router.get('/', (req, res) => {
  res.json({
    name: 'Airavat B2B Marketplace API',
    version: 'v1',
    description: 'B2B E-commerce Platform API for Indian Businesses',
    documentation: '/api/v1/docs',
    endpoints: {
      auth: '/api/v1/auth',
      users: '/api/v1/users',
      businesses: '/api/v1/businesses',
      products: '/api/v1/products',
      categories: '/api/v1/categories',
      cart: '/api/v1/cart',
      orders: '/api/v1/orders',
      rfq: '/api/v1/rfq',
      chat: '/api/v1/chat',
      payments: '/api/v1/payments',
      reviews: '/api/v1/reviews',
      search: '/api/v1/search',
      subscriptions: '/api/v1/subscriptions',
      promotions: '/api/v1/promotions',
      uploads: '/api/v1/uploads',
      admin: '/api/v1/admin',
      financial: '/api/v1/financial',
      financialReports: '/api/v1/reports/financial',
      // V2 Features
      wishlist: '/api/v1/wishlist',
      alerts: '/api/v1/alerts',
      orderTemplates: '/api/v1/order-templates',
      quickOrders: '/api/v1/quick-orders',
      samples: '/api/v1/samples',
      auctions: '/api/v1/auctions',
      contracts: '/api/v1/contracts',
      approvals: '/api/v1/approvals',
      referrals: '/api/v1/referrals',
      loyalty: '/api/v1/loyalty',
      tradeAssurance: '/api/v1/trade-assurance',
      vendorScorecards: '/api/v1/vendor-scorecards',
      // V3 Features
      wallet: '/api/v1/wallet',
      creditLine: '/api/v1/credit-line',
      eInvoice: '/api/v1/e-invoice',
      eWayBill: '/api/v1/e-way-bill',
      bulkUpload: '/api/v1/bulk-upload',
      analytics: '/api/v1/analytics',
      flashDeals: '/api/v1/flash-deals',
      coupons: '/api/v1/coupons',
      notifications: '/api/v1/notifications',
      warehouse: '/api/v1/warehouse',
      shipping: '/api/v1/shipping',
      twoFactorAuth: '/api/v1/2fa',
      documentVault: '/api/v1/documents',
      // V4 Features - Phase 1 (Quick Wins)
      scanner: '/api/v1/scanner',
      deepLinks: '/api/v1/deep-links',
      badges: '/api/v1/badges',
      consent: '/api/v1/consent',
      announcements: '/api/v1/announcements',
      socialShare: '/api/v1/social-share',
      sellerStories: '/api/v1/seller-stories',
      // V4 Features - Phase 2 (Medium Priority)
      blanketOrders: '/api/v1/blanket-orders',
      requisitions: '/api/v1/requisitions',
      forum: '/api/v1/forum',
      privacy: '/api/v1/privacy',
      // V4 Features - Phase 3 (High Impact B2B)
      reverseAuctions: '/api/v1/reverse-auctions',
      disputes: '/api/v1/disputes',
      // V4 Features - Phase 4 (Advanced AI)
      chatbot: '/api/v1/chatbot',
      smartPricing: '/api/v1/pricing',
      // V5 Features - Revenue & Enterprise
      commissions: '/api/v1/commissions',
      advertising: '/api/v1/advertising',
      leads: '/api/v1/leads',
      bi: '/api/v1/bi',
      tenants: '/api/v1/tenants',
      integrationsTally: '/api/v1/integrations/tally',
      apiMarketplace: '/api/v1/api-marketplace',
      i18n: '/api/v1/i18n',
    },
  });
});

// =============================================================================
// MOUNT ROUTES
// =============================================================================

// Authentication & User Management
router.use('/auth', authRoutes);
router.use('/users', userRoutes);

// Business Management
router.use('/businesses', businessRoutes);

// Product & Catalog
router.use('/products', productRoutes);
router.use('/categories', categoryRoutes);

// Shopping & Orders
router.use('/cart', cartRoutes);
router.use('/orders', orderRoutes);

// RFQ (Request for Quotation)
router.use('/rfq', rfqRoutes);

// Communication
router.use('/chat', chatRoutes);

// Payments & Transactions
router.use('/payments', paymentRoutes);

// Reviews & Ratings
router.use('/reviews', reviewRoutes);

// Search & Discovery
router.use('/search', searchRoutes);

// Subscriptions & Plans
router.use('/subscriptions', subscriptionRoutes);

// Promotions & Advertising
router.use('/promotions', promotionRoutes);

// File Uploads
router.use('/uploads', uploadRoutes);

// Webhooks (for external services)
router.use('/webhooks', webhookRoutes);

// Admin Panel
router.use('/admin', adminRoutes);

// Financial Services
router.use('/financial', financialRoutes);
router.use('/admin/financial', financialAdminRoutes);
router.use('/webhooks/financial', financialWebhooksRoutes);
router.use('/reports/financial', financialReportsRoutes);

// =============================================================================
// V2 FEATURES
// =============================================================================

// Wishlist & Alerts
router.use('/wishlist', wishlistRoutes);
router.use('/alerts', alertRoutes);

// Order Templates & Quick Orders
router.use('/order-templates', orderTemplateRoutes);
router.use('/quick-orders', quickOrderRoutes);

// Sample Orders
router.use('/samples', sampleRoutes);

// Auctions
router.use('/auctions', auctionRoutes);

// Contracts & Approvals
router.use('/contracts', contractRoutes);
router.use('/approvals', approvalRoutes);

// Loyalty & Referrals
router.use('/referrals', referralRoutes);
router.use('/loyalty', loyaltyRoutes);

// Trade Assurance
router.use('/trade-assurance', tradeAssuranceRoutes);

// Vendor Scorecards
router.use('/vendor-scorecards', vendorScorecardRoutes);

// =============================================================================
// V3 FEATURES
// =============================================================================

// Wallet & Credit
router.use('/wallet', walletRoutes);
router.use('/credit-line', creditLineRoutes);

// E-Invoice & E-Way Bill
router.use('/e-invoice', eInvoiceRoutes);
router.use('/e-way-bill', eWayBillRoutes);

// Bulk Upload
router.use('/bulk-upload', bulkUploadRoutes);

// Analytics
router.use('/analytics', analyticsRoutes);

// Flash Deals & Coupons
router.use('/flash-deals', flashDealRoutes);
router.use('/coupons', couponRoutes);

// Notifications
router.use('/notifications', notificationRoutes);

// Warehouse & Shipping
router.use('/warehouse', warehouseRoutes);
router.use('/shipping', shippingRoutes);

// Security
router.use('/2fa', twoFactorAuthRoutes);

// Document Vault
router.use('/documents', documentVaultRoutes);

// =============================================================================
// V4 FEATURES (PHASES 1-4)
// =============================================================================

// Phase 1: Quick Wins
const scannerRoutes = require('./scanner.routes');
const deepLinkRoutes = require('./deepLink.routes');
const badgeRoutes = require('./badge.routes');
const consentRoutes = require('./consent.routes');
const announcementRoutes = require('./announcement.routes');
const socialShareRoutes = require('./socialShare.routes');
const sellerStoryRoutes = require('./sellerStory.routes');

// Phase 2: Medium Priority
const blanketOrderRoutes = require('./blanketOrder.routes');
const requisitionRoutes = require('./requisition.routes');
const forumRoutes = require('./forum.routes');
const privacyRoutes = require('./privacy.routes');

// Phase 3: High Impact B2B
const reverseAuctionRoutes = require('./reverseAuction.routes');
const disputeRoutes = require('./dispute.routes');

// Phase 4: Advanced AI
const chatbotRoutes = require('./chatbot.routes');
const smartPricingRoutes = require('./smartPricing.routes');

// V5 Features (Revenue, Enterprise, Platform)
const v5Routes = require('./v5.index');
const commissionRoutes = require('./commission.routes');
const advertisingRoutes = require('./advertising.routes');
const leadRoutes = require('./lead.routes');

// Mount V4 Routes
router.use('/scanner', scannerRoutes);
router.use('/deep-links', deepLinkRoutes);
router.use('/badges', badgeRoutes);
router.use('/consent', consentRoutes);
router.use('/announcements', announcementRoutes);
router.use('/social-share', socialShareRoutes);
router.use('/seller-stories', sellerStoryRoutes);
router.use('/blanket-orders', blanketOrderRoutes);
router.use('/requisitions', requisitionRoutes);
router.use('/forum', forumRoutes);
router.use('/privacy', privacyRoutes);
router.use('/reverse-auctions', reverseAuctionRoutes);
router.use('/disputes', disputeRoutes);
router.use('/chatbot', chatbotRoutes);
router.use('/pricing', smartPricingRoutes);

// =============================================================================
// V5 FEATURES (REVENUE, ENTERPRISE, PLATFORM)
// =============================================================================

// Revenue & Monetization
router.use('/commissions', commissionRoutes);
router.use('/advertising', advertisingRoutes);
router.use('/leads', leadRoutes);

// Enterprise Features (via v5 routes)
router.use('/', v5Routes);

// =============================================================================
// 404 HANDLER
// =============================================================================

router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
  });
});

module.exports = router;
