// =============================================================================
// AIRAVAT B2B MARKETPLACE - ORDER CONTROLLER
// =============================================================================

const orderService = require('../services/order.service');
const paymentService = require('../services/payment.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ForbiddenError, OrderStateError } = require('../utils/errors');

/**
 * Get my orders (as buyer)
 * GET /api/v1/orders/my-orders
 */
exports.getMyOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, dateFrom, dateTo, sort } = req.query;
  
  const { orders, total } = await orderService.getBuyerOrders(req.business.id, {
    skip,
    limit,
    status,
    dateFrom,
    dateTo,
    sort,
  });
  
  paginated(res, orders, { page, limit, total });
});

/**
 * Get orders (as seller)
 * GET /api/v1/orders/seller/orders
 */
exports.getSellerOrders = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, dateFrom, dateTo, sort } = req.query;
  
  const { orders, total } = await orderService.getSellerOrders(req.business.id, {
    skip,
    limit,
    status,
    dateFrom,
    dateTo,
    sort,
  });
  
  paginated(res, orders, { page, limit, total });
});

/**
 * Get seller order stats
 * GET /api/v1/orders/seller/stats
 */
exports.getSellerStats = asyncHandler(async (req, res) => {
  const { period = 'last30days' } = req.query;
  
  const stats = await orderService.getSellerStats(req.business.id, period);
  
  success(res, { stats });
});

/**
 * Get order by ID
 * GET /api/v1/orders/:orderId
 */
exports.getById = asyncHandler(async (req, res) => {
  const order = await orderService.getById(req.params.orderId, {
    includeItems: true,
    includePayments: true,
    includeShipments: true,
  });
  
  if (!order) {
    throw new NotFoundError('Order');
  }
  
  // Check access
  if (order.buyerId !== req.business.id && order.sellerId !== req.business.id) {
    throw new ForbiddenError('You do not have access to this order');
  }
  
  success(res, { order });
});

/**
 * Create order
 * POST /api/v1/orders
 */
exports.create = asyncHandler(async (req, res) => {
  const {
    sellerId,
    items,
    shippingAddressId,
    billingAddressId,
    paymentMethod,
    note,
  } = req.body;
  
  const order = await orderService.create({
    buyerId: req.business.id,
    sellerId,
    items,
    shippingAddressId,
    billingAddressId,
    paymentMethod,
    buyerNote: note,
  });
  
  // Create payment if needed
  let paymentData = null;
  if (paymentMethod !== 'COD' && paymentMethod !== 'CREDIT_LINE') {
    paymentData = await paymentService.createPayment(order.id, order.totalAmount, paymentMethod);
  }
  
  created(res, { order, payment: paymentData }, 'Order created successfully');
});

/**
 * Create order from quotation
 * POST /api/v1/orders/from-quotation/:quotationId
 */
exports.createFromQuotation = asyncHandler(async (req, res) => {
  const { shippingAddressId, billingAddressId, paymentMethod } = req.body;
  
  const order = await orderService.createFromQuotation(req.params.quotationId, {
    buyerId: req.business.id,
    shippingAddressId,
    billingAddressId,
    paymentMethod,
  });
  
  let paymentData = null;
  if (paymentMethod !== 'COD' && paymentMethod !== 'CREDIT_LINE') {
    paymentData = await paymentService.createPayment(order.id, order.totalAmount, paymentMethod);
  }
  
  created(res, { order, payment: paymentData }, 'Order created from quotation');
});

/**
 * Cancel order (buyer)
 * POST /api/v1/orders/:orderId/cancel
 */
exports.cancel = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.buyerId !== req.business.id) {
    throw new ForbiddenError('You can only cancel your own orders');
  }
  
  // Check if cancellable
  const cancellableStatuses = ['PENDING_PAYMENT', 'PAID', 'CONFIRMED'];
  if (!cancellableStatuses.includes(order.status)) {
    throw new OrderStateError(order.status, 'cancel');
  }
  
  const updatedOrder = await orderService.cancel(order.id, reason, 'buyer');
  
  success(res, { order: updatedOrder }, 'Order cancelled successfully');
});

/**
 * Confirm order (seller)
 * POST /api/v1/orders/:orderId/confirm
 */
exports.confirm = asyncHandler(async (req, res) => {
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.sellerId !== req.business.id) {
    throw new ForbiddenError('You can only confirm orders for your business');
  }
  
  if (order.status !== 'PAID') {
    throw new OrderStateError(order.status, 'confirm');
  }
  
  const updatedOrder = await orderService.confirm(order.id);
  
  success(res, { order: updatedOrder }, 'Order confirmed');
});

