// =============================================================================
// AIRAVAT B2B MARKETPLACE - WEBHOOK MANAGEMENT SERVICE
// Outbound webhooks for third-party integrations
// =============================================================================

const crypto = require('crypto');
const axios = require('axios');
const { prisma } = require('../config/database');
const { addJob } = require('../jobs/queue');
const logger = require('../config/logger');

class WebhookService {
  // ===========================================================================
  // WEBHOOK EVENTS
  // ===========================================================================

  static EVENTS = {
    // Order events
    ORDER_CREATED: 'order.created',
    ORDER_CONFIRMED: 'order.confirmed',
    ORDER_SHIPPED: 'order.shipped',
    ORDER_DELIVERED: 'order.delivered',
    ORDER_CANCELLED: 'order.cancelled',
    ORDER_REFUNDED: 'order.refunded',
    
    // Product events
    PRODUCT_CREATED: 'product.created',
    PRODUCT_UPDATED: 'product.updated',
    PRODUCT_DELETED: 'product.deleted',
    PRODUCT_LOW_STOCK: 'product.low_stock',
    PRODUCT_OUT_OF_STOCK: 'product.out_of_stock',
    
    // Payment events
    PAYMENT_RECEIVED: 'payment.received',
    PAYMENT_FAILED: 'payment.failed',
    PAYMENT_REFUNDED: 'payment.refunded',
    
    // Business events
    BUSINESS_VERIFIED: 'business.verified',
    BUSINESS_SUSPENDED: 'business.suspended',
    
    // RFQ events
    RFQ_CREATED: 'rfq.created',
    RFQ_QUOTE_RECEIVED: 'rfq.quote_received',
    RFQ_ACCEPTED: 'rfq.accepted',
    
    // Inventory events
    INVENTORY_UPDATED: 'inventory.updated',
    INVENTORY_THRESHOLD_REACHED: 'inventory.threshold_reached',
  };

  // ===========================================================================
  // WEBHOOK REGISTRATION
  // ===========================================================================

  /**
   * Register a webhook endpoint
   */
  async registerWebhook(businessId, data) {
    const { url, events, secret, description } = data;

    // Validate URL
    if (!this.isValidUrl(url)) {
      throw new Error('Invalid webhook URL');
    }

    // Generate secret if not provided
    const webhookSecret = secret || this.generateSecret();

    const webhook = await prisma.webhookEndpoint.create({
      data: {
        businessId,
        url,
        events,
        secret: webhookSecret,
        description,
        isActive: true,
        metadata: {},
      },
    });

    // Test the webhook
    await this.testWebhook(webhook.id);

    return {
      ...webhook,
      secret: webhookSecret, // Only return secret on creation
    };
  }

  /**
   * Update webhook endpoint
   */
  async updateWebhook(webhookId, businessId, data) {
    const { url, events, isActive, description } = data;

    const webhook = await prisma.webhookEndpoint.findFirst({
      where: { id: webhookId, businessId },
    });

    if (!webhook) {
      throw new Error('Webhook not found');
    }

    return prisma.webhookEndpoint.update({
      where: { id: webhookId },
      data: {
        url: url || webhook.url,
        events: events || webhook.events,
        isActive: isActive !== undefined ? isActive : webhook.isActive,
        description: description || webhook.description,
        updatedAt: new Date(),
      },
    });
  }

  /**
   * Delete webhook endpoint
   */
  async deleteWebhook(webhookId, businessId) {
    const webhook = await prisma.webhookEndpoint.findFirst({
      where: { id: webhookId, businessId },
    });

    if (!webhook) {
      throw new Error('Webhook not found');
    }

    await prisma.webhookEndpoint.delete({
      where: { id: webhookId },
    });

    return { success: true };
  }

  /**
   * Get webhooks for a business
   */
  async getWebhooks(businessId) {
    return prisma.webhookEndpoint.findMany({
      where: { businessId },
      select: {
        id: true,
        url: true,
        events: true,
        isActive: true,
        description: true,
        lastTriggeredAt: true,
        failureCount: true,
        createdAt: true,
      },
    });
  }

  /**
   * Regenerate webhook secret
   */
  async regenerateSecret(webhookId, businessId) {
    const webhook = await prisma.webhookEndpoint.findFirst({
      where: { id: webhookId, businessId },
    });

    if (!webhook) {
      throw new Error('Webhook not found');
    }

    const newSecret = this.generateSecret();

    await prisma.webhookEndpoint.update({
      where: { id: webhookId },
      data: { secret: newSecret },
    });

    return { secret: newSecret };
  }

