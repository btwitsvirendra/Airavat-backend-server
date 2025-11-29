// =============================================================================
// AIRAVAT B2B MARKETPLACE - V3 SERVICES INDEX
// All New Feature Services
// =============================================================================

// Financial Services
const WalletService = require('./wallet.service');
const CreditLineService = require('./creditLine.service');

// GST Compliance Services
const EInvoiceService = require('./eInvoice.service');
const EWayBillService = require('./eWayBill.service');

// Seller Tools Services
const BulkUploadService = require('./bulkUpload.service');
const AdvancedAnalyticsService = require('./advancedAnalytics.service');
const AIRecommendationService = require('./aiRecommendation.service');

// Marketing Services
const FlashDealService = require('./flashDeal.service');
const CouponService = require('./coupon.service');

// Communication Services
const NotificationService = require('./notification.service');

// Logistics Services
const WarehouseService = require('./warehouse.service');
const ShippingService = require('./shipping.service');

// Security Services
const TwoFactorAuthService = require('./twoFactorAuth.service');
const FraudDetectionService = require('./fraudDetection.service');
const DocumentVaultService = require('./documentVault.service');
const AuditLogService = require('./auditLog.service');

module.exports = {
  // Financial
  WalletService,
  CreditLineService,
  
  // GST Compliance
  EInvoiceService,
  EWayBillService,
  
  // Seller Tools
  BulkUploadService,
  AdvancedAnalyticsService,
  AIRecommendationService,
  
  // Marketing
  FlashDealService,
  CouponService,
  
  // Communication
  NotificationService,
  
  // Logistics
  WarehouseService,
  ShippingService,
  
  // Security
  TwoFactorAuthService,
  FraudDetectionService,
  DocumentVaultService,
  AuditLogService
};

