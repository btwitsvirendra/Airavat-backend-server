// =============================================================================
// AIRAVAT B2B MARKETPLACE - WALLET ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const walletController = require('../controllers/wallet.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

router.get('/', walletController.getWallet);
router.post('/deposit', walletController.initiateDeposit);
router.post('/deposit/complete', walletController.completeDeposit);
router.post('/withdraw', walletController.requestWithdrawal);
router.post('/pay', walletController.payFromWallet);
router.get('/transactions', walletController.getTransactions);
router.get('/transactions/:transactionId', walletController.getTransaction);

module.exports = router;

