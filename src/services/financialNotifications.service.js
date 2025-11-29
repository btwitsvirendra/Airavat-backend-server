// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL NOTIFICATIONS SERVICE
// Notifications for financial events and alerts
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const emailService = require('./email.service');
const smsService = require('./sms.service');
const notificationService = require('./notification.service');

// =============================================================================
// CONFIGURATION
// =============================================================================

const NOTIFICATION_CONFIG = {
  channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
  priorities: {
    LOW: { retryCount: 1, delayMs: 0 },
    MEDIUM: { retryCount: 2, delayMs: 0 },
    HIGH: { retryCount: 3, delayMs: 0 },
    CRITICAL: { retryCount: 5, delayMs: 0, immediate: true },
  },
  templates: {
    // Wallet notifications
    WALLET_CREDIT: {
      title: 'Wallet Credited',
      priority: 'MEDIUM',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    WALLET_DEBIT: {
      title: 'Wallet Debited',
      priority: 'MEDIUM',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    WALLET_LOW_BALANCE: {
      title: 'Low Wallet Balance Alert',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },
    WALLET_WITHDRAWAL_SUCCESS: {
      title: 'Withdrawal Successful',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },
    WALLET_WITHDRAWAL_FAILED: {
      title: 'Withdrawal Failed',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },

    // EMI notifications
    EMI_CREATED: {
      title: 'EMI Order Created',
      priority: 'MEDIUM',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    EMI_APPROVED: {
      title: 'EMI Order Approved',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },
    EMI_REJECTED: {
      title: 'EMI Order Rejected',
      priority: 'HIGH',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    EMI_DUE_REMINDER: {
      title: 'EMI Payment Due',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },
    EMI_OVERDUE: {
      title: 'EMI Payment Overdue',
      priority: 'CRITICAL',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },
    EMI_PAYMENT_SUCCESS: {
      title: 'EMI Payment Successful',
      priority: 'MEDIUM',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    EMI_COMPLETED: {
      title: 'EMI Completed',
      priority: 'HIGH',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },

    // Card notifications
    CARD_CREATED: {
      title: 'Virtual Card Created',
      priority: 'HIGH',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    CARD_TRANSACTION: {
      title: 'Card Transaction',
      priority: 'MEDIUM',
      channels: ['PUSH', 'IN_APP'],
    },
    CARD_DECLINED: {
      title: 'Card Transaction Declined',
      priority: 'HIGH',
      channels: ['PUSH', 'IN_APP'],
    },
    CARD_LIMIT_REACHED: {
      title: 'Card Limit Reached',
      priority: 'HIGH',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    CARD_EXPIRING: {
      title: 'Card Expiring Soon',
      priority: 'MEDIUM',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    CARD_LOCKED: {
      title: 'Card Locked',
      priority: 'CRITICAL',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },

    // Insurance notifications
    INSURANCE_POLICY_CREATED: {
      title: 'Insurance Policy Created',
      priority: 'HIGH',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    INSURANCE_POLICY_ACTIVATED: {
      title: 'Insurance Policy Activated',
      priority: 'HIGH',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    INSURANCE_POLICY_EXPIRING: {
      title: 'Insurance Policy Expiring',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },
    INSURANCE_CLAIM_SUBMITTED: {
      title: 'Insurance Claim Submitted',
      priority: 'HIGH',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    INSURANCE_CLAIM_APPROVED: {
      title: 'Insurance Claim Approved',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },
    INSURANCE_CLAIM_REJECTED: {
      title: 'Insurance Claim Rejected',
      priority: 'HIGH',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    INSURANCE_CLAIM_SETTLED: {
      title: 'Insurance Claim Settled',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },

    // Trade finance notifications
    LC_CREATED: {
      title: 'Letter of Credit Created',
      priority: 'HIGH',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    LC_ISSUED: {
      title: 'Letter of Credit Issued',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },
    LC_AMENDMENT_REQUESTED: {
      title: 'LC Amendment Requested',
      priority: 'MEDIUM',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    LC_EXPIRING: {
      title: 'Letter of Credit Expiring',
      priority: 'CRITICAL',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },
    LC_PAYMENT_PROCESSED: {
      title: 'LC Payment Processed',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },

    // Factoring notifications
    FACTORING_APPLICATION_SUBMITTED: {
      title: 'Factoring Application Submitted',
      priority: 'MEDIUM',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    FACTORING_APPROVED: {
      title: 'Factoring Application Approved',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },
    FACTORING_REJECTED: {
      title: 'Factoring Application Rejected',
      priority: 'HIGH',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    FACTORING_DISBURSED: {
      title: 'Factoring Disbursement Complete',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },

    // Bank integration notifications
    BANK_CONNECTED: {
      title: 'Bank Account Connected',
      priority: 'HIGH',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    BANK_DISCONNECTED: {
      title: 'Bank Account Disconnected',
      priority: 'CRITICAL',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },
    BANK_SYNC_COMPLETE: {
      title: 'Bank Sync Complete',
      priority: 'LOW',
      channels: ['PUSH', 'IN_APP'],
    },
    BANK_LARGE_TRANSACTION: {
      title: 'Large Transaction Detected',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },

    // Cashback notifications
    CASHBACK_EARNED: {
      title: 'Cashback Earned',
      priority: 'MEDIUM',
      channels: ['PUSH', 'IN_APP'],
    },
    CASHBACK_CREDITED: {
      title: 'Cashback Credited',
      priority: 'MEDIUM',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
    CASHBACK_EXPIRING: {
      title: 'Cashback Expiring Soon',
      priority: 'MEDIUM',
      channels: ['PUSH', 'IN_APP'],
    },

    // Security notifications
    SUSPICIOUS_ACTIVITY: {
      title: 'Suspicious Activity Detected',
      priority: 'CRITICAL',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },
    PIN_CHANGED: {
      title: 'Wallet PIN Changed',
      priority: 'HIGH',
      channels: ['EMAIL', 'SMS', 'PUSH', 'IN_APP'],
    },
    LIMIT_UPDATED: {
      title: 'Transaction Limit Updated',
      priority: 'MEDIUM',
      channels: ['EMAIL', 'PUSH', 'IN_APP'],
    },
  },
};

// =============================================================================
// NOTIFICATION FUNCTIONS
// =============================================================================

/**
 * Send financial notification
 */
exports.send = async (userId, type, data = {}, options = {}) => {
  const template = NOTIFICATION_CONFIG.templates[type];

  if (!template) {
    logger.warn('Unknown notification type', { type });
    return { success: false, error: 'Unknown notification type' };
  }

  try {
    // Get user preferences
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        name: true,
        email: true,
        phone: true,
        notificationPreferences: true,
      },
    });

    if (!user) {
      return { success: false, error: 'User not found' };
    }

    const preferences = user.notificationPreferences || {};
    const channels = options.channels || template.channels;
    const priority = options.priority || template.priority;

    const results = {};

    // Send through each channel
    for (const channel of channels) {
      // Check user preferences
      if (preferences[channel.toLowerCase()] === false) {
        results[channel] = { skipped: true, reason: 'User preference' };
        continue;
      }

      try {
        switch (channel) {
          case 'EMAIL':
            results.EMAIL = await sendEmailNotification(user, type, template, data);
            break;
          case 'SMS':
            results.SMS = await sendSMSNotification(user, type, template, data);
            break;
          case 'PUSH':
            results.PUSH = await sendPushNotification(userId, type, template, data);
            break;
          case 'IN_APP':
            results.IN_APP = await sendInAppNotification(userId, type, template, data);
            break;
        }
      } catch (channelError) {
        logger.error(`Failed to send ${channel} notification`, {
          error: channelError.message,
          type,
          userId,
        });
        results[channel] = { success: false, error: channelError.message };
      }
    }

    // Log notification
    await logNotification(userId, type, priority, results, data);

    return { success: true, results };
  } catch (error) {
    logger.error('Failed to send financial notification', {
      error: error.message,
      type,
      userId,
    });
    return { success: false, error: error.message };
  }
};

/**
 * Send bulk notifications
 */
exports.sendBulk = async (notifications) => {
  const results = [];

  for (const notification of notifications) {
    const result = await this.send(
      notification.userId,
      notification.type,
      notification.data,
      notification.options
    );
    results.push({ ...notification, result });
  }

  return results;
};

// =============================================================================
// CHANNEL-SPECIFIC SENDERS
// =============================================================================

/**
 * Send email notification
 */
async function sendEmailNotification(user, type, template, data) {
  if (!user.email) {
    return { success: false, error: 'No email address' };
  }

  const emailContent = formatEmailContent(type, template, data, user);

  await emailService.sendEmail({
    to: user.email,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
  });

  return { success: true, email: user.email };
}

/**
 * Send SMS notification
 */
async function sendSMSNotification(user, type, template, data) {
  if (!user.phone) {
    return { success: false, error: 'No phone number' };
  }

  const smsContent = formatSMSContent(type, template, data);

  await smsService.sendSMS({
    to: user.phone,
    message: smsContent,
  });

  return { success: true, phone: user.phone };
}

/**
 * Send push notification
 */
async function sendPushNotification(userId, type, template, data) {
  const pushContent = formatPushContent(type, template, data);

  await notificationService.sendPush(userId, {
    title: pushContent.title,
    body: pushContent.body,
    data: {
      type,
      ...pushContent.data,
    },
  });

  return { success: true };
}

/**
 * Send in-app notification
 */
async function sendInAppNotification(userId, type, template, data) {
  const notification = await prisma.notification.create({
    data: {
      userId,
      type: 'FINANCIAL',
      subType: type,
      title: template.title,
      message: formatNotificationMessage(type, data),
      data: data,
      read: false,
    },
  });

  // Emit via Socket.IO for real-time update
  const { io } = require('./socket.service');
  if (io) {
    io.to(`user:${userId}`).emit('notification', {
      type: 'FINANCIAL',
      notification,
    });
  }

  return { success: true, notificationId: notification.id };
}

// =============================================================================
// CONTENT FORMATTERS
// =============================================================================

/**
 * Format email content based on notification type
 */
function formatEmailContent(type, template, data, user) {
  const subject = template.title;
  let html = '';
  let text = '';

  switch (type) {
    case 'WALLET_CREDIT':
      html = `
        <h2>Wallet Credited</h2>
        <p>Dear ${user.name},</p>
        <p>Your wallet has been credited with <strong>${data.currency || 'INR'} ${formatAmount(data.amount)}</strong>.</p>
        <p><strong>Reference:</strong> ${data.reference || 'N/A'}</p>
        <p><strong>New Balance:</strong> ${data.currency || 'INR'} ${formatAmount(data.newBalance)}</p>
        <p>Thank you for using Airavat.</p>
      `;
      text = `Your wallet has been credited with ${data.currency || 'INR'} ${formatAmount(data.amount)}. New balance: ${data.currency || 'INR'} ${formatAmount(data.newBalance)}`;
      break;

    case 'WALLET_DEBIT':
      html = `
        <h2>Wallet Debited</h2>
        <p>Dear ${user.name},</p>
        <p>An amount of <strong>${data.currency || 'INR'} ${formatAmount(data.amount)}</strong> has been debited from your wallet.</p>
        <p><strong>Description:</strong> ${data.description || 'N/A'}</p>
        <p><strong>New Balance:</strong> ${data.currency || 'INR'} ${formatAmount(data.newBalance)}</p>
      `;
      text = `${data.currency || 'INR'} ${formatAmount(data.amount)} debited from wallet. New balance: ${data.currency || 'INR'} ${formatAmount(data.newBalance)}`;
      break;

    case 'EMI_DUE_REMINDER':
      html = `
        <h2>EMI Payment Due</h2>
        <p>Dear ${user.name},</p>
        <p>Your EMI payment of <strong>${data.currency || 'INR'} ${formatAmount(data.amount)}</strong> is due on <strong>${formatDate(data.dueDate)}</strong>.</p>
        <p><strong>EMI Order:</strong> ${data.emiOrderNumber}</p>
        <p><strong>Installment:</strong> ${data.installmentNumber} of ${data.totalInstallments}</p>
        <p>Please ensure timely payment to avoid late fees.</p>
      `;
      text = `EMI payment of ${data.currency || 'INR'} ${formatAmount(data.amount)} due on ${formatDate(data.dueDate)}. EMI: ${data.emiOrderNumber}`;
      break;

    case 'EMI_OVERDUE':
      html = `
        <h2>EMI Payment Overdue</h2>
        <p>Dear ${user.name},</p>
        <p><strong style="color: red;">Your EMI payment is overdue!</strong></p>
        <p><strong>Amount:</strong> ${data.currency || 'INR'} ${formatAmount(data.amount)}</p>
        <p><strong>Due Date:</strong> ${formatDate(data.dueDate)}</p>
        <p><strong>Late Fee:</strong> ${data.currency || 'INR'} ${formatAmount(data.lateFee)}</p>
        <p><strong>Total Due:</strong> ${data.currency || 'INR'} ${formatAmount(data.totalDue)}</p>
        <p>Please make the payment immediately to avoid further penalties.</p>
      `;
      text = `URGENT: EMI payment overdue! Amount: ${data.currency || 'INR'} ${formatAmount(data.totalDue)} (including late fee). Pay immediately.`;
      break;

    case 'CARD_TRANSACTION':
      html = `
        <h2>Card Transaction Alert</h2>
        <p>A transaction was made using your virtual card ending in ${data.last4}.</p>
        <p><strong>Amount:</strong> ${data.currency || 'INR'} ${formatAmount(data.amount)}</p>
        <p><strong>Merchant:</strong> ${data.merchantName}</p>
        <p><strong>Time:</strong> ${formatDateTime(data.transactionTime)}</p>
        <p>If you did not make this transaction, please lock your card immediately.</p>
      `;
      text = `Card *${data.last4} used for ${data.currency || 'INR'} ${formatAmount(data.amount)} at ${data.merchantName}`;
      break;

    case 'INSURANCE_CLAIM_SETTLED':
      html = `
        <h2>Insurance Claim Settled</h2>
        <p>Dear ${user.name},</p>
        <p>Your insurance claim has been settled.</p>
        <p><strong>Claim Number:</strong> ${data.claimNumber}</p>
        <p><strong>Settlement Amount:</strong> ${data.currency || 'INR'} ${formatAmount(data.settlementAmount)}</p>
        <p>The amount has been credited to your wallet.</p>
      `;
      text = `Insurance claim ${data.claimNumber} settled. ${data.currency || 'INR'} ${formatAmount(data.settlementAmount)} credited to wallet.`;
      break;

    case 'SUSPICIOUS_ACTIVITY':
      html = `
        <h2 style="color: red;">⚠️ Suspicious Activity Detected</h2>
        <p>Dear ${user.name},</p>
        <p>We detected unusual activity on your account:</p>
        <p><strong>Activity:</strong> ${data.activityType}</p>
        <p><strong>Time:</strong> ${formatDateTime(data.detectedAt)}</p>
        <p><strong>IP Address:</strong> ${data.ipAddress}</p>
        <p>If this was you, you can ignore this message. Otherwise, please secure your account immediately.</p>
      `;
      text = `ALERT: Suspicious activity detected on your account. Review immediately.`;
      break;

    default:
      html = `
        <h2>${template.title}</h2>
        <p>Dear ${user.name},</p>
        <p>${formatNotificationMessage(type, data)}</p>
      `;
      text = formatNotificationMessage(type, data);
  }

  return { subject, html, text };
}

/**
 * Format SMS content
 */
function formatSMSContent(type, template, data) {
  switch (type) {
    case 'WALLET_CREDIT':
      return `Airavat: Wallet credited with INR ${formatAmount(data.amount)}. Balance: INR ${formatAmount(data.newBalance)}`;
    case 'WALLET_DEBIT':
      return `Airavat: INR ${formatAmount(data.amount)} debited. Balance: INR ${formatAmount(data.newBalance)}`;
    case 'EMI_DUE_REMINDER':
      return `Airavat: EMI of INR ${formatAmount(data.amount)} due on ${formatDate(data.dueDate)}. Pay to avoid late fee.`;
    case 'EMI_OVERDUE':
      return `Airavat: EMI OVERDUE! INR ${formatAmount(data.totalDue)} due immediately. Late fee: INR ${formatAmount(data.lateFee)}`;
    case 'CARD_LOCKED':
      return `Airavat: Your card *${data.last4} has been locked. Contact support if not done by you.`;
    case 'SUSPICIOUS_ACTIVITY':
      return `Airavat: Suspicious activity detected on your account. Review immediately.`;
    default:
      return `Airavat: ${template.title}. Check app for details.`;
  }
}

/**
 * Format push notification content
 */
function formatPushContent(type, template, data) {
  return {
    title: template.title,
    body: formatNotificationMessage(type, data),
    data: { type, ...data },
  };
}

/**
 * Format notification message
 */
function formatNotificationMessage(type, data) {
  switch (type) {
    case 'WALLET_CREDIT':
      return `Your wallet has been credited with ${data.currency || 'INR'} ${formatAmount(data.amount)}`;
    case 'WALLET_DEBIT':
      return `${data.currency || 'INR'} ${formatAmount(data.amount)} has been debited from your wallet`;
    case 'WALLET_LOW_BALANCE':
      return `Your wallet balance is low: ${data.currency || 'INR'} ${formatAmount(data.balance)}`;
    case 'EMI_DUE_REMINDER':
      return `EMI payment of ${data.currency || 'INR'} ${formatAmount(data.amount)} is due on ${formatDate(data.dueDate)}`;
    case 'EMI_OVERDUE':
      return `Your EMI payment is overdue! Total due: ${data.currency || 'INR'} ${formatAmount(data.totalDue)}`;
    case 'CARD_TRANSACTION':
      return `Card *${data.last4} used for ${data.currency || 'INR'} ${formatAmount(data.amount)} at ${data.merchantName}`;
    case 'CARD_DECLINED':
      return `Card transaction of ${data.currency || 'INR'} ${formatAmount(data.amount)} was declined. Reason: ${data.reason}`;
    case 'INSURANCE_CLAIM_SETTLED':
      return `Insurance claim ${data.claimNumber} settled. ${data.currency || 'INR'} ${formatAmount(data.settlementAmount)} credited.`;
    case 'CASHBACK_CREDITED':
      return `Cashback of ${data.currency || 'INR'} ${formatAmount(data.amount)} has been credited to your wallet`;
    default:
      return `Financial notification: ${type}`;
  }
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Log notification to database
 */
async function logNotification(userId, type, priority, results, data) {
  try {
    await prisma.notificationLog.create({
      data: {
        userId,
        type: 'FINANCIAL',
        subType: type,
        priority,
        channels: Object.keys(results),
        results,
        data,
      },
    });
  } catch (error) {
    logger.error('Failed to log notification', { error: error.message });
  }
}

/**
 * Format amount with thousand separators
 */
function formatAmount(amount) {
  if (amount === undefined || amount === null) return '0.00';
  return parseFloat(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format date
 */
function formatDate(date) {
  if (!date) return '';
  return new Date(date).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/**
 * Format datetime
 */
function formatDateTime(date) {
  if (!date) return '';
  return new Date(date).toLocaleString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

// =============================================================================
// SCHEDULED NOTIFICATIONS
// =============================================================================

/**
 * Send EMI due reminders
 */
exports.sendEMIDueReminders = async (daysAhead = 3) => {
  const dueDate = new Date();
  dueDate.setDate(dueDate.getDate() + daysAhead);
  dueDate.setHours(23, 59, 59, 999);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const upcomingInstallments = await prisma.eMIInstallment.findMany({
    where: {
      status: 'PENDING',
      dueDate: { gte: today, lte: dueDate },
    },
    include: {
      emiOrder: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  const results = [];
  for (const installment of upcomingInstallments) {
    const result = await this.send(
      installment.emiOrder.userId,
      'EMI_DUE_REMINDER',
      {
        amount: installment.amount,
        dueDate: installment.dueDate,
        emiOrderNumber: installment.emiOrder.orderNumber || installment.emiOrderId,
        installmentNumber: installment.installmentNumber,
        totalInstallments: installment.emiOrder.tenureMonths,
      }
    );
    results.push({ installmentId: installment.id, result });
  }

  logger.info('EMI due reminders sent', { count: results.length });
  return results;
};

/**
 * Send policy expiry reminders
 */
exports.sendPolicyExpiryReminders = async (daysAhead = 30) => {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + daysAhead);

  const expiringPolicies = await prisma.creditInsurancePolicy.findMany({
    where: {
      status: 'ACTIVE',
      endDate: { lte: expiryDate, gte: new Date() },
    },
    include: {
      business: {
        include: {
          user: { select: { id: true, name: true, email: true } },
        },
      },
    },
  });

  const results = [];
  for (const policy of expiringPolicies) {
    if (policy.business?.user) {
      const result = await this.send(
        policy.business.user.id,
        'INSURANCE_POLICY_EXPIRING',
        {
          policyNumber: policy.policyNumber,
          expiryDate: policy.endDate,
          coverageLimit: policy.coverageLimit,
          daysToExpiry: Math.ceil((new Date(policy.endDate) - new Date()) / (1000 * 60 * 60 * 24)),
        }
      );
      results.push({ policyId: policy.id, result });
    }
  }

  logger.info('Policy expiry reminders sent', { count: results.length });
  return results;
};

/**
 * Send card expiry reminders
 */
exports.sendCardExpiryReminders = async (daysAhead = 7) => {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + daysAhead);

  const expiringCards = await prisma.virtualCard.findMany({
    where: {
      status: 'ACTIVE',
      validUntil: { lte: expiryDate, gte: new Date() },
    },
  });

  const results = [];
  for (const card of expiringCards) {
    const result = await this.send(
      card.userId,
      'CARD_EXPIRING',
      {
        last4: card.last4,
        expiryDate: card.validUntil,
        daysToExpiry: Math.ceil((new Date(card.validUntil) - new Date()) / (1000 * 60 * 60 * 24)),
      }
    );
    results.push({ cardId: card.id, result });
  }

  logger.info('Card expiry reminders sent', { count: results.length });
  return results;
};

module.exports = exports;
