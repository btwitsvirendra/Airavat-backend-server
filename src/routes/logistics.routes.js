// =============================================================================
// AIRAVAT B2B MARKETPLACE - LOGISTICS ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const LogisticsWebhookController = require('../controllers/webhook.logistics.controller');

/**
 * @route   POST /api/v1/logistics/webhook
 * @desc    Inbound tracking updates from carriers
 */
router.post('/webhook', LogisticsWebhookController.handleCarrierUpdate);

module.exports = router;
