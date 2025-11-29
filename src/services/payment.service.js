// =============================================================================
// AIRAVAT B2B MARKETPLACE - PAYMENT SERVICE
// Razorpay integration with Route (split payments) and escrow
// =============================================================================

const Razorpay = require('razorpay');
const crypto = require('crypto');
const { prisma } = require('../config/database');
const config = require('../config');
const logger = require('../config/logger');
const {
  BadRequestError,
  PaymentFailedError,
  NotFoundError,
} = require('../utils/errors');
const { verifyRazorpaySignature } = require('../utils/helpers');

// Initialize Razorpay
const razorpay = new Razorpay({
  key_id: config.razorpay.keyId,
  key_secret: config.razorpay.keySecret,
});

/**
 * Create Razorpay order
 */
const createOrder = async (data) => {
  const { orderId, amount, currency = 'INR', receipt, notes } = data;

  try {
    const razorpayOrder = await razorpay.orders.create({
      amount: Math.round(amount * 100), // Convert to paise
      currency,
      receipt,
      notes,
      payment_capture: 1, // Auto-capture
    });

    // Create payment record
    await prisma.payment.create({
      data: {
        orderId,
        amount,
        currency,
        status: 'PENDING',
        method: 'RAZORPAY',
        gatewayOrderId: razorpayOrder.id,
        isEscrowed: true,
      },
    });

    logger.info(`Razorpay order created: ${razorpayOrder.id}`);

    return razorpayOrder;
  } catch (error) {
    logger.error('Failed to create Razorpay order:', error);
    throw new PaymentFailedError('Failed to initiate payment');
  }
};

/**
 * Verify payment signature
 */
const verifyPayment = async (data) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = data;

  // Verify signature
  const isValid = verifyRazorpaySignature(
    razorpay_order_id,
    razorpay_payment_id,
    razorpay_signature,
    config.razorpay.keySecret
  );

  if (!isValid) {
    throw new PaymentFailedError('Invalid payment signature');
  }

  // Get payment from Razorpay
  const razorpayPayment = await razorpay.payments.fetch(razorpay_payment_id);

  // Update payment record
  const payment = await prisma.payment.update({
    where: { gatewayOrderId: razorpay_order_id },
    data: {
      status: razorpayPayment.status === 'captured' ? 'CAPTURED' : 'AUTHORIZED',
      gatewayPaymentId: razorpay_payment_id,
      gatewaySignature: razorpay_signature,
      gatewayResponse: razorpayPayment,
      method: mapPaymentMethod(razorpayPayment.method),
      paidAt: new Date(),
    },
    include: {
      order: true,
    },
  });

  // Update order status
  if (payment.status === 'CAPTURED') {
    await prisma.order.update({
      where: { id: payment.orderId },
      data: {
        status: 'PAID',
        timeline: {
          create: {
            status: 'PAID',
            title: 'Payment Confirmed',
            description: `Payment of ₹${payment.amount} received via ${payment.method}`,
            createdBy: 'system',
          },
        },
      },
    });

    // Create split transfers using Razorpay Route
    await createSplitTransfers(payment);
  }

  logger.logAudit('PAYMENT_VERIFIED', null, {
    orderId: payment.orderId,
    paymentId: payment.id,
    amount: payment.amount,
  });

  return payment;
};

/**
 * Create split transfers (Razorpay Route)
 */
const createSplitTransfers = async (payment) => {
  const order = await prisma.order.findUnique({
    where: { id: payment.orderId },
    include: {
      seller: {
        select: {
          razorpayAccountId: true,
          businessName: true,
        },
      },
    },
  });

  if (!order.seller.razorpayAccountId) {
    logger.warn(`Seller ${order.sellerId} has no Razorpay account`);
    return;
  }

  try {
    // Calculate split amounts
    const platformFee = parseFloat(order.platformFee);
    const sellerAmount = parseFloat(payment.amount) - platformFee;

    // Create transfer to seller (hold for escrow)
    const transfer = await razorpay.payments.transfer(payment.gatewayPaymentId, {
      transfers: [
        {
          account: order.seller.razorpayAccountId,
          amount: Math.round(sellerAmount * 100),
          currency: 'INR',
          notes: {
            orderId: order.id,
            orderNumber: order.orderNumber,
          },
          on_hold: 1, // Hold for escrow
          on_hold_until: Math.floor(Date.now() / 1000) + (config.businessRules.escrowHoldDays * 24 * 60 * 60),
        },
      ],
    });

    // Update payment with transfer details
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        splitDetails: {
          sellerAmount,
          platformFee,
          sellerAccountId: order.seller.razorpayAccountId,
        },
        transferIds: transfer.items.map((t) => t.id),
      },
    });

    logger.info(`Split transfer created for order ${order.orderNumber}`);
  } catch (error) {
    logger.error('Failed to create split transfer:', error);
    // Don't fail the payment - handle manually
  }
};