  // ===========================================================================
  // WEBHOOK DISPATCHING
  // ===========================================================================

  /**
   * Dispatch webhook event to all registered endpoints
   */
  async dispatch(event, payload, businessIds = []) {
    const webhooks = await prisma.webhookEndpoint.findMany({
      where: {
        isActive: true,
        events: { has: event },
        ...(businessIds.length > 0 && { businessId: { in: businessIds } }),
      },
    });

    const results = [];

    for (const webhook of webhooks) {
      // Queue webhook delivery for reliability
      await addJob('webhookDelivery', {
        webhookId: webhook.id,
        event,
        payload,
      }, {
        attempts: 5,
        backoff: {
          type: 'exponential',
          delay: 1000,
        },
      });

      results.push({ webhookId: webhook.id, queued: true });
    }

    return results;
  }

  /**
   * Deliver webhook (called by job processor)
   */
  async deliver(webhookId, event, payload) {
    const webhook = await prisma.webhookEndpoint.findUnique({
      where: { id: webhookId },
    });

    if (!webhook || !webhook.isActive) {
      throw new Error('Webhook not found or inactive');
    }

    const timestamp = Date.now();
    const signature = this.generateSignature(webhook.secret, timestamp, payload);

    const headers = {
      'Content-Type': 'application/json',
      'X-Webhook-Event': event,
      'X-Webhook-Timestamp': timestamp.toString(),
      'X-Webhook-Signature': signature,
      'X-Webhook-Id': webhookId,
      'User-Agent': 'Airavat-Webhook/1.0',
    };

    const deliveryId = crypto.randomUUID();
    const startTime = Date.now();

    try {
      const response = await axios.post(webhook.url, {
        event,
        payload,
        timestamp: new Date().toISOString(),
        deliveryId,
      }, {
        headers,
        timeout: 30000, // 30 second timeout
        validateStatus: () => true, // Accept any status code
      });

      const success = response.status >= 200 && response.status < 300;
      const responseTime = Date.now() - startTime;

      // Log delivery
      await this.logDelivery(webhookId, {
        deliveryId,
        event,
        success,
        statusCode: response.status,
        responseTime,
        requestHeaders: headers,
        responseHeaders: response.headers,
        responseBody: typeof response.data === 'string' 
          ? response.data.substring(0, 1000) 
          : JSON.stringify(response.data).substring(0, 1000),
      });

      // Update webhook stats
      await prisma.webhookEndpoint.update({
        where: { id: webhookId },
        data: {
          lastTriggeredAt: new Date(),
          failureCount: success ? 0 : { increment: 1 },
        },
      });

      if (!success) {
        throw new Error(`Webhook returned status ${response.status}`);
      }

      return { success: true, deliveryId, statusCode: response.status };
    } catch (error) {
      const responseTime = Date.now() - startTime;

      // Log failed delivery
      await this.logDelivery(webhookId, {
        deliveryId,
        event,
        success: false,
        error: error.message,
        responseTime,
        requestHeaders: headers,
      });

      // Update failure count
      const updated = await prisma.webhookEndpoint.update({
        where: { id: webhookId },
        data: {
          lastTriggeredAt: new Date(),
          failureCount: { increment: 1 },
        },
      });

      // Disable webhook after too many failures
      if (updated.failureCount >= 10) {
        await prisma.webhookEndpoint.update({
          where: { id: webhookId },
          data: { isActive: false },
        });

        logger.warn('Webhook disabled due to failures', { webhookId });
      }

      throw error;
    }
  }

  /**
   * Test webhook endpoint
   */
  async testWebhook(webhookId) {
    const webhook = await prisma.webhookEndpoint.findUnique({
      where: { id: webhookId },
    });

    if (!webhook) {
      throw new Error('Webhook not found');
    }

    const testPayload = {
      test: true,
      message: 'This is a test webhook from Airavat B2B Marketplace',
      timestamp: new Date().toISOString(),
    };

    try {
      await this.deliver(webhookId, 'webhook.test', testPayload);
      return { success: true, message: 'Test webhook delivered successfully' };
    } catch (error) {
      return { success: false, message: error.message };
    }
  }

