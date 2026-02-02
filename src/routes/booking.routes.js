// =============================================================================
// AIRAVAT B2B MARKETPLACE - BOOKING ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const BookingController = require('../controllers/booking.controller');
const { authenticate, requireBusiness } = require('../middleware/auth');

// All booking routes require authentication and a business profile
router.use(authenticate);
router.use(requireBusiness);

/**
 * @route   POST /api/v1/bookings/warehouse/reserve
 * @desc    Create a warehouse reservation
 */
router.post('/warehouse/reserve', BookingController.createReservation);

/**
 * @route   POST /api/v1/bookings/warehouse/confirm
 * @desc    Confirm a reservation with payment ID
 */
router.post('/warehouse/confirm', BookingController.confirmReservation);

/**
 * @route   GET /api/v1/bookings/my-reservations
 * @desc    Get all reservations for the logged-in business
 */
router.get('/my-reservations', BookingController.getMyReservations);

module.exports = router;
