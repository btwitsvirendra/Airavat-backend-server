// =============================================================================
// AIRAVAT B2B MARKETPLACE - NOTIFICATION SERVICE
// Push, Email, SMS & WhatsApp Notifications
// =============================================================================

const { prisma } = require('../config/database');
const { cache, getPublisher } = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const { emitToUser, emitToBusiness } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const NOTIFICATION_TYPE = { ORDER: 'ORDER', PAYMENT: 'PAYMENT', SHIPPING: 'SHIPPING', MESSAGE: 'MESSAGE', SYSTEM: 'SYSTEM', PROMOTION: 'PROMOTION', ALERT: 'ALERT' };
const NOTIFICATION_CHANNEL = { PUSH: 'push', EMAIL: 'email', SMS: 'sms', WHATSAPP: 'whatsapp', IN_APP: 'in_app' };
const NOTIFICATION_PRIORITY = { LOW: 'LOW', NORMAL: 'NORMAL', HIGH: 'HIGH', URGENT: 'URGENT' };
const CACHE_TTL = { UNREAD_COUNT: 60, PREFERENCES: 3600 };

const TEMPLATES = {
  order_created: { title: 'New Order Received', body: 'Order #{orderNumber} has been placed for ₹{amount}', type: NOTIFICATION_TYPE.ORDER },
  order_confirmed: { title: 'Order Confirmed', body: 'Your order #{orderNumber} has been confirmed', type: NOTIFICATION_TYPE.ORDER },
  order_shipped: { title: 'Order Shipped', body: 'Your order #{orderNumber} is on its way! Track: {trackingNumber}', type: NOTIFICATION_TYPE.SHIPPING },
  order_delivered: { title: 'Order Delivered', body: 'Your order #{orderNumber} has been delivered', type: NOTIFICATION_TYPE.SHIPPING },
  payment_received: { title: 'Payment Received', body: 'Payment of ₹{amount} received for order #{orderNumber}', type: NOTIFICATION_TYPE.PAYMENT },
  payment_pending: { title: 'Payment Pending', body: 'Payment pending for order #{orderNumber}. Amount: ₹{amount}', type: NOTIFICATION_TYPE.PAYMENT },
  new_message: { title: 'New Message', body: 'You have a new message from {senderName}', type: NOTIFICATION_TYPE.MESSAGE },
  price_drop: { title: 'Price Drop Alert!', body: '{productName} is now available at ₹{newPrice} (was ₹{oldPrice})', type: NOTIFICATION_TYPE.ALERT },
  low_stock: { title: 'Low Stock Alert', body: '{productName} has only {quantity} units left', type: NOTIFICATION_TYPE.ALERT },
  rfq_received: { title: 'New RFQ Received', body: 'You have received a new quote request from {buyerName}', type: NOTIFICATION_TYPE.ORDER },
  rfq_response: { title: 'Quotation Received', body: '{sellerName} has responded to your RFQ', type: NOTIFICATION_TYPE.ORDER },
};

// =============================================================================
// NOTIFICATION CREATION
// =============================================================================

const createNotification = async (options) => {
  const { userId, businessId, template, data = {}, channels = [NOTIFICATION_CHANNEL.IN_APP, NOTIFICATION_CHANNEL.PUSH], priority = NOTIFICATION_PRIORITY.NORMAL, actionUrl, metadata } = options;

  const notificationTemplate = TEMPLATES[template];
  if (!notificationTemplate) throw new BadRequestError(`Unknown notification template: ${template}`);

  const title = renderTemplate(notificationTemplate.title, data);
  const body = renderTemplate(notificationTemplate.body, data);

  const preferences = await getNotificationPreferences(userId);
  const enabledChannels = channels.filter((channel) => {
    const prefKey = `${notificationTemplate.type.toLowerCase()}_${channel}`;
    return preferences[prefKey] !== false;
  });

  if (enabledChannels.length === 0) {
    logger.debug('Notification suppressed by preferences', { userId, template });
    return null;
  }

  const notification = await prisma.notification.create({
    data: { userId, businessId, type: notificationTemplate.type, title, body, data: { template, ...data }, actionUrl, priority, channels: enabledChannels, metadata, read: false },
  });

  await Promise.allSettled(enabledChannels.map((channel) => sendToChannel(channel, { userId, businessId, notification, data })));
  await cache.del(`notifications:unread:${userId}`);

  logger.info('Notification created', { notificationId: notification.id, userId, template, channels: enabledChannels });
  return notification;
};

