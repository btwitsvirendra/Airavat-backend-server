// =============================================================================
// AIRAVAT B2B MARKETPLACE - SHIPPING SERVICE
// Multi-Carrier Integration & Rate Comparison
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const { NotFoundError, BadRequestError, ExternalServiceError } = require('../utils/errors');
const { generateId, formatCurrency } = require('../utils/helpers');
const { emitToUser } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const CARRIERS = { DELHIVERY: 'delhivery', BLUEDART: 'bluedart', DTDC: 'dtdc', FEDEX: 'fedex', SHIPROCKET: 'shiprocket' };
const SHIPMENT_STATUS = { PENDING: 'PENDING', BOOKED: 'BOOKED', PICKED_UP: 'PICKED_UP', IN_TRANSIT: 'IN_TRANSIT', OUT_FOR_DELIVERY: 'OUT_FOR_DELIVERY', DELIVERED: 'DELIVERED', FAILED: 'FAILED', RETURNED: 'RETURNED', CANCELLED: 'CANCELLED' };
const SERVICE_TYPE = { STANDARD: 'STANDARD', EXPRESS: 'EXPRESS', ECONOMY: 'ECONOMY', SAME_DAY: 'SAME_DAY', NEXT_DAY: 'NEXT_DAY' };
const CACHE_TTL = { RATES: 300, TRACKING: 60, SERVICEABILITY: 3600 };

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const calculateVolumetricWeight = (dimensions) => {
  const { length = 0, width = 0, height = 0 } = dimensions;
  return (length * width * height) / 5000;
};

const getChargeableWeight = (actualWeight, dimensions) => Math.max(actualWeight, calculateVolumetricWeight(dimensions));

const getTrackingUrl = (carrier, awbNumber) => {
  const urls = {
    [CARRIERS.DELHIVERY]: `https://www.delhivery.com/track/package/${awbNumber}`,
    [CARRIERS.BLUEDART]: `https://www.bluedart.com/tracking/${awbNumber}`,
    [CARRIERS.DTDC]: `https://www.dtdc.in/tracking.asp?tracking_number=${awbNumber}`,
    [CARRIERS.SHIPROCKET]: `https://shiprocket.co/tracking/${awbNumber}`,
  };
  return urls[carrier] || `https://track.airavat.com/${awbNumber}`;
};

// =============================================================================
// RATE CALCULATION
// =============================================================================

