// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL WEBHOOKS
// Handle callbacks from external financial services
// =============================================================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const logger = require('../config/logger');
const { prisma } = require('../config/database');
const bankIntegrationService = require('../services/bankIntegration.service');
const virtualCardService = require('../services/virtualCard.service');
const walletService = require('../services/wallet.service');
const { eventEmitter } = require('../services/eventEmitter.service');

// =============================================================================
// WEBHOOK SIGNATURE VERIFICATION MIDDLEWARE
// =============================================================================

/**
 * Verify webhook signature
 */
const verifyWebhookSignature = (provider) => {
  return (req, res, next) => {
    try {
      const signature = req.headers['x-webhook-signature'] || 
                        req.headers['x-razorpay-signature'] ||
                        req.headers['x-stripe-signature'];

      if (!signature) {
        logger.warn('Webhook signature missing', { provider });
        return res.status(401).json({ error: 'Signature missing' });
      }

      const secret = getWebhookSecret(provider);
      const payload = JSON.stringify(req.body);
      
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      if (!crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      )) {
        logger.warn('Invalid webhook signature', { provider });
        return res.status(401).json({ error: 'Invalid signature' });
      }

      next();
    } catch (error) {
      logger.error('Webhook signature verification error', { error: error.message });
      res.status(500).json({ error: 'Signature verification failed' });
    }
  };
};

/**
 * Get webhook secret for provider
 */
function getWebhookSecret(provider) {
  const secrets = {
    razorpay: process.env.RAZORPAY_WEBHOOK_SECRET,
    stripe: process.env.STRIPE_WEBHOOK_SECRET,
    bank_aa: process.env.ACCOUNT_AGGREGATOR_WEBHOOK_SECRET,
    card_provider: process.env.CARD_PROVIDER_WEBHOOK_SECRET,
    insurance: process.env.INSURANCE_WEBHOOK_SECRET,
  };
  return secrets[provider] || process.env.DEFAULT_WEBHOOK_SECRET || 'default_secret';
}

// =============================================================================
// BANK INTEGRATION WEBHOOKS
// =============================================================================

/**
 * Account Aggregator consent callback
 */
