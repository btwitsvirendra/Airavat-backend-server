// =============================================================================
// AIRAVAT B2B MARKETPLACE - WALLET CONTROLLER
// =============================================================================

const WalletService = require('../services/wallet.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Get wallet details
exports.getWallet = asyncHandler(async (req, res) => {
  const wallet = await WalletService.getWalletDetails(req.user.businessId);
  res.json({ success: true, data: wallet });
});

// Initiate deposit
exports.initiateDeposit = asyncHandler(async (req, res) => {
  const { amount, paymentMethod } = req.body;
  const result = await WalletService.initiateDeposit(req.user.businessId, amount, paymentMethod);
  res.json({ success: true, data: result });
});

// Complete deposit
exports.completeDeposit = asyncHandler(async (req, res) => {
  const { transactionId, paymentDetails } = req.body;
  const result = await WalletService.completeDeposit(transactionId, paymentDetails);
  res.json({ success: true, data: result });
});

// Request withdrawal
exports.requestWithdrawal = asyncHandler(async (req, res) => {
  const { amount, bankDetails } = req.body;
  const result = await WalletService.requestWithdrawal(req.user.businessId, amount, bankDetails);
  res.json({ success: true, data: result });
});

// Pay from wallet
exports.payFromWallet = asyncHandler(async (req, res) => {
  const { orderId, amount } = req.body;
  const result = await WalletService.payFromWallet(req.user.businessId, orderId, amount);
  res.json({ success: true, data: result });
});

// Get transactions
exports.getTransactions = asyncHandler(async (req, res) => {
  const result = await WalletService.getTransactions(req.user.businessId, req.query);
  res.json({ success: true, data: result });
});

// Get single transaction
exports.getTransaction = asyncHandler(async (req, res) => {
  const result = await WalletService.getTransaction(req.params.transactionId, req.user.businessId);
  res.json({ success: true, data: result });
});