const getRates = async (params) => {
  const { originPincode, destinationPincode, weight, dimensions = {}, paymentMode = 'PREPAID' } = params;
  const cacheKey = `rates:${originPincode}:${destinationPincode}:${weight}:${paymentMode}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const chargeableWeight = getChargeableWeight(weight, dimensions);
  const rates = await getMockRates(params, chargeableWeight);

  await cache.set(cacheKey, rates, CACHE_TTL.RATES);
  return rates;
};

const getMockRates = async (params, chargeableWeight) => {
  const baseRate = chargeableWeight * 50;
  const isSameZone = params.originPincode.substring(0, 2) === params.destinationPincode.substring(0, 2);
  const zoneMultiplier = isSameZone ? 1 : 1.5;

  return [
    { carrier: 'express', carrierName: 'Express Delivery', serviceType: SERVICE_TYPE.EXPRESS, rate: Math.round(baseRate * zoneMultiplier * 1.5), formattedRate: formatCurrency(Math.round(baseRate * zoneMultiplier * 1.5)), estimatedDays: isSameZone ? 1 : 2, codCharges: params.paymentMode === 'COD' ? 50 : 0 },
    { carrier: 'standard', carrierName: 'Standard Shipping', serviceType: SERVICE_TYPE.STANDARD, rate: Math.round(baseRate * zoneMultiplier), formattedRate: formatCurrency(Math.round(baseRate * zoneMultiplier)), estimatedDays: isSameZone ? 3 : 5, codCharges: params.paymentMode === 'COD' ? 40 : 0 },
    { carrier: 'economy', carrierName: 'Economy Shipping', serviceType: SERVICE_TYPE.ECONOMY, rate: Math.round(baseRate * zoneMultiplier * 0.7), formattedRate: formatCurrency(Math.round(baseRate * zoneMultiplier * 0.7)), estimatedDays: isSameZone ? 5 : 7, codCharges: params.paymentMode === 'COD' ? 30 : 0 },
  ];
};

// =============================================================================
// SHIPMENT BOOKING
// =============================================================================

const createShipment = async (shipmentData) => {
  const { orderId, businessId, carrier, pickupAddress, deliveryAddress, items, weight, dimensions, declaredValue, paymentMode } = shipmentData;

  const awbNumber = `AWB${Date.now()}${Math.floor(Math.random() * 1000)}`;

  const shipment = await prisma.shipment.create({
    data: {
      orderId, businessId, awbNumber, carrier, carrierName: shipmentData.carrierName || carrier,
      serviceType: shipmentData.serviceType || SERVICE_TYPE.STANDARD, status: SHIPMENT_STATUS.BOOKED,
      pickupAddress, deliveryAddress, weight, dimensions, declaredValue, paymentMode,
      trackingUrl: getTrackingUrl(carrier, awbNumber),
      estimatedDelivery: new Date(Date.now() + (shipmentData.estimatedDays || 5) * 24 * 60 * 60 * 1000),
    },
  });

  await prisma.order.update({ where: { id: orderId }, data: { trackingNumber: awbNumber, shippingCarrier: carrier, status: 'SHIPPED' } });

  logger.info('Shipment created', { shipmentId: shipment.id, awbNumber, carrier, orderId });

  const order = await prisma.order.findUnique({ where: { id: orderId }, select: { buyer: { select: { owner: { select: { id: true } } } } } });
  if (order?.buyer?.owner?.id) {
    emitToUser(order.buyer.owner.id, 'order:shipped', { orderId, awbNumber, trackingUrl: shipment.trackingUrl });
  }

  return shipment;
};

const cancelShipment = async (shipmentId, businessId, reason) => {
  const shipment = await prisma.shipment.findFirst({ where: { id: shipmentId, businessId } });
  if (!shipment) throw new NotFoundError('Shipment');
  if ([SHIPMENT_STATUS.DELIVERED, SHIPMENT_STATUS.CANCELLED].includes(shipment.status)) throw new BadRequestError('Cannot cancel this shipment');

  await prisma.shipment.update({ where: { id: shipmentId }, data: { status: SHIPMENT_STATUS.CANCELLED, cancelReason: reason, cancelledAt: new Date() } });
  logger.info('Shipment cancelled', { shipmentId, reason });
  return { success: true };
};

// =============================================================================
// TRACKING
// =============================================================================

const trackShipment = async (awbNumber) => {
  const cacheKey = `tracking:${awbNumber}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const shipment = await prisma.shipment.findFirst({ where: { awbNumber }, include: { order: { select: { orderNumber: true } } } });
  if (!shipment) throw new NotFoundError('Shipment');

  const trackingData = getMockTracking(shipment);

  if (trackingData?.currentStatus && trackingData.currentStatus !== shipment.status) {
    await prisma.shipment.update({ where: { id: shipment.id }, data: { status: trackingData.currentStatus, deliveredAt: trackingData.currentStatus === SHIPMENT_STATUS.DELIVERED ? new Date() : null } });
  }

  const result = {
    awbNumber, carrier: shipment.carrier, carrierName: shipment.carrierName, status: trackingData?.currentStatus || shipment.status,
    estimatedDelivery: shipment.estimatedDelivery, deliveredAt: shipment.deliveredAt, trackingUrl: shipment.trackingUrl, events: trackingData?.events || [], order: shipment.order,
  };

  await cache.set(cacheKey, result, CACHE_TTL.TRACKING);
  return result;
};

const getMockTracking = (shipment) => {
  const events = [{ status: 'Shipment created', location: shipment.pickupAddress?.city || 'Origin', timestamp: shipment.createdAt }];

  if (shipment.status !== SHIPMENT_STATUS.BOOKED) {
    events.push({ status: 'Package picked up', location: shipment.pickupAddress?.city || 'Origin', timestamp: new Date(new Date(shipment.createdAt).getTime() + 12 * 60 * 60 * 1000) });
  }

  if ([SHIPMENT_STATUS.IN_TRANSIT, SHIPMENT_STATUS.OUT_FOR_DELIVERY, SHIPMENT_STATUS.DELIVERED].includes(shipment.status)) {
    events.push({ status: 'In transit', location: 'Hub', timestamp: new Date(new Date(shipment.createdAt).getTime() + 24 * 60 * 60 * 1000) });
  }

  if (shipment.status === SHIPMENT_STATUS.DELIVERED) {
    events.push({ status: 'Delivered', location: shipment.deliveryAddress?.city || 'Destination', timestamp: shipment.deliveredAt || new Date() });
  }

  return { currentStatus: shipment.status, events: events.reverse() };
};

// =============================================================================
// SERVICEABILITY
// =============================================================================

const checkServiceability = async (originPincode, destinationPincode) => {
  const cacheKey = `serviceable:${originPincode}:${destinationPincode}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const result = { serviceable: true, originPincode, destinationPincode, availableCarriers: ['Express Delivery', 'Standard Shipping', 'Economy Shipping'], codAvailable: true };
  await cache.set(cacheKey, result, CACHE_TTL.SERVICEABILITY);
  return result;
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  CARRIERS, SHIPMENT_STATUS, SERVICE_TYPE,
  getRates, calculateVolumetricWeight, getChargeableWeight,
  createShipment, cancelShipment, trackShipment, getTrackingUrl, checkServiceability,
};
