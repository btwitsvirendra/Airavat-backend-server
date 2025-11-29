// =============================================================================
// AIRAVAT B2B MARKETPLACE - PAYMENT CONTROLLER
// =============================================================================

const paymentService = require('../services/payment.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

/**
 * Create payment for order
 * POST /api/v1/payments/create
 */
exports.createPayment = asyncHandler(async (req, res) => {
  const { orderId, amount, method } = req.body;
  
  if (!orderId || !amount) {
    throw new BadRequestError('Order ID and amount are required');
  }
  
  const payment = await paymentService.createPayment(orderId, amount, method);
  
  created(res, { payment }, 'Payment initiated');
});

/**
 * Verify payment (Razorpay callback)
 * POST /api/v1/payments/verify
 */
exports.verifyPayment = asyncHandler(async (req, res) => {
  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = req.body;
  
  if (!razorpay_order_id || !razorpay_payment_id || !razorpay_signature) {
    throw new BadRequestError('Payment verification data is incomplete');
  }
  
  const result = await paymentService.verifyPayment({
    razorpayOrderId: razorpay_order_id,
    razorpayPaymentId: razorpay_payment_id,
    razorpaySignature: razorpay_signature,
  });
  
  success(res, result, 'Payment verified');
});

/**
 * Get payment details
 * GET /api/v1/payments/:paymentId
 */
exports.getPayment = asyncHandler(async (req, res) => {
  const payment = await paymentService.getPaymentById(req.params.paymentId);
  
  if (!payment) {
    throw new NotFoundError('Payment');
  }
  
  // Verify access
  const order = await paymentService.getOrderByPaymentId(payment.id);
  if (order.buyerId !== req.business.id && order.sellerId !== req.business.id) {
    throw new ForbiddenError('Access denied');
  }
  
  success(res, { payment });
});

/**
 * Get payment history
 * GET /api/v1/payments
 */
exports.getPaymentHistory = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { type, status, dateFrom, dateTo } = req.query;
  
  const { payments, total } = await paymentService.getPaymentHistory(req.business.id, {
    skip,
    limit,
    type,
    status,
    dateFrom,
    dateTo,
  });
  
  paginated(res, payments, { page, limit, total });
});

/**
 * Create UPI payment
 * POST /api/v1/payments/upi/create
 */
exports.createUPIPayment = asyncHandler(async (req, res) => {
  const { orderId, amount, vpa } = req.body;
  
  if (!orderId || !amount) {
    throw new BadRequestError('Order ID and amount are required');
  }
  
  const payment = await paymentService.createUPIPayment(orderId, amount, vpa);
  
  created(res, { payment }, 'UPI payment initiated');
});

/**
 * Check UPI payment status
 * GET /api/v1/payments/upi/:paymentId/status
 */
exports.checkUPIStatus = asyncHandler(async (req, res) => {
  const status = await paymentService.checkUPIStatus(req.params.paymentId);
  
  success(res, { status });
});

/**
 * Initiate refund
 * POST /api/v1/payments/:paymentId/refund
 */
exports.initiateRefund = asyncHandler(async (req, res) => {
  const { amount, reason, notes } = req.body;
  
  const payment = await paymentService.getPaymentById(req.params.paymentId);
  if (!payment) {
    throw new NotFoundError('Payment');
  }
  
  const refund = await paymentService.initiateRefund(payment.id, {
    amount,
    reason,
    notes,
    initiatedBy: req.user.id,
  });
  
  created(res, { refund }, 'Refund initiated');
});

/**
 * Get refund status
 * GET /api/v1/payments/:paymentId/refund/:refundId
 */
exports.getRefundStatus = asyncHandler(async (req, res) => {
  const refund = await paymentService.getRefundStatus(req.params.refundId);
  
  if (!refund) {
    throw new NotFoundError('Refund');
  }
  
  success(res, { refund });
});

/**
 * Get settlements (seller)
 * GET /api/v1/payments/settlements
 */
exports.getSettlements = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { status, dateFrom, dateTo } = req.query;
  
  const { settlements, total } = await paymentService.getSettlements(req.business.id, {
    skip,
    limit,
    status,
    dateFrom,
    dateTo,
  });
  
  paginated(res, settlements, { page, limit, total });
});