/**
 * Release escrow payment to seller
 */
const releaseEscrow = async (orderId) => {
  const payment = await prisma.payment.findFirst({
    where: { orderId, status: 'CAPTURED', isEscrowed: true },
  });

  if (!payment || !payment.transferIds?.length) {
    return;
  }

  try {
    // Modify transfer to release hold
    for (const transferId of payment.transferIds) {
      await razorpay.transfers.edit(transferId, {
        on_hold: false,
      });
    }

    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SETTLED',
        isEscrowed: false,
        escrowReleasedAt: new Date(),
        escrowReleaseNote: 'Released after order completion',
        settledAt: new Date(),
        settlementAmount: payment.splitDetails?.sellerAmount,
      },
    });

    logger.info(`Escrow released for order ${orderId}`);
  } catch (error) {
    logger.error('Failed to release escrow:', error);
  }
};

/**
 * Process refund
 */
const refundPayment = async (orderId, reason) => {
  const payment = await prisma.payment.findFirst({
    where: { orderId, status: { in: ['CAPTURED', 'SETTLED'] } },
  });

  if (!payment) {
    throw new NotFoundError('Payment');
  }

  try {
    // Create refund in Razorpay
    const refund = await razorpay.payments.refund(payment.gatewayPaymentId, {
      amount: Math.round(parseFloat(payment.amount) * 100),
      speed: 'normal',
      notes: {
        reason,
        orderId,
      },
    });

    // Update payment record
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'REFUNDED',
        refundAmount: payment.amount,
        refundReason: reason,
        refundId: refund.id,
        refundedAt: new Date(),
      },
    });

    // Reverse transfers if any
    if (payment.transferIds?.length) {
      for (const transferId of payment.transferIds) {
        try {
          await razorpay.transfers.reverse(transferId, {
            amount: Math.round(parseFloat(payment.splitDetails?.sellerAmount || 0) * 100),
          });
        } catch (e) {
          logger.error(`Failed to reverse transfer ${transferId}:`, e);
        }
      }
    }

    logger.logAudit('PAYMENT_REFUNDED', null, {
      orderId,
      paymentId: payment.id,
      amount: payment.amount,
    });

    return { success: true, refundId: refund.id };
  } catch (error) {
    logger.error('Failed to process refund:', error);
    throw new PaymentFailedError('Failed to process refund');
  }
};

/**
 * Create linked account for seller (Razorpay Route)
 */
const createLinkedAccount = async (business) => {
  try {
    // Create contact
    const contact = await razorpay.contacts.create({
      name: business.businessName,
      email: business.email,
      contact: business.phone,
      type: 'vendor',
      reference_id: business.id,
      notes: {
        businessId: business.id,
        gstin: business.gstin,
      },
    });

    // Create fund account
    const fundAccount = await razorpay.fundAccount.create({
      contact_id: contact.id,
      account_type: 'bank_account',
      bank_account: {
        name: business.bankAccountName,
        ifsc: business.bankIfsc,
        account_number: business.bankAccountNumber,
      },
    });

    // Update business with Razorpay IDs
    await prisma.business.update({
      where: { id: business.id },
      data: {
        razorpayContactId: contact.id,
        razorpayFundAccountId: fundAccount.id,
        razorpayAccountId: fundAccount.id, // Use fund account ID for Route
      },
    });

    logger.info(`Linked account created for business ${business.id}`);

    return { contactId: contact.id, fundAccountId: fundAccount.id };
  } catch (error) {
    logger.error('Failed to create linked account:', error);
    throw new BadRequestError('Failed to setup payment account');
  }
};

