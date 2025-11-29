// =============================================================================
// AIRAVAT B2B MARKETPLACE - BUSINESS INTELLIGENCE CONTROLLER
// Handles analytics, reports, and forecasting endpoints
// =============================================================================

const biService = require('../services/businessIntelligence.service');
const asyncHandler = require('../middleware/async.middleware');

// =============================================================================
// DASHBOARD
// =============================================================================

/**
 * Get executive dashboard
 * @route GET /api/v1/bi/dashboard
 */
const getDashboard = asyncHandler(async (req, res) => {
  const dashboard = await biService.getExecutiveDashboard(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: dashboard,
  });
});

/**
 * Get real-time metrics
 * @route GET /api/v1/bi/realtime
 */
const getRealtime = asyncHandler(async (req, res) => {
  const metrics = await biService.getRealTimeMetrics(req.user.businessId);

  res.json({
    success: true,
    data: metrics,
  });
});

// =============================================================================
// ANALYTICS
// =============================================================================

/**
 * Get cohort analysis
 * @route GET /api/v1/bi/cohort
 */
const getCohortAnalysis = asyncHandler(async (req, res) => {
  const cohort = await biService.getCohortAnalysis(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: cohort,
  });
});

/**
 * Get sales forecast
 * @route GET /api/v1/bi/forecast
 */
const getForecast = asyncHandler(async (req, res) => {
  const forecast = await biService.getSalesForecast(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: forecast,
  });
});

/**
 * Get customer lifetime value
 * @route GET /api/v1/bi/clv
 */
const getCustomerLifetimeValue = asyncHandler(async (req, res) => {
  const clv = await biService.getCustomerLifetimeValue(req.user.businessId);

  res.json({
    success: true,
    data: clv,
  });
});

/**
 * Get churn analysis
 * @route GET /api/v1/bi/churn
 */
const getChurnAnalysis = asyncHandler(async (req, res) => {
  const churn = await biService.getChurnAnalysis(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: churn,
  });
});

/**
 * Generate a report
 * @route POST /api/v1/bi/reports
 */
const generateReport = asyncHandler(async (req, res) => {
  const report = await biService.generateReport(
    req.body.type,
    req.user.businessId,
    req.body
  );

  res.json({
    success: true,
    data: report,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  getDashboard,
  getRealtime,
  getCohortAnalysis,
  getForecast,
  getCustomerLifetimeValue,
  getChurnAnalysis,
  generateReport,
};



