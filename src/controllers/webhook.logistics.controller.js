// =============================================================================
// AIRAVAT B2B MARKETPLACE - LOGISTICS WEBHOOK CONTROLLER
// =============================================================================

const LogisticsWebhookService = require('../services/webhook.logistics.service');

/**
 * Handle carrier webhook (e.g., from Shiprocket or Aramex)
 */
exports.handleCarrierUpdate = async (req, res, next) => {
  try {
    // Basic verification of webhook signature should go here
    await LogisticsWebhookService.handleTrackingWebhook(req.body);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
};