router.post('/bank/consent-callback', async (req, res) => {
  try {
    logger.info('Bank consent callback received', { body: req.body });

    const { connectionId, consentId, status, error } = req.body;

    if (!connectionId || !consentId) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    const result = await bankIntegrationService.handleConsentCallback(connectionId, {
      success: status === 'APPROVED' || status === 'SUCCESS',
      consentId,
      error: error || (status === 'REJECTED' ? 'Consent rejected by user' : null),
    });

    eventEmitter.emit('webhook.bank_consent', {
      connectionId,
      consentId,
      status,
    });

    res.json({ success: true, result });
  } catch (error) {
    logger.error('Bank consent callback error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Bank transaction notification
 */
router.post('/bank/transaction-notification', async (req, res) => {
  try {
    logger.info('Bank transaction notification received', { body: req.body });

    const { connectionId, transactions } = req.body;

    if (connectionId && transactions?.length > 0) {
      // Trigger sync to fetch new transactions
      await bankIntegrationService.syncTransactions(connectionId);
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Bank transaction notification error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// VIRTUAL CARD WEBHOOKS
// =============================================================================

/**
 * Card transaction authorization webhook
 */
router.post('/card/authorization', async (req, res) => {
  try {
    logger.info('Card authorization webhook received', { body: req.body });

    const {
      cardToken,
      amount,
      currency,
      merchantName,
      merchantCategory,
      merchantId,
      transactionType,
    } = req.body;

    if (!cardToken || !amount) {
      return res.status(400).json({ 
        authorized: false, 
        reason: 'INVALID_REQUEST' 
      });
    }

    const result = await virtualCardService.authorizeTransaction(cardToken, {
      amount: parseFloat(amount),
      currency: currency || 'INR',
      merchantName,
      merchantCategory,
      merchantId,
    });

    if (!result.authorized) {
      await virtualCardService.declineTransaction(cardToken, req.body, result.reason);
    }

    res.json(result);
  } catch (error) {
    logger.error('Card authorization error', { error: error.message });
    res.status(500).json({ authorized: false, reason: 'SYSTEM_ERROR' });
  }
});

/**
 * Card transaction settlement webhook
 */
router.post('/card/settlement', async (req, res) => {
  try {
    logger.info('Card settlement webhook received', { body: req.body });

    const { transactionId, settlementAmount, settlementDate } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: 'Missing transaction ID' });
    }

    await virtualCardService.settleTransaction(transactionId, settlementAmount);

    res.json({ success: true });
  } catch (error) {
    logger.error('Card settlement error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Card transaction reversal webhook
 */
router.post('/card/reversal', async (req, res) => {
  try {
    logger.info('Card reversal webhook received', { body: req.body });

    const { transactionId, reason } = req.body;

    if (!transactionId) {
      return res.status(400).json({ error: 'Missing transaction ID' });
    }

    await virtualCardService.reverseTransaction(transactionId, reason);

    res.json({ success: true });
  } catch (error) {
    logger.error('Card reversal error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// PAYMENT GATEWAY WEBHOOKS (for wallet top-up)
// =============================================================================

/**
 * Razorpay payment webhook
 */
router.post('/razorpay/payment', async (req, res) => {
  try {
    logger.info('Razorpay webhook received', { event: req.body.event });

    const { event, payload } = req.body;

    switch (event) {
      case 'payment.captured':
        await handlePaymentCaptured(payload.payment.entity);
        break;
      case 'payment.failed':
        await handlePaymentFailed(payload.payment.entity);
        break;
      case 'refund.created':
        await handleRefundCreated(payload.refund.entity);
        break;
      default:
        logger.info('Unhandled Razorpay event', { event });
    }

    res.json({ status: 'ok' });
  } catch (error) {
    logger.error('Razorpay webhook error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Handle successful payment capture
 */
async function handlePaymentCaptured(payment) {
  const { id, amount, notes } = payment;

  if (notes?.type === 'WALLET_TOPUP' && notes?.walletId) {
    await walletService.credit(notes.walletId, amount / 100, {
      referenceType: 'DEPOSIT',
      referenceId: id,
      description: 'Wallet top-up via Razorpay',
    });

    logger.info('Wallet credited from payment', { paymentId: id, walletId: notes.walletId });
  }
}

/**
 * Handle failed payment
 */
async function handlePaymentFailed(payment) {
  const { id, error_description, notes } = payment;

  logger.warn('Payment failed', {
    paymentId: id,
    error: error_description,
    notes,
  });

  // Release any holds if applicable
  if (notes?.walletId && notes?.holdId) {
    await walletService.releaseHold(notes.walletId, notes.holdAmount || 0, false);
  }
}

/**
 * Handle refund created
 */
async function handleRefundCreated(refund) {
  const { id, payment_id, amount, notes } = refund;

  logger.info('Refund processed', {
    refundId: id,
    paymentId: payment_id,
    amount,
  });

  if (notes?.walletId) {
    await walletService.credit(notes.walletId, amount / 100, {
      referenceType: 'REFUND',
      referenceId: id,
      description: 'Payment refund',
    });
  }
}

// =============================================================================
// CREDIT INSURANCE WEBHOOKS
// =============================================================================

/**
 * Insurance policy status update
 */
router.post('/insurance/policy-update', async (req, res) => {
  try {
    logger.info('Insurance policy update webhook', { body: req.body });

    const { policyNumber, status, effectiveDate, reason } = req.body;

    const policy = await prisma.creditInsurancePolicy.findFirst({
      where: { policyNumber },
    });

    if (policy) {
      await prisma.creditInsurancePolicy.update({
        where: { id: policy.id },
        data: {
          status: mapInsuranceStatus(status),
          updatedAt: new Date(),
        },
      });

      eventEmitter.emit('webhook.insurance_policy_update', {
        policyId: policy.id,
        status,
      });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Insurance policy update error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Insurance claim status update
 */
router.post('/insurance/claim-update', async (req, res) => {
  try {
    logger.info('Insurance claim update webhook', { body: req.body });

    const { claimNumber, status, settlementAmount, settlementRef, reason } = req.body;

    const claim = await prisma.insuranceClaim.findFirst({
      where: { claimNumber },
    });

    if (claim) {
      const updateData = {
        status: mapClaimStatus(status),
        updatedAt: new Date(),
      };

      if (status === 'SETTLED' && settlementAmount) {
        updateData.settlementAmount = settlementAmount;
        updateData.settlementRef = settlementRef;
        updateData.settledAt = new Date();
      }

      if (status === 'REJECTED' && reason) {
        updateData.rejectionReason = reason;
      }

      await prisma.insuranceClaim.update({
        where: { id: claim.id },
        data: updateData,
      });

      eventEmitter.emit('webhook.insurance_claim_update', {
        claimId: claim.id,
        status,
      });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Insurance claim update error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Map external insurance status to internal
 */
function mapInsuranceStatus(externalStatus) {
  const statusMap = {
    ACTIVE: 'ACTIVE',
    CANCELLED: 'CANCELLED',
    EXPIRED: 'EXPIRED',
    SUSPENDED: 'SUSPENDED',
  };
  return statusMap[externalStatus] || externalStatus;
}

/**
 * Map external claim status to internal
 */
function mapClaimStatus(externalStatus) {
  const statusMap = {
    SUBMITTED: 'SUBMITTED',
    UNDER_REVIEW: 'UNDER_REVIEW',
    APPROVED: 'APPROVED',
    REJECTED: 'REJECTED',
    SETTLED: 'SETTLED',
    CLOSED: 'CLOSED',
  };
  return statusMap[externalStatus] || externalStatus;
}

// =============================================================================
// TRADE FINANCE WEBHOOKS
// =============================================================================

/**
 * LC status update from bank
 */
router.post('/trade-finance/lc-update', async (req, res) => {
  try {
    logger.info('LC status update webhook', { body: req.body });

    const { lcNumber, status, bankReference, documents } = req.body;

    const lc = await prisma.letterOfCredit.findFirst({
      where: { lcNumber },
    });

    if (lc) {
      await prisma.letterOfCredit.update({
        where: { id: lc.id },
        data: {
          status: status,
          updatedAt: new Date(),
        },
      });

      eventEmitter.emit('webhook.lc_update', {
        lcId: lc.id,
        status,
      });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('LC update error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// INVOICE FACTORING WEBHOOKS
// =============================================================================

/**
 * Factoring disbursement notification
 */
router.post('/factoring/disbursement', async (req, res) => {
  try {
    logger.info('Factoring disbursement webhook', { body: req.body });

    const { applicationNumber, disbursementRef, amount, date } = req.body;

    const application = await prisma.factoringApplication.findFirst({
      where: { applicationNumber },
    });

    if (application && application.status === 'APPROVED') {
      await prisma.factoringApplication.update({
        where: { id: application.id },
        data: {
          status: 'DISBURSED',
          disbursedAt: new Date(date),
          disbursementRef,
        },
      });

      eventEmitter.emit('webhook.factoring_disbursement', {
        applicationId: application.id,
        amount,
      });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Factoring disbursement error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

/**
 * Factoring settlement notification
 */
router.post('/factoring/settlement', async (req, res) => {
  try {
    logger.info('Factoring settlement webhook', { body: req.body });

    const { applicationNumber, settlementAmount, settlementRef, date } = req.body;

    const application = await prisma.factoringApplication.findFirst({
      where: { applicationNumber },
    });

    if (application && application.status === 'DISBURSED') {
      await prisma.factoringApplication.update({
        where: { id: application.id },
        data: {
          status: 'SETTLED',
          settledAt: new Date(date),
          settlementAmount,
        },
      });

      eventEmitter.emit('webhook.factoring_settlement', {
        applicationId: application.id,
        settlementAmount,
      });
    }

    res.json({ success: true });
  } catch (error) {
    logger.error('Factoring settlement error', { error: error.message });
    res.status(500).json({ error: error.message });
  }
});

// =============================================================================
// HEALTH CHECK
// =============================================================================

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'financial-webhooks',
    timestamp: new Date().toISOString(),
  });
});

module.exports = router;
