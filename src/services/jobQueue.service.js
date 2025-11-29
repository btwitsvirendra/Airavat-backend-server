// =============================================================================
// AIRAVAT B2B MARKETPLACE - JOB QUEUE SERVICE
// Background job processing with Bull queues
// =============================================================================

const Bull = require('bull');
const logger = require('../config/logger');

// Redis connection config
const redisConfig = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT) || 6379,
  password: process.env.REDIS_PASSWORD || undefined,
  db: parseInt(process.env.REDIS_DB) || 1,
};

/**
 * Job Queue Configuration
 */
const QUEUE_CONFIG = {
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000,
    },
    removeOnComplete: 100,
    removeOnFail: 500,
  },
  settings: {
    stalledInterval: 30000,
    maxStalledCount: 2,
  },
};

/**
 * Queue definitions
 */
const QUEUES = {
  email: 'email-queue',
  sms: 'sms-queue',
  notification: 'notification-queue',
  order: 'order-queue',
  payment: 'payment-queue',
  inventory: 'inventory-queue',
  search: 'search-queue',
  analytics: 'analytics-queue',
  report: 'report-queue',
  cleanup: 'cleanup-queue',
  webhook: 'webhook-queue',
};

class JobQueueService {
  constructor() {
    this.queues = new Map();
    this.processors = new Map();
    this.isRunning = false;
  }

  /**
   * Initialize all queues
   */
  init() {
    for (const [name, queueName] of Object.entries(QUEUES)) {
      const queue = new Bull(queueName, {
        redis: redisConfig,
        defaultJobOptions: QUEUE_CONFIG.defaultJobOptions,
        settings: QUEUE_CONFIG.settings,
      });

      // Set up event handlers
      this.setupQueueEvents(queue, name);

      this.queues.set(name, queue);
    }

    logger.info(`Initialized ${this.queues.size} job queues`);
    return this;
  }

  /**
   * Setup queue event handlers
   */
  setupQueueEvents(queue, name) {
    queue.on('completed', (job, result) => {
      logger.debug(`Job completed`, { queue: name, jobId: job.id });
    });

    queue.on('failed', (job, error) => {
      logger.error(`Job failed`, {
        queue: name,
        jobId: job.id,
        attempt: job.attemptsMade,
        error: error.message,
      });
    });

    queue.on('stalled', (job) => {
      logger.warn(`Job stalled`, { queue: name, jobId: job.id });
    });

    queue.on('error', (error) => {
      logger.error(`Queue error`, { queue: name, error: error.message });
    });

    queue.on('waiting', (jobId) => {
      logger.debug(`Job waiting`, { queue: name, jobId });
    });

    queue.on('active', (job) => {
      logger.debug(`Job active`, { queue: name, jobId: job.id });
    });
  }

  /**
   * Register job processor
   */
  registerProcessor(queueName, processor, concurrency = 5) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    queue.process(concurrency, async (job) => {
      const startTime = Date.now();
      try {
        const result = await processor(job.data, job);
        logger.info(`Job processed`, {
          queue: queueName,
          jobId: job.id,
          duration: Date.now() - startTime,
        });
        return result;
      } catch (error) {
        logger.error(`Job processor error`, {
          queue: queueName,
          jobId: job.id,
          error: error.message,
        });
        throw error;
      }
    });