/**
 * Reject order (seller)
 * POST /api/v1/orders/:orderId/reject
 */
exports.reject = asyncHandler(async (req, res) => {
  const { reason } = req.body;
  
  if (!reason) {
    throw new BadRequestError('Rejection reason is required');
  }
  
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.sellerId !== req.business.id) {
    throw new ForbiddenError('You can only reject orders for your business');
  }
  
  if (order.status !== 'PAID') {
    throw new OrderStateError(order.status, 'reject');
  }
  
  const updatedOrder = await orderService.reject(order.id, reason);
  
  success(res, { order: updatedOrder }, 'Order rejected');
});

/**
 * Update order status
 * PATCH /api/v1/orders/:orderId/status
 */
exports.updateStatus = asyncHandler(async (req, res) => {
  const { status, note } = req.body;
  
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.sellerId !== req.business.id) {
    throw new ForbiddenError('You can only update orders for your business');
  }
  
  const updatedOrder = await orderService.updateStatus(order.id, status, note);
  
  success(res, { order: updatedOrder }, 'Order status updated');
});

/**
 * Mark order as ready to ship
 * POST /api/v1/orders/:orderId/ready-to-ship
 */
exports.markReadyToShip = asyncHandler(async (req, res) => {
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const updatedOrder = await orderService.markReadyToShip(order.id);
  
  success(res, { order: updatedOrder }, 'Order marked as ready to ship');
});

/**
 * Create shipment
 * POST /api/v1/orders/:orderId/shipment
 */
exports.createShipment = asyncHandler(async (req, res) => {
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const shipment = await orderService.createShipment(order.id, req.body);
  
  created(res, { shipment }, 'Shipment created');
});

/**
 * Update shipment
 * PATCH /api/v1/orders/:orderId/shipment/:shipmentId
 */
exports.updateShipment = asyncHandler(async (req, res) => {
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const shipment = await orderService.updateShipment(req.params.shipmentId, req.body);
  
  success(res, { shipment }, 'Shipment updated');
});

/**
 * Mark order as shipped
 * POST /api/v1/orders/:orderId/ship
 */
exports.markShipped = asyncHandler(async (req, res) => {
  const { awbNumber, courierName, trackingUrl } = req.body;
  
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const updatedOrder = await orderService.markShipped(order.id, {
    awbNumber,
    courierName,
    trackingUrl,
  });
  
  success(res, { order: updatedOrder }, 'Order marked as shipped');
});

/**
 * Mark order as delivered
 * POST /api/v1/orders/:orderId/deliver
 */
exports.markDelivered = asyncHandler(async (req, res) => {
  const { podImage, receiverName } = req.body;
  
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const updatedOrder = await orderService.markDelivered(order.id, {
    podImage,
    receiverName,
  });
  
  success(res, { order: updatedOrder }, 'Order marked as delivered');
});

/**
 * Confirm delivery (buyer)
 * POST /api/v1/orders/:orderId/confirm-delivery
 */
exports.confirmDelivery = asyncHandler(async (req, res) => {
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const updatedOrder = await orderService.confirmDelivery(order.id);
  
  success(res, { order: updatedOrder }, 'Delivery confirmed');
});

/**
 * Request refund
 * POST /api/v1/orders/:orderId/refund
 */
exports.requestRefund = asyncHandler(async (req, res) => {
  const { reason, items } = req.body;
  
  if (!reason) {
    throw new BadRequestError('Refund reason is required');
  }
  
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.buyerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const refundRequest = await orderService.requestRefund(order.id, { reason, items });
  
  success(res, { refundRequest }, 'Refund request submitted');
});

/**
 * Get invoice
 * GET /api/v1/orders/:orderId/invoice
 */
