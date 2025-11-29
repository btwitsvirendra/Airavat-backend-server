// =============================================================================
// AIRAVAT B2B MARKETPLACE - SUBSCRIPTION PLAN SERVICE
// Handles subscription tiers, feature gating, and billing
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError, BadRequestError, NotFoundError } = require('../utils/errors');
const Decimal = require('decimal.js');

// =============================================================================
// SUBSCRIPTION PLANS CONFIGURATION
// =============================================================================

/**
 * Subscription plans with features and limits
 */
const SUBSCRIPTION_PLANS = {
  FREE: {
    id: 'free',
    name: 'Free',
    description: 'Get started with basic features',
    monthlyPrice: 0,
    annualPrice: 0,
    currency: 'INR',
    features: {
      // Product limits
      maxProducts: 10,
      maxProductImages: 3,
      maxProductVideos: 0,
      digitalProducts: false,
      
      // Order limits
      maxMonthlyOrders: 20,
      bulkOrders: false,
      orderTemplates: false,
      
      // RFQ & Auctions
      maxActiveRfqs: 2,
      rfqResponseTime: '48h',
      auctions: false,
      reverseAuctions: false,
      
      // Communication
      chatSupport: false,
      whatsappIntegration: false,
      emailNotifications: true,
      
      // Analytics
      basicAnalytics: true,
      advancedAnalytics: false,
      exportReports: false,
      
      // Marketing
      promotedListings: false,
      flashDeals: false,
      coupons: false,
      
      // Business features
      teamMembers: 1,
      apiAccess: false,
      customDomain: false,
      whiteLabel: false,
      
      // Support
      supportLevel: 'EMAIL',
      supportResponseTime: '72h',
      dedicatedManager: false,
      
      // Commission
      commissionDiscount: 0,
    },
    trialDays: 0,
    popular: false,
  },

  STARTER: {
    id: 'starter',
    name: 'Starter',
    description: 'Perfect for small businesses',
    monthlyPrice: 999,
    annualPrice: 9990, // 2 months free
    currency: 'INR',
    features: {
      maxProducts: 50,
      maxProductImages: 5,
      maxProductVideos: 1,
      digitalProducts: false,
      
      maxMonthlyOrders: 100,
      bulkOrders: false,
      orderTemplates: true,
      
      maxActiveRfqs: 10,
      rfqResponseTime: '24h',
      auctions: false,
      reverseAuctions: false,
      
      chatSupport: true,
      whatsappIntegration: false,
      emailNotifications: true,
      
      basicAnalytics: true,
      advancedAnalytics: false,
      exportReports: true,
      
      promotedListings: false,
      flashDeals: false,
      coupons: true,
      
      teamMembers: 3,
      apiAccess: false,
      customDomain: false,
      whiteLabel: false,
      
      supportLevel: 'EMAIL_CHAT',
      supportResponseTime: '24h',
      dedicatedManager: false,
      
      commissionDiscount: 0.5,
    },
    trialDays: 14,
    popular: false,
  },

  GROWTH: {
    id: 'growth',
    name: 'Growth',
    description: 'Scale your business faster',
    monthlyPrice: 2999,
    annualPrice: 29990,
    currency: 'INR',
    features: {
      maxProducts: 500,
      maxProductImages: 10,
      maxProductVideos: 3,
      digitalProducts: true,
      
      maxMonthlyOrders: 500,
      bulkOrders: true,
      orderTemplates: true,
      
      maxActiveRfqs: 50,
      rfqResponseTime: '12h',
      auctions: true,
      reverseAuctions: true,
      
      chatSupport: true,
      whatsappIntegration: true,
      emailNotifications: true,
      
      basicAnalytics: true,
      advancedAnalytics: true,
      exportReports: true,
      
      promotedListings: true,
      flashDeals: true,
      coupons: true,
      
      teamMembers: 10,
      apiAccess: false,
      customDomain: false,
      whiteLabel: false,
      
      supportLevel: 'PRIORITY',
      supportResponseTime: '4h',
      dedicatedManager: false,
      
      commissionDiscount: 1.0,
    },
    trialDays: 14,
    popular: true,
  },

  PROFESSIONAL: {
    id: 'professional',
    name: 'Professional',
    description: 'For established businesses',
    monthlyPrice: 7999,
    annualPrice: 79990,
    currency: 'INR',
    features: {
      maxProducts: 2000,
      maxProductImages: 20,
      maxProductVideos: 10,
      digitalProducts: true,
      
      maxMonthlyOrders: 2000,
      bulkOrders: true,
      orderTemplates: true,
      
      maxActiveRfqs: 200,
      rfqResponseTime: '6h',
      auctions: true,
      reverseAuctions: true,
      
      chatSupport: true,
      whatsappIntegration: true,
      emailNotifications: true,
      
      basicAnalytics: true,
      advancedAnalytics: true,
      exportReports: true,
      
      promotedListings: true,
      flashDeals: true,
      coupons: true,
      
      teamMembers: 25,
      apiAccess: true,
      customDomain: true,
      whiteLabel: false,
      
      supportLevel: 'PRIORITY',
      supportResponseTime: '2h',
      dedicatedManager: true,
      
      commissionDiscount: 1.5,
    },
    trialDays: 14,
    popular: false,
  },

  ENTERPRISE: {
    id: 'enterprise',
    name: 'Enterprise',
    description: 'Custom solutions for large organizations',
    monthlyPrice: null, // Custom pricing
    annualPrice: null,
    currency: 'INR',
    features: {
      maxProducts: -1, // Unlimited
      maxProductImages: -1,
      maxProductVideos: -1,
      digitalProducts: true,
      
      maxMonthlyOrders: -1,
      bulkOrders: true,
      orderTemplates: true,
      
      maxActiveRfqs: -1,
      rfqResponseTime: '1h',
      auctions: true,
      reverseAuctions: true,
      
      chatSupport: true,
      whatsappIntegration: true,
      emailNotifications: true,
      
      basicAnalytics: true,
      advancedAnalytics: true,
      exportReports: true,
      
      promotedListings: true,
      flashDeals: true,
      coupons: true,
      
      teamMembers: -1,
      apiAccess: true,
      customDomain: true,
      whiteLabel: true,
      
      supportLevel: 'DEDICATED',
      supportResponseTime: '1h',
      dedicatedManager: true,
      
      commissionDiscount: 2.0,
    },
    trialDays: 30,
    popular: false,
  },
};