/**
 * Get settlement details
 * GET /api/v1/payments/settlements/:settlementId
 */
exports.getSettlementDetails = asyncHandler(async (req, res) => {
  const settlement = await paymentService.getSettlementById(req.params.settlementId);
  
  if (!settlement || settlement.businessId !== req.business.id) {
    throw new NotFoundError('Settlement');
  }
  
  success(res, { settlement });
});

/**
 * Get pending settlements
 * GET /api/v1/payments/settlements/pending
 */
exports.getPendingSettlements = asyncHandler(async (req, res) => {
  const pending = await paymentService.getPendingSettlements(req.business.id);
  
  success(res, { pending });
});

/**
 * Get wallet balance
 * GET /api/v1/payments/wallet/balance
 */
exports.getWalletBalance = asyncHandler(async (req, res) => {
  const balance = await paymentService.getWalletBalance(req.business.id);
  
  success(res, { balance });
});

/**
 * Get wallet transactions
 * GET /api/v1/payments/wallet/transactions
 */
exports.getWalletTransactions = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { type, dateFrom, dateTo } = req.query;
  
  const { transactions, total } = await paymentService.getWalletTransactions(req.business.id, {
    skip,
    limit,
    type,
    dateFrom,
    dateTo,
  });
  
  paginated(res, transactions, { page, limit, total });
});

/**
 * Add money to wallet
 * POST /api/v1/payments/wallet/add
 */
exports.addToWallet = asyncHandler(async (req, res) => {
  const { amount, method } = req.body;
  
  if (!amount || amount <= 0) {
    throw new BadRequestError('Valid amount is required');
  }
  
  const result = await paymentService.addToWallet(req.business.id, amount, method);
  
  success(res, result, 'Wallet top-up initiated');
});

/**
 * Check credit eligibility
 * GET /api/v1/payments/credit/eligibility
 */
exports.checkCreditEligibility = asyncHandler(async (req, res) => {
  const eligibility = await paymentService.checkCreditEligibility(req.business.id);
  
  success(res, { eligibility });
});

/**
 * Get credit limit
 * GET /api/v1/payments/credit/limit
 */
exports.getCreditLimit = asyncHandler(async (req, res) => {
  const creditLimit = await paymentService.getCreditLimit(req.business.id);
  
  success(res, { creditLimit });
});

/**
 * Get credit usage
 * GET /api/v1/payments/credit/usage
 */
exports.getCreditUsage = asyncHandler(async (req, res) => {
  const usage = await paymentService.getCreditUsage(req.business.id);
  
  success(res, { usage });
});

/**
 * Pay credit invoice
 * POST /api/v1/payments/credit/pay
 */
exports.payCreditInvoice = asyncHandler(async (req, res) => {
  const { invoiceId, amount, method } = req.body;
  
  if (!invoiceId) {
    throw new BadRequestError('Invoice ID is required');
  }
  
  const result = await paymentService.payCreditInvoice(req.business.id, invoiceId, {
    amount,
    method,
  });
  
  success(res, result, 'Payment processed');
});

/**
 * Get saved payment methods
 * GET /api/v1/payments/methods
 */
exports.getPaymentMethods = asyncHandler(async (req, res) => {
  const methods = await paymentService.getPaymentMethods(req.user.id);
  
  success(res, { methods });
});

/**
 * Add payment method
 * POST /api/v1/payments/methods
 */
exports.addPaymentMethod = asyncHandler(async (req, res) => {
  const { type, token, isDefault } = req.body;
  
  if (!type || !token) {
    throw new BadRequestError('Payment method type and token are required');
  }
  
  const method = await paymentService.addPaymentMethod(req.user.id, {
    type,
    token,
    isDefault,
  });
  
  created(res, { method }, 'Payment method added');
});

/**
 * Delete payment method
 * DELETE /api/v1/payments/methods/:methodId
 */
exports.deletePaymentMethod = asyncHandler(async (req, res) => {
  await paymentService.deletePaymentMethod(req.user.id, req.params.methodId);
  
  success(res, null, 'Payment method deleted');
});
