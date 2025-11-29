// =============================================================================
// AIRAVAT B2B MARKETPLACE - EVENT EMITTER SERVICE
// Pub/Sub pattern for decoupled event handling
// =============================================================================

const EventEmitter = require('events');
const { redis, cache } = require('../config/redis');
const logger = require('../config/logger');

/**
 * Event types used across the application
 */
const EVENTS = {
  // User events
  USER_REGISTERED: 'user.registered',
  USER_VERIFIED: 'user.verified',
  USER_LOGIN: 'user.login',
  USER_LOGOUT: 'user.logout',
  USER_PASSWORD_CHANGED: 'user.password_changed',
  USER_PROFILE_UPDATED: 'user.profile_updated',

  // Business events
  BUSINESS_CREATED: 'business.created',
  BUSINESS_VERIFIED: 'business.verified',
  BUSINESS_REJECTED: 'business.rejected',
  BUSINESS_UPDATED: 'business.updated',
  BUSINESS_SUSPENDED: 'business.suspended',

  // Product events
  PRODUCT_CREATED: 'product.created',
  PRODUCT_UPDATED: 'product.updated',
  PRODUCT_DELETED: 'product.deleted',
  PRODUCT_PUBLISHED: 'product.published',
  PRODUCT_OUT_OF_STOCK: 'product.out_of_stock',
  PRODUCT_LOW_STOCK: 'product.low_stock',

  // Order events
  ORDER_CREATED: 'order.created',
  ORDER_CONFIRMED: 'order.confirmed',
  ORDER_PROCESSING: 'order.processing',
  ORDER_SHIPPED: 'order.shipped',
  ORDER_DELIVERED: 'order.delivered',
  ORDER_CANCELLED: 'order.cancelled',
  ORDER_REFUNDED: 'order.refunded',

  // Payment events
  PAYMENT_INITIATED: 'payment.initiated',
  PAYMENT_COMPLETED: 'payment.completed',
  PAYMENT_FAILED: 'payment.failed',
  PAYMENT_REFUNDED: 'payment.refunded',

  // RFQ events
  RFQ_CREATED: 'rfq.created',
  RFQ_QUOTATION_RECEIVED: 'rfq.quotation_received',
  RFQ_AWARDED: 'rfq.awarded',
  RFQ_CLOSED: 'rfq.closed',
  RFQ_EXPIRED: 'rfq.expired',

  // Chat events
  CHAT_MESSAGE_SENT: 'chat.message_sent',
  CHAT_MESSAGE_READ: 'chat.message_read',
  CHAT_TYPING: 'chat.typing',

  // Review events
  REVIEW_SUBMITTED: 'review.submitted',
  REVIEW_APPROVED: 'review.approved',
  REVIEW_REJECTED: 'review.rejected',
  REVIEW_RESPONDED: 'review.responded',

  // Notification events
  NOTIFICATION_CREATED: 'notification.created',
  NOTIFICATION_READ: 'notification.read',

  // System events
  SYSTEM_MAINTENANCE: 'system.maintenance',
  SYSTEM_ALERT: 'system.alert',
  SYSTEM_METRIC: 'system.metric',
};

/**
 * Event handler registry
 */
class EventRegistry {
  constructor() {
    this.handlers = new Map();
  }

  register(eventType, handler, options = {}) {
    if (!this.handlers.has(eventType)) {
      this.handlers.set(eventType, []);
    }

    this.handlers.get(eventType).push({
      handler,
      priority: options.priority || 10,
      async: options.async !== false,
      name: options.name || handler.name || 'anonymous',
    });

    // Sort by priority
    this.handlers.get(eventType).sort((a, b) => a.priority - b.priority);

    logger.debug('Event handler registered', { eventType, name: options.name });
  }

  unregister(eventType, handler) {
    if (!this.handlers.has(eventType)) return;

    const handlers = this.handlers.get(eventType);
    const index = handlers.findIndex((h) => h.handler === handler);

    if (index !== -1) {
      handlers.splice(index, 1);
    }
  }

