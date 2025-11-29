// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL SCHEDULED JOBS
// Cron jobs for financial services
// =============================================================================

const cron = require('node-cron');
const logger = require('../config/logger');

// Import services
const emiService = require('../services/emi.service');
const cashbackService = require('../services/cashback.service');
const virtualCardService = require('../services/virtualCard.service');
const bankIntegrationService = require('../services/bankIntegration.service');
const creditInsuranceService = require('../services/creditInsurance.service');
const reconciliationService = require('../services/reconciliation.service');

/**
 * Financial Jobs Configuration
 */
const FINANCIAL_JOBS = {
  // EMI Jobs
  markOverdueInstallments: {
    schedule: '0 1 * * *', // Daily at 1 AM
    name: 'Mark Overdue EMI Installments',
  },
  processEMIReminders: {
    schedule: '0 9 * * *', // Daily at 9 AM
    name: 'Send EMI Payment Reminders',
  },

  // Cashback Jobs
  processPendingCashback: {
    schedule: '0 2 * * *', // Daily at 2 AM
    name: 'Process Pending Cashback Rewards',
  },
  expireCashbackRewards: {
    schedule: '0 3 * * *', // Daily at 3 AM
    name: 'Expire Old Cashback Rewards',
  },

  // Virtual Card Jobs
  expireVirtualCards: {
    schedule: '0 0 * * *', // Daily at midnight
    name: 'Expire Old Virtual Cards',
  },
  resetCardLimits: {
    schedule: '0 0 1 * *', // Monthly on 1st at midnight
    name: 'Reset Virtual Card Limits',
  },

  // Bank Integration Jobs
  syncBankTransactions: {
    schedule: '0 */6 * * *', // Every 6 hours
    name: 'Sync Bank Transactions',
  },
  cleanOldBankTransactions: {
    schedule: '0 4 1 * *', // Monthly on 1st at 4 AM
    name: 'Clean Old Bank Transactions',
  },

  // Credit Insurance Jobs
  expireInsurancePolicies: {
    schedule: '0 0 * * *', // Daily at midnight
    name: 'Expire Insurance Policies',
  },

  // Reconciliation Jobs
  autoReconciliation: {
    schedule: '0 5 * * *', // Daily at 5 AM
    name: 'Auto Reconciliation',
  },
};

/**
 * Initialize all financial scheduled jobs
 */
