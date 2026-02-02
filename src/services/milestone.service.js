// =============================================================================
// AIRAVAT B2B MARKETPLACE - MILESTONE SERVICE
// Handles stage-wise payments and milestone escrow releases
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const PaymentService = require('./payment.service');

/**
 * Initialize default milestones for an order (20/40/40 split)
 */
const initializeDefaultMilestones = async (orderId, totalAmount) => {
  const milestones = [
    { title: 'Advance Payment', percentage: 20, trigger: 'MANUAL' },
    { title: 'On Dispatch', percentage: 40, trigger: 'SHIPMENT_PICKED' },
    { title: 'On Delivery', percentage: 40, trigger: 'SHIPMENT_DELIVERED' }
  ];

  const data = milestones.map(m => ({
    orderId,
    title: m.title,
    percentage: m.percentage,
    amount: (totalAmount * m.percentage) / 100,
    triggerType: m.trigger,
    status: 'PENDING'
  }));

  await prisma.paymentMilestone.createMany({ data });
  logger.info(`Default milestones initialized for order ${orderId}`);
};

/**
 * Process a milestone payment (Mark as PAID)
 */
const payMilestone = async (milestoneId, paymentId) => {
  const milestone = await prisma.paymentMilestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) throw new NotFoundError('Milestone');

  const updated = await prisma.paymentMilestone.update({
    where: { id: milestoneId },
    data: {
      status: 'PAID',
      paymentId,
      paidAt: new Date()
    }
  });

  logger.info(`Milestone ${milestoneId} marked as PAID.`);
  return updated;
};

/**
 * Release milestone funds to seller (Mark as RELEASED)
 */
const releaseMilestone = async (milestoneId) => {
  const milestone = await prisma.paymentMilestone.findUnique({ where: { id: milestoneId } });
  if (!milestone) throw new NotFoundError('Milestone');
  if (milestone.status !== 'PAID') throw new BadRequestError('Milestone must be PAID before releasing');

  // Trigger actual Razorpay Route release if applicable
  // In a real scenario, this would call PaymentService.releaseEscrow specifically for this amount
  
  const updated = await prisma.paymentMilestone.update({
    where: { id: milestoneId },
    data: {
      status: 'RELEASED',
      verifiedAt: new Date()
    }
  });

  logger.info(`Milestone ${milestoneId} funds RELEASED to seller.`);
  return updated;
};

/**
 * Auto-trigger milestones based on shipment status
 */
const triggerMilestonesByEvent = async (orderId, eventType) => {
  const milestones = await prisma.paymentMilestone.findMany({
    where: { orderId, triggerType: eventType, status: 'PAID' }
  });

  for (const milestone of milestones) {
    await releaseMilestone(milestone.id);
  }
};

module.exports = {
  initializeDefaultMilestones,
  payMilestone,
  releaseMilestone,
  triggerMilestonesByEvent
};