const renderTemplate = (template, data) => template.replace(/\{(\w+)\}/g, (match, key) => (data[key] !== undefined ? data[key] : match));

const sendToChannel = async (channel, options) => {
  const { userId, businessId, notification, data } = options;

  switch (channel) {
    case NOTIFICATION_CHANNEL.IN_APP:
      emitToUser(userId, 'notification:new', { id: notification.id, title: notification.title, body: notification.body, type: notification.type, actionUrl: notification.actionUrl, createdAt: notification.createdAt });
      break;
    case NOTIFICATION_CHANNEL.PUSH:
      await sendPushNotification(userId, notification);
      break;
    case NOTIFICATION_CHANNEL.EMAIL:
      await queueEmailNotification(userId, notification, data);
      break;
    case NOTIFICATION_CHANNEL.SMS:
      await queueSMSNotification(userId, notification);
      break;
    case NOTIFICATION_CHANNEL.WHATSAPP:
      await queueWhatsAppNotification(userId, notification, data);
      break;
  }
};

const sendPushNotification = async (userId, notification) => {
  try {
    const devices = await prisma.userDevice.findMany({ where: { userId, pushEnabled: true }, select: { pushToken: true, platform: true } });
    if (devices.length === 0) return;

    const publisher = getPublisher();
    await publisher.publish('push:send', JSON.stringify({ tokens: devices.map((d) => d.pushToken), notification: { title: notification.title, body: notification.body, data: { notificationId: notification.id, actionUrl: notification.actionUrl } } }));
  } catch (error) {
    logger.error('Push notification failed', { userId, error: error.message });
  }
};

const queueEmailNotification = async (userId, notification, data) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true } });
    if (!user?.email) return;

    const publisher = getPublisher();
    await publisher.publish('email:send', JSON.stringify({ to: user.email, template: `notification_${notification.type.toLowerCase()}`, data: { firstName: user.firstName, title: notification.title, body: notification.body, actionUrl: notification.actionUrl, ...data } }));
  } catch (error) {
    logger.error('Email notification failed', { userId, error: error.message });
  }
};

const queueSMSNotification = async (userId, notification) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true } });
    if (!user?.phone) return;

    const publisher = getPublisher();
    await publisher.publish('sms:send', JSON.stringify({ to: user.phone, message: `${notification.title}: ${notification.body}` }));
  } catch (error) {
    logger.error('SMS notification failed', { userId, error: error.message });
  }
};

const queueWhatsAppNotification = async (userId, notification, data) => {
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { phone: true, firstName: true } });
    if (!user?.phone) return;

    const publisher = getPublisher();
    await publisher.publish('whatsapp:send', JSON.stringify({ to: user.phone, templateName: `notification_${notification.type.toLowerCase()}`, params: { name: user.firstName, title: notification.title, body: notification.body, ...data } }));
  } catch (error) {
    logger.error('WhatsApp notification failed', { userId, error: error.message });
  }
};

// =============================================================================
// NOTIFICATION MANAGEMENT
// =============================================================================

