// =============================================================================
// AIRAVAT B2B MARKETPLACE - SERVICES INDEX
// =============================================================================

const authService = require('./auth.service');
const businessService = require('./business.service');
const productService = require('./product.service');
const orderService = require('./order.service');
const paymentService = require('./payment.service');
const emailService = require('./email.service');
const smsService = require('./sms.service');
const uploadService = require('./upload.service');
const socketService = require('./socket.service');
const inventoryService = require('./inventory.service');
const notificationService = require('./notification.service');
const shippingService = require('./shipping.service');
const analyticsService = require('./analytics.service');

// Financial Services
const walletService = require('./wallet.service');
const emiService = require('./emi.service');
const invoiceFactoringService = require('./invoiceFactoring.service');
const tradeFinanceService = require('./tradeFinance.service');
const cashbackService = require('./cashback.service');
const virtualCardService = require('./virtualCard.service');
const bankIntegrationService = require('./bankIntegration.service');
const creditInsuranceService = require('./creditInsurance.service');
const reconciliationService = require('./reconciliation.service');
const multiCurrencyWalletService = require('./multiCurrencyWallet.service');

// Financial Support Services
const financialReportsService = require('./financialReports.service');
const financialAuditService = require('./financialAudit.service');
const financialNotificationsService = require('./financialNotifications.service');
const financialExportService = require('./financialExport.service');
const financialHealthService = require('./financialHealth.service');

module.exports = {
  authService,
  businessService,
  productService,
  orderService,
  paymentService,
  emailService,
  smsService,
  uploadService,
  socketService,
  inventoryService,
  notificationService,
  shippingService,
  analyticsService,
  
  // Financial Services
  walletService,
  emiService,
  invoiceFactoringService,
  tradeFinanceService,
  cashbackService,
  virtualCardService,
  bankIntegrationService,
  creditInsuranceService,
  reconciliationService,
  multiCurrencyWalletService,
  
  // Financial Support Services
  financialReportsService,
  financialAuditService,
  financialNotificationsService,
  financialExportService,
  financialHealthService,
};
