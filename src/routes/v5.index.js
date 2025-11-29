// =============================================================================
// AIRAVAT B2B MARKETPLACE - V5 ROUTES INDEX
// Revenue, Enterprise, and Platform Enhancement Routes
// =============================================================================

const express = require('express');
const router = express.Router();

// Import routes
const commissionRoutes = require('./commission.routes');
const subscriptionRoutes = require('./subscription.routes');
const advertisingRoutes = require('./advertising.routes');
const leadRoutes = require('./lead.routes');

// =============================================================================
// MOUNT ROUTES
// =============================================================================

// Revenue & Monetization
router.use('/commissions', commissionRoutes);
router.use('/subscriptions', subscriptionRoutes);
router.use('/advertising', advertisingRoutes);
router.use('/leads', leadRoutes);

// =============================================================================
// BUSINESS INTELLIGENCE ROUTES
// =============================================================================

const biController = require('../controllers/bi.controller');
const { authenticate, authorize } = require('../middleware/auth.middleware');

router.get('/bi/dashboard', authenticate, biController.getDashboard);
router.get('/bi/realtime', authenticate, biController.getRealtime);
router.get('/bi/cohort', authenticate, biController.getCohortAnalysis);
router.get('/bi/forecast', authenticate, biController.getForecast);
router.get('/bi/clv', authenticate, biController.getCustomerLifetimeValue);
router.get('/bi/churn', authenticate, biController.getChurnAnalysis);
router.post('/bi/reports', authenticate, biController.generateReport);

// =============================================================================
// LOCALIZATION ROUTES
// =============================================================================

const localizationController = require('../controllers/localization.controller');

router.get('/i18n/languages', localizationController.getLanguages);
router.get('/i18n/translations/:lang', localizationController.getTranslations);
router.get('/i18n/translate', localizationController.translate);
router.post('/i18n/translations', authenticate, authorize('admin'), localizationController.setTranslation);
router.post('/i18n/import', authenticate, authorize('admin'), localizationController.importTranslations);
router.put('/users/language', authenticate, localizationController.setUserLanguage);

// =============================================================================
// MULTI-TENANCY ROUTES
// =============================================================================

const tenantController = require('../controllers/tenant.controller');

router.post('/tenants', authenticate, tenantController.createTenant);
router.get('/tenants/:identifier', tenantController.getTenant);
router.put('/tenants/:id', authenticate, tenantController.updateTenant);
router.put('/tenants/:id/branding', authenticate, tenantController.updateBranding);
router.post('/tenants/:id/domain', authenticate, tenantController.setupDomain);
router.post('/tenants/:id/domain/verify', authenticate, tenantController.verifyDomain);
router.delete('/tenants/:id/domain', authenticate, tenantController.removeDomain);
router.post('/tenants/:id/api-key/rotate', authenticate, tenantController.rotateApiKey);
router.get('/tenants/:id/users', authenticate, tenantController.getUsers);
router.post('/tenants/:id/users', authenticate, tenantController.addUser);
router.delete('/tenants/:id/users/:userId', authenticate, tenantController.removeUser);

// =============================================================================
// TALLY INTEGRATION ROUTES
// =============================================================================

const tallyController = require('../controllers/tally.controller');

router.post('/integrations/tally/connect', authenticate, authorize('seller'), tallyController.configure);
router.get('/integrations/tally/status', authenticate, tallyController.getStatus);
router.post('/integrations/tally/sync', authenticate, tallyController.syncAll);
router.post('/integrations/tally/sync/customer/:customerId', authenticate, tallyController.syncCustomer);
router.post('/integrations/tally/sync/order/:orderId', authenticate, tallyController.syncOrder);
router.post('/integrations/tally/sync/product/:productId', authenticate, tallyController.syncProduct);
router.get('/integrations/tally/import/ledgers', authenticate, tallyController.importLedgers);
router.get('/integrations/tally/import/stock', authenticate, tallyController.importStock);

// =============================================================================
// WEBHOOK ROUTES
// =============================================================================

const webhookController = require('../controllers/webhook.controller');

router.post('/webhooks', authenticate, webhookController.createWebhook);
router.get('/webhooks', authenticate, webhookController.getWebhooks);
router.put('/webhooks/:id', authenticate, webhookController.updateWebhook);
router.delete('/webhooks/:id', authenticate, webhookController.deleteWebhook);
router.post('/webhooks/:id/test', authenticate, webhookController.testWebhook);
router.post('/webhooks/:id/rotate-secret', authenticate, webhookController.rotateSecret);
router.get('/webhooks/:id/deliveries', authenticate, webhookController.getDeliveries);
router.get('/webhooks/events', webhookController.getEventTypes);

// =============================================================================
// API MARKETPLACE ROUTES
// =============================================================================

const apiController = require('../controllers/api.controller');

router.get('/api-marketplace/docs', apiController.getDocs);
router.get('/api-marketplace/plans', apiController.getPlans);
router.post('/api-marketplace/keys', authenticate, apiController.generateKey);
router.get('/api-marketplace/keys', authenticate, apiController.listKeys);
router.delete('/api-marketplace/keys/:id', authenticate, apiController.revokeKey);
router.get('/api-marketplace/usage', authenticate, apiController.getUsage);
router.post('/api-marketplace/keys/:id/upgrade', authenticate, apiController.upgradePlan);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;



