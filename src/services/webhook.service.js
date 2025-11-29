// =============================================================================
// AIRAVAT B2B MARKETPLACE - WEBHOOK SERVICE
// Event-driven webhooks for third-party integrations
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError, BadRequestError, NotFoundError } = require('../utils/errors');
const crypto = require('crypto');
const axios = require('axios');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Webhook event types
 */
const WEBHOOK_EVENTS = {
  // Order events
  'order.created': { category: 'orders', description: 'When a new order is placed' },
  'order.confirmed': { category: 'orders', description: 'When an order is confirmed' },
  'order.shipped': { category: 'orders', description: 'When an order is shipped' },
  'order.delivered': { category: 'orders', description: 'When an order is delivered' },
  'order.cancelled': { category: 'orders', description: 'When an order is cancelled' },
  'order.refunded': { category: 'orders', description: 'When an order is refunded' },

  // Payment events
  'payment.received': { category: 'payments', description: 'When a payment is received' },
  'payment.failed': { category: 'payments', description: 'When a payment fails' },
  'payment.refunded': { category: 'payments', description: 'When a payment is refunded' },

  // Product events
  'product.created': { category: 'products', description: 'When a product is created' },
  'product.updated': { category: 'products', description: 'When a product is updated' },
  'product.deleted': { category: 'products', description: 'When a product is deleted' },
  'product.stock_low': { category: 'products', description: 'When stock falls below threshold' },
  'product.out_of_stock': { category: 'products', description: 'When product goes out of stock' },

  // RFQ events
  'rfq.created': { category: 'rfq', description: 'When an RFQ is created' },
  'rfq.quotation_received': { category: 'rfq', description: 'When a quotation is received' },
  'rfq.awarded': { category: 'rfq', description: 'When an RFQ is awarded' },
  'rfq.closed': { category: 'rfq', description: 'When an RFQ is closed' },

  // User events
  'user.registered': { category: 'users', description: 'When a new user registers' },
  'user.verified': { category: 'users', description: 'When a user is verified' },
  'business.verified': { category: 'users', description: 'When a business is verified' },

  // Inquiry events
  'inquiry.received': { category: 'inquiries', description: 'When an inquiry is received' },
  'inquiry.responded': { category: 'inquiries', description: 'When an inquiry is responded' },

  // Lead events
  'lead.captured': { category: 'leads', description: 'When a new lead is captured' },
  'lead.converted': { category: 'leads', description: 'When a lead is converted' },

  // Review events
  'review.created': { category: 'reviews', description: 'When a review is posted' },
  'review.approved': { category: 'reviews', description: 'When a review is approved' },
};

/**
 * Webhook delivery status
 */
const DELIVERY_STATUS = {
  PENDING: 'pending',
  SUCCESS: 'success',
  FAILED: 'failed',
  RETRYING: 'retrying',
};

/**
 * Retry configuration
 */
const RETRY_CONFIG = {
  maxRetries: 5,
  retryDelays: [60, 300, 900, 3600, 7200], // seconds: 1m, 5m, 15m, 1h, 2h
  timeout: 30000, // 30 seconds
};

// =============================================================================
// WEBHOOK MANAGEMENT
// =============================================================================

/**
 * Create a webhook endpoint
 * @param {string} businessId - Business ID
 * @param {Object} data - Webhook data
 * @returns {Promise<Object>} Created webhook
 */
exports.createWebhook = async (businessId, data) => {
  try {
    const { url, events, description, secret } = data;

    // Validate URL
    if (!isValidUrl(url)) {
      throw new BadRequestError('Invalid webhook URL');
    }

    // Validate events
    for (const event of events) {
      if (!WEBHOOK_EVENTS[event]) {
        throw new BadRequestError(`Invalid event type: ${event}`);
      }
    }

    // Generate secret if not provided
    const webhookSecret = secret || generateWebhookSecret();

    const webhook = await prisma.webhook.create({
      data: {
        businessId,
        url,
        events,
        description,
        secret: webhookSecret,
        isActive: true,
        metadata: {
          createdFrom: 'api',
          version: '1.0',
        },
      },
    });

    logger.info('Webhook created', { webhookId: webhook.id, businessId });

    return {
      ...webhook,
      secret: webhookSecret, // Return once for storage
    };
  } catch (error) {
    logger.error('Create webhook error', { error: error.message, businessId });
    throw error;
  }
};

