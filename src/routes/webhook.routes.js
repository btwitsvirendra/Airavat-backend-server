// =============================================================================
// AIRAVAT B2B MARKETPLACE - WEBHOOK ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { asyncHandler } = require('../middleware/errorHandler');
const config = require('../config');

// =============================================================================
// RAZORPAY WEBHOOKS
// =============================================================================

router.post(
  '/razorpay',
  express.raw({ type: 'application/json' }),
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-razorpay-signature'];
    const body = req.body.toString();
    
    // Verify signature
    const expectedSignature = crypto
      .createHmac('sha256', config.razorpay.webhookSecret)
      .update(body)
      .digest('hex');
    
    if (signature !== expectedSignature) {
      logger.warn('Invalid Razorpay webhook signature');
      return res.status(400).json({ error: 'Invalid signature' });
    }
    
    const event = JSON.parse(body);
    logger.info(`Razorpay webhook: ${event.event}`, { payload: event.payload });
    
    try {
      switch (event.event) {
        case 'payment.captured':
          await handlePaymentCaptured(event.payload.payment.entity);
          break;
          
        case 'payment.failed':
          await handlePaymentFailed(event.payload.payment.entity);
          break;
          
        case 'refund.processed':
          await handleRefundProcessed(event.payload.refund.entity);
          break;
          
        case 'order.paid':
          await handleOrderPaid(event.payload.order.entity);
          break;
          
        case 'settlement.processed':
          await handleSettlementProcessed(event.payload.settlement.entity);
          break;
          
        default:
          logger.info(`Unhandled Razorpay event: ${event.event}`);
      }
    } catch (error) {
      logger.error('Error processing Razorpay webhook', { error, event });
    }
    
    res.json({ received: true });
  })
);

// Razorpay handler functions
async function handlePaymentCaptured(payment) {
  const orderId = payment.notes?.orderId;
  
  if (!orderId) {
    logger.warn('Payment captured without order ID', { paymentId: payment.id });
    return;
  }
  
  await prisma.$transaction(async (tx) => {
    // Update payment record
    await tx.payment.updateMany({
      where: { razorpayPaymentId: payment.id },
      data: {
        status: 'CAPTURED',
        capturedAt: new Date(),
        amount: payment.amount / 100, // Razorpay stores in paise
      },
    });
    
    // Update order status
    await tx.order.update({
      where: { id: orderId },
      data: {
        status: 'PAID',
        paidAt: new Date(),
      },
    });
    
    // Create timeline entry
    await tx.orderTimeline.create({
      data: {
        orderId,
        status: 'PAID',
        title: 'Payment received',
        description: `Payment of ₹${payment.amount / 100} received via ${payment.method}`,
      },
    });
  });
  
  logger.info('Payment captured processed', { orderId, paymentId: payment.id });
}

async function handlePaymentFailed(payment) {
  const orderId = payment.notes?.orderId;
  
  if (!orderId) return;
  
  await prisma.payment.updateMany({
    where: { razorpayPaymentId: payment.id },
    data: {
      status: 'FAILED',
      failureReason: payment.error_description,
    },
  });
  
  logger.info('Payment failure recorded', { orderId, paymentId: payment.id });
}

async function handleRefundProcessed(refund) {
  await prisma.refund.updateMany({
    where: { razorpayRefundId: refund.id },
    data: {
      status: 'PROCESSED',
      processedAt: new Date(),
    },
  });
  
  logger.info('Refund processed', { refundId: refund.id });
}

async function handleOrderPaid(order) {
  // Handle Razorpay order paid event
  logger.info('Razorpay order paid', { razorpayOrderId: order.id });
}

async function handleSettlementProcessed(settlement) {
  // Record settlement
  await prisma.settlement.create({
    data: {
      razorpaySettlementId: settlement.id,
      amount: settlement.amount / 100,
      status: 'PROCESSED',
      utr: settlement.utr,
      processedAt: new Date(),
    },
  });
  
  logger.info('Settlement processed', { settlementId: settlement.id });
}

// =============================================================================
// SHIPROCKET WEBHOOKS
// =============================================================================

router.post(
  '/shiprocket',
  asyncHandler(async (req, res) => {
    const { token } = req.query;
    
    // Verify webhook token
    if (token !== config.shiprocket.webhookToken) {
      logger.warn('Invalid Shiprocket webhook token');
      return res.status(401).json({ error: 'Unauthorized' });
    }
    
    const event = req.body;
    logger.info('Shiprocket webhook', { event });
    
    try {
      const { awb, current_status, shipment_id, order_id } = event;
      
      // Find order by AWB or order_id
      const shipment = await prisma.shipment.findFirst({
        where: {
          OR: [
            { awbNumber: awb },
            { shiprocketShipmentId: shipment_id?.toString() },
          ],
        },
        include: { order: true },
      });
      
      if (!shipment) {
        logger.warn('Shipment not found for webhook', { awb, shipment_id });
        return res.json({ received: true });
      }
      
      // Map Shiprocket status to our status
      const statusMapping = {
        'PICKED UP': 'PICKED_UP',
        'IN TRANSIT': 'IN_TRANSIT',
        'OUT FOR DELIVERY': 'OUT_FOR_DELIVERY',
        'DELIVERED': 'DELIVERED',
        'RTO INITIATED': 'RTO_INITIATED',
        'RTO DELIVERED': 'RTO_DELIVERED',
        'CANCELLED': 'CANCELLED',
      };
      
      const mappedStatus = statusMapping[current_status] || current_status;
      
      await prisma.$transaction(async (tx) => {
        // Update shipment
        await tx.shipment.update({
          where: { id: shipment.id },
          data: {
            status: mappedStatus,
            currentStatus: current_status,
            lastUpdated: new Date(),
          },
        });
        
        // Add tracking event
        await tx.trackingEvent.create({
          data: {
            shipmentId: shipment.id,
            status: current_status,
            location: event.current_location || '',
            timestamp: new Date(event.scanned_date || Date.now()),
            description: event.current_status_body || '',
          },
        });
        
        // Update order status if delivered
        if (mappedStatus === 'DELIVERED') {
          await tx.order.update({
            where: { id: shipment.orderId },
            data: {
              status: 'DELIVERED',
              deliveredAt: new Date(),
            },
          });
          
          await tx.orderTimeline.create({
            data: {
              orderId: shipment.orderId,
              status: 'DELIVERED',
              title: 'Order delivered',
              description: `Order delivered at ${event.current_location || 'destination'}`,
            },
          });
        }
      });
      
      logger.info('Shipping status updated', { orderId: shipment.orderId, status: mappedStatus });
    } catch (error) {
      logger.error('Error processing Shiprocket webhook', { error, event });
    }
    
    res.json({ received: true });
  })
);

