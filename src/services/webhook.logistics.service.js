// =============================================================================
// AIRAVAT B2B MARKETPLACE - LOGISTICS WEBHOOK SERVICE
// Handles real-time status updates from shipping carriers
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const MilestoneService = require('./milestone.service');
const { emitToUser } = require('./socket.service');

/**
 * Process inbound tracking webhook (Universal Format)
 */
const handleTrackingWebhook = async (payload) => {
  const { awbNumber, status, location, timestamp } = payload;

  const shipment = await prisma.shipment.findFirst({
    where: { awbNumber },
    include: { order: true }
  });

  if (!shipment) {
    logger.warn(`Webhook received for unknown AWB: ${awbNumber}`);
    return;
  }

  // 1. Log the tracking event
  await prisma.shipmentTracking.create({
    data: {
      shipmentId: shipment.id,
      status,
      location,
      description: payload.description || `Shipment status updated to ${status}`,
      timestamp: new Date(timestamp),
      rawData: payload
    }
  });

  // 2. Update shipment status
  await prisma.shipment.update({
    where: { id: shipment.id },
    data: { 
      status,
      currentLocation: location
    }
  });

  // 3. Trigger Milestones if status matches
  if (status === 'PICKED_UP') {
    await MilestoneService.triggerMilestonesByEvent(shipment.orderId, 'SHIPMENT_PICKED');
  } else if (status === 'DELIVERED') {
    await MilestoneService.triggerMilestonesByEvent(shipment.orderId, 'SHIPMENT_DELIVERED');
  }

  // 4. Real-time update to Buyer via Socket
  const order = await prisma.order.findUnique({
    where: { id: shipment.orderId },
    select: { buyer: { select: { owner: { select: { id: true } } } } }
  });

  if (order?.buyer?.owner?.id) {
    emitToUser(order.buyer.owner.id, 'shipment:update', {
      orderNumber: shipment.order.orderNumber,
      status,
      location
    });
  }

  logger.info(`Real-time tracking updated for ${awbNumber}: ${status}`);
};

module.exports = {
  handleTrackingWebhook
};