/**
 * Update a webhook
 * @param {string} webhookId - Webhook ID
 * @param {string} businessId - Business ID
 * @param {Object} updates - Updates
 * @returns {Promise<Object>} Updated webhook
 */
exports.updateWebhook = async (webhookId, businessId, updates) => {
  const webhook = await prisma.webhook.findFirst({
    where: { id: webhookId, businessId },
  });

  if (!webhook) {
    throw new NotFoundError('Webhook not found');
  }

  const allowedUpdates = ['url', 'events', 'description', 'isActive'];
  const updateData = {};

  for (const key of allowedUpdates) {
    if (updates[key] !== undefined) {
      updateData[key] = updates[key];
    }
  }

  // Validate URL if updated
  if (updateData.url && !isValidUrl(updateData.url)) {
    throw new BadRequestError('Invalid webhook URL');
  }

  // Validate events if updated
  if (updateData.events) {
    for (const event of updateData.events) {
      if (!WEBHOOK_EVENTS[event]) {
        throw new BadRequestError(`Invalid event type: ${event}`);
      }
    }
  }

  const updated = await prisma.webhook.update({
    where: { id: webhookId },
    data: updateData,
  });

  logger.info('Webhook updated', { webhookId });

  return updated;
};

/**
 * Delete a webhook
 * @param {string} webhookId - Webhook ID
 * @param {string} businessId - Business ID
 * @returns {Promise<void>}
 */
exports.deleteWebhook = async (webhookId, businessId) => {
  const webhook = await prisma.webhook.findFirst({
    where: { id: webhookId, businessId },
  });

  if (!webhook) {
    throw new NotFoundError('Webhook not found');
  }

  await prisma.webhook.delete({ where: { id: webhookId } });

  logger.info('Webhook deleted', { webhookId });
};

/**
 * Get webhooks for a business
 * @param {string} businessId - Business ID
 * @returns {Promise<Object[]>} Webhooks
 */
exports.getWebhooks = async (businessId) => {
  const webhooks = await prisma.webhook.findMany({
    where: { businessId },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      url: true,
      events: true,
      description: true,
      isActive: true,
      lastTriggeredAt: true,
      successCount: true,
      failureCount: true,
      createdAt: true,
    },
  });

  return webhooks;
};

/**
 * Rotate webhook secret
 * @param {string} webhookId - Webhook ID
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} New secret
 */
exports.rotateSecret = async (webhookId, businessId) => {
  const webhook = await prisma.webhook.findFirst({
    where: { id: webhookId, businessId },
  });

  if (!webhook) {
    throw new NotFoundError('Webhook not found');
  }

  const newSecret = generateWebhookSecret();

  await prisma.webhook.update({
    where: { id: webhookId },
    data: {
      secret: newSecret,
      secretRotatedAt: new Date(),
    },
  });

  logger.info('Webhook secret rotated', { webhookId });

  return { secret: newSecret };
};

// =============================================================================
// EVENT DISPATCH
// =============================================================================

/**
 * Trigger a webhook event
 * @param {string} eventType - Event type
 * @param {Object} payload - Event payload
 * @param {Object} context - Event context
 * @returns {Promise<Object>} Dispatch results
 */