    this.processors.set(queueName, { processor, concurrency });
    logger.info(`Registered processor for ${queueName} with concurrency ${concurrency}`);
  }

  /**
   * Add job to queue
   */
  async addJob(queueName, data, options = {}) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const job = await queue.add(data, {
      ...QUEUE_CONFIG.defaultJobOptions,
      ...options,
    });

    logger.debug(`Job added`, { queue: queueName, jobId: job.id });
    return job;
  }

  /**
   * Add delayed job
   */
  async addDelayedJob(queueName, data, delay, options = {}) {
    return this.addJob(queueName, data, { ...options, delay });
  }

  /**
   * Add repeatable job
   */
  async addRepeatableJob(queueName, data, repeat, options = {}) {
    return this.addJob(queueName, data, { ...options, repeat });
  }

  /**
   * Add bulk jobs
   */
  async addBulkJobs(queueName, jobs) {
    const queue = this.queues.get(queueName);
    if (!queue) {
      throw new Error(`Queue ${queueName} not found`);
    }

    const bulkJobs = jobs.map((job) => ({
      data: job.data,
      opts: { ...QUEUE_CONFIG.defaultJobOptions, ...job.options },
    }));

    return queue.addBulk(bulkJobs);
  }

  /**
   * Get job by ID
   */
  async getJob(queueName, jobId) {
    const queue = this.queues.get(queueName);
    if (!queue) return null;
    return queue.getJob(jobId);
  }

  /**
   * Get queue status
   */
  async getQueueStatus(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) return null;

    const [
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused,
    ] = await Promise.all([
      queue.getWaitingCount(),
      queue.getActiveCount(),
      queue.getCompletedCount(),
      queue.getFailedCount(),
      queue.getDelayedCount(),
      queue.getPausedCount(),
    ]);

    return {
      name: queueName,
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused,
      total: waiting + active + delayed + paused,
    };
  }

  /**
   * Get all queues status
   */
  async getAllQueuesStatus() {
    const statuses = {};
    for (const [name] of this.queues) {
      statuses[name] = await this.getQueueStatus(name);
    }
    return statuses;
  }

  /**
   * Pause queue
   */
  async pauseQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (queue) {
      await queue.pause();
      logger.info(`Queue paused: ${queueName}`);
    }
  }

  /**
   * Resume queue
   */
  async resumeQueue(queueName) {
    const queue = this.queues.get(queueName);
    if (queue) {
      await queue.resume();
      logger.info(`Queue resumed: ${queueName}`);
    }
  }

  /**
   * Clean queue
   */
  async cleanQueue(queueName, grace = 0, type = 'completed') {
    const queue = this.queues.get(queueName);
    if (queue) {
      const cleaned = await queue.clean(grace, type);
      logger.info(`Queue cleaned`, { queueName, type, count: cleaned.length });
      return cleaned.length;
    }
    return 0;
  }

  /**
   * Retry failed jobs
   */
  async retryFailedJobs(queueName) {
    const queue = this.queues.get(queueName);
    if (!queue) return 0;

    const failedJobs = await queue.getFailed();
    let retried = 0;

    for (const job of failedJobs) {
      await job.retry();
      retried++;
    }

    logger.info(`Retried failed jobs`, { queueName, count: retried });
    return retried;
  }

  /**
   * Close all queues
   */
  async close() {
    for (const [name, queue] of this.queues) {
      await queue.close();
      logger.info(`Queue closed: ${name}`);
    }
    this.queues.clear();
    this.isRunning = false;
  }

  // ===========================================================================
  // CONVENIENCE METHODS
  // ===========================================================================

  /**
   * Queue email job
   */
  async queueEmail(data, options = {}) {
    return this.addJob('email', data, {
      priority: data.priority || 5,
      ...options,
    });
  }

  /**
   * Queue SMS job
   */
  async queueSMS(data, options = {}) {
    return this.addJob('sms', data, {
      priority: data.priority || 5,
      ...options,
    });
  }

  /**
   * Queue notification job
   */
  async queueNotification(data, options = {}) {
    return this.addJob('notification', data, {
      priority: data.priority || 5,
      ...options,
    });
  }

  /**
   * Queue order processing job
   */
  async queueOrderProcessing(data, options = {}) {
    return this.addJob('order', data, {
      priority: 1, // High priority
      ...options,
    });
  }

  /**
   * Queue search index update
   */
  async queueSearchIndexUpdate(data, options = {}) {
    return this.addJob('search', data, {
      priority: 10,
      ...options,
    });
  }

  /**
   * Queue analytics event
   */
  async queueAnalyticsEvent(data, options = {}) {
    return this.addJob('analytics', data, {
      priority: 20,
      removeOnComplete: 50,
      ...options,
    });
  }

  /**
   * Queue report generation
   */
  async queueReportGeneration(data, options = {}) {
    return this.addJob('report', data, {
      priority: 15,
      timeout: 300000, // 5 minutes
      ...options,
    });
  }

  /**
   * Queue webhook delivery
   */
  async queueWebhook(data, options = {}) {
    return this.addJob('webhook', data, {
      priority: 3,
      attempts: 5,
      backoff: {
        type: 'exponential',
        delay: 60000, // Start with 1 minute
      },
      ...options,
    });
  }
}

// Create singleton instance
const jobQueue = new JobQueueService();

// Initialize default processors
function initializeProcessors() {
  // Email processor
  jobQueue.registerProcessor('email', async (data) => {
    const emailService = require('./email.service');
    return emailService.send(data);
  }, 10);

  // SMS processor
  jobQueue.registerProcessor('sms', async (data) => {
    const smsService = require('./sms.service');
    return smsService.send(data.to, data.message);
  }, 5);

  // Notification processor
  jobQueue.registerProcessor('notification', async (data) => {
    const notificationService = require('./notification.service');
    return notificationService.send(data);
  }, 10);

  // Order processor
  jobQueue.registerProcessor('order', async (data, job) => {
    const orderService = require('./order.service');
    switch (data.action) {
      case 'process':
        return orderService.processOrder(data.orderId);
      case 'cancel':
        return orderService.cancelOrder(data.orderId, data.reason);
      case 'refund':
        return orderService.processRefund(data.orderId, data.amount);
      default:
        throw new Error(`Unknown order action: ${data.action}`);
    }
  }, 5);

  // Search index processor
  jobQueue.registerProcessor('search', async (data) => {
    const elasticsearchService = require('./elasticsearch.service');
    switch (data.action) {
      case 'index':
        return elasticsearchService.indexProduct(data.product);
      case 'update':
        return elasticsearchService.updateProduct(data.productId, data.updates);
      case 'delete':
        return elasticsearchService.deleteProduct(data.productId);
      case 'bulk':
        return elasticsearchService.bulkIndexProducts(data.products);
      default:
        throw new Error(`Unknown search action: ${data.action}`);
    }
  }, 3);

  // Analytics processor
  jobQueue.registerProcessor('analytics', async (data) => {
    const analyticsService = require('./analytics.service');
    return analyticsService.trackEvent(data);
  }, 20);

  // Report processor
  jobQueue.registerProcessor('report', async (data, job) => {
    const reportService = require('./report.service');
    
    // Update progress
    await job.progress(10);
    
    const report = await reportService.generate(data);
    
    await job.progress(100);
    return report;
  }, 2);

  // Webhook processor
  jobQueue.registerProcessor('webhook', async (data) => {
    const webhookService = require('./webhook.service');
    return webhookService.sendWebhook(data.url, data.event, data.payload, data.options);
  }, 10);

  // Cleanup processor
  jobQueue.registerProcessor('cleanup', async (data) => {
    switch (data.type) {
      case 'expired_sessions':
        const { prisma } = require('../config/database');
        return prisma.session.deleteMany({
          where: { expiresAt: { lt: new Date() } },
        });
      case 'old_logs':
        return prisma.auditLog.deleteMany({
          where: { timestamp: { lt: new Date(Date.now() - 90 * 24 * 60 * 60 * 1000) } },
        });
      default:
        throw new Error(`Unknown cleanup type: ${data.type}`);
    }
  }, 1);
}

module.exports = {
  jobQueue,
  QUEUES,
  initializeProcessors,
};