// =============================================================================
// PLAN MANAGEMENT
// =============================================================================

/**
 * Get all available subscription plans
 * @returns {Object[]} Available plans
 */
exports.getPlans = () => {
  return Object.values(SUBSCRIPTION_PLANS).map((plan) => ({
    ...plan,
    // Don't expose internal feature keys to clients
    featuresList: formatFeaturesList(plan.features),
  }));
};

/**
 * Get a specific plan by ID
 * @param {string} planId - Plan ID
 * @returns {Object} Plan details
 */
exports.getPlan = (planId) => {
  const plan = SUBSCRIPTION_PLANS[planId.toUpperCase()];
  if (!plan) {
    throw new NotFoundError(`Plan ${planId} not found`);
  }
  return plan;
};

/**
 * Format features for display
 * @param {Object} features - Plan features
 * @returns {Object[]} Formatted features list
 */
function formatFeaturesList(features) {
  const featureLabels = {
    maxProducts: { label: 'Products', format: (v) => v === -1 ? 'Unlimited' : `Up to ${v}` },
    maxProductImages: { label: 'Images per product', format: (v) => v === -1 ? 'Unlimited' : `${v}` },
    maxProductVideos: { label: 'Videos per product', format: (v) => v === -1 ? 'Unlimited' : `${v}` },
    digitalProducts: { label: 'Digital products', format: (v) => v ? '✓' : '✗' },
    maxMonthlyOrders: { label: 'Monthly orders', format: (v) => v === -1 ? 'Unlimited' : `Up to ${v}` },
    bulkOrders: { label: 'Bulk orders', format: (v) => v ? '✓' : '✗' },
    orderTemplates: { label: 'Order templates', format: (v) => v ? '✓' : '✗' },
    maxActiveRfqs: { label: 'Active RFQs', format: (v) => v === -1 ? 'Unlimited' : `Up to ${v}` },
    auctions: { label: 'Auctions', format: (v) => v ? '✓' : '✗' },
    reverseAuctions: { label: 'Reverse auctions', format: (v) => v ? '✓' : '✗' },
    chatSupport: { label: 'Chat support', format: (v) => v ? '✓' : '✗' },
    whatsappIntegration: { label: 'WhatsApp integration', format: (v) => v ? '✓' : '✗' },
    advancedAnalytics: { label: 'Advanced analytics', format: (v) => v ? '✓' : '✗' },
    exportReports: { label: 'Export reports', format: (v) => v ? '✓' : '✗' },
    promotedListings: { label: 'Promoted listings', format: (v) => v ? '✓' : '✗' },
    flashDeals: { label: 'Flash deals', format: (v) => v ? '✓' : '✗' },
    coupons: { label: 'Coupons', format: (v) => v ? '✓' : '✗' },
    teamMembers: { label: 'Team members', format: (v) => v === -1 ? 'Unlimited' : `${v}` },
    apiAccess: { label: 'API access', format: (v) => v ? '✓' : '✗' },
    customDomain: { label: 'Custom domain', format: (v) => v ? '✓' : '✗' },
    dedicatedManager: { label: 'Dedicated manager', format: (v) => v ? '✓' : '✗' },
    commissionDiscount: { label: 'Commission discount', format: (v) => v > 0 ? `${v}%` : 'None' },
  };

  return Object.entries(features)
    .filter(([key]) => featureLabels[key])
    .map(([key, value]) => ({
      key,
      label: featureLabels[key].label,
      value: featureLabels[key].format(value),
      available: value === true || value > 0 || value === -1,
    }));
}