function initializeFinancialJobs() {
  logger.info('Initializing financial scheduled jobs...');

  // ===========================================================================
  // EMI JOBS
  // ===========================================================================

  /**
   * Mark overdue EMI installments
   */
  cron.schedule(FINANCIAL_JOBS.markOverdueInstallments.schedule, async () => {
    const jobName = FINANCIAL_JOBS.markOverdueInstallments.name;
    logger.info(`Starting job: ${jobName}`);
    const startTime = Date.now();

    try {
      const result = await emiService.markOverdueInstallments();
      logger.info(`Job completed: ${jobName}`, {
        duration: Date.now() - startTime,
        result,
      });
    } catch (error) {
      logger.error(`Job failed: ${jobName}`, {
        error: error.message,
        duration: Date.now() - startTime,
      });
    }
  });

  /**
   * Send EMI payment reminders
   */
  cron.schedule(FINANCIAL_JOBS.processEMIReminders.schedule, async () => {
    const jobName = FINANCIAL_JOBS.processEMIReminders.name;
    logger.info(`Starting job: ${jobName}`);
    const startTime = Date.now();

    try {
      // Get installments due in next 7 days
      const upcomingInstallments = await getAllUpcomingInstallments(7);
      
      let remindersSent = 0;
      for (const installment of upcomingInstallments) {
        try {
          // Send reminder notification
          await sendEMIReminder(installment);
          remindersSent++;
        } catch (err) {
          logger.warn('Failed to send EMI reminder', {
            installmentId: installment.id,
            error: err.message,
          });
        }
      }

      logger.info(`Job completed: ${jobName}`, {
        duration: Date.now() - startTime,
        remindersSent,
        totalPending: upcomingInstallments.length,
      });
    } catch (error) {
      logger.error(`Job failed: ${jobName}`, {
        error: error.message,
        duration: Date.now() - startTime,
      });
    }
  });

  // ===========================================================================
  // CASHBACK JOBS
  // ===========================================================================

  /**
   * Process pending cashback rewards
   */
  cron.schedule(FINANCIAL_JOBS.processPendingCashback.schedule, async () => {
    const jobName = FINANCIAL_JOBS.processPendingCashback.name;
    logger.info(`Starting job: ${jobName}`);
    const startTime = Date.now();

    try {
      const result = await cashbackService.processPendingRewards();
      logger.info(`Job completed: ${jobName}`, {
        duration: Date.now() - startTime,
        processed: result.processed,
        credited: result.credited,
      });
    } catch (error) {
      logger.error(`Job failed: ${jobName}`, {
        error: error.message,
        duration: Date.now() - startTime,
      });
    }
  });

  /**
   * Expire old cashback rewards
   */
  cron.schedule(FINANCIAL_JOBS.expireCashbackRewards.schedule, async () => {
    const jobName = FINANCIAL_JOBS.expireCashbackRewards.name;
    logger.info(`Starting job: ${jobName}`);
    const startTime = Date.now();

    try {
      const count = await cashbackService.expireOldRewards();
      logger.info(`Job completed: ${jobName}`, {
        duration: Date.now() - startTime,
        expiredCount: count,
      });
    } catch (error) {
      logger.error(`Job failed: ${jobName}`, {
        error: error.message,
        duration: Date.now() - startTime,
      });
    }
  });

  // ===========================================================================
  // VIRTUAL CARD JOBS
  // ===========================================================================

  /**
   * Expire old virtual cards
   */
  cron.schedule(FINANCIAL_JOBS.expireVirtualCards.schedule, async () => {
    const jobName = FINANCIAL_JOBS.expireVirtualCards.name;
    logger.info(`Starting job: ${jobName}`);
    const startTime = Date.now();

    try {
      const count = await virtualCardService.expireOldCards();
      logger.info(`Job completed: ${jobName}`, {
        duration: Date.now() - startTime,
        expiredCount: count,
      });
    } catch (error) {
      logger.error(`Job failed: ${jobName}`, {
        error: error.message,
        duration: Date.now() - startTime,
      });
    }
  });

  /**
   * Reset virtual card limits (monthly)
   */
  cron.schedule(FINANCIAL_JOBS.resetCardLimits.schedule, async () => {
    const jobName = FINANCIAL_JOBS.resetCardLimits.name;
    logger.info(`Starting job: ${jobName}`);
    const startTime = Date.now();

    try {
      const count = await virtualCardService.resetCardLimits();
      logger.info(`Job completed: ${jobName}`, {
        duration: Date.now() - startTime,
        cardsReset: count,
      });
    } catch (error) {
      logger.error(`Job failed: ${jobName}`, {
        error: error.message,
        duration: Date.now() - startTime,
      });
    }
  });

  // ===========================================================================
  // BANK INTEGRATION JOBS
  // ===========================================================================

  /**
   * Sync bank transactions for all active connections
   */
  cron.schedule(FINANCIAL_JOBS.syncBankTransactions.schedule, async () => {
    const jobName = FINANCIAL_JOBS.syncBankTransactions.name;
    logger.info(`Starting job: ${jobName}`);
    const startTime = Date.now();

    try {
      const result = await bankIntegrationService.syncAllConnections();
      logger.info(`Job completed: ${jobName}`, {
        duration: Date.now() - startTime,
        total: result.total,
        success: result.success,
        failed: result.failed,
      });
    } catch (error) {
      logger.error(`Job failed: ${jobName}`, {
        error: error.message,
        duration: Date.now() - startTime,
      });
    }
  });

  /**
   * Clean old bank transactions
   */
  cron.schedule(FINANCIAL_JOBS.cleanOldBankTransactions.schedule, async () => {
    const jobName = FINANCIAL_JOBS.cleanOldBankTransactions.name;
    logger.info(`Starting job: ${jobName}`);
    const startTime = Date.now();

    try {
      const count = await bankIntegrationService.cleanOldTransactions();
      logger.info(`Job completed: ${jobName}`, {
        duration: Date.now() - startTime,
        deletedCount: count,
      });
    } catch (error) {
      logger.error(`Job failed: ${jobName}`, {
        error: error.message,
        duration: Date.now() - startTime,
      });
    }
  });

  // ===========================================================================
  // CREDIT INSURANCE JOBS
  // ===========================================================================

  /**
   * Expire insurance policies
   */
  cron.schedule(FINANCIAL_JOBS.expireInsurancePolicies.schedule, async () => {
    const jobName = FINANCIAL_JOBS.expireInsurancePolicies.name;
    logger.info(`Starting job: ${jobName}`);
    const startTime = Date.now();

    try {
      const count = await creditInsuranceService.expirePolicies();
      logger.info(`Job completed: ${jobName}`, {
        duration: Date.now() - startTime,
        expiredCount: count,
      });
    } catch (error) {
      logger.error(`Job failed: ${jobName}`, {
        error: error.message,
        duration: Date.now() - startTime,
      });
    }
  });

  // ===========================================================================
  // RECONCILIATION JOBS
  // ===========================================================================

  /**
   * Auto reconciliation for all businesses
   */
  cron.schedule(FINANCIAL_JOBS.autoReconciliation.schedule, async () => {
    const jobName = FINANCIAL_JOBS.autoReconciliation.name;
    logger.info(`Starting job: ${jobName}`);
    const startTime = Date.now();

    try {
      const result = await runAutoReconciliation();
      logger.info(`Job completed: ${jobName}`, {
        duration: Date.now() - startTime,
        result,
      });
    } catch (error) {
      logger.error(`Job failed: ${jobName}`, {
        error: error.message,
        duration: Date.now() - startTime,
      });
    }
  });

  logger.info('Financial scheduled jobs initialized', {
    jobCount: Object.keys(FINANCIAL_JOBS).length,
  });
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Get all upcoming installments across all users
 */
async function getAllUpcomingInstallments(days) {
  const { prisma } = require('../config/database');
  
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + days);

  return prisma.eMIInstallment.findMany({
    where: {
      status: 'PENDING',
      dueDate: { lte: dueDate },
    },
    include: {
      emiOrder: {
        include: {
          user: {
            select: { id: true, email: true, name: true },
          },
        },
      },
    },
    orderBy: { dueDate: 'asc' },
  });
}

