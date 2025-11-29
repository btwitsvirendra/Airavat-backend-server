// =============================================================================
// AIRAVAT B2B MARKETPLACE - V3 ROUTES INDEX
// All New Feature Routes
// =============================================================================

const express = require('express');
const router = express.Router();

// Financial Routes
const walletRoutes = require('./wallet.routes');
const creditLineRoutes = require('./creditLine.routes');

// GST Compliance Routes
const eInvoiceRoutes = require('./eInvoice.routes');
const eWayBillRoutes = require('./eWayBill.routes');

// Seller Tools Routes
const bulkUploadRoutes = require('./bulkUpload.routes');
const analyticsRoutes = require('./analytics.routes');

// Marketing Routes
const flashDealRoutes = require('./flashDeal.routes');
const couponRoutes = require('./coupon.routes');

// Communication Routes
const notificationRoutes = require('./notification.routes');

// Logistics Routes
const warehouseRoutes = require('./warehouse.routes');
const shippingRoutes = require('./shipping.routes');

// Security Routes
const twoFactorAuthRoutes = require('./twoFactorAuth.routes');
const documentVaultRoutes = require('./documentVault.routes');

// Mount all routes
router.use('/wallet', walletRoutes);
router.use('/credit', creditLineRoutes);
router.use('/e-invoice', eInvoiceRoutes);
router.use('/e-way-bill', eWayBillRoutes);
router.use('/bulk-upload', bulkUploadRoutes);
router.use('/analytics', analyticsRoutes);
router.use('/flash-deals', flashDealRoutes);
router.use('/coupons', couponRoutes);
router.use('/notifications', notificationRoutes);
router.use('/warehouses', warehouseRoutes);
router.use('/shipping', shippingRoutes);
router.use('/2fa', twoFactorAuthRoutes);
router.use('/documents', documentVaultRoutes);

module.exports = router;

