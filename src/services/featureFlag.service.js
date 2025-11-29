// =============================================================================
// AIRAVAT B2B MARKETPLACE - FEATURE FLAGS SERVICE
// Control feature rollouts and A/B testing
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');

class FeatureFlagService {
  constructor() {
    this.cachePrefix = 'feature:';
    this.cacheTTL = 300; // 5 minutes
    
    // Default feature flags
    this.defaultFlags = {
      // Core Features
      'credit_line': { enabled: true, rolloutPercentage: 100 },
      'buy_now_pay_later': { enabled: true, rolloutPercentage: 50 },
      'rfq_system': { enabled: true, rolloutPercentage: 100 },
      'real_time_chat': { enabled: true, rolloutPercentage: 100 },
      
      // India Specific
      'gst_einvoice': { enabled: true, regions: ['IN'] },
      'eway_bill': { enabled: true, regions: ['IN'] },
      'aadhaar_verification': { enabled: true, regions: ['IN'] },
      'upi_payments': { enabled: true, regions: ['IN'] },
      
      // UAE Specific
      'vat_compliance': { enabled: true, regions: ['AE'] },
      'trn_verification': { enabled: true, regions: ['AE'] },
      
      // New Features (Gradual Rollout)
      'ai_recommendations': { enabled: true, rolloutPercentage: 30 },
      'voice_search': { enabled: false, rolloutPercentage: 0 },
      'ar_product_view': { enabled: false, rolloutPercentage: 0 },
      'bulk_order_discount': { enabled: true, rolloutPercentage: 100 },
      'loyalty_program': { enabled: false, rolloutPercentage: 0 },
      
      // Experimental
      'new_checkout_flow': { enabled: false, rolloutPercentage: 10, allowlist: [] },
      'enhanced_search': { enabled: true, rolloutPercentage: 50 },
      'social_sharing': { enabled: true, rolloutPercentage: 100 },
      
      // Maintenance
      'maintenance_mode': { enabled: false },
      'read_only_mode': { enabled: false },
    };
  }

  // ===========================================================================
  // FEATURE FLAG CHECKING
  // ===========================================================================

  /**
   * Check if a feature is enabled for a user
   */
  async isEnabled(featureName, context = {}) {
    try {
      const flag = await this.getFlag(featureName);
      
      if (!flag) {
        logger.warn(`Feature flag not found: ${featureName}`);
        return false;
      }

      // Check if globally disabled
      if (!flag.enabled) {
        return false;
      }

      // Check region restrictions
      if (flag.regions && flag.regions.length > 0) {
        if (!context.region || !flag.regions.includes(context.region)) {
          return false;
        }
      }

      // Check allowlist
      if (flag.allowlist && flag.allowlist.length > 0) {
        if (context.userId && flag.allowlist.includes(context.userId)) {
          return true;
        }
        if (context.businessId && flag.allowlist.includes(context.businessId)) {
          return true;
        }
      }

      // Check blocklist
      if (flag.blocklist && flag.blocklist.length > 0) {
        if (context.userId && flag.blocklist.includes(context.userId)) {
          return false;
        }
        if (context.businessId && flag.blocklist.includes(context.businessId)) {
          return false;
        }
      }

      // Check rollout percentage
      if (flag.rolloutPercentage !== undefined && flag.rolloutPercentage < 100) {
        const hash = this.getConsistentHash(
          featureName,
          context.userId || context.businessId || context.sessionId || Math.random().toString()
        );
        return hash < flag.rolloutPercentage;
      }

      // Check subscription tier
      if (flag.requiredTier) {
        if (!context.subscriptionTier || 
            this.getTierLevel(context.subscriptionTier) < this.getTierLevel(flag.requiredTier)) {
          return false;
        }
      }

      // Check date range
      if (flag.startDate && new Date() < new Date(flag.startDate)) {
        return false;
      }
      if (flag.endDate && new Date() > new Date(flag.endDate)) {
        return false;
      }

      return true;
    } catch (error) {
      logger.error('Feature flag check error', { featureName, error: error.message });
      return false;
    }
  }