  getHandlers(eventType) {
    return this.handlers.get(eventType) || [];
  }
}

/**
 * Application Event Emitter
 */
class AppEventEmitter extends EventEmitter {
  constructor() {
    super();
    this.registry = new EventRegistry();
    this.redisEnabled = false;
    this.redisPublisher = null;
    this.redisSubscriber = null;
    this.eventHistory = [];
    this.maxHistorySize = 1000;
  }

  /**
   * Initialize Redis pub/sub for distributed events
   */
  async initDistributed() {
    try {
      if (!redis) {
        logger.warn('Redis not available, using local events only');
        return;
      }

      // Create separate connections for pub/sub
      this.redisPublisher = redis.duplicate();
      this.redisSubscriber = redis.duplicate();

      await this.redisPublisher.connect();
      await this.redisSubscriber.connect();

      // Subscribe to all events pattern
      await this.redisSubscriber.psubscribe('events:*', (message, channel) => {
        const eventType = channel.replace('events:', '');
        const data = JSON.parse(message);

        // Emit locally (but skip publishing to avoid loop)
        this.emitLocal(eventType, data);
      });

      this.redisEnabled = true;
      logger.info('Distributed event emitter initialized');
    } catch (error) {
      logger.error('Failed to initialize distributed events', { error: error.message });
    }
  }

  /**
   * Register event handler
   */
  on(eventType, handler, options = {}) {
    this.registry.register(eventType, handler, options);
    return super.on(eventType, handler);
  }

  /**
   * Emit event locally only
   */
  emitLocal(eventType, data) {
    // Add metadata
    const eventData = {
      ...data,
      _meta: {
        eventType,
        timestamp: new Date().toISOString(),
        source: process.env.NODE_APP_INSTANCE || 'default',
      },
    };

    // Store in history
    this.addToHistory(eventType, eventData);

    // Get handlers from registry
    const handlers = this.registry.getHandlers(eventType);

    // Execute handlers
    for (const { handler, async: isAsync, name } of handlers) {
      try {
        if (isAsync) {
          setImmediate(() => {
            Promise.resolve(handler(eventData)).catch((error) => {
              logger.error('Async event handler error', {
                eventType,
                handler: name,
                error: error.message,
              });
            });
          });
        } else {
          handler(eventData);
        }
      } catch (error) {
        logger.error('Event handler error', {
          eventType,
          handler: name,
          error: error.message,
        });
      }
    }

    // Call native EventEmitter
    return super.emit(eventType, eventData);
  }

  /**
   * Emit event (distributed if available)
   */
  async emit(eventType, data = {}) {
    // Add metadata
    const eventData = {
      ...data,
      _meta: {
        eventType,
        timestamp: new Date().toISOString(),
        source: process.env.NODE_APP_INSTANCE || 'default',
      },
    };

    logger.debug('Event emitted', { eventType, data: eventData });

    // Publish to Redis if available
    if (this.redisEnabled && this.redisPublisher) {
      try {
        await this.redisPublisher.publish(
          `events:${eventType}`,
          JSON.stringify(eventData)
        );
      } catch (error) {
        logger.error('Failed to publish event to Redis', {
          eventType,
          error: error.message,
        });
      }
    }

    // Also emit locally
    return this.emitLocal(eventType, eventData);
  }

  /**
   * Emit and wait for all handlers to complete
   */
  async emitAsync(eventType, data = {}) {
    const eventData = {
      ...data,
      _meta: {
        eventType,
        timestamp: new Date().toISOString(),
        source: process.env.NODE_APP_INSTANCE || 'default',
      },
    };

    const handlers = this.registry.getHandlers(eventType);
    const results = [];

    for (const { handler, name } of handlers) {
      try {
        const result = await handler(eventData);
        results.push({ name, success: true, result });
      } catch (error) {
        results.push({ name, success: false, error: error.message });
        logger.error('Async event handler error', {
          eventType,
          handler: name,
          error: error.message,
        });
      }
    }

    return results;
  }