// =============================================================================
// SUBSCRIPTION MANAGEMENT
// =============================================================================

/**
 * Get business subscription
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Subscription details
 */
exports.getSubscription = async (businessId) => {
  const subscription = await prisma.businessSubscription.findUnique({
    where: { businessId },
    include: {
      business: {
        select: { businessName: true },
      },
    },
  });

  if (!subscription) {
    // Return default free plan
    return {
      businessId,
      planId: 'FREE',
      plan: SUBSCRIPTION_PLANS.FREE,
      status: 'ACTIVE',
      features: SUBSCRIPTION_PLANS.FREE.features,
      isTrial: false,
      isActive: true,
    };
  }

  const plan = SUBSCRIPTION_PLANS[subscription.planId.toUpperCase()] || SUBSCRIPTION_PLANS.FREE;

  return {
    ...subscription,
    plan,
    features: plan.features,
    isActive: subscription.status === 'ACTIVE' || subscription.status === 'TRIAL',
    daysRemaining: calculateDaysRemaining(subscription.currentPeriodEnd),
  };
};

/**
 * Subscribe to a plan
 * @param {string} businessId - Business ID
 * @param {Object} data - Subscription data
 * @returns {Promise<Object>} Subscription
 */
exports.subscribe = async (businessId, data) => {
  try {
    const { planId, billingCycle = 'MONTHLY', paymentMethodId, couponCode } = data;

    const plan = SUBSCRIPTION_PLANS[planId.toUpperCase()];
    if (!plan) {
      throw new NotFoundError(`Plan ${planId} not found`);
    }

    // Check for existing subscription
    const existing = await prisma.businessSubscription.findUnique({
      where: { businessId },
    });

    if (existing && existing.status === 'ACTIVE') {
      throw new BadRequestError('Active subscription exists. Use upgrade/downgrade instead.');
    }

    // Calculate pricing
    const price = billingCycle === 'ANNUAL' ? plan.annualPrice : plan.monthlyPrice;
    let finalPrice = price;
    let discountAmount = 0;

    // Apply coupon if provided
    if (couponCode) {
      const couponResult = await applyCoupon(couponCode, price, planId);
      finalPrice = couponResult.finalPrice;
      discountAmount = couponResult.discount;
    }

    // Calculate period
    const now = new Date();
    const periodEnd = new Date(now);
    if (billingCycle === 'ANNUAL') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    // Check for trial eligibility
    const isTrialEligible = !existing && plan.trialDays > 0;
    const trialEnd = isTrialEligible 
      ? new Date(now.getTime() + plan.trialDays * 24 * 60 * 60 * 1000)
      : null;

    // Create subscription
    const subscription = await prisma.businessSubscription.upsert({
      where: { businessId },
      update: {
        planId: plan.id,
        status: isTrialEligible ? 'TRIAL' : 'ACTIVE',
        billingCycle,
        price: finalPrice,
        currency: plan.currency,
        currentPeriodStart: now,
        currentPeriodEnd: isTrialEligible ? trialEnd : periodEnd,
        trialEnd,
        paymentMethodId,
        couponCode,
        discountAmount,
        metadata: {
          originalPrice: price,
          planName: plan.name,
        },
      },
      create: {
        businessId,
        planId: plan.id,
        status: isTrialEligible ? 'TRIAL' : 'ACTIVE',
        billingCycle,
        price: finalPrice,
        currency: plan.currency,
        currentPeriodStart: now,
        currentPeriodEnd: isTrialEligible ? trialEnd : periodEnd,
        trialEnd,
        paymentMethodId,
        couponCode,
        discountAmount,
        metadata: {
          originalPrice: price,
          planName: plan.name,
        },
      },
    });

    // Create billing record (if not trial)
    if (!isTrialEligible && finalPrice > 0) {
      await createBillingRecord(businessId, subscription, finalPrice);
    }

    logger.info('Subscription created', { businessId, planId, billingCycle, isTrialEligible });

    return {
      ...subscription,
      plan,
      features: plan.features,
      isActive: true,
      isTrial: isTrialEligible,
    };
  } catch (error) {
    logger.error('Subscribe error', { error: error.message, businessId });
    throw error;
  }
};