  /**
   * Get multiple feature flags at once
   */
  async getEnabledFeatures(context = {}) {
    const flags = await this.getAllFlags();
    const enabled = {};

    for (const [name, flag] of Object.entries(flags)) {
      enabled[name] = await this.isEnabled(name, context);
    }

    return enabled;
  }

  /**
   * Get feature flag details
   */
  async getFlag(featureName) {
    const cacheKey = `${this.cachePrefix}${featureName}`;
    
    // Try cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Try database
    const dbFlag = await prisma.featureFlag.findUnique({
      where: { name: featureName },
    });

    if (dbFlag) {
      await cache.set(cacheKey, JSON.stringify(dbFlag), this.cacheTTL);
      return dbFlag;
    }

    // Fall back to default
    const defaultFlag = this.defaultFlags[featureName];
    if (defaultFlag) {
      return { name: featureName, ...defaultFlag };
    }

    return null;
  }

  /**
   * Get all feature flags
   */
  async getAllFlags() {
    const cacheKey = `${this.cachePrefix}all`;
    
    const cached = await cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Get from database
    const dbFlags = await prisma.featureFlag.findMany();
    
    // Merge with defaults
    const flags = { ...this.defaultFlags };
    dbFlags.forEach(flag => {
      flags[flag.name] = flag;
    });

    await cache.set(cacheKey, JSON.stringify(flags), this.cacheTTL);
    return flags;
  }

  // ===========================================================================
  // FEATURE FLAG MANAGEMENT
  // ===========================================================================

  /**
   * Create or update a feature flag
   */
  async setFlag(featureName, config) {
    const flag = await prisma.featureFlag.upsert({
      where: { name: featureName },
      create: {
        name: featureName,
        enabled: config.enabled ?? true,
        rolloutPercentage: config.rolloutPercentage ?? 100,
        regions: config.regions || [],
        allowlist: config.allowlist || [],
        blocklist: config.blocklist || [],
        requiredTier: config.requiredTier,
        startDate: config.startDate,
        endDate: config.endDate,
        metadata: config.metadata || {},
      },
      update: {
        enabled: config.enabled,
        rolloutPercentage: config.rolloutPercentage,
        regions: config.regions,
        allowlist: config.allowlist,
        blocklist: config.blocklist,
        requiredTier: config.requiredTier,
        startDate: config.startDate,
        endDate: config.endDate,
        metadata: config.metadata,
        updatedAt: new Date(),
      },
    });

    // Clear cache
    await this.clearCache(featureName);

    logger.info('Feature flag updated', { featureName, config });
    return flag;
  }

  /**
   * Enable a feature
   */
  async enableFeature(featureName) {
    return this.setFlag(featureName, { enabled: true });
  }

  /**
   * Disable a feature
   */
  async disableFeature(featureName) {
    return this.setFlag(featureName, { enabled: false });
  }

  /**
   * Set rollout percentage
   */
  async setRolloutPercentage(featureName, percentage) {
    if (percentage < 0 || percentage > 100) {
      throw new Error('Percentage must be between 0 and 100');
    }
    return this.setFlag(featureName, { rolloutPercentage: percentage });
  }

  /**
   * Add users/businesses to allowlist
   */
  async addToAllowlist(featureName, ids) {
    const flag = await this.getFlag(featureName);
    const allowlist = [...new Set([...(flag?.allowlist || []), ...ids])];
    return this.setFlag(featureName, { allowlist });
  }

  /**
   * Remove from allowlist
   */
  async removeFromAllowlist(featureName, ids) {
    const flag = await this.getFlag(featureName);
    const allowlist = (flag?.allowlist || []).filter(id => !ids.includes(id));
    return this.setFlag(featureName, { allowlist });
  }

