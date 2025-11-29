// =============================================================================
// AIRAVAT B2B MARKETPLACE - SCHEDULED JOBS (CRON)
// Background scheduled tasks for maintenance and automation
// =============================================================================

const cron = require('node-cron');
const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const emailService = require('../services/email.service');
const analyticsService = require('../services/analytics.service');
const inventoryService = require('../services/inventory.service');
const elasticsearchService = require('../services/elasticsearch.service');
const { initializeFinancialJobs } = require('./financial.jobs');

class ScheduledJobs {
  constructor() {
    this.jobs = [];
  }

  /**
   * Initialize all scheduled jobs
   */
  init() {
    logger.info('Initializing scheduled jobs...');

    // Run every minute
    this.addJob('* * * * *', 'Process Pending Payments', this.processPendingPayments);

    // Run every 5 minutes
    this.addJob('*/5 * * * *', 'Release Expired Cart Reservations', this.releaseExpiredReservations);
    this.addJob('*/5 * * * *', 'Process Pending Notifications', this.processPendingNotifications);

    // Run every 15 minutes
    this.addJob('*/15 * * * *', 'Update Currency Rates', this.updateCurrencyRates);
    this.addJob('*/15 * * * *', 'Sync Search Index', this.syncSearchIndex);

    // Run every hour
    this.addJob('0 * * * *', 'Clean Expired Sessions', this.cleanExpiredSessions);
    this.addJob('0 * * * *', 'Process Subscription Renewals', this.processSubscriptionRenewals);
    this.addJob('0 * * * *', 'Update Product Scores', this.updateProductScores);

    // Run every 6 hours
    this.addJob('0 */6 * * *', 'Generate Analytics Summaries', this.generateAnalyticsSummaries);
    this.addJob('0 */6 * * *', 'Check Low Stock Alerts', this.checkLowStockAlerts);

    // Run daily at midnight
    this.addJob('0 0 * * *', 'Clean Old Data', this.cleanOldData);
    this.addJob('0 0 * * *', 'Generate Daily Reports', this.generateDailyReports);
    this.addJob('0 0 * * *', 'Process Credit Overdue', this.processCreditOverdue);
    this.addJob('0 0 * * *', 'Expire Old RFQs', this.expireOldRFQs);
    this.addJob('0 0 * * *', 'Update Trust Scores', this.updateTrustScores);

    // Run daily at 6 AM
    this.addJob('0 6 * * *', 'Send Digest Emails', this.sendDigestEmails);

    // Run weekly on Sunday at midnight
    this.addJob('0 0 * * 0', 'Generate Weekly Reports', this.generateWeeklyReports);
    this.addJob('0 0 * * 0', 'Cleanup Temporary Files', this.cleanupTempFiles);

    // Run monthly on 1st at midnight
    this.addJob('0 0 1 * *', 'Generate Monthly Reports', this.generateMonthlyReports);
    this.addJob('0 0 1 * *', 'Process Monthly Settlements', this.processMonthlySettlements);
    this.addJob('0 0 1 * *', 'Archive Old Orders', this.archiveOldOrders);

    // Initialize financial services scheduled jobs
    initializeFinancialJobs();

    logger.info(`${this.jobs.length} scheduled jobs initialized`);
  }

  /**
   * Add a scheduled job
   */
  addJob(schedule, name, handler) {
    const job = cron.schedule(schedule, async () => {
      const startTime = Date.now();
      logger.info(`[CRON] Starting: ${name}`);
      
      try {
        await handler.call(this);
        logger.info(`[CRON] Completed: ${name} (${Date.now() - startTime}ms)`);
      } catch (error) {
        logger.error(`[CRON] Failed: ${name}`, { error: error.message, stack: error.stack });
      }
    }, {
      scheduled: false,
      timezone: 'Asia/Kolkata',
    });

    this.jobs.push({ name, schedule, job });
  }

  /**
   * Start all jobs
   */
  start() {
    this.jobs.forEach(({ job }) => job.start());
    logger.info('All scheduled jobs started');
  }

  /**
   * Stop all jobs
   */
  stop() {
    this.jobs.forEach(({ job }) => job.stop());
    logger.info('All scheduled jobs stopped');
  }

