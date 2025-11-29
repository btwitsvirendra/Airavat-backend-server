// =============================================================================
// AIRAVAT B2B MARKETPLACE - COOKIE CONSENT SERVICE
// Service for managing GDPR/CCPA compliant cookie consent
// =============================================================================

const crypto = require('crypto');
const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  consentVersion: '1.0.0',
  cookieMaxAge: 365 * 24 * 60 * 60 * 1000, // 1 year
  consentLogRetention: 3 * 365 * 24 * 60 * 60 * 1000, // 3 years
};

/**
 * Cookie categories and their purposes
 */
const COOKIE_CATEGORIES = {
  necessary: {
    name: 'Strictly Necessary',
    description: 'Essential cookies required for the website to function properly',
    required: true,
    canDisable: false,
    examples: ['session', 'csrf', 'auth'],
  },
  functional: {
    name: 'Functional',
    description: 'Cookies that enhance functionality like preferences and language',
    required: false,
    canDisable: true,
    examples: ['language', 'currency', 'theme'],
  },
  analytics: {
    name: 'Analytics',
    description: 'Cookies that help us understand how visitors use the website',
    required: false,
    canDisable: true,
    examples: ['_ga', '_gid', 'amplitude'],
  },
  marketing: {
    name: 'Marketing',
    description: 'Cookies used to track visitors and show relevant advertisements',
    required: false,
    canDisable: true,
    examples: ['_fbp', 'ads', 'remarketing'],
  },
  thirdParty: {
    name: 'Third-Party',
    description: 'Cookies set by third-party services integrated into the site',
    required: false,
    canDisable: true,
    examples: ['youtube', 'maps', 'social'],
  },
};

// =============================================================================
// CONSENT MANAGEMENT
// =============================================================================

/**
 * Get cookie consent configuration
 * @returns {Object} Cookie consent configuration
 */
exports.getConsentConfig = () => {
  return {
    version: CONFIG.consentVersion,
    categories: COOKIE_CATEGORIES,
    defaults: {
      necessary: true,
      functional: false,
      analytics: false,
      marketing: false,
      thirdParty: false,
    },
    policyUrl: '/privacy-policy',
    cookiePolicyUrl: '/cookie-policy',
  };
};

/**
 * Save user's cookie consent preferences
 * @param {Object} preferences - User's cookie preferences
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Saved consent
 */
exports.saveConsent = async (preferences, context = {}) => {
  try {
    const {
      userId = null,
      sessionId = null,
      ipAddress = null,
      userAgent = null,
    } = context;

    // Validate preferences
    validatePreferences(preferences);

    // Generate consent ID
    const consentId = generateConsentId();

    // Create consent record
    const consent = await prisma.cookieConsent.create({
      data: {
        consentId,
        userId,
        sessionId,
        version: CONFIG.consentVersion,
        preferences: {
          necessary: true, // Always true
          functional: preferences.functional || false,
          analytics: preferences.analytics || false,
          marketing: preferences.marketing || false,
          thirdParty: preferences.thirdParty || false,
        },
        ipAddress,
        userAgent,
        consentedAt: new Date(),
      },
    });

    logger.info('Cookie consent saved', {
      consentId,
      userId,
      preferences: consent.preferences,
    });

    return {
      consentId,
      preferences: consent.preferences,
      expiresAt: new Date(Date.now() + CONFIG.cookieMaxAge),
    };
  } catch (error) {
    logger.error('Save consent error', { error: error.message });
    throw error;
  }
};

/**
 * Update existing consent preferences
 * @param {string} consentId - Existing consent ID
 * @param {Object} preferences - Updated preferences
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Updated consent
 */
exports.updateConsent = async (consentId, preferences, context = {}) => {
  try {
    const existingConsent = await prisma.cookieConsent.findUnique({
      where: { consentId },
    });

    if (!existingConsent) {
      throw new AppError('Consent record not found', 404);
    }

    validatePreferences(preferences);

    // Log the change
    await prisma.consentChangeLog.create({
      data: {
        consentId,
        previousPreferences: existingConsent.preferences,
        newPreferences: preferences,
        changedAt: new Date(),
        ipAddress: context.ipAddress,
      },
    });

    // Update consent
    const updated = await prisma.cookieConsent.update({
      where: { consentId },
      data: {
        preferences: {
          necessary: true,
          functional: preferences.functional || false,
          analytics: preferences.analytics || false,
          marketing: preferences.marketing || false,
          thirdParty: preferences.thirdParty || false,
        },
        updatedAt: new Date(),
      },
    });

    logger.info('Cookie consent updated', { consentId, preferences });

    return {
      consentId,
      preferences: updated.preferences,
    };
  } catch (error) {
    logger.error('Update consent error', { error: error.message, consentId });
    throw error;
  }
};