  // ===========================================================================
  // WEBHOOK LOGS
  // ===========================================================================

  /**
   * Log webhook delivery
   */
  async logDelivery(webhookId, data) {
    return prisma.webhookDelivery.create({
      data: {
        webhookId,
        deliveryId: data.deliveryId,
        event: data.event,
        success: data.success,
        statusCode: data.statusCode,
        responseTime: data.responseTime,
        error: data.error,
        requestHeaders: data.requestHeaders,
        responseHeaders: data.responseHeaders,
        responseBody: data.responseBody,
      },
    });
  }

  /**
   * Get delivery logs for a webhook
   */
  async getDeliveryLogs(webhookId, options = {}) {
    const { page = 1, limit = 20, success } = options;

    const where = { webhookId };
    if (success !== undefined) {
      where.success = success;
    }

    const [logs, total] = await Promise.all([
      prisma.webhookDelivery.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.webhookDelivery.count({ where }),
    ]);

    return {
      logs,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Retry failed delivery
   */
  async retryDelivery(deliveryId) {
    const delivery = await prisma.webhookDelivery.findUnique({
      where: { id: deliveryId },
      include: { webhook: true },
    });

    if (!delivery) {
      throw new Error('Delivery not found');
    }

    // Queue for retry
    await addJob('webhookDelivery', {
      webhookId: delivery.webhookId,
      event: delivery.event,
      payload: delivery.requestBody,
      isRetry: true,
      originalDeliveryId: deliveryId,
    });

    return { success: true, message: 'Retry queued' };
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Generate webhook secret
   */
  generateSecret() {
    return `whsec_${crypto.randomBytes(32).toString('hex')}`;
  }

  /**
   * Generate signature for payload
   */
  generateSignature(secret, timestamp, payload) {
    const signedPayload = `${timestamp}.${JSON.stringify(payload)}`;
    return crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');
  }

  /**
   * Verify webhook signature (for incoming webhooks)
   */
  verifySignature(secret, signature, timestamp, payload) {
    const expectedSignature = this.generateSignature(secret, timestamp, payload);
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Validate URL
   */
  isValidUrl(url) {
    try {
      const parsed = new URL(url);
      return ['http:', 'https:'].includes(parsed.protocol);
    } catch {
      return false;
    }
  }

  // ===========================================================================
  // EVENT TRIGGERS (Called by other services)
  // ===========================================================================

  async onOrderCreated(order) {
    await this.dispatch(
      WebhookService.EVENTS.ORDER_CREATED,
      this.formatOrderPayload(order),
      [order.sellerId, order.buyerId]
    );
  }

  async onOrderStatusChanged(order, newStatus) {
    const eventMap = {
      'CONFIRMED': WebhookService.EVENTS.ORDER_CONFIRMED,
      'SHIPPED': WebhookService.EVENTS.ORDER_SHIPPED,
      'DELIVERED': WebhookService.EVENTS.ORDER_DELIVERED,
      'CANCELLED': WebhookService.EVENTS.ORDER_CANCELLED,
      'REFUNDED': WebhookService.EVENTS.ORDER_REFUNDED,
    };

    const event = eventMap[newStatus];
    if (event) {
      await this.dispatch(
        event,
        this.formatOrderPayload(order),
        [order.sellerId, order.buyerId]
      );
    }
  }

  async onPaymentReceived(payment) {
    await this.dispatch(
      WebhookService.EVENTS.PAYMENT_RECEIVED,
      {
        paymentId: payment.id,
        orderId: payment.orderId,
        amount: payment.amount,
        currency: payment.currency,
        method: payment.method,
        status: payment.status,
      },
      [payment.businessId]
    );
  }

  async onLowStock(variant, product) {
    await this.dispatch(
      WebhookService.EVENTS.PRODUCT_LOW_STOCK,
      {
        productId: product.id,
        productName: product.name,
        variantId: variant.id,
        sku: variant.sku,
        currentStock: variant.stockQuantity,
        threshold: variant.lowStockThreshold,
      },
      [product.businessId]
    );
  }

  formatOrderPayload(order) {
    return {
      orderId: order.id,
      orderNumber: order.orderNumber,
      status: order.status,
      paymentStatus: order.paymentStatus,
      totalAmount: order.totalAmount,
      currency: order.currency,
      itemCount: order.items?.length,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
    };
  }
}

module.exports = new WebhookService();