  /**
   * Add event to history
   */
  addToHistory(eventType, data) {
    this.eventHistory.push({
      eventType,
      data,
      timestamp: Date.now(),
    });

    // Trim history
    if (this.eventHistory.length > this.maxHistorySize) {
      this.eventHistory.shift();
    }
  }

  /**
   * Get event history
   */
  getHistory(filter = {}) {
    let history = this.eventHistory;

    if (filter.eventType) {
      history = history.filter((e) => e.eventType === filter.eventType);
    }

    if (filter.since) {
      history = history.filter((e) => e.timestamp >= filter.since);
    }

    if (filter.limit) {
      history = history.slice(-filter.limit);
    }

    return history;
  }

  /**
   * Clear event history
   */
  clearHistory() {
    this.eventHistory = [];
  }

  /**
   * Subscribe to multiple events
   */
  subscribe(events, handler) {
    for (const event of events) {
      this.on(event, handler);
    }
  }

  /**
   * Shutdown
   */
  async shutdown() {
    if (this.redisSubscriber) {
      await this.redisSubscriber.punsubscribe();
      await this.redisSubscriber.quit();
    }

    if (this.redisPublisher) {
      await this.redisPublisher.quit();
    }

    this.removeAllListeners();
    logger.info('Event emitter shutdown complete');
  }
}

// Create singleton instance
const eventEmitter = new AppEventEmitter();

// Register default handlers
function registerDefaultHandlers() {
  // User registration
  eventEmitter.on(EVENTS.USER_REGISTERED, async (data) => {
    const emailService = require('./email.service');
    await emailService.sendWelcomeEmail(data.email, data.firstName);
  }, { name: 'sendWelcomeEmail', priority: 1 });

  // Order created
  eventEmitter.on(EVENTS.ORDER_CREATED, async (data) => {
    const notificationService = require('./notification.service');
    await notificationService.notifyOrderCreated(data.order);
  }, { name: 'notifyOrderCreated', priority: 1 });

  // Order shipped
  eventEmitter.on(EVENTS.ORDER_SHIPPED, async (data) => {
    const emailService = require('./email.service');
    const smsService = require('./sms.service');
    
    await Promise.all([
      emailService.sendOrderShippedEmail(data.buyerEmail, data.order),
      smsService.sendOrderShippedSMS(data.buyerPhone, data.order),
    ]);
  }, { name: 'notifyOrderShipped', priority: 1 });

  // Low stock alert
  eventEmitter.on(EVENTS.PRODUCT_LOW_STOCK, async (data) => {
    const emailService = require('./email.service');
    await emailService.sendLowStockAlert(data.sellerEmail, data.product);
  }, { name: 'sendLowStockAlert', priority: 5 });

  // Payment completed - update order
  eventEmitter.on(EVENTS.PAYMENT_COMPLETED, async (data) => {
    const orderService = require('./order.service');
    await orderService.confirmPayment(data.orderId, data.paymentId);
  }, { name: 'confirmOrderPayment', priority: 1 });

  // RFQ quotation received
  eventEmitter.on(EVENTS.RFQ_QUOTATION_RECEIVED, async (data) => {
    const notificationService = require('./notification.service');
    await notificationService.notifyQuotationReceived(data.rfq, data.quotation);
  }, { name: 'notifyQuotationReceived', priority: 1 });

  // Analytics tracking
  eventEmitter.on('*', async (data) => {
    const analyticsService = require('./analytics.service');
    await analyticsService.trackEvent(data._meta.eventType, data);
  }, { name: 'trackAnalytics', priority: 100 });

  logger.info('Default event handlers registered');
}

module.exports = {
  eventEmitter,
  EVENTS,
  registerDefaultHandlers,
};
