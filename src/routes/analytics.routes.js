// =============================================================================
// AIRAVAT B2B MARKETPLACE - ANALYTICS ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const analyticsController = require('../controllers/analytics.controller');
const { protect } = require('../middleware/auth.middleware');

// Public routes
router.get('/trending', analyticsController.getTrending);
router.get('/best-sellers', analyticsController.getBestSellers);
router.get('/new-arrivals', analyticsController.getNewArrivals);
router.get('/also-bought/:productId', analyticsController.getAlsoBought);
router.get('/frequently-bought-together/:productId', analyticsController.getFrequentlyBoughtTogether);

// Protected routes
router.use(protect);
router.get('/business', analyticsController.getBusinessAnalytics);
router.get('/forecast', analyticsController.getSalesForecast);
router.get('/recommendations', analyticsController.getRecommendations);
router.get('/reorder-suggestions', analyticsController.getReorderSuggestions);

module.exports = router;