/**
 * Get user's current consent preferences
 * @param {string} consentId - Consent ID
 * @returns {Promise<Object>} Current preferences
 */
exports.getConsent = async (consentId) => {
  const consent = await prisma.cookieConsent.findUnique({
    where: { consentId },
  });

  if (!consent) {
    return null;
  }

  return {
    consentId: consent.consentId,
    version: consent.version,
    preferences: consent.preferences,
    consentedAt: consent.consentedAt,
    updatedAt: consent.updatedAt,
  };
};

/**
 * Withdraw all consent (except necessary)
 * @param {string} consentId - Consent ID
 * @param {Object} context - Request context
 * @returns {Promise<Object>} Withdrawal confirmation
 */
exports.withdrawConsent = async (consentId, context = {}) => {
  try {
    const consent = await prisma.cookieConsent.findUnique({
      where: { consentId },
    });

    if (!consent) {
      throw new AppError('Consent record not found', 404);
    }

    // Log the withdrawal
    await prisma.consentChangeLog.create({
      data: {
        consentId,
        previousPreferences: consent.preferences,
        newPreferences: { necessary: true },
        changedAt: new Date(),
        ipAddress: context.ipAddress,
        action: 'WITHDRAWAL',
      },
    });

    // Update to minimum consent
    await prisma.cookieConsent.update({
      where: { consentId },
      data: {
        preferences: {
          necessary: true,
          functional: false,
          analytics: false,
          marketing: false,
          thirdParty: false,
        },
        withdrawnAt: new Date(),
      },
    });

    logger.info('Cookie consent withdrawn', { consentId });

    return {
      success: true,
      message: 'All optional cookie consents have been withdrawn',
    };
  } catch (error) {
    logger.error('Withdraw consent error', { error: error.message, consentId });
    throw error;
  }
};

// =============================================================================
// CONSENT VERIFICATION
// =============================================================================

/**
 * Check if specific cookie category is allowed
 * @param {string} consentId - Consent ID
 * @param {string} category - Cookie category
 * @returns {Promise<boolean>} Whether category is allowed
 */
exports.isCategoryAllowed = async (consentId, category) => {
  if (!COOKIE_CATEGORIES[category]) {
    throw new AppError(`Invalid cookie category: ${category}`, 400);
  }

  // Necessary cookies are always allowed
  if (category === 'necessary') {
    return true;
  }

  const consent = await prisma.cookieConsent.findUnique({
    where: { consentId },
  });

  if (!consent) {
    return false;
  }

  return consent.preferences[category] === true;
};

/**
 * Check consent version compatibility
 * @param {string} consentId - Consent ID
 * @returns {Promise<Object>} Version check result
 */
exports.checkConsentVersion = async (consentId) => {
  const consent = await prisma.cookieConsent.findUnique({
    where: { consentId },
  });

  if (!consent) {
    return { valid: false, reason: 'Consent not found' };
  }

  const isCurrentVersion = consent.version === CONFIG.consentVersion;

  return {
    valid: isCurrentVersion,
    currentVersion: CONFIG.consentVersion,
    consentVersion: consent.version,
    requiresRenewal: !isCurrentVersion,
  };
};

// =============================================================================
// COOKIE BANNER
// =============================================================================

/**
 * Get cookie banner configuration
 * @param {string} locale - User's locale
 * @returns {Object} Banner configuration
 */
exports.getBannerConfig = (locale = 'en') => {
  const translations = {
    en: {
      title: 'We value your privacy',
      description: 'We use cookies to enhance your browsing experience, serve personalized content, and analyze our traffic. By clicking "Accept All", you consent to our use of cookies.',
      acceptAll: 'Accept All',
      rejectAll: 'Reject All',
      customize: 'Customize',
      save: 'Save Preferences',
      moreInfo: 'Learn More',
    },
    hi: {
      title: 'हम आपकी गोपनीयता को महत्व देते हैं',
      description: 'हम आपके ब्राउज़िंग अनुभव को बेहतर बनाने के लिए कुकीज़ का उपयोग करते हैं।',
      acceptAll: 'सभी स्वीकार करें',
      rejectAll: 'सभी अस्वीकार करें',
      customize: 'कस्टमाइज़ करें',
      save: 'प्राथमिकताएं सहेजें',
      moreInfo: 'और जानें',
    },
  };

  return {
    text: translations[locale] || translations.en,
    categories: Object.entries(COOKIE_CATEGORIES).map(([key, value]) => ({
      id: key,
      ...value,
    })),
    links: {
      privacyPolicy: '/privacy-policy',
      cookiePolicy: '/cookie-policy',
    },
  };
};

