// =============================================================================
// AIRAVAT B2B MARKETPLACE - CREDIT LINE CONTROLLER
// =============================================================================

const CreditLineService = require('../services/creditLine.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Apply for credit
exports.applyForCredit = asyncHandler(async (req, res) => {
  const result = await CreditLineService.applyForCredit(req.user.businessId, req.user.id, req.body);
  res.status(201).json({ success: true, data: result });
});

// Get credit line
exports.getCreditLine = asyncHandler(async (req, res) => {
  const result = await CreditLineService.getCreditLine(req.user.businessId);
  res.json({ success: true, data: result });
});

// Make payment
exports.makePayment = asyncHandler(async (req, res) => {
  const { amount, paymentMethod } = req.body;
  const result = await CreditLineService.makePayment(req.user.businessId, amount, paymentMethod);
  res.json({ success: true, data: result });
});

// Get statement
exports.getStatement = asyncHandler(async (req, res) => {
  const { month, year } = req.query;
  const result = await CreditLineService.getStatement(req.user.businessId, parseInt(month), parseInt(year));
  res.json({ success: true, data: result });
});

// Get transactions
exports.getTransactions = asyncHandler(async (req, res) => {
  const result = await CreditLineService.getTransactions(req.user.businessId, req.query);
  res.json({ success: true, data: result });
});