/**
 * Upgrade subscription
 * @param {string} businessId - Business ID
 * @param {string} newPlanId - New plan ID
 * @returns {Promise<Object>} Updated subscription
 */
exports.upgradePlan = async (businessId, newPlanId) => {
  try {
    const currentSub = await exports.getSubscription(businessId);
    const newPlan = SUBSCRIPTION_PLANS[newPlanId.toUpperCase()];

    if (!newPlan) {
      throw new NotFoundError(`Plan ${newPlanId} not found`);
    }

    const currentPlan = SUBSCRIPTION_PLANS[currentSub.planId?.toUpperCase()] || SUBSCRIPTION_PLANS.FREE;

    // Verify it's an upgrade
    const planOrder = ['FREE', 'STARTER', 'GROWTH', 'PROFESSIONAL', 'ENTERPRISE'];
    const currentIndex = planOrder.indexOf(currentPlan.id.toUpperCase());
    const newIndex = planOrder.indexOf(newPlan.id.toUpperCase());

    if (newIndex <= currentIndex) {
      throw new BadRequestError('New plan must be higher tier. Use downgrade for lower tiers.');
    }

    // Calculate prorated credit
    const daysRemaining = calculateDaysRemaining(currentSub.currentPeriodEnd);
    const dailyRate = currentSub.price / 30;
    const credit = dailyRate * daysRemaining;

    // Calculate new price with credit
    const newPrice = currentSub.billingCycle === 'ANNUAL' 
      ? newPlan.annualPrice 
      : newPlan.monthlyPrice;
    const finalPrice = Math.max(0, newPrice - credit);

    // Update subscription
    const now = new Date();
    const periodEnd = new Date(now);
    if (currentSub.billingCycle === 'ANNUAL') {
      periodEnd.setFullYear(periodEnd.getFullYear() + 1);
    } else {
      periodEnd.setMonth(periodEnd.getMonth() + 1);
    }

    const subscription = await prisma.businessSubscription.update({
      where: { businessId },
      data: {
        planId: newPlan.id,
        status: 'ACTIVE',
        price: newPrice,
        currentPeriodStart: now,
        currentPeriodEnd: periodEnd,
        previousPlanId: currentPlan.id,
        upgradedAt: now,
        metadata: {
          proratedCredit: credit,
          chargedAmount: finalPrice,
          previousPlan: currentPlan.name,
        },
      },
    });

    // Create billing record for upgrade
    if (finalPrice > 0) {
      await createBillingRecord(businessId, subscription, finalPrice, 'UPGRADE');
    }

    logger.info('Plan upgraded', { businessId, from: currentPlan.id, to: newPlan.id });

    return {
      ...subscription,
      plan: newPlan,
      features: newPlan.features,
      isActive: true,
      proratedCredit: credit,
      chargedAmount: finalPrice,
    };
  } catch (error) {
    logger.error('Upgrade error', { error: error.message, businessId });
    throw error;
  }
};