// =============================================================================
// GST API WEBHOOKS
// =============================================================================

router.post(
  '/gst',
  asyncHandler(async (req, res) => {
    const signature = req.headers['x-gst-signature'];
    
    // Verify signature (implementation depends on GST API provider)
    // ...
    
    const event = req.body;
    logger.info('GST webhook', { event });
    
    try {
      switch (event.type) {
        case 'e-invoice.generated':
          await handleEInvoiceGenerated(event.data);
          break;
          
        case 'eway-bill.generated':
          await handleEWayBillGenerated(event.data);
          break;
          
        case 'e-invoice.cancelled':
          await handleEInvoiceCancelled(event.data);
          break;
          
        default:
          logger.info(`Unhandled GST event: ${event.type}`);
      }
    } catch (error) {
      logger.error('Error processing GST webhook', { error, event });
    }
    
    res.json({ received: true });
  })
);

async function handleEInvoiceGenerated(data) {
  await prisma.order.update({
    where: { id: data.orderId },
    data: {
      eInvoiceNumber: data.irn,
      eInvoiceData: data,
      eInvoiceGeneratedAt: new Date(),
    },
  });
}

async function handleEWayBillGenerated(data) {
  await prisma.order.update({
    where: { id: data.orderId },
    data: {
      ewayBillNumber: data.ewbNumber,
      ewayBillData: data,
      ewayBillGeneratedAt: new Date(),
      ewayBillValidUntil: new Date(data.validUpto),
    },
  });
}

async function handleEInvoiceCancelled(data) {
  await prisma.order.update({
    where: { id: data.orderId },
    data: {
      eInvoiceCancelled: true,
      eInvoiceCancelledAt: new Date(),
      eInvoiceCancelReason: data.reason,
    },
  });
}

// =============================================================================
// SMS DELIVERY WEBHOOKS (MSG91)
// =============================================================================

router.post(
  '/sms/delivery',
  asyncHandler(async (req, res) => {
    const events = req.body;
    
    // MSG91 sends array of events
    if (Array.isArray(events)) {
      for (const event of events) {
        await prisma.smsLog.updateMany({
          where: { messageId: event.requestId },
          data: {
            status: event.status,
            deliveredAt: event.status === 'delivered' ? new Date() : undefined,
            errorCode: event.errorCode,
          },
        });
      }
    }
    
    res.json({ received: true });
  })
);

// =============================================================================
// EMAIL DELIVERY WEBHOOKS (AWS SES)
// =============================================================================

router.post(
  '/email/ses',
  asyncHandler(async (req, res) => {
    const message = JSON.parse(req.body.Message || req.body);
    
    logger.info('SES webhook', { message });
    
    const { notificationType, mail, bounce, complaint, delivery } = message;
    
    switch (notificationType) {
      case 'Bounce':
        await handleEmailBounce(mail, bounce);
        break;
        
      case 'Complaint':
        await handleEmailComplaint(mail, complaint);
        break;
        
      case 'Delivery':
        await handleEmailDelivery(mail, delivery);
        break;
    }
    
    res.json({ received: true });
  })
);

async function handleEmailBounce(mail, bounce) {
  const recipients = bounce.bouncedRecipients.map((r) => r.emailAddress);
  
  // Mark emails as bounced
  for (const email of recipients) {
    await prisma.user.updateMany({
      where: { email },
      data: { 
        emailBounced: true,
        emailBouncedAt: new Date(),
      },
    });
  }
  
  logger.warn('Email bounced', { messageId: mail.messageId, recipients });
}

async function handleEmailComplaint(mail, complaint) {
  const recipients = complaint.complainedRecipients.map((r) => r.emailAddress);
  
  // Unsubscribe users who complained
  for (const email of recipients) {
    await prisma.user.updateMany({
      where: { email },
      data: { emailOptOut: true },
    });
  }
  
  logger.warn('Email complaint received', { messageId: mail.messageId, recipients });
}

async function handleEmailDelivery(mail, delivery) {
  logger.info('Email delivered', { 
    messageId: mail.messageId, 
    recipients: delivery.recipients,
  });
}

// =============================================================================
// HEALTH CHECK
// =============================================================================

router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

module.exports = router;