exports.getInvoice = asyncHandler(async (req, res) => {
  const order = await orderService.getById(req.params.orderId);
  
  if (!order) {
    throw new NotFoundError('Order');
  }
  
  if (order.buyerId !== req.business.id && order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  if (!order.invoiceUrl) {
    throw new BadRequestError('Invoice not yet generated');
  }
  
  success(res, { invoiceUrl: order.invoiceUrl, invoiceNumber: order.invoiceNumber });
});

/**
 * Generate invoice
 * POST /api/v1/orders/:orderId/invoice
 */
exports.generateInvoice = asyncHandler(async (req, res) => {
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const invoice = await orderService.generateInvoice(order.id);
  
  success(res, { invoice }, 'Invoice generated');
});

/**
 * Generate E-Invoice (GST)
 * POST /api/v1/orders/:orderId/e-invoice
 */
exports.generateEInvoice = asyncHandler(async (req, res) => {
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const eInvoice = await orderService.generateEInvoice(order.id);
  
  success(res, { eInvoice }, 'E-Invoice generated');
});

/**
 * Generate E-Way Bill
 * POST /api/v1/orders/:orderId/eway-bill
 */
exports.generateEWayBill = asyncHandler(async (req, res) => {
  const { transporterName, transporterId, vehicleNumber, transportMode } = req.body;
  
  const order = await orderService.getById(req.params.orderId);
  
  if (!order || order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const eWayBill = await orderService.generateEWayBill(order.id, {
    transporterName,
    transporterId,
    vehicleNumber,
    transportMode,
  });
  
  success(res, { eWayBill }, 'E-Way Bill generated');
});

/**
 * Get order timeline
 * GET /api/v1/orders/:orderId/timeline
 */
exports.getTimeline = asyncHandler(async (req, res) => {
  const order = await orderService.getById(req.params.orderId);
  
  if (!order) {
    throw new NotFoundError('Order');
  }
  
  if (order.buyerId !== req.business.id && order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const timeline = await orderService.getTimeline(order.id);
  
  success(res, { timeline });
});

/**
 * Add note to order
 * POST /api/v1/orders/:orderId/notes
 */
exports.addNote = asyncHandler(async (req, res) => {
  const { note, isInternal } = req.body;
  
  if (!note) {
    throw new BadRequestError('Note is required');
  }
  
  const order = await orderService.getById(req.params.orderId);
  
  if (!order) {
    throw new NotFoundError('Order');
  }
  
  if (order.buyerId !== req.business.id && order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  await orderService.addNote(order.id, {
    note,
    isInternal,
    addedBy: req.user.id,
    businessId: req.business.id,
  });
  
  success(res, null, 'Note added');
});

/**
 * Open dispute
 * POST /api/v1/orders/:orderId/dispute
 */
exports.openDispute = asyncHandler(async (req, res) => {
  const { type, reason, description, evidence } = req.body;
  
  if (!type || !reason) {
    throw new BadRequestError('Dispute type and reason are required');
  }
  
  const order = await orderService.getById(req.params.orderId);
  
  if (!order) {
    throw new NotFoundError('Order');
  }
  
  if (order.buyerId !== req.business.id && order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const dispute = await orderService.openDispute(order.id, {
    type,
    reason,
    description,
    evidence,
    raisedById: req.business.id,
  });
  
  created(res, { dispute }, 'Dispute opened');
});

/**
 * Get dispute details
 * GET /api/v1/orders/:orderId/dispute
 */
exports.getDispute = asyncHandler(async (req, res) => {
  const order = await orderService.getById(req.params.orderId);
  
  if (!order) {
    throw new NotFoundError('Order');
  }
  
  if (order.buyerId !== req.business.id && order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const dispute = await orderService.getDispute(order.id);
  
  success(res, { dispute });
});

/**
 * Add dispute message
 * POST /api/v1/orders/:orderId/dispute/message
 */
exports.addDisputeMessage = asyncHandler(async (req, res) => {
  const { content, attachments } = req.body;
  
  if (!content) {
    throw new BadRequestError('Message content is required');
  }
  
  const order = await orderService.getById(req.params.orderId);
  
  if (!order) {
    throw new NotFoundError('Order');
  }
  
  if (order.buyerId !== req.business.id && order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const message = await orderService.addDisputeMessage(order.id, {
    content,
    attachments,
    senderId: req.user.id,
    senderType: order.buyerId === req.business.id ? 'buyer' : 'seller',
  });
  
  created(res, { message }, 'Message added');
});

/**
 * Get shipping rates
 * POST /api/v1/orders/shipping/rates
 */
exports.getShippingRates = asyncHandler(async (req, res) => {
  const { pickupPincode, deliveryPincode, weight, dimensions, cod } = req.body;
  
  if (!pickupPincode || !deliveryPincode || !weight) {
    throw new BadRequestError('Pickup pincode, delivery pincode, and weight are required');
  }
  
  const rates = await orderService.getShippingRates({
    pickupPincode,
    deliveryPincode,
    weight,
    dimensions,
    cod: cod || false,
  });
  
  success(res, { rates });
});

/**
 * Track shipment
 * GET /api/v1/orders/:orderId/track
 */
exports.trackShipment = asyncHandler(async (req, res) => {
  const order = await orderService.getById(req.params.orderId);
  
  if (!order) {
    throw new NotFoundError('Order');
  }
  
  if (order.buyerId !== req.business.id && order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  const tracking = await orderService.trackShipment(order.id);
  
  success(res, { tracking });
});