exports.triggerEvent = async (eventType, payload, context = {}) => {
  try {
    const { businessId, userId } = context;

    if (!WEBHOOK_EVENTS[eventType]) {
      logger.warn('Unknown webhook event type', { eventType });
      return { dispatched: 0 };
    }

    // Find all active webhooks subscribed to this event
    const webhooks = await prisma.webhook.findMany({
      where: {
        isActive: true,
        events: { has: eventType },
        ...(businessId && { businessId }),
      },
    });

    if (webhooks.length === 0) {
      return { dispatched: 0 };
    }

    const eventId = generateEventId();
    const timestamp = new Date().toISOString();

    const results = [];

    for (const webhook of webhooks) {
      // Create delivery record
      const delivery = await prisma.webhookDelivery.create({
        data: {
          webhookId: webhook.id,
          eventId,
          eventType,
          payload,
          status: DELIVERY_STATUS.PENDING,
          attempts: 0,
        },
      });

      // Dispatch asynchronously
      dispatchWebhook(webhook, delivery, payload, eventType, timestamp)
        .then((result) => results.push(result))
        .catch((error) => {
          logger.error('Webhook dispatch error', { error: error.message, webhookId: webhook.id });
        });
    }

    logger.info('Webhook event triggered', { 
      eventType, 
      eventId, 
      webhooksCount: webhooks.length,
    });

    return {
      eventId,
      eventType,
      dispatched: webhooks.length,
    };
  } catch (error) {
    logger.error('Trigger event error', { error: error.message, eventType });
    throw error;
  }
};

/**
 * Dispatch a single webhook
 * @param {Object} webhook - Webhook record
 * @param {Object} delivery - Delivery record
 * @param {Object} payload - Event payload
 * @param {string} eventType - Event type
 * @param {string} timestamp - Timestamp
 */
async function dispatchWebhook(webhook, delivery, payload, eventType, timestamp) {
  const signature = generateSignature(payload, webhook.secret);

    const headers = {
      'Content-Type': 'application/json',
    'X-Airavat-Event': eventType,
    'X-Airavat-Delivery': delivery.id,
    'X-Airavat-Signature': signature,
    'X-Airavat-Timestamp': timestamp,
    'User-Agent': 'Airavat-Webhook/1.0',
  };

  const body = {
    event: eventType,
    timestamp,
    data: payload,
  };

  try {
    const response = await axios.post(webhook.url, body, {
          headers,
      timeout: RETRY_CONFIG.timeout,
          validateStatus: (status) => status >= 200 && status < 300,
        });

    // Success
    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: DELIVERY_STATUS.SUCCESS,
        responseStatus: response.status,
        responseHeaders: response.headers,
        responseBody: typeof response.data === 'string' 
          ? response.data.substring(0, 1000) 
          : JSON.stringify(response.data).substring(0, 1000),
        deliveredAt: new Date(),
        attempts: { increment: 1 },
      },
    });

    await prisma.webhook.update({
      where: { id: webhook.id },
      data: {
        lastTriggeredAt: new Date(),
        successCount: { increment: 1 },
      },
    });

    return { success: true, webhookId: webhook.id };
  } catch (error) {
    // Failed
    const attempts = delivery.attempts + 1;
    const shouldRetry = attempts < RETRY_CONFIG.maxRetries;

    await prisma.webhookDelivery.update({
      where: { id: delivery.id },
      data: {
        status: shouldRetry ? DELIVERY_STATUS.RETRYING : DELIVERY_STATUS.FAILED,
        error: error.message,
        responseStatus: error.response?.status,
        attempts,
        nextRetryAt: shouldRetry 
          ? new Date(Date.now() + RETRY_CONFIG.retryDelays[attempts - 1] * 1000)
          : null,
      },
    });

    await prisma.webhook.update({
      where: { id: webhook.id },
      data: {
        lastTriggeredAt: new Date(),
        failureCount: { increment: 1 },
      },
    });

    // Schedule retry if applicable
    if (shouldRetry) {
      scheduleRetry(delivery.id, RETRY_CONFIG.retryDelays[attempts - 1]);
    }

    return { success: false, webhookId: webhook.id, error: error.message };
  }
}

/**
 * Retry a failed webhook delivery
 * @param {string} deliveryId - Delivery ID
 */
