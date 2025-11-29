// =============================================================================
// AIRAVAT B2B MARKETPLACE - WEBHOOK CONTROLLER
// Handles webhook management endpoints
// =============================================================================

const webhookService = require('../services/webhook.service');
const asyncHandler = require('../middleware/async.middleware');

// =============================================================================
// WEBHOOK MANAGEMENT
// =============================================================================

/**
 * Create a webhook
 * @route POST /api/v1/webhooks
 */
const createWebhook = asyncHandler(async (req, res) => {
  const webhook = await webhookService.createWebhook(
    req.user.businessId,
    req.body
  );

  res.status(201).json({
    success: true,
    message: 'Webhook created. Store the secret securely.',
    data: webhook,
  });
});

/**
 * Get all webhooks
 * @route GET /api/v1/webhooks
 */
const getWebhooks = asyncHandler(async (req, res) => {
  const webhooks = await webhookService.getWebhooks(req.user.businessId);

  res.json({
    success: true,
    data: webhooks,
  });
});

/**
 * Update a webhook
 * @route PUT /api/v1/webhooks/:id
 */
const updateWebhook = asyncHandler(async (req, res) => {
  const webhook = await webhookService.updateWebhook(
    req.params.id,
    req.user.businessId,
    req.body
  );

  res.json({
    success: true,
    message: 'Webhook updated',
    data: webhook,
  });
});

/**
 * Delete a webhook
 * @route DELETE /api/v1/webhooks/:id
 */
const deleteWebhook = asyncHandler(async (req, res) => {
  await webhookService.deleteWebhook(req.params.id, req.user.businessId);

  res.json({
    success: true,
    message: 'Webhook deleted',
  });
});

/**
 * Test a webhook
 * @route POST /api/v1/webhooks/:id/test
 */
const testWebhook = asyncHandler(async (req, res) => {
  const result = await webhookService.testWebhook(
    req.params.id,
    req.user.businessId
  );

  res.json({
    success: result.success,
    message: result.success ? 'Test successful' : 'Test failed',
    data: result,
  });
});

/**
 * Rotate webhook secret
 * @route POST /api/v1/webhooks/:id/rotate-secret
 */
const rotateSecret = asyncHandler(async (req, res) => {
  const result = await webhookService.rotateSecret(
    req.params.id,
    req.user.businessId
  );

  res.json({
    success: true,
    message: 'Secret rotated. Store the new secret securely.',
    data: result,
  });
});

/**
 * Get delivery history
 * @route GET /api/v1/webhooks/:id/deliveries
 */
const getDeliveries = asyncHandler(async (req, res) => {
  const result = await webhookService.getDeliveryHistory(
    req.params.id,
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: result.deliveries,
    pagination: result.pagination,
  });
});

/**
 * Get available event types
 * @route GET /api/v1/webhooks/events
 */
const getEventTypes = asyncHandler(async (req, res) => {
  const events = Object.entries(webhookService.WEBHOOK_EVENTS).map(
    ([event, config]) => ({
      event,
      ...config,
    })
  );

  // Group by category
  const grouped = events.reduce((acc, event) => {
    if (!acc[event.category]) {
      acc[event.category] = [];
    }
    acc[event.category].push(event);
    return acc;
  }, {});

  res.json({
    success: true,
    data: grouped,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  createWebhook,
  getWebhooks,
  updateWebhook,
  deleteWebhook,
  testWebhook,
  rotateSecret,
  getDeliveries,
  getEventTypes,
};
