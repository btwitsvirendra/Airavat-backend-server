// =============================================================================
// AIRAVAT B2B MARKETPLACE - FLASH DEAL ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const flashDealController = require('../controllers/flashDeal.controller');
const { protect } = require('../middleware/auth.middleware');

// Public routes
router.get('/active', flashDealController.getActiveDeals);
router.get('/upcoming', flashDealController.getUpcomingDeals);
router.get('/:dealId', flashDealController.getDeal);

// Protected routes
router.use(protect);
router.post('/', flashDealController.createDeal);
router.put('/:dealId', flashDealController.updateDeal);
router.post('/:dealId/cancel', flashDealController.cancelDeal);
router.post('/:dealId/reserve', flashDealController.reserveStock);
router.get('/seller/deals', flashDealController.getSellerDeals);
router.get('/seller/:dealId/analytics', flashDealController.getDealAnalytics);

module.exports = router;