/**
 * Handle Razorpay webhook
 */
const handleWebhook = async (body, signature) => {
  // Verify webhook signature
  const expectedSignature = crypto
    .createHmac('sha256', config.razorpay.webhookSecret)
    .update(body)
    .digest('hex');

  if (signature !== expectedSignature) {
    throw new BadRequestError('Invalid webhook signature');
  }

  const event = JSON.parse(body);
  const { event: eventType, payload } = event;

  logger.info(`Razorpay webhook received: ${eventType}`);

  switch (eventType) {
    case 'payment.captured':
      await handlePaymentCaptured(payload.payment.entity);
      break;

    case 'payment.failed':
      await handlePaymentFailed(payload.payment.entity);
      break;

    case 'refund.created':
      await handleRefundCreated(payload.refund.entity);
      break;

    case 'transfer.settled':
      await handleTransferSettled(payload.transfer.entity);
      break;

    default:
      logger.info(`Unhandled webhook event: ${eventType}`);
  }

  return { received: true };
};

/**
 * Handle payment.captured webhook
 */
const handlePaymentCaptured = async (paymentEntity) => {
  const payment = await prisma.payment.findFirst({
    where: { gatewayPaymentId: paymentEntity.id },
  });

  if (payment && payment.status !== 'CAPTURED') {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'CAPTURED',
        paidAt: new Date(paymentEntity.created_at * 1000),
      },
    });
  }
};

/**
 * Handle payment.failed webhook
 */
const handlePaymentFailed = async (paymentEntity) => {
  const payment = await prisma.payment.findFirst({
    where: { gatewayOrderId: paymentEntity.order_id },
  });

  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'FAILED',
        failedAt: new Date(),
        failureReason: paymentEntity.error_description,
      },
    });
  }
};

/**
 * Handle refund.created webhook
 */
const handleRefundCreated = async (refundEntity) => {
  const payment = await prisma.payment.findFirst({
    where: { gatewayPaymentId: refundEntity.payment_id },
  });

  if (payment && !payment.refundId) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'REFUNDED',
        refundId: refundEntity.id,
        refundAmount: refundEntity.amount / 100,
        refundedAt: new Date(refundEntity.created_at * 1000),
      },
    });
  }
};

/**
 * Handle transfer.settled webhook
 */
const handleTransferSettled = async (transferEntity) => {
  const payment = await prisma.payment.findFirst({
    where: { transferIds: { has: transferEntity.id } },
  });

  if (payment) {
    await prisma.payment.update({
      where: { id: payment.id },
      data: {
        status: 'SETTLED',
        settledAt: new Date(transferEntity.settled_at * 1000),
      },
    });
  }
};

/**
 * Map Razorpay payment method to our enum
 */
const mapPaymentMethod = (method) => {
  const methodMap = {
    card: 'CREDIT_CARD',
    netbanking: 'NETBANKING',
    wallet: 'WALLET',
    upi: 'UPI',
    emi: 'CREDIT_CARD',
    bank_transfer: 'NEFT',
  };
  return methodMap[method] || 'UPI';
};

/**
 * Get payment by order ID
 */
const getPaymentByOrderId = async (orderId) => {
  return prisma.payment.findFirst({
    where: { orderId },
    orderBy: { createdAt: 'desc' },
  });
};

/**
 * Get payment status
 */
const getPaymentStatus = async (paymentId) => {
  const payment = await prisma.payment.findUnique({
    where: { id: paymentId },
  });

  if (!payment) {
    throw new NotFoundError('Payment');
  }

  // Fetch latest status from Razorpay
  if (payment.gatewayPaymentId) {
    const razorpayPayment = await razorpay.payments.fetch(payment.gatewayPaymentId);
    return {
      ...payment,
      gatewayStatus: razorpayPayment.status,
    };
  }

  return payment;
};

module.exports = {
  createOrder,
  verifyPayment,
  releaseEscrow,
  refundPayment,
  createLinkedAccount,
  handleWebhook,
  getPaymentByOrderId,
  getPaymentStatus,
};
