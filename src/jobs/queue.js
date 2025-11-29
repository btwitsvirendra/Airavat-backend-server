// =============================================================================
// AIRAVAT B2B MARKETPLACE - JOB QUEUE SYSTEM
// =============================================================================

const Queue = require('bull');
const logger = require('../config/logger');
const config = require('../config');

// =============================================================================
// QUEUE CONFIGURATION
// =============================================================================

const redisConfig = {
  host: config.redis.host,
  port: config.redis.port,
  password: config.redis.password,
};

const defaultJobOptions = {
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000,
  },
  removeOnComplete: 100,
  removeOnFail: 500,
};

// =============================================================================
// CREATE QUEUES
// =============================================================================

const emailQueue = new Queue('email', { redis: redisConfig, defaultJobOptions });
const smsQueue = new Queue('sms', { redis: redisConfig, defaultJobOptions });
const notificationQueue = new Queue('notification', { redis: redisConfig, defaultJobOptions });
const inventoryQueue = new Queue('inventory', { redis: redisConfig, defaultJobOptions });
const orderQueue = new Queue('order', { redis: redisConfig, defaultJobOptions });
const importQueue = new Queue('import', { redis: redisConfig, defaultJobOptions });
const reportQueue = new Queue('report', { redis: redisConfig, defaultJobOptions });
const cleanupQueue = new Queue('cleanup', { redis: redisConfig, defaultJobOptions });

// =============================================================================
// QUEUE EXPORTS
// =============================================================================

const queues = {
  email: emailQueue,
  sms: smsQueue,
  notification: notificationQueue,
  inventory: inventoryQueue,
  order: orderQueue,
  import: importQueue,
  report: reportQueue,
  cleanup: cleanupQueue,
};

// =============================================================================
// QUEUE EVENTS
// =============================================================================

Object.entries(queues).forEach(([name, queue]) => {
  queue.on('error', (error) => {
    logger.error(`Queue ${name} error`, { error: error.message });
  });
  
  queue.on('failed', (job, error) => {
    logger.error(`Job ${job.id} in ${name} queue failed`, {
      jobId: job.id,
      jobData: job.data,
      error: error.message,
      attemptsMade: job.attemptsMade,
    });
  });
  
  queue.on('completed', (job) => {
    logger.info(`Job ${job.id} in ${name} queue completed`);
  });
  
  queue.on('stalled', (job) => {
    logger.warn(`Job ${job.id} in ${name} queue stalled`);
  });
});

// =============================================================================
// JOB CREATORS
// =============================================================================

const jobs = {
  /**
   * Add email job
   */
  async sendEmail(data) {
    return emailQueue.add('send', data);
  },
  
  /**
   * Add SMS job
   */
  async sendSMS(data) {
    return smsQueue.add('send', data);
  },
  
  /**
   * Add notification job
   */
  async sendNotification(data) {
    return notificationQueue.add('send', data);
  },
  
  /**
   * Add inventory update job
   */
  async updateInventory(data) {
    return inventoryQueue.add('update', data);
  },
  
  /**
   * Add low stock check job
   */
  async checkLowStock(businessId) {
    return inventoryQueue.add('check-low-stock', { businessId });
  },
  
  /**
   * Add order processing job
   */
  async processOrder(orderId) {
    return orderQueue.add('process', { orderId });
  },
  
  /**
   * Add order status update job
   */
  async updateOrderStatus(orderId, status) {
    return orderQueue.add('status-update', { orderId, status });
  },
  
  /**
   * Add product import job
   */
  async importProducts(data) {
    return importQueue.add('products', data, {
      ...defaultJobOptions,
      timeout: 300000, // 5 minutes
    });
  },
  
  /**
   * Add report generation job
   */
  async generateReport(data) {
    return reportQueue.add('generate', data, {
      ...defaultJobOptions,
      timeout: 600000, // 10 minutes
    });
  },
  
  /**
   * Add cleanup job
   */
  async scheduleCleanup(type, options = {}) {
    return cleanupQueue.add(type, options);
  },
};

// =============================================================================
// SCHEDULED JOBS (CRON)
// =============================================================================

const scheduledJobs = {
  init() {
    // Clean up expired cart sessions every hour
    cleanupQueue.add('expired-carts', {}, {
      repeat: { cron: '0 * * * *' },
      removeOnComplete: true,
    });
    
    // Clean up expired stock reservations every 15 minutes
    cleanupQueue.add('expired-reservations', {}, {
      repeat: { cron: '*/15 * * * *' },
      removeOnComplete: true,
    });
    
    // Update organic scores daily at midnight
    cleanupQueue.add('update-organic-scores', {}, {
      repeat: { cron: '0 0 * * *' },
      removeOnComplete: true,
    });
    
    // Generate daily reports at 6 AM
    reportQueue.add('daily-summary', {}, {
      repeat: { cron: '0 6 * * *' },
      removeOnComplete: true,
    });
    
    // Check and update subscription statuses daily
    cleanupQueue.add('subscription-check', {}, {
      repeat: { cron: '0 1 * * *' },
      removeOnComplete: true,
    });
    
    // Clean up old notifications weekly
    cleanupQueue.add('old-notifications', {}, {
      repeat: { cron: '0 2 * * 0' },
      removeOnComplete: true,
    });
    
    logger.info('Scheduled jobs initialized');
  },
};

module.exports = { queues, jobs, scheduledJobs };
