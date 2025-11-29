// =============================================================================
// AIRAVAT B2B MARKETPLACE - SUBSCRIPTION CONTROLLER
// Handles subscription plans and billing endpoints
// =============================================================================

const subscriptionPlanService = require('../services/subscriptionPlan.service');
const asyncHandler = require('../middleware/async.middleware');

// =============================================================================
// PLAN ENDPOINTS
// =============================================================================

/**
 * Get all subscription plans
 * @route GET /api/v1/subscriptions/plans
 */
const getPlans = asyncHandler(async (req, res) => {
  const plans = subscriptionPlanService.getPlans();

  res.json({
    success: true,
    data: plans,
  });
});

/**
 * Get a specific plan
 * @route GET /api/v1/subscriptions/plans/:planId
 */
const getPlan = asyncHandler(async (req, res) => {
  const plan = subscriptionPlanService.getPlan(req.params.planId);

  res.json({
    success: true,
    data: plan,
  });
});

// =============================================================================
// SUBSCRIPTION MANAGEMENT
// =============================================================================

/**
 * Get current subscription
 * @route GET /api/v1/subscriptions/current
 */
const getCurrentSubscription = asyncHandler(async (req, res) => {
  const subscription = await subscriptionPlanService.getSubscription(
    req.user.businessId
  );

  res.json({
    success: true,
    data: subscription,
  });
});

/**
 * Subscribe to a plan
 * @route POST /api/v1/subscriptions
 */
const subscribe = asyncHandler(async (req, res) => {
  const subscription = await subscriptionPlanService.subscribe(
    req.user.businessId,
    req.body
  );

  res.status(201).json({
    success: true,
    message: subscription.isTrial 
      ? 'Trial started successfully' 
      : 'Subscription activated successfully',
    data: subscription,
  });
});

/**
 * Upgrade subscription
 * @route POST /api/v1/subscriptions/upgrade
 */
const upgradePlan = asyncHandler(async (req, res) => {
  const subscription = await subscriptionPlanService.upgradePlan(
    req.user.businessId,
    req.body.planId
  );

  res.json({
    success: true,
    message: 'Plan upgraded successfully',
    data: subscription,
  });
});

/**
 * Downgrade subscription
 * @route POST /api/v1/subscriptions/downgrade
 */
const downgradePlan = asyncHandler(async (req, res) => {
  const result = await subscriptionPlanService.downgradePlan(
    req.user.businessId,
    req.body.planId
  );

  res.json({
    success: true,
    message: result.message,
    data: result,
  });
});

/**
 * Cancel subscription
 * @route POST /api/v1/subscriptions/cancel
 */
const cancelSubscription = asyncHandler(async (req, res) => {
  const result = await subscriptionPlanService.cancelSubscription(
    req.user.businessId,
    req.body
  );

  res.json({
    success: true,
    message: result.message,
    data: result,
  });
});

// =============================================================================
// FEATURE ACCESS
// =============================================================================

/**
 * Check feature access
 * @route GET /api/v1/subscriptions/features/:featureKey
 */
const checkFeatureAccess = asyncHandler(async (req, res) => {
  const access = await subscriptionPlanService.checkFeatureAccess(
    req.user.businessId,
    req.params.featureKey
  );

  res.json({
    success: true,
    data: access,
  });
});

/**
 * Check usage limit
 * @route GET /api/v1/subscriptions/usage/:featureKey
 */
const checkUsageLimit = asyncHandler(async (req, res) => {
  const usage = await subscriptionPlanService.checkUsageLimit(
    req.user.businessId,
    req.params.featureKey,
    parseInt(req.query.currentUsage) || 0
  );

  res.json({
    success: true,
    data: usage,
  });
});

// =============================================================================
// BILLING
// =============================================================================

/**
 * Get billing history
 * @route GET /api/v1/subscriptions/billing
 */
const getBillingHistory = asyncHandler(async (req, res) => {
  const result = await subscriptionPlanService.getBillingHistory(
    req.user.businessId,
    req.query
  );

  res.json({
    success: true,
    data: result.records,
    pagination: result.pagination,
  });
});

/**
 * Compare plans
 * @route GET /api/v1/subscriptions/compare
 */
const comparePlans = asyncHandler(async (req, res) => {
  const plans = subscriptionPlanService.getPlans();
  
  // Get all unique features
  const allFeatures = new Set();
  plans.forEach((plan) => {
    plan.featuresList.forEach((f) => allFeatures.add(f.key));
  });

  // Create comparison matrix
  const comparison = Array.from(allFeatures).map((featureKey) => {
    const feature = { key: featureKey };
    plans.forEach((plan) => {
      const planFeature = plan.featuresList.find((f) => f.key === featureKey);
      feature[plan.id] = planFeature?.value || '✗';
    });
    return feature;
  });

  res.json({
    success: true,
    data: {
      plans: plans.map((p) => ({
        id: p.id,
        name: p.name,
        monthlyPrice: p.monthlyPrice,
        annualPrice: p.annualPrice,
        popular: p.popular,
      })),
      comparison,
    },
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  getPlans,
  getPlan,
  getCurrentSubscription,
  subscribe,
  upgradePlan,
  downgradePlan,
  cancelSubscription,
  checkFeatureAccess,
  checkUsageLimit,
  getBillingHistory,
  comparePlans,
};
