// =============================================================================
// AIRAVAT B2B MARKETPLACE - BOOKING SERVICE
// Handles Warehouse Space Reservations & Advanced Bookings
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const { generateId } = require('../utils/helpers');

/**
 * Calculate total price for a reservation
 */
const calculatePrice = (quantity, pricePerUnit, startDate, endDate) => {
  const start = new Date(startDate);
  const end = new Date(endDate);
  const diffTime = Math.abs(end - start);
  const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)) || 1;
  return quantity * pricePerUnit * diffDays;
};

/**
 * Create a new warehouse reservation
 */
const createReservation = async (businessId, bookingData) => {
  const { warehouseId, startDate, endDate, quantity, spaceType, pricePerUnit, notes } = bookingData;

  // 1. Verify Warehouse existence
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new NotFoundError('Warehouse');

  // 2. Business logic: Check if warehouse has enough capacity (Basic check for now)
  if (warehouse.capacity && quantity > warehouse.capacity) {
    throw new BadRequestError(`Requested quantity exceeds total warehouse capacity of ${warehouse.capacity}`);
  }

  // 3. Logic: Check for overlapping bookings (Advanced Capacity Management)
  // This would typically involve summing up existing confirmed bookings for that date range

  const totalPrice = calculatePrice(quantity, pricePerUnit, startDate, endDate);
  const reservationNo = `WHR-${Date.now().toString(36).toUpperCase()}`;

  const reservation = await prisma.warehouseReservation.create({
    data: {
      businessId,
      warehouseId,
      reservationNo,
      startDate: new Date(startDate),
      endDate: new Date(endDate),
      spaceType: spaceType || 'CBM',
      quantity,
      pricePerUnit,
      totalPrice,
      currency: bookingData.currency || 'AED',
      status: 'PENDING',
      notes
    }
  });

  logger.info('Warehouse reservation created', { reservationId: reservation.id, reservationNo });
  return reservation;
};

/**
 * Confirm a reservation after payment
 */
const confirmReservation = async (reservationId, paymentId) => {
  const reservation = await prisma.warehouseReservation.findUnique({ where: { id: reservationId } });
  if (!reservation) throw new NotFoundError('Reservation');

  const updated = await prisma.warehouseReservation.update({
    where: { id: reservationId },
    data: {
      status: 'CONFIRMED',
      paymentId,
      paymentStatus: 'PAID'
    }
  });

  logger.info('Warehouse reservation confirmed', { reservationId, paymentId });
  return updated;
};

/**
 * Get reservations for a business
 */
const getBusinessReservations = async (businessId, options = {}) => {
  const { page = 1, limit = 20, status } = options;
  const skip = (page - 1) * limit;
  const where = { businessId };
  if (status) where.status = status;

  const [reservations, total] = await Promise.all([
    prisma.warehouseReservation.findMany({
      where,
      include: { warehouse: { select: { name: true, city: true, code: true } } },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' }
    }),
    prisma.warehouseReservation.count({ where })
  ]);

  return { reservations, pagination: { page, limit, total } };
};

module.exports = {
  createReservation,
  confirmReservation,
  getBusinessReservations
};
