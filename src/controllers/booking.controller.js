// =============================================================================
// AIRAVAT B2B MARKETPLACE - BOOKING CONTROLLER
// Handles API requests for Warehouse & Resource Bookings
// =============================================================================

const BookingService = require('../services/booking.service');
const { responseHelpers } = require('../utils/apiResponse');

/**
 * Create a new warehouse reservation
 */
exports.createReservation = async (req, res, next) => {
  try {
    const businessId = req.business.id;
    const result = await BookingService.createReservation(businessId, req.body);
    res.status(201).json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * Confirm a reservation after successful payment
 */
exports.confirmReservation = async (req, res, next) => {
  try {
    const { reservationId, paymentId } = req.body;
    const result = await BookingService.confirmReservation(reservationId, paymentId);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};

/**
 * Get all reservations for the current business
 */
exports.getMyReservations = async (req, res, next) => {
  try {
    const businessId = req.business.id;
    const result = await BookingService.getBusinessReservations(businessId, req.query);
    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
};