const getNotifications = async (userId, options = {}) => {
  const { page = 1, limit = 20, type, read } = options;
  const skip = (page - 1) * limit;
  const where = { userId };
  if (type) where.type = type;
  if (read !== undefined) where.read = read;

  const [notifications, total, unreadCount] = await Promise.all([
    prisma.notification.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.notification.count({ where }),
    prisma.notification.count({ where: { userId, read: false } }),
  ]);

  return { notifications, unreadCount, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

const getUnreadCount = async (userId) => {
  const cacheKey = `notifications:unread:${userId}`;
  const cached = await cache.get(cacheKey);
  if (cached !== null) return cached;

  const count = await prisma.notification.count({ where: { userId, read: false } });
  await cache.set(cacheKey, count, CACHE_TTL.UNREAD_COUNT);
  return count;
};

const markAsRead = async (notificationId, userId) => {
  const notification = await prisma.notification.findFirst({ where: { id: notificationId, userId } });
  if (!notification) throw new NotFoundError('Notification');

  if (!notification.read) {
    await prisma.notification.update({ where: { id: notificationId }, data: { read: true, readAt: new Date() } });
    await cache.del(`notifications:unread:${userId}`);
  }

  return { success: true };
};

const markAllAsRead = async (userId) => {
  await prisma.notification.updateMany({ where: { userId, read: false }, data: { read: true, readAt: new Date() } });
  await cache.del(`notifications:unread:${userId}`);
  return { success: true };
};

const deleteNotification = async (notificationId, userId) => {
  const notification = await prisma.notification.findFirst({ where: { id: notificationId, userId } });
  if (!notification) throw new NotFoundError('Notification');

  await prisma.notification.delete({ where: { id: notificationId } });
  if (!notification.read) await cache.del(`notifications:unread:${userId}`);

  return { success: true };
};

// =============================================================================
// NOTIFICATION PREFERENCES
// =============================================================================

const getNotificationPreferences = async (userId) => {
  const cacheKey = `notifications:prefs:${userId}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { notificationPreferences: true } });

  const defaultPreferences = {
    order_push: true, order_email: true, order_sms: false, order_whatsapp: true,
    payment_push: true, payment_email: true, payment_sms: true, payment_whatsapp: true,
    shipping_push: true, shipping_email: true, shipping_sms: true, shipping_whatsapp: true,
    message_push: true, message_email: false, message_sms: false, message_whatsapp: false,
    system_push: true, system_email: true, system_sms: false, system_whatsapp: false,
    promotion_push: true, promotion_email: true, promotion_sms: false, promotion_whatsapp: false,
    alert_push: true, alert_email: true, alert_sms: true, alert_whatsapp: true,
  };

  const preferences = { ...defaultPreferences, ...(user?.notificationPreferences || {}) };
  await cache.set(cacheKey, preferences, CACHE_TTL.PREFERENCES);
  return preferences;
};

const updateNotificationPreferences = async (userId, preferences) => {
  const current = await getNotificationPreferences(userId);
  const updated = { ...current, ...preferences };

  await prisma.user.update({ where: { id: userId }, data: { notificationPreferences: updated } });
  await cache.del(`notifications:prefs:${userId}`);

  return updated;
};

// =============================================================================
// BULK NOTIFICATIONS
// =============================================================================

const sendBulkNotification = async (userIds, options) => {
  const results = { sent: 0, failed: 0 };

  for (const userId of userIds) {
    try {
      await createNotification({ ...options, userId });
      results.sent++;
    } catch (error) {
      logger.error('Bulk notification failed', { userId, error: error.message });
      results.failed++;
    }
  }

  logger.info('Bulk notification completed', results);
  return results;
};

const notifyBusinessUsers = async (businessId, options) => {
  const users = await prisma.user.findMany({ where: { businessId }, select: { id: true } });
  const userIds = users.map((u) => u.id);
  return sendBulkNotification(userIds, { ...options, businessId });
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  NOTIFICATION_TYPE, NOTIFICATION_CHANNEL, NOTIFICATION_PRIORITY, TEMPLATES,
  createNotification, renderTemplate, getNotifications, getUnreadCount, markAsRead, markAllAsRead, deleteNotification,
  getNotificationPreferences, updateNotificationPreferences, sendBulkNotification, notifyBusinessUsers,
};

