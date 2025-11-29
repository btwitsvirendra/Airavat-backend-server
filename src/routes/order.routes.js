// =============================================================================
// AIRAVAT B2B MARKETPLACE - ORDER ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const orderController = require('../controllers/order.controller');
const { authenticate, requireBusiness, requireVerifiedBusiness } = require('../middleware/auth');
const { orderLimiter } = require('../middleware/rateLimiter');
const { validate } = require('../middleware/errorHandler');
const { createOrderSchema } = require('../validators/schemas');

// =============================================================================
// BUYER ROUTES
// =============================================================================

// Get my orders (as buyer)
router.get(
  '/my-orders',
  authenticate,
  requireBusiness,
  orderController.getMyOrders
);

// Get order by ID
router.get(
  '/:orderId',
  authenticate,
  requireBusiness,
  orderController.getById
);

// Create order (from cart or direct)
router.post(
  '/',
  authenticate,
  requireBusiness,
  orderLimiter,
  validate(createOrderSchema),
  orderController.create
);

// Create order from quotation
router.post(
  '/from-quotation/:quotationId',
  authenticate,
  requireBusiness,
  orderLimiter,
  orderController.createFromQuotation
);

// Cancel order (buyer)
router.post(
  '/:orderId/cancel',
  authenticate,
  requireBusiness,
  orderController.cancel
);

// Request refund
router.post(
  '/:orderId/refund',
  authenticate,
  requireBusiness,
  orderController.requestRefund
);

// Confirm delivery
router.post(
  '/:orderId/confirm-delivery',
  authenticate,
  requireBusiness,
  orderController.confirmDelivery
);

// =============================================================================
// SELLER ROUTES
// =============================================================================

// Get orders (as seller)
router.get(
  '/seller/orders',
  authenticate,
  requireBusiness,
  orderController.getSellerOrders
);

// Get order stats (seller)
router.get(
  '/seller/stats',
  authenticate,
  requireBusiness,
  orderController.getSellerStats
);

// Confirm order
router.post(
  '/:orderId/confirm',
  authenticate,
  requireBusiness,
  orderController.confirm
);

// Reject order
router.post(
  '/:orderId/reject',
  authenticate,
  requireBusiness,
  orderController.reject
);

// Update order status
router.patch(
  '/:orderId/status',
  authenticate,
  requireBusiness,
  orderController.updateStatus
);

// Mark as ready to ship
router.post(
  '/:orderId/ready-to-ship',
  authenticate,
  requireBusiness,
  orderController.markReadyToShip
);

// Create shipment
router.post(
  '/:orderId/shipment',
  authenticate,
  requireBusiness,
  orderController.createShipment
);

// Update shipment tracking
router.patch(
  '/:orderId/shipment/:shipmentId',
  authenticate,
  requireBusiness,
  orderController.updateShipment
);

// Mark as shipped
router.post(
  '/:orderId/ship',
  authenticate,
  requireBusiness,
  orderController.markShipped
);

// Mark as delivered
router.post(
  '/:orderId/deliver',
  authenticate,
  requireBusiness,
  orderController.markDelivered
);

// =============================================================================
// ORDER DOCUMENTS
// =============================================================================

// Get invoice
router.get(
  '/:orderId/invoice',
  authenticate,
  requireBusiness,
  orderController.getInvoice
);

// Generate invoice
router.post(
  '/:orderId/invoice',
  authenticate,
  requireBusiness,
  orderController.generateInvoice
);

// Generate E-Invoice (GST)
router.post(
  '/:orderId/e-invoice',
  authenticate,
  requireBusiness,
  requireVerifiedBusiness,
  orderController.generateEInvoice
);

// Generate E-Way Bill
router.post(
  '/:orderId/eway-bill',
  authenticate,
  requireBusiness,
  requireVerifiedBusiness,
  orderController.generateEWayBill
);

// Get order timeline
router.get(
  '/:orderId/timeline',
  authenticate,
  requireBusiness,
  orderController.getTimeline
);

// Add note to order
router.post(
  '/:orderId/notes',
  authenticate,
  requireBusiness,
  orderController.addNote
);

// =============================================================================
// DISPUTES
// =============================================================================

// Open dispute
router.post(
  '/:orderId/dispute',
  authenticate,
  requireBusiness,
  orderController.openDispute
);

// Get dispute details
router.get(
  '/:orderId/dispute',
  authenticate,
  requireBusiness,
  orderController.getDispute
);

// Add dispute message
router.post(
  '/:orderId/dispute/message',
  authenticate,
  requireBusiness,
  orderController.addDisputeMessage
);

// =============================================================================
// SHIPPING
// =============================================================================

// Get shipping rates
router.post(
  '/shipping/rates',
  authenticate,
  requireBusiness,
  orderController.getShippingRates
);

// Track shipment
router.get(
  '/:orderId/track',
  authenticate,
  requireBusiness,
  orderController.trackShipment
);

module.exports = router;
