// =============================================================================
// AIRAVAT B2B MARKETPLACE - JOB PROCESSORS
// =============================================================================

const { queues } = require('./queue');
const { prisma } = require('../config/database');
const emailService = require('../services/email.service');
const smsService = require('../services/sms.service');
const notificationService = require('../services/notification.service');
const inventoryService = require('../services/inventory.service');
const logger = require('../config/logger');

// =============================================================================
// EMAIL PROCESSOR
// =============================================================================

queues.email.process('send', async (job) => {
  const { type, to, data } = job.data;
  
  logger.info('Processing email job', { type, to });
  
  switch (type) {
    case 'verification':
      await emailService.sendVerificationEmail(to, data.userId);
      break;
    case 'welcome':
      await emailService.sendWelcomeEmail(to, data);
      break;
    case 'password-reset':
      await emailService.sendPasswordResetEmail(to, data.token);
      break;
    case 'order-confirmation':
      await emailService.sendOrderConfirmationEmail(to, data.order);
      break;
    case 'order-shipped':
      await emailService.sendOrderShippedEmail(to, data.order);
      break;
    case 'order-delivered':
      await emailService.sendOrderDeliveredEmail(to, data.order);
      break;
    case 'quotation-received':
      await emailService.sendQuotationReceivedEmail(to, data);
      break;
    case 'payment-received':
      await emailService.sendPaymentReceivedEmail(to, data);
      break;
    case 'notification':
      await emailService.sendNotificationEmail(to, data);
      break;
    default:
      logger.warn('Unknown email type', { type });
  }
  
  return { success: true, type, to };
});

// =============================================================================
// SMS PROCESSOR
// =============================================================================

queues.sms.process('send', async (job) => {
  const { type, phone, data } = job.data;
  
  logger.info('Processing SMS job', { type, phone });
  
  switch (type) {
    case 'otp':
      await smsService.sendOTP(phone, data.otp);
      break;
    case 'order-update':
      await smsService.sendOrderUpdate(phone, data.message);
      break;
    case 'notification':
      await smsService.sendNotification(phone, data.message);
      break;
    default:
      logger.warn('Unknown SMS type', { type });
  }
  
  return { success: true, type, phone };
});

// =============================================================================
// NOTIFICATION PROCESSOR
// =============================================================================

queues.notification.process('send', async (job) => {
  const { userId, type, title, message, data, channels } = job.data;
  
  logger.info('Processing notification job', { userId, type });
  
  await notificationService.send({
    userId,
    type,
    title,
    message,
    data,
    channels,
  });
  
  return { success: true, userId, type };
});

// =============================================================================
// INVENTORY PROCESSOR
// =============================================================================

queues.inventory.process('update', async (job) => {
  const { variantId, quantity, type, reason, updatedBy } = job.data;
  
  logger.info('Processing inventory update', { variantId, quantity, type });
  
  await inventoryService.updateStock(variantId, quantity, type, {
    reason,
    updatedBy,
  });
  
  return { success: true, variantId };
});

queues.inventory.process('check-low-stock', async (job) => {
  const { businessId } = job.data;
  
  logger.info('Checking low stock', { businessId });
  
  const { variants } = await inventoryService.getLowStockProducts(businessId, { limit: 100 });
  
  if (variants.length > 0) {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });
    
    await notificationService.send({
      userId: business.ownerId,
      businessId,
      type: 'LOW_STOCK_ALERT',
      title: 'Low Stock Alert',
      message: `${variants.length} products are running low on stock`,
      data: { count: variants.length },
      channels: ['in_app', 'email'],
    });
  }
  
  return { success: true, lowStockCount: variants.length };
});

// =============================================================================
// ORDER PROCESSOR
// =============================================================================

queues.order.process('process', async (job) => {
  const { orderId } = job.data;
  
  logger.info('Processing order', { orderId });
  
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { variant: true } },
      buyer: { include: { owner: true } },
      seller: { include: { owner: true } },
    },
  });
  
  if (!order) {
    throw new Error('Order not found');
  }
  
  // Confirm inventory reservation
  await inventoryService.confirmReservation(orderId);
  
  // Send notifications
  await notificationService.notifyNewOrder(order);
  
  // Update order timeline
  await prisma.orderTimeline.create({
    data: {
      orderId,
      status: 'CONFIRMED',
      message: 'Order confirmed and inventory reserved',
    },
  });
  
  return { success: true, orderId };
});

queues.order.process('status-update', async (job) => {
  const { orderId, status } = job.data;
  
  logger.info('Processing order status update', { orderId, status });
  
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      buyer: { include: { owner: true } },
      seller: { include: { owner: true } },
    },
  });
  
  // Send appropriate notification based on status
  switch (status) {
    case 'CONFIRMED':
      await notificationService.notifyOrderConfirmed(order);
      break;
    case 'SHIPPED':
      await notificationService.notifyOrderShipped(order);
      break;
    case 'DELIVERED':
      await notificationService.notifyOrderDelivered(order);
      break;
  }
  
  return { success: true, orderId, status };
});

// =============================================================================
// IMPORT PROCESSOR
// =============================================================================

