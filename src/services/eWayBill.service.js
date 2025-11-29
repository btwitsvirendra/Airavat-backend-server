// =============================================================================
// AIRAVAT B2B MARKETPLACE - E-WAY BILL SERVICE
// GST E-Way Bill Generation & Management
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const { NotFoundError, BadRequestError, ExternalServiceError } = require('../utils/errors');
const { generateId, formatCurrency } = require('../utils/helpers');
const { emitToBusiness } = require('./socket.service');
const { getStateCode, isInterstate } = require('./eInvoice.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const EWB_STATUS = { GENERATED: 'GENERATED', UPDATED: 'UPDATED', EXTENDED: 'EXTENDED', CANCELLED: 'CANCELLED', EXPIRED: 'EXPIRED' };
const SUPPLY_TYPE = { OUTWARD: 'O', INWARD: 'I' };
const TRANSPORT_MODE = { ROAD: '1', RAIL: '2', AIR: '3', SHIP: '4' };
const VEHICLE_TYPE = { REGULAR: 'R', ODC: 'O' };
const MIN_VALUE_FOR_EWB = 50000;
const CACHE_TTL = { EWB: 300 };

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const calculateValidity = (distance) => {
  const daysValidity = Math.ceil(distance / 100) || 1;
  const validUpto = new Date();
  validUpto.setDate(validUpto.getDate() + daysValidity);
  return validUpto;
};

const estimateDistance = (fromPincode, toPincode) => {
  if (!fromPincode || !toPincode) return 100;
  const diff = Math.abs(parseInt(fromPincode) - parseInt(toPincode));
  return Math.min(Math.max(Math.round(diff / 100), 50), 2000);
};

const isEWBRequired = (invoiceValue) => parseFloat(invoiceValue) >= MIN_VALUE_FOR_EWB;

// =============================================================================
// E-WAY BILL GENERATION
// =============================================================================

const generateEWayBill = async (orderId, vehicleDetails) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: { select: { hsnCode: true, gstRate: true } } } },
      buyer: { include: { addresses: { where: { isDefault: true }, take: 1 } } },
      seller: { include: { addresses: { where: { isDefault: true }, take: 1 } } },
      eInvoice: true,
    },
  });

  if (!order) throw new NotFoundError('Order');

  if (!isEWBRequired(order.totalAmount)) {
    logger.info('E-Way bill not required', { orderId, value: order.totalAmount, threshold: MIN_VALUE_FOR_EWB });
    return { required: false, reason: `Invoice value below ${formatCurrency(MIN_VALUE_FOR_EWB)}` };
  }

  const existing = await prisma.eWayBill.findFirst({
    where: { orderId, status: { notIn: [EWB_STATUS.CANCELLED, EWB_STATUS.EXPIRED] } },
  });
  if (existing) return existing;

  const sellerAddr = order.seller.addresses[0] || {};
  const buyerAddr = order.shippingAddress || order.buyer.addresses[0] || {};
  const distance = vehicleDetails.distance || estimateDistance(sellerAddr.pincode, buyerAddr.pincode);
  const validUpto = calculateValidity(distance);
  const mockEwbNo = `${Date.now()}${Math.floor(Math.random() * 10000)}`;

  const eWayBill = await prisma.eWayBill.create({
    data: {
      orderId, ewbNumber: mockEwbNo, ewbDate: new Date(), validUpto,
      generatedBy: order.seller.gstNumber, supplyType: 'OUTWARD', subSupplyType: 'SUPPLY',
      docType: 'INV', docNumber: order.eInvoice?.invoiceNumber || order.orderNumber, docDate: new Date(),
      fromGstin: order.seller.gstNumber, fromPlace: sellerAddr.city, fromPincode: sellerAddr.pincode, fromState: sellerAddr.state,
      toGstin: order.buyer.gstNumber, toPlace: buyerAddr.city, toPincode: buyerAddr.pincode, toState: buyerAddr.state,
      transMode: vehicleDetails.mode || 'ROAD', transDocNumber: vehicleDetails.lrNumber,
      vehicleNumber: vehicleDetails.vehicleNumber, vehicleType: vehicleDetails.vehicleType || VEHICLE_TYPE.REGULAR,
      transporterId: vehicleDetails.transporterId, transporterName: vehicleDetails.transporterName,
      totalValue: order.totalAmount, distance, status: EWB_STATUS.GENERATED,
    },
  });

  logger.info('E-Way Bill generated', { ewbId: eWayBill.id, ewbNumber: eWayBill.ewbNumber, orderId, distance, validUpto });
  emitToBusiness(order.sellerId, 'ewb:generated', { orderId, ewbNumber: eWayBill.ewbNumber, validUpto });

  return eWayBill;
};