/**
 * Downgrade subscription (effective at period end)
 * @param {string} businessId - Business ID
 * @param {string} newPlanId - New plan ID
 * @returns {Promise<Object>} Updated subscription
 */
exports.downgradePlan = async (businessId, newPlanId) => {
  try {
    const currentSub = await exports.getSubscription(businessId);
    const newPlan = SUBSCRIPTION_PLANS[newPlanId.toUpperCase()];

    if (!newPlan) {
      throw new NotFoundError(`Plan ${newPlanId} not found`);
    }

    // Schedule downgrade for end of period
    const subscription = await prisma.businessSubscription.update({
      where: { businessId },
      data: {
        scheduledPlanId: newPlan.id,
        scheduledChangeAt: currentSub.currentPeriodEnd,
        metadata: {
          ...currentSub.metadata,
          scheduledDowngrade: newPlan.name,
        },
      },
    });

    logger.info('Downgrade scheduled', { 
      businessId, 
      newPlan: newPlan.id, 
      effectiveDate: currentSub.currentPeriodEnd,
    });

    return {
      ...subscription,
      message: `Downgrade to ${newPlan.name} scheduled for ${currentSub.currentPeriodEnd.toISOString()}`,
      effectiveDate: currentSub.currentPeriodEnd,
    };
  } catch (error) {
    logger.error('Downgrade error', { error: error.message, businessId });
    throw error;
  }
};

/**
 * Cancel subscription
 * @param {string} businessId - Business ID
 * @param {Object} options - Cancellation options
 * @returns {Promise<Object>} Cancelled subscription
 */
exports.cancelSubscription = async (businessId, options = {}) => {
  try {
    const { immediately = false, reason = '', feedback = '' } = options;

    const subscription = await prisma.businessSubscription.findUnique({
      where: { businessId },
    });

    if (!subscription) {
      throw new NotFoundError('No subscription found');
    }

    const updateData = {
      cancelledAt: new Date(),
      cancellationReason: reason,
      cancellationFeedback: feedback,
    };

    if (immediately) {
      updateData.status = 'CANCELLED';
      updateData.currentPeriodEnd = new Date();
    } else {
      updateData.cancelAtPeriodEnd = true;
    }

    const updated = await prisma.businessSubscription.update({
      where: { businessId },
      data: updateData,
    });

    logger.info('Subscription cancelled', { businessId, immediately, reason });

    return {
      ...updated,
      message: immediately 
        ? 'Subscription cancelled immediately'
        : `Subscription will be cancelled on ${subscription.currentPeriodEnd.toISOString()}`,
    };
  } catch (error) {
    logger.error('Cancel subscription error', { error: error.message, businessId });
    throw error;
  }
};

// =============================================================================
// FEATURE GATING
// =============================================================================

/**
 * Check if a business has access to a feature
 * @param {string} businessId - Business ID
 * @param {string} featureKey - Feature key
 * @returns {Promise<Object>} Access result
 */
exports.checkFeatureAccess = async (businessId, featureKey) => {
  const subscription = await exports.getSubscription(businessId);
  
  if (!subscription.isActive) {
    return {
      hasAccess: false,
      reason: 'SUBSCRIPTION_INACTIVE',
      message: 'Your subscription is not active',
      requiredPlans: getPlansWithFeature(featureKey),
    };
  }

  const featureValue = subscription.features[featureKey];

  if (featureValue === undefined) {
    return {
      hasAccess: false,
      reason: 'FEATURE_NOT_FOUND',
      message: 'Feature not found',
    };
  }

  // Boolean feature
  if (typeof featureValue === 'boolean') {
    return {
      hasAccess: featureValue,
      reason: featureValue ? 'ALLOWED' : 'FEATURE_DISABLED',
      message: featureValue ? 'Access granted' : 'Feature not available in your plan',
      requiredPlans: featureValue ? [] : getPlansWithFeature(featureKey),
    };
  }

  // Numeric limit (-1 = unlimited)
  if (typeof featureValue === 'number') {
    return {
      hasAccess: featureValue !== 0,
      limit: featureValue,
      unlimited: featureValue === -1,
      reason: featureValue === 0 ? 'LIMIT_ZERO' : 'ALLOWED',
      message: featureValue === -1 ? 'Unlimited' : `Limit: ${featureValue}`,
    };
  }

  return { hasAccess: true };
};