/**
 * Send EMI payment reminder
 */
async function sendEMIReminder(installment) {
  const notificationService = require('../services/notification.service');
  
  const daysUntilDue = Math.ceil(
    (new Date(installment.dueDate) - new Date()) / (1000 * 60 * 60 * 24)
  );

  await notificationService.send({
    userId: installment.emiOrder.user.id,
    type: 'EMI_REMINDER',
    title: 'EMI Payment Reminder',
    message: `Your EMI payment of ₹${installment.amount} is due in ${daysUntilDue} days`,
    data: {
      installmentId: installment.id,
      emiOrderId: installment.emiOrderId,
      amount: installment.amount,
      dueDate: installment.dueDate,
    },
  });
}

/**
 * Run auto reconciliation for all businesses with active bank connections
 */
async function runAutoReconciliation() {
  const { prisma } = require('../config/database');
  
  // Get businesses with active bank connections and reconciliation rules
  const businesses = await prisma.business.findMany({
    where: {
      bankConnections: {
        some: { status: 'ACTIVE' },
      },
      reconciliationRules: {
        some: { isActive: true },
      },
    },
    select: { id: true },
  });

  let processed = 0;
  let errors = 0;

  const endDate = new Date();
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 1); // Last 24 hours

  for (const business of businesses) {
    try {
      await reconciliationService.startBatch(
        business.id,
        startDate.toISOString(),
        endDate.toISOString()
      );
      processed++;
    } catch (error) {
      logger.warn('Auto reconciliation failed for business', {
        businessId: business.id,
        error: error.message,
      });
      errors++;
    }
  }

  return { total: businesses.length, processed, errors };
}

/**
 * Run a specific job manually
 */
async function runJob(jobName) {
  const job = FINANCIAL_JOBS[jobName];
  if (!job) {
    throw new Error(`Job not found: ${jobName}`);
  }

  logger.info(`Manually running job: ${job.name}`);

  switch (jobName) {
    case 'markOverdueInstallments':
      return emiService.markOverdueInstallments();
    case 'processPendingCashback':
      return cashbackService.processPendingRewards();
    case 'expireCashbackRewards':
      return cashbackService.expireOldRewards();
    case 'expireVirtualCards':
      return virtualCardService.expireOldCards();
    case 'resetCardLimits':
      return virtualCardService.resetCardLimits();
    case 'syncBankTransactions':
      return bankIntegrationService.syncAllConnections();
    case 'cleanOldBankTransactions':
      return bankIntegrationService.cleanOldTransactions();
    case 'expireInsurancePolicies':
      return creditInsuranceService.expirePolicies();
    case 'autoReconciliation':
      return runAutoReconciliation();
    default:
      throw new Error(`No handler for job: ${jobName}`);
  }
}

/**
 * Get job status
 */
function getJobStatus() {
  return Object.entries(FINANCIAL_JOBS).map(([key, job]) => ({
    name: key,
    displayName: job.name,
    schedule: job.schedule,
  }));
}

module.exports = {
  initializeFinancialJobs,
  runJob,
  getJobStatus,
  FINANCIAL_JOBS,
};