  /**
   * Delete a feature flag
   */
  async deleteFlag(featureName) {
    await prisma.featureFlag.delete({
      where: { name: featureName },
    });
    await this.clearCache(featureName);
    logger.info('Feature flag deleted', { featureName });
  }

  // ===========================================================================
  // A/B TESTING
  // ===========================================================================

  /**
   * Get A/B test variant for a user
   */
  async getVariant(experimentName, context = {}) {
    const experiment = await this.getFlag(experimentName);
    
    if (!experiment || !experiment.enabled) {
      return 'control';
    }

    const variants = experiment.variants || ['control', 'variant_a'];
    const hash = this.getConsistentHash(
      experimentName,
      context.userId || context.sessionId
    );

    const variantIndex = Math.floor((hash / 100) * variants.length);
    return variants[variantIndex];
  }

  /**
   * Track A/B test conversion
   */
  async trackConversion(experimentName, variant, context = {}) {
    await prisma.experimentConversion.create({
      data: {
        experimentName,
        variant,
        userId: context.userId,
        businessId: context.businessId,
        conversionType: context.type || 'default',
        metadata: context.metadata || {},
      },
    });
  }

  /**
   * Get experiment results
   */
  async getExperimentResults(experimentName) {
    const conversions = await prisma.experimentConversion.groupBy({
      by: ['variant'],
      where: { experimentName },
      _count: true,
    });

    const impressions = await prisma.experimentImpression.groupBy({
      by: ['variant'],
      where: { experimentName },
      _count: true,
    });

    const results = {};
    impressions.forEach(imp => {
      const conv = conversions.find(c => c.variant === imp.variant);
      results[imp.variant] = {
        impressions: imp._count,
        conversions: conv?._count || 0,
        conversionRate: conv ? (conv._count / imp._count * 100).toFixed(2) : 0,
      };
    });

    return results;
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Get consistent hash for rollout
   */
  getConsistentHash(featureName, identifier) {
    const str = `${featureName}:${identifier}`;
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash;
    }
    return Math.abs(hash) % 100;
  }

  /**
   * Get tier level for comparison
   */
  getTierLevel(tier) {
    const levels = { 'free': 0, 'starter': 1, 'professional': 2, 'enterprise': 3 };
    return levels[tier?.toLowerCase()] || 0;
  }

  /**
   * Clear cache for a feature
   */
  async clearCache(featureName) {
    await cache.del(`${this.cachePrefix}${featureName}`);
    await cache.del(`${this.cachePrefix}all`);
  }

  /**
   * Clear all feature flag cache
   */
  async clearAllCache() {
    const keys = await cache.keys(`${this.cachePrefix}*`);
    if (keys.length > 0) {
      await cache.del(...keys);
    }
  }

  // ===========================================================================
  // EXPRESS MIDDLEWARE
  // ===========================================================================

  /**
   * Middleware to attach feature flags to request
   */
  middleware() {
    return async (req, res, next) => {
      const context = {
        userId: req.user?.id,
        businessId: req.user?.businessId,
        sessionId: req.sessionID,
        region: req.user?.country || 'IN',
        subscriptionTier: req.user?.subscriptionTier,
      };

      req.features = {
        isEnabled: (name) => this.isEnabled(name, context),
        getVariant: (name) => this.getVariant(name, context),
      };

      next();
    };
  }

  /**
   * Require feature middleware
   */
  requireFeature(featureName) {
    return async (req, res, next) => {
      const context = {
        userId: req.user?.id,
        businessId: req.user?.businessId,
        region: req.user?.country,
        subscriptionTier: req.user?.subscriptionTier,
      };

      const enabled = await this.isEnabled(featureName, context);
      
      if (!enabled) {
        return res.status(403).json({
          success: false,
          error: 'Feature not available',
          message: `The feature '${featureName}' is not enabled for your account.`,
        });
      }

      next();
    };
  }
}

module.exports = new FeatureFlagService();
