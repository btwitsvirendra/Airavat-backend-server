// =============================================================================
// AIRAVAT B2B MARKETPLACE - CREDIT LINE ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const creditLineController = require('../controllers/creditLine.controller');
const { protect } = require('../middleware/auth.middleware');

router.use(protect);

router.post('/apply', creditLineController.applyForCredit);
router.get('/', creditLineController.getCreditLine);
router.post('/payment', creditLineController.makePayment);
router.get('/statement', creditLineController.getStatement);
router.get('/transactions', creditLineController.getTransactions);

module.exports = router;