/**
 * Check usage against limit
 * @param {string} businessId - Business ID
 * @param {string} featureKey - Feature key
 * @param {number} currentUsage - Current usage count
 * @returns {Promise<Object>} Usage result
 */
exports.checkUsageLimit = async (businessId, featureKey, currentUsage = 0) => {
  const access = await exports.checkFeatureAccess(businessId, featureKey);

  if (!access.hasAccess) {
    return {
      ...access,
      withinLimit: false,
    };
  }

  if (access.unlimited) {
    return {
      ...access,
      withinLimit: true,
      currentUsage,
      remaining: Infinity,
    };
  }

  const remaining = access.limit - currentUsage;
  const withinLimit = remaining > 0;

  return {
    ...access,
    withinLimit,
    currentUsage,
    remaining: Math.max(0, remaining),
    percentUsed: ((currentUsage / access.limit) * 100).toFixed(1),
  };
};

/**
 * Get plans that have a specific feature
 * @param {string} featureKey - Feature key
 * @returns {string[]} Plan IDs
 */
function getPlansWithFeature(featureKey) {
  return Object.entries(SUBSCRIPTION_PLANS)
    .filter(([, plan]) => {
      const value = plan.features[featureKey];
      return value === true || value > 0 || value === -1;
    })
    .map(([id]) => id);
}

// =============================================================================
// BILLING
// =============================================================================

/**
 * Create billing record
 * @param {string} businessId - Business ID
 * @param {Object} subscription - Subscription
 * @param {number} amount - Amount
 * @param {string} type - Billing type
 */
async function createBillingRecord(businessId, subscription, amount, type = 'SUBSCRIPTION') {
  await prisma.billingRecord.create({
    data: {
      businessId,
      subscriptionId: subscription.id,
      amount,
      currency: subscription.currency,
      type,
      status: 'PENDING',
      description: `${subscription.planId} - ${subscription.billingCycle}`,
      dueDate: new Date(),
    },
  });
}

/**
 * Get billing history
 * @param {string} businessId - Business ID
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Billing history
 */
exports.getBillingHistory = async (businessId, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const [records, total] = await Promise.all([
    prisma.billingRecord.findMany({
      where: { businessId },
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
    }),
    prisma.billingRecord.count({ where: { businessId } }),
  ]);

  return {
    records,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Apply coupon to subscription
 * @param {string} couponCode - Coupon code
 * @param {number} price - Original price
 * @param {string} planId - Plan ID
 * @returns {Promise<Object>} Coupon result
 */
async function applyCoupon(couponCode, price, planId) {
  const coupon = await prisma.subscriptionCoupon.findFirst({
    where: {
      code: couponCode.toUpperCase(),
      isActive: true,
      OR: [
        { validUntil: null },
        { validUntil: { gte: new Date() } },
      ],
    },
  });

  if (!coupon) {
    throw new BadRequestError('Invalid or expired coupon');
  }

  if (coupon.applicablePlans?.length > 0 && !coupon.applicablePlans.includes(planId)) {
    throw new BadRequestError('Coupon not valid for this plan');
  }

  if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
    throw new BadRequestError('Coupon usage limit reached');
  }

  let discount = 0;
  if (coupon.discountType === 'PERCENTAGE') {
    discount = (price * coupon.discountValue) / 100;
    if (coupon.maxDiscount) {
      discount = Math.min(discount, coupon.maxDiscount);
    }
  } else {
    discount = coupon.discountValue;
  }

  // Increment usage
  await prisma.subscriptionCoupon.update({
    where: { id: coupon.id },
    data: { usageCount: { increment: 1 } },
  });

  return {
    coupon,
    discount,
    finalPrice: Math.max(0, price - discount),
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function calculateDaysRemaining(periodEnd) {
  if (!periodEnd) return 0;
  const now = new Date();
  const end = new Date(periodEnd);
  const diff = end - now;
  return Math.max(0, Math.ceil(diff / (24 * 60 * 60 * 1000)));
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  SUBSCRIPTION_PLANS,
};