// =============================================================================
// E-WAY BILL MANAGEMENT
// =============================================================================

const updateVehicle = async (ewbNumber, vehicleDetails) => {
  const eWayBill = await prisma.eWayBill.findFirst({ where: { ewbNumber, status: EWB_STATUS.GENERATED } });
  if (!eWayBill) throw new NotFoundError('E-Way Bill');
  if (new Date() > new Date(eWayBill.validUpto)) throw new BadRequestError('E-Way bill has expired');

  await prisma.eWayBill.update({
    where: { id: eWayBill.id },
    data: {
      vehicleNumber: vehicleDetails.vehicleNumber, vehicleType: vehicleDetails.vehicleType,
      transDocNumber: vehicleDetails.lrNumber, transporterId: vehicleDetails.transporterId,
      transporterName: vehicleDetails.transporterName, status: EWB_STATUS.UPDATED,
    },
  });

  logger.info('E-Way Bill vehicle updated', { ewbNumber });
  return { success: true };
};

const extendValidity = async (ewbNumber, reason, remainingDistance) => {
  const eWayBill = await prisma.eWayBill.findFirst({
    where: { ewbNumber, status: { in: [EWB_STATUS.GENERATED, EWB_STATUS.UPDATED] } },
  });
  if (!eWayBill) throw new NotFoundError('E-Way Bill');

  const hoursToExpiry = (new Date(eWayBill.validUpto) - new Date()) / (1000 * 60 * 60);
  if (hoursToExpiry > 8 || hoursToExpiry < -8) throw new BadRequestError('Extension only allowed within 8 hours of expiry');

  const additionalDays = Math.ceil(remainingDistance / 100);
  const newValidity = new Date(eWayBill.validUpto);
  newValidity.setDate(newValidity.getDate() + additionalDays);

  await prisma.eWayBill.update({
    where: { id: eWayBill.id }, data: { validUpto: newValidity, status: EWB_STATUS.EXTENDED },
  });

  logger.info('E-Way Bill extended', { ewbNumber, newValidity });
  return { success: true, newValidity };
};

const cancelEWayBill = async (ewbNumber, reason) => {
  const eWayBill = await prisma.eWayBill.findFirst({ where: { ewbNumber, status: { not: EWB_STATUS.CANCELLED } } });
  if (!eWayBill) throw new NotFoundError('E-Way Bill');

  const hoursSinceGeneration = (Date.now() - new Date(eWayBill.ewbDate).getTime()) / (1000 * 60 * 60);
  if (hoursSinceGeneration > 24) throw new BadRequestError('E-Way bill can only be cancelled within 24 hours');

  await prisma.eWayBill.update({
    where: { id: eWayBill.id }, data: { status: EWB_STATUS.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
  });

  logger.info('E-Way Bill cancelled', { ewbNumber, reason });
  return { success: true };
};

const getEWayBill = async (ewbNumber) => {
  const eWayBill = await prisma.eWayBill.findFirst({
    where: { ewbNumber }, include: { order: { select: { orderNumber: true, totalAmount: true } } },
  });
  if (!eWayBill) throw new NotFoundError('E-Way Bill');

  const now = new Date();
  const validUpto = new Date(eWayBill.validUpto);
  return {
    ...eWayBill, isExpired: now > validUpto,
    hoursRemaining: Math.max(0, (validUpto - now) / (1000 * 60 * 60)),
    formattedTotalValue: formatCurrency(eWayBill.totalValue),
  };
};

const getEWayBills = async (businessId, options = {}) => {
  const { page = 1, limit = 20, status } = options;
  const skip = (page - 1) * limit;
  const where = { order: { OR: [{ buyerId: businessId }, { sellerId: businessId }] } };
  if (status) where.status = status;

  const [bills, total] = await Promise.all([
    prisma.eWayBill.findMany({ where, skip, take: limit, orderBy: { ewbDate: 'desc' }, include: { order: { select: { orderNumber: true } } } }),
    prisma.eWayBill.count({ where }),
  ]);

  const now = new Date();
  return {
    bills: bills.map((b) => ({ ...b, isExpired: now > new Date(b.validUpto), formattedTotalValue: formatCurrency(b.totalValue) })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  EWB_STATUS, SUPPLY_TYPE, TRANSPORT_MODE, VEHICLE_TYPE, MIN_VALUE_FOR_EWB,
  calculateValidity, estimateDistance, isEWBRequired,
  generateEWayBill, updateVehicle, extendValidity, cancelEWayBill, getEWayBill, getEWayBills,
};