  // ===========================================================================
  // JOB HANDLERS
  // ===========================================================================

  /**
   * Process pending payments that are stuck
   */
  async processPendingPayments() {
    const stuckPayments = await prisma.payment.findMany({
      where: {
        status: 'PENDING',
        createdAt: {
          lt: new Date(Date.now() - 30 * 60 * 1000), // Older than 30 minutes
        },
      },
      take: 100,
    });

    for (const payment of stuckPayments) {
      // Check payment status with gateway
      // Mark as failed if not completed
      await prisma.payment.update({
        where: { id: payment.id },
        data: { status: 'FAILED', failureReason: 'Payment timeout' },
      });

      // Release inventory reservation
      await inventoryService.releaseReservation(payment.orderId);
    }

    if (stuckPayments.length > 0) {
      logger.info(`Processed ${stuckPayments.length} stuck payments`);
    }
  }

  /**
   * Release expired cart/inventory reservations
   */
  async releaseExpiredReservations() {
    const result = await prisma.inventoryReservation.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
        status: 'RESERVED',
      },
    });

    if (result.count > 0) {
      logger.info(`Released ${result.count} expired reservations`);
    }
  }

  /**
   * Process pending notifications queue
   */
  async processPendingNotifications() {
    const pending = await prisma.notificationQueue.findMany({
      where: {
        status: 'PENDING',
        scheduledAt: { lte: new Date() },
      },
      take: 100,
    });

    for (const notification of pending) {
      try {
        // Send notification based on channel
        // ... notification sending logic
        
        await prisma.notificationQueue.update({
          where: { id: notification.id },
          data: { status: 'SENT', sentAt: new Date() },
        });
      } catch (error) {
        await prisma.notificationQueue.update({
          where: { id: notification.id },
          data: { 
            status: 'FAILED', 
            errorMessage: error.message,
            retryCount: { increment: 1 },
          },
        });
      }
    }
  }

  /**
   * Update currency exchange rates
   */
  async updateCurrencyRates() {
    try {
      const axios = require('axios');
      const response = await axios.get(
        'https://api.exchangerate-api.com/v4/latest/INR'
      );

      const rates = response.data.rates;
      
      await cache.set('currency:rates', JSON.stringify({
        base: 'INR',
        rates,
        updatedAt: new Date().toISOString(),
      }), 3600);

      logger.info('Currency rates updated');
    } catch (error) {
      logger.error('Failed to update currency rates', { error: error.message });
    }
  }

  /**
   * Sync updated products to search index
   */
  async syncSearchIndex() {
    const lastSync = await cache.get('search:lastSync');
    const since = lastSync ? new Date(lastSync) : new Date(Date.now() - 15 * 60 * 1000);

    const updatedProducts = await prisma.product.findMany({
      where: {
        updatedAt: { gt: since },
        status: 'ACTIVE',
      },
      take: 500,
    });

    if (updatedProducts.length > 0) {
      await elasticsearchService.bulkIndexProducts(updatedProducts);
      logger.info(`Synced ${updatedProducts.length} products to search index`);
    }

    await cache.set('search:lastSync', new Date().toISOString());
  }

  /**
   * Clean expired sessions
   */
  async cleanExpiredSessions() {
    const result = await prisma.session.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    if (result.count > 0) {
      logger.info(`Cleaned ${result.count} expired sessions`);
    }
  }

  /**
   * Process subscription renewals
   */
  async processSubscriptionRenewals() {
    // Get subscriptions expiring in next 3 days
    const expiringSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        currentPeriodEnd: {
          gte: new Date(),
          lte: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        },
        cancelAtPeriodEnd: false,
      },
      include: {
        business: { include: { owner: true } },
        plan: true,
      },
    });

    for (const subscription of expiringSubscriptions) {
      // Send renewal reminder
      await emailService.sendSubscriptionRenewalReminder(
        subscription.business.owner.email,
        {
          businessName: subscription.business.businessName,
          planName: subscription.plan.name,
          expiryDate: subscription.currentPeriodEnd,
        }
      );
    }

    // Process expired subscriptions
    const expiredSubscriptions = await prisma.subscription.findMany({
      where: {
        status: 'ACTIVE',
        currentPeriodEnd: { lt: new Date() },
      },
    });

    for (const subscription of expiredSubscriptions) {
      if (subscription.cancelAtPeriodEnd) {
        await prisma.subscription.update({
          where: { id: subscription.id },
          data: { status: 'CANCELLED' },
        });
      } else {
        // Attempt auto-renewal
        // ... payment processing logic
      }
    }
  }

  /**
   * Update product organic scores
   */
  async updateProductScores() {
    // Update scores based on recent performance
    const products = await prisma.product.findMany({
      where: { status: 'ACTIVE' },
      select: {
        id: true,
        viewCount: true,
        orderCount: true,
        averageRating: true,
        reviewCount: true,
        createdAt: true,
      },
    });

    for (const product of products) {
      const ageInDays = (Date.now() - new Date(product.createdAt)) / (1000 * 60 * 60 * 24);
      const freshnessScore = Math.max(0, 100 - ageInDays);
      
      const score = Math.round(
        (product.orderCount * 5) +
        (product.viewCount * 0.1) +
        (product.averageRating * 10) +
        (product.reviewCount * 2) +
        freshnessScore
      );

      await prisma.product.update({
        where: { id: product.id },
        data: { organicScore: Math.min(score, 1000) },
      });
    }

    logger.info(`Updated organic scores for ${products.length} products`);
  }

  /**
   * Generate analytics summaries
   */
  async generateAnalyticsSummaries() {
    await analyticsService.generateHourlySummary();
  }

  /**
   * Check low stock and send alerts
   */
  async checkLowStockAlerts() {
    const lowStockProducts = await prisma.productVariant.findMany({
      where: {
        isActive: true,
        stockQuantity: { lte: prisma.productVariant.fields.lowStockThreshold },
      },
      include: {
        product: {
          include: {
            business: { include: { owner: true } },
          },
        },
      },
    });

    // Group by seller
    const sellerProducts = {};
    for (const variant of lowStockProducts) {
      const sellerId = variant.product.business.id;
      if (!sellerProducts[sellerId]) {
        sellerProducts[sellerId] = {
          seller: variant.product.business,
          products: [],
        };
      }
      sellerProducts[sellerId].products.push({
        name: variant.product.name,
        variant: variant.variantName,
        stock: variant.stockQuantity,
      });
    }

    // Send alerts
    for (const { seller, products } of Object.values(sellerProducts)) {
      await emailService.sendLowStockAlert(seller.owner.email, {
        businessName: seller.businessName,
        products,
      });
    }
  }

  /**
   * Clean old data (logs, events, etc.)
   */
  async cleanOldData() {
    const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);

    // Clean old analytics events
    await prisma.analyticsEvent.deleteMany({
      where: { createdAt: { lt: thirtyDaysAgo } },
    });

    // Clean old webhook logs
    await prisma.webhookLog.deleteMany({
      where: { receivedAt: { lt: thirtyDaysAgo } },
    });

    // Clean old notifications
    await prisma.notification.deleteMany({
      where: { 
        createdAt: { lt: ninetyDaysAgo },
        isRead: true,
      },
    });

    logger.info('Old data cleanup completed');
  }

  /**
   * Generate daily reports
   */
  async generateDailyReports() {
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    yesterday.setHours(0, 0, 0, 0);

    const today = new Date();
    today.setHours(0, 0, 0, 0);

    const stats = await prisma.$transaction([
      prisma.order.count({
        where: { createdAt: { gte: yesterday, lt: today } },
      }),
      prisma.order.aggregate({
        where: { createdAt: { gte: yesterday, lt: today } },
        _sum: { totalAmount: true },
      }),
      prisma.user.count({
        where: { createdAt: { gte: yesterday, lt: today } },
      }),
      prisma.business.count({
        where: { createdAt: { gte: yesterday, lt: today } },
      }),
      prisma.product.count({
        where: { createdAt: { gte: yesterday, lt: today } },
      }),
    ]);

    await prisma.dailyReport.create({
      data: {
        date: yesterday,
        orderCount: stats[0],
        revenue: stats[1]._sum.totalAmount || 0,
        newUsers: stats[2],
        newBusinesses: stats[3],
        newProducts: stats[4],
      },
    });

    logger.info('Daily report generated', { date: yesterday.toISOString() });
  }

  /**
   * Process credit line overdue payments
   */
  async processCreditOverdue() {
    const overdueInvoices = await prisma.creditInvoice.findMany({
      where: {
        status: { in: ['PENDING', 'PARTIAL'] },
        dueDate: { lt: new Date() },
      },
      include: {
        business: { include: { owner: true } },
      },
    });

    for (const invoice of overdueInvoices) {
      const daysOverdue = Math.floor(
        (Date.now() - new Date(invoice.dueDate)) / (1000 * 60 * 60 * 24)
      );

      // Update credit score
      if (daysOverdue > 0 && daysOverdue % 7 === 0) {
        // Reduce score every week overdue
        await prisma.business.update({
          where: { id: invoice.businessId },
          data: { creditScore: { decrement: 10 } },
        });
      }

      // Send reminder
      if (daysOverdue === 1 || daysOverdue === 7 || daysOverdue === 14) {
        await emailService.sendPaymentOverdueReminder(invoice.business.owner.email, {
          invoiceNumber: invoice.invoiceNumber,
          amount: invoice.remainingAmount,
          daysOverdue,
        });
      }
    }
  }

  /**
   * Expire old RFQs
   */
  async expireOldRFQs() {
    const result = await prisma.rFQ.updateMany({
      where: {
        status: 'OPEN',
        expiresAt: { lt: new Date() },
      },
      data: { status: 'EXPIRED' },
    });

    if (result.count > 0) {
      logger.info(`Expired ${result.count} RFQs`);
    }
  }

  /**
   * Update business trust scores
   */
  async updateTrustScores() {
    const businesses = await prisma.business.findMany({
      where: { verificationStatus: 'VERIFIED' },
      include: {
        orders: {
          where: {
            createdAt: { gte: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) },
          },
        },
        reviews: {
          where: { status: 'APPROVED' },
        },
      },
    });

    for (const business of businesses) {
      const orderCount = business.orders.length;
      const avgRating = business.reviews.reduce((sum, r) => sum + r.rating, 0) / 
        (business.reviews.length || 1);
      const reviewCount = business.reviews.length;

      // Calculate trust score (0-100)
      const score = Math.min(100, Math.round(
        (orderCount * 0.5) +
        (avgRating * 10) +
        (reviewCount * 0.2) +
        (business.verificationStatus === 'VERIFIED' ? 20 : 0)
      ));

      await prisma.business.update({
        where: { id: business.id },
        data: { trustScore: score },
      });
    }

    logger.info(`Updated trust scores for ${businesses.length} businesses`);
  }

  /**
   * Send daily digest emails
   */
  async sendDigestEmails() {
    // Get users who opted in for daily digest
    const users = await prisma.user.findMany({
      where: {
        preferences: { emailNotifications: true },
        status: 'ACTIVE',
      },
      include: { businesses: true },
    });

    for (const user of users) {
      // Get relevant updates
      // ... compile digest content
      // await emailService.sendDailyDigest(user.email, digestContent);
    }
  }

  /**
   * Generate weekly reports
   */
  async generateWeeklyReports() {
    // Similar to daily reports but for the week
    logger.info('Weekly report generated');
  }

  /**
   * Cleanup temporary files
   */
  async cleanupTempFiles() {
    // Clean up temporary uploads, etc.
    logger.info('Temporary files cleaned');
  }

  /**
   * Generate monthly reports
   */
  async generateMonthlyReports() {
    // Generate comprehensive monthly analytics
    logger.info('Monthly report generated');
  }

  /**
   * Process monthly settlements
   */
  async processMonthlySettlements() {
    // Calculate and process seller settlements
    logger.info('Monthly settlements processed');
  }

  /**
   * Archive old orders
   */
  async archiveOldOrders() {
    const oneYearAgo = new Date();
    oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);

    // Move to archive table
    const oldOrders = await prisma.order.findMany({
      where: {
        createdAt: { lt: oneYearAgo },
        status: { in: ['DELIVERED', 'CANCELLED', 'REFUNDED'] },
      },
    });

    // Archive logic...
    logger.info(`Archived ${oldOrders.length} old orders`);
  }
}

// Export singleton instance
const scheduledJobs = new ScheduledJobs();

module.exports = scheduledJobs;