// =============================================================================
// COMPLIANCE REPORTING
// =============================================================================

/**
 * Get consent statistics (Admin)
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Consent statistics
 */
exports.getConsentStats = async (options = {}) => {
  const { startDate, endDate } = options;

  const where = {};
  if (startDate) {
    where.consentedAt = { gte: new Date(startDate) };
  }
  if (endDate) {
    where.consentedAt = { ...where.consentedAt, lte: new Date(endDate) };
  }

  const [total, byPreference, withdrawals] = await Promise.all([
    prisma.cookieConsent.count({ where }),
    prisma.cookieConsent.groupBy({
      by: ['preferences'],
      where,
      _count: true,
    }),
    prisma.cookieConsent.count({
      where: { ...where, withdrawnAt: { not: null } },
    }),
  ]);

  // Calculate category acceptance rates
  const allConsents = await prisma.cookieConsent.findMany({
    where,
    select: { preferences: true },
  });

  const categoryStats = {
    functional: 0,
    analytics: 0,
    marketing: 0,
    thirdParty: 0,
  };

  allConsents.forEach((consent) => {
    if (consent.preferences.functional) categoryStats.functional++;
    if (consent.preferences.analytics) categoryStats.analytics++;
    if (consent.preferences.marketing) categoryStats.marketing++;
    if (consent.preferences.thirdParty) categoryStats.thirdParty++;
  });

  return {
    total,
    withdrawals,
    acceptanceRates: {
      functional: total > 0 ? ((categoryStats.functional / total) * 100).toFixed(2) : 0,
      analytics: total > 0 ? ((categoryStats.analytics / total) * 100).toFixed(2) : 0,
      marketing: total > 0 ? ((categoryStats.marketing / total) * 100).toFixed(2) : 0,
      thirdParty: total > 0 ? ((categoryStats.thirdParty / total) * 100).toFixed(2) : 0,
    },
  };
};

/**
 * Export consent records for compliance
 * @param {Object} options - Export options
 * @returns {Promise<Object>} Export data
 */
exports.exportConsentRecords = async (options = {}) => {
  const { userId, startDate, endDate, format = 'json' } = options;

  const where = {};
  if (userId) where.userId = userId;
  if (startDate) where.consentedAt = { gte: new Date(startDate) };
  if (endDate) where.consentedAt = { ...where.consentedAt, lte: new Date(endDate) };

  const records = await prisma.cookieConsent.findMany({
    where,
    include: {
      changeLogs: true,
    },
    orderBy: { consentedAt: 'desc' },
  });

  const exportData = records.map((record) => ({
    consentId: record.consentId,
    version: record.version,
    preferences: record.preferences,
    consentedAt: record.consentedAt,
    updatedAt: record.updatedAt,
    withdrawnAt: record.withdrawnAt,
    changeHistory: record.changeLogs.map((log) => ({
      changedAt: log.changedAt,
      from: log.previousPreferences,
      to: log.newPreferences,
    })),
  }));

  return {
    exportedAt: new Date(),
    recordCount: exportData.length,
    records: exportData,
  };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Generate unique consent ID
 */
function generateConsentId() {
  return `consent_${crypto.randomBytes(16).toString('hex')}`;
}

/**
 * Validate preference object
 */
function validatePreferences(preferences) {
  if (!preferences || typeof preferences !== 'object') {
    throw new AppError('Invalid preferences object', 400);
  }

  const validCategories = Object.keys(COOKIE_CATEGORIES);
  const providedCategories = Object.keys(preferences);

  for (const category of providedCategories) {
    if (!validCategories.includes(category)) {
      throw new AppError(`Invalid cookie category: ${category}`, 400);
    }

    if (typeof preferences[category] !== 'boolean') {
      throw new AppError(`Preference for ${category} must be boolean`, 400);
    }
  }
}

// =============================================================================
// SCHEDULED TASKS
// =============================================================================

/**
 * Clean up old consent records
 * @returns {Promise<Object>} Cleanup result
 */
exports.cleanupOldRecords = async () => {
  const cutoffDate = new Date(Date.now() - CONFIG.consentLogRetention);

  const result = await prisma.consentChangeLog.deleteMany({
    where: {
      changedAt: { lt: cutoffDate },
    },
  });

  logger.info('Consent change logs cleaned up', { deleted: result.count });

  return { deleted: result.count };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  COOKIE_CATEGORIES,
  CONFIG,
};