async function retryDelivery(deliveryId) {
  const delivery = await prisma.webhookDelivery.findUnique({
    where: { id: deliveryId },
    include: { webhook: true },
  });

  if (!delivery || delivery.status === DELIVERY_STATUS.SUCCESS) {
    return;
  }

  if (delivery.attempts >= RETRY_CONFIG.maxRetries) {
    await prisma.webhookDelivery.update({
      where: { id: deliveryId },
      data: { status: DELIVERY_STATUS.FAILED },
    });
    return;
  }

  await dispatchWebhook(
    delivery.webhook,
    delivery,
    delivery.payload,
    delivery.eventType,
    new Date().toISOString()
  );
}

function scheduleRetry(deliveryId, delaySeconds) {
  // In production, use a job queue like Bull
  setTimeout(() => {
    retryDelivery(deliveryId).catch((error) => {
      logger.error('Retry delivery error', { error: error.message, deliveryId });
    });
  }, delaySeconds * 1000);
}

// =============================================================================
// WEBHOOK TESTING
// =============================================================================

/**
 * Test a webhook endpoint
 * @param {string} webhookId - Webhook ID
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Test result
 */
exports.testWebhook = async (webhookId, businessId) => {
  const webhook = await prisma.webhook.findFirst({
    where: { id: webhookId, businessId },
  });

  if (!webhook) {
    throw new NotFoundError('Webhook not found');
  }

  const testPayload = {
    test: true,
    message: 'This is a test webhook from Airavat',
    timestamp: new Date().toISOString(),
  };

  const signature = generateSignature(testPayload, webhook.secret);

  try {
    const response = await axios.post(webhook.url, {
      event: 'test',
      timestamp: testPayload.timestamp,
      data: testPayload,
    }, {
      headers: {
        'Content-Type': 'application/json',
        'X-Airavat-Event': 'test',
        'X-Airavat-Signature': signature,
        'User-Agent': 'Airavat-Webhook/1.0',
      },
      timeout: 10000,
    });

    return {
      success: true,
      statusCode: response.status,
      responseTime: response.headers['x-response-time'],
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
      statusCode: error.response?.status,
    };
  }
};

/**
 * Get webhook delivery history
 * @param {string} webhookId - Webhook ID
 * @param {string} businessId - Business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Delivery history
 */
exports.getDeliveryHistory = async (webhookId, businessId, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const webhook = await prisma.webhook.findFirst({
    where: { id: webhookId, businessId },
  });

  if (!webhook) {
    throw new NotFoundError('Webhook not found');
  }

  const [deliveries, total] = await Promise.all([
    prisma.webhookDelivery.findMany({
      where: { webhookId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      select: {
        id: true,
        eventId: true,
        eventType: true,
        status: true,
        responseStatus: true,
        attempts: true,
        error: true,
        deliveredAt: true,
        createdAt: true,
      },
    }),
    prisma.webhookDelivery.count({ where: { webhookId } }),
    ]);

    return {
    deliveries,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function isValidUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:';
  } catch {
    return false;
  }
}

function generateWebhookSecret() {
  return `whsec_${crypto.randomBytes(24).toString('hex')}`;
}

function generateEventId() {
  return `evt_${crypto.randomBytes(12).toString('hex')}`;
}

function generateSignature(payload, secret) {
  const timestamp = Math.floor(Date.now() / 1000);
  const message = `${timestamp}.${JSON.stringify(payload)}`;
  const signature = crypto
    .createHmac('sha256', secret)
    .update(message)
    .digest('hex');
  return `t=${timestamp},v1=${signature}`;
}

/**
 * Verify webhook signature (for incoming webhooks)
 * @param {string} payload - Raw payload
 * @param {string} signature - Signature header
 * @param {string} secret - Webhook secret
 * @returns {boolean} Is valid
 */
exports.verifySignature = (payload, signature, secret) => {
  const parts = signature.split(',');
  const timestamp = parts.find((p) => p.startsWith('t='))?.slice(2);
  const sig = parts.find((p) => p.startsWith('v1='))?.slice(3);

  if (!timestamp || !sig) return false;

  // Check timestamp (within 5 minutes)
  const age = Math.abs(Date.now() / 1000 - parseInt(timestamp));
  if (age > 300) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');

  return crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected));
};

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  WEBHOOK_EVENTS,
  DELIVERY_STATUS,
};