queues.import.process('products', async (job) => {
  const { businessId, fileUrl, mode } = job.data;
  
  logger.info('Processing product import', { businessId, fileUrl });
  
  // This would typically:
  // 1. Download CSV from fileUrl
  // 2. Parse CSV data
  // 3. Validate each row
  // 4. Create/update products
  // 5. Report progress
  
  const results = {
    total: 0,
    created: 0,
    updated: 0,
    failed: 0,
    errors: [],
  };
  
  // Update import status
  await job.progress(100);
  
  // Notify user
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });
  
  await notificationService.send({
    userId: business.ownerId,
    businessId,
    type: 'IMPORT_COMPLETE',
    title: 'Product Import Complete',
    message: `Imported ${results.created} products, updated ${results.updated}`,
    data: results,
    channels: ['in_app', 'email'],
  });
  
  return results;
});

// =============================================================================
// REPORT PROCESSOR
// =============================================================================

queues.report.process('generate', async (job) => {
  const { businessId, type, dateRange, format } = job.data;
  
  logger.info('Generating report', { businessId, type });
  
  // Generate report based on type
  let reportData;
  
  switch (type) {
    case 'sales':
      // Generate sales report
      break;
    case 'inventory':
      // Generate inventory report
      break;
    case 'orders':
      // Generate orders report
      break;
  }
  
  // Store report and notify user
  const business = await prisma.business.findUnique({
    where: { id: businessId },
  });
  
  await notificationService.send({
    userId: business.ownerId,
    businessId,
    type: 'REPORT_READY',
    title: 'Report Ready',
    message: `Your ${type} report is ready to download`,
    channels: ['in_app', 'email'],
  });
  
  return { success: true, type };
});

queues.report.process('daily-summary', async (job) => {
  logger.info('Generating daily summary reports');
  
  // Get all active businesses
  const businesses = await prisma.business.findMany({
    where: { verificationStatus: 'VERIFIED' },
    include: { owner: true },
  });
  
  for (const business of businesses) {
    // Generate and send daily summary
    // This would include orders, revenue, new customers, etc.
  }
  
  return { success: true, businessCount: businesses.length };
});

// =============================================================================
// CLEANUP PROCESSOR
// =============================================================================

queues.cleanup.process('expired-carts', async (job) => {
  logger.info('Cleaning up expired carts');
  
  const result = await prisma.cart.deleteMany({
    where: {
      businessId: null, // Only guest carts
      expiresAt: { lt: new Date() },
    },
  });
  
  logger.info(`Deleted ${result.count} expired carts`);
  
  return { deleted: result.count };
});

queues.cleanup.process('expired-reservations', async (job) => {
  logger.info('Cleaning up expired reservations');
  
  const cleaned = await inventoryService.cleanupExpiredReservations();
  
  return { cleaned };
});

queues.cleanup.process('update-organic-scores', async (job) => {
  logger.info('Updating organic scores');
  
  // Update product organic scores based on:
  // - Recent sales
  // - View count
  // - Ratings
  // - Stock availability
  
  const products = await prisma.product.findMany({
    where: { status: 'ACTIVE' },
    select: {
      id: true,
      viewCount: true,
      orderCount: true,
      averageRating: true,
      reviewCount: true,
    },
  });
  
  for (const product of products) {
    const score = calculateOrganicScore(product);
    
    await prisma.product.update({
      where: { id: product.id },
      data: { organicScore: score },
    });
  }
  
  logger.info(`Updated organic scores for ${products.length} products`);
  
  return { updated: products.length };
});

queues.cleanup.process('subscription-check', async (job) => {
  logger.info('Checking subscriptions');
  
  // Find expired subscriptions
  const expired = await prisma.subscription.findMany({
    where: {
      status: 'ACTIVE',
      currentPeriodEnd: { lt: new Date() },
    },
    include: { businesses: true },
  });
  
  for (const subscription of expired) {
    // Update to expired or downgrade
    await prisma.subscription.update({
      where: { id: subscription.id },
      data: { status: 'EXPIRED' },
    });
    
    // Notify business owner
    for (const business of subscription.businesses) {
      await notificationService.send({
        userId: business.ownerId,
        businessId: business.id,
        type: 'SUBSCRIPTION_EXPIRED',
        title: 'Subscription Expired',
        message: 'Your subscription has expired. Renew to continue enjoying premium features.',
        channels: ['in_app', 'email'],
      });
    }
  }
  
  return { expired: expired.length };
});

queues.cleanup.process('old-notifications', async (job) => {
  logger.info('Cleaning up old notifications');
  
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  
  const result = await prisma.notification.deleteMany({
    where: {
      isRead: true,
      createdAt: { lt: thirtyDaysAgo },
    },
  });
  
  logger.info(`Deleted ${result.count} old notifications`);
  
  return { deleted: result.count };
});

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function calculateOrganicScore(product) {
  const weights = {
    views: 0.1,
    orders: 0.4,
    rating: 0.3,
    reviews: 0.2,
  };
  
  const normalized = {
    views: Math.min(product.viewCount / 1000, 1),
    orders: Math.min(product.orderCount / 100, 1),
    rating: (product.averageRating || 0) / 5,
    reviews: Math.min(product.reviewCount / 50, 1),
  };
  
  const score = 
    normalized.views * weights.views +
    normalized.orders * weights.orders +
    normalized.rating * weights.rating +
    normalized.reviews * weights.reviews;
  
  return Math.round(score * 100);
}

// =============================================================================
// INITIALIZE PROCESSORS
// =============================================================================

function initProcessors() {
  logger.info('Job processors initialized');
}

module.exports = { initProcessors };
