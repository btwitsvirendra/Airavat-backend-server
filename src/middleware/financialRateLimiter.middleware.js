// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL RATE LIMITER
// Specialized rate limiting for financial operations
// =============================================================================

const rateLimit = require('express-rate-limit');
const RedisStore = require('rate-limit-redis');
const { redis } = require('../config/redis');
const logger = require('../config/logger');
const { prisma } = require('../config/database');

// =============================================================================
// CONFIGURATION
// =============================================================================

const FINANCIAL_LIMITS = {
  // Wallet operations
  wallet: {
    credit: { windowMs: 60 * 60 * 1000, max: 50 },       // 50 credits/hour
    debit: { windowMs: 60 * 60 * 1000, max: 100 },      // 100 debits/hour
    transfer: { windowMs: 60 * 60 * 1000, max: 30 },    // 30 transfers/hour
    withdrawal: { windowMs: 24 * 60 * 60 * 1000, max: 5 }, // 5 withdrawals/day
    pinVerify: { windowMs: 15 * 60 * 1000, max: 5 },    // 5 PIN attempts/15min
  },

  // EMI operations
  emi: {
    create: { windowMs: 60 * 60 * 1000, max: 10 },      // 10 EMI orders/hour
    payment: { windowMs: 60 * 60 * 1000, max: 20 },     // 20 payments/hour
    foreclose: { windowMs: 24 * 60 * 60 * 1000, max: 5 }, // 5 foreclosures/day
  },

  // Card operations
  card: {
    create: { windowMs: 24 * 60 * 60 * 1000, max: 3 },  // 3 cards/day
    viewDetails: { windowMs: 60 * 60 * 1000, max: 10 }, // 10 detail views/hour
    transaction: { windowMs: 60 * 1000, max: 10 },      // 10 transactions/minute
  },

  // Insurance operations
  insurance: {
    quote: { windowMs: 60 * 60 * 1000, max: 20 },       // 20 quotes/hour
    createPolicy: { windowMs: 24 * 60 * 60 * 1000, max: 5 }, // 5 policies/day
    fileClaim: { windowMs: 24 * 60 * 60 * 1000, max: 10 }, // 10 claims/day
  },

  // Trade finance operations
  tradeFinance: {
    createLC: { windowMs: 24 * 60 * 60 * 1000, max: 10 }, // 10 LCs/day
    amendment: { windowMs: 24 * 60 * 60 * 1000, max: 20 }, // 20 amendments/day
  },

  // Factoring operations
  factoring: {
    eligibility: { windowMs: 60 * 60 * 1000, max: 30 }, // 30 checks/hour
    apply: { windowMs: 24 * 60 * 60 * 1000, max: 10 },  // 10 applications/day
  },

  // Bank integration
  bank: {
    connect: { windowMs: 24 * 60 * 60 * 1000, max: 5 }, // 5 connections/day
    sync: { windowMs: 60 * 60 * 1000, max: 10 },        // 10 syncs/hour
  },

  // General API limits
  general: {
    read: { windowMs: 60 * 1000, max: 100 },            // 100 reads/minute
    write: { windowMs: 60 * 1000, max: 30 },            // 30 writes/minute
  },
};

// =============================================================================
// RATE LIMITER FACTORY
// =============================================================================

/**
 * Create rate limiter with Redis store
 */
const createRateLimiter = (category, operation) => {
  const config = FINANCIAL_LIMITS[category]?.[operation] || FINANCIAL_LIMITS.general.write;

  const options = {
    windowMs: config.windowMs,
    max: config.max,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => {
      // Use user ID + IP for better tracking
      const userId = req.user?.id || 'anonymous';
      const ip = req.ip || req.connection?.remoteAddress || 'unknown';
      return `financial:${category}:${operation}:${userId}:${ip}`;
    },
    handler: (req, res, next, options) => {
      logger.warn('Financial rate limit exceeded', {
        category,
        operation,
        userId: req.user?.id,
        ip: req.ip,
        limit: options.max,
        windowMs: options.windowMs,
      });

      // Log to audit
      logRateLimitViolation(req, category, operation, options);

      res.status(429).json({
        success: false,
        error: {
          code: 'RATE_LIMIT_EXCEEDED',
          message: `Too many ${operation} requests. Please try again later.`,
          retryAfter: Math.ceil(options.windowMs / 1000),
          limit: options.max,
          category,
          operation,
        },
      });
    },
    skip: (req) => {
      // Skip rate limiting for admin users (optional)
      return req.user?.role === 'SUPER_ADMIN';
    },
  };

  // Use Redis store if available
  if (redis) {
    options.store = new RedisStore({
      sendCommand: (...args) => redis.call(...args),
      prefix: 'rl:financial:',
    });
  }

  return rateLimit(options);
};

// =============================================================================
// PRE-CONFIGURED LIMITERS
// =============================================================================

// Wallet limiters
exports.walletCreditLimiter = createRateLimiter('wallet', 'credit');
exports.walletDebitLimiter = createRateLimiter('wallet', 'debit');
exports.walletTransferLimiter = createRateLimiter('wallet', 'transfer');
exports.walletWithdrawalLimiter = createRateLimiter('wallet', 'withdrawal');
exports.walletPinLimiter = createRateLimiter('wallet', 'pinVerify');

// EMI limiters
exports.emiCreateLimiter = createRateLimiter('emi', 'create');
exports.emiPaymentLimiter = createRateLimiter('emi', 'payment');
exports.emiForecloseLimiter = createRateLimiter('emi', 'foreclose');

// Card limiters
exports.cardCreateLimiter = createRateLimiter('card', 'create');
exports.cardViewLimiter = createRateLimiter('card', 'viewDetails');
exports.cardTransactionLimiter = createRateLimiter('card', 'transaction');

// Insurance limiters
exports.insuranceQuoteLimiter = createRateLimiter('insurance', 'quote');
exports.insurancePolicyLimiter = createRateLimiter('insurance', 'createPolicy');
exports.insuranceClaimLimiter = createRateLimiter('insurance', 'fileClaim');

// Trade finance limiters
exports.lcCreateLimiter = createRateLimiter('tradeFinance', 'createLC');
exports.lcAmendmentLimiter = createRateLimiter('tradeFinance', 'amendment');

// Factoring limiters
exports.factoringEligibilityLimiter = createRateLimiter('factoring', 'eligibility');
exports.factoringApplyLimiter = createRateLimiter('factoring', 'apply');

// Bank limiters
exports.bankConnectLimiter = createRateLimiter('bank', 'connect');
exports.bankSyncLimiter = createRateLimiter('bank', 'sync');

// General limiters
exports.financialReadLimiter = createRateLimiter('general', 'read');
exports.financialWriteLimiter = createRateLimiter('general', 'write');

// =============================================================================
// DYNAMIC RATE LIMITER
// =============================================================================

/**
 * Dynamic rate limiter based on user trust score
 */
exports.dynamicRateLimiter = (baseCategory, baseOperation) => {
  return async (req, res, next) => {
    const baseConfig = FINANCIAL_LIMITS[baseCategory]?.[baseOperation] || FINANCIAL_LIMITS.general.write;
    let adjustedMax = baseConfig.max;

    if (req.user?.id) {
      try {
        // Get user's business trust score
        const business = await prisma.business.findFirst({
          where: { userId: req.user.id },
          select: { trustScore: true },
        });

        if (business?.trustScore) {
          // Adjust limits based on trust score
          // High trust (80+): 50% more requests
          // Medium trust (50-80): Normal
          // Low trust (<50): 50% fewer requests
          if (business.trustScore >= 80) {
            adjustedMax = Math.floor(baseConfig.max * 1.5);
          } else if (business.trustScore < 50) {
            adjustedMax = Math.floor(baseConfig.max * 0.5);
          }
        }
      } catch (error) {
        logger.warn('Failed to get trust score for rate limiting', { error: error.message });
      }
    }

    // Create limiter with adjusted max
    const limiter = rateLimit({
      windowMs: baseConfig.windowMs,
      max: adjustedMax,
      standardHeaders: true,
      legacyHeaders: false,
      keyGenerator: (req) => {
        const userId = req.user?.id || 'anonymous';
        return `financial:dynamic:${baseCategory}:${baseOperation}:${userId}`;
      },
      handler: (req, res) => {
        res.status(429).json({
          success: false,
          error: {
            code: 'RATE_LIMIT_EXCEEDED',
            message: 'Too many requests. Please try again later.',
            retryAfter: Math.ceil(baseConfig.windowMs / 1000),
          },
        });
      },
      store: redis ? new RedisStore({
        sendCommand: (...args) => redis.call(...args),
        prefix: 'rl:financial:dynamic:',
      }) : undefined,
    });

    return limiter(req, res, next);
  };
};

// =============================================================================
// AMOUNT-BASED RATE LIMITER
// =============================================================================

/**
 * Rate limiter based on transaction amounts
 */
exports.amountBasedLimiter = (options = {}) => {
  const {
    maxAmountPerHour = 1000000,      // 10 lakh per hour
    maxAmountPerDay = 5000000,       // 50 lakh per day
    currency = 'INR',
  } = options;

  return async (req, res, next) => {
    if (!req.user?.id) {
      return next();
    }

    const amount = parseFloat(req.body?.amount || 0);
    if (amount <= 0) {
      return next();
    }

    const userId = req.user.id;
    const now = Date.now();
    const hourAgo = now - 60 * 60 * 1000;
    const dayAgo = now - 24 * 60 * 60 * 1000;

    try {
      // Check hourly amount
      const hourlyKey = `amount_limit:hourly:${userId}`;
      const dailyKey = `amount_limit:daily:${userId}`;

      if (redis) {
        // Use Redis for tracking
        const [hourlyTotal, dailyTotal] = await Promise.all([
          redis.get(hourlyKey),
          redis.get(dailyKey),
        ]);

        const currentHourly = parseFloat(hourlyTotal || 0);
        const currentDaily = parseFloat(dailyTotal || 0);

        if (currentHourly + amount > maxAmountPerHour) {
          logger.warn('Hourly amount limit exceeded', {
            userId,
            currentHourly,
            requestedAmount: amount,
            limit: maxAmountPerHour,
          });

          return res.status(429).json({
            success: false,
            error: {
              code: 'AMOUNT_LIMIT_EXCEEDED',
              message: `Hourly transaction limit of ${currency} ${maxAmountPerHour.toLocaleString()} exceeded`,
              currentTotal: currentHourly,
              limit: maxAmountPerHour,
              type: 'hourly',
            },
          });
        }

        if (currentDaily + amount > maxAmountPerDay) {
          logger.warn('Daily amount limit exceeded', {
            userId,
            currentDaily,
            requestedAmount: amount,
            limit: maxAmountPerDay,
          });

          return res.status(429).json({
            success: false,
            error: {
              code: 'AMOUNT_LIMIT_EXCEEDED',
              message: `Daily transaction limit of ${currency} ${maxAmountPerDay.toLocaleString()} exceeded`,
              currentTotal: currentDaily,
              limit: maxAmountPerDay,
              type: 'daily',
            },
          });
        }

        // Update totals (will be committed after successful transaction)
        req.amountLimitKeys = { hourlyKey, dailyKey, amount };
      }
    } catch (error) {
      logger.error('Amount limit check failed', { error: error.message });
      // Don't block on error, but log it
    }

    next();
  };
};

/**
 * Commit amount to limits after successful transaction
 */
exports.commitAmountLimit = async (req) => {
  if (!req.amountLimitKeys || !redis) return;

  const { hourlyKey, dailyKey, amount } = req.amountLimitKeys;

  try {
    await Promise.all([
      redis.incrbyfloat(hourlyKey, amount),
      redis.expire(hourlyKey, 3600), // 1 hour
      redis.incrbyfloat(dailyKey, amount),
      redis.expire(dailyKey, 86400), // 24 hours
    ]);
  } catch (error) {
    logger.error('Failed to commit amount limit', { error: error.message });
  }
};

// =============================================================================
// VELOCITY CHECK
// =============================================================================

/**
 * Check for suspicious transaction velocity
 */
exports.velocityCheck = (options = {}) => {
  const {
    maxTransactionsPerMinute = 5,
    maxTransactionsPerHour = 50,
    blockDurationMinutes = 30,
  } = options;

  return async (req, res, next) => {
    if (!req.user?.id) {
      return next();
    }

    const userId = req.user.id;
    const minuteKey = `velocity:minute:${userId}`;
    const hourKey = `velocity:hour:${userId}`;
    const blockKey = `velocity:blocked:${userId}`;

    try {
      if (redis) {
        // Check if user is blocked
        const isBlocked = await redis.get(blockKey);
        if (isBlocked) {
          logger.warn('Blocked user attempted transaction', { userId });
          return res.status(429).json({
            success: false,
            error: {
              code: 'VELOCITY_BLOCKED',
              message: 'Account temporarily blocked due to suspicious activity',
              unblockAt: isBlocked,
            },
          });
        }

        // Check minute velocity
        const minuteCount = await redis.incr(minuteKey);
        if (minuteCount === 1) {
          await redis.expire(minuteKey, 60);
        }

        if (minuteCount > maxTransactionsPerMinute) {
          // Block user
          const unblockAt = new Date(Date.now() + blockDurationMinutes * 60 * 1000);
          await redis.set(blockKey, unblockAt.toISOString(), 'EX', blockDurationMinutes * 60);

          logger.warn('User blocked for velocity violation', {
            userId,
            minuteCount,
            limit: maxTransactionsPerMinute,
          });

          // Alert for suspicious activity
          await alertSuspiciousActivity(userId, 'VELOCITY_VIOLATION', {
            minuteCount,
            limit: maxTransactionsPerMinute,
          });

          return res.status(429).json({
            success: false,
            error: {
              code: 'VELOCITY_VIOLATION',
              message: 'Too many transactions in a short period. Account temporarily blocked.',
              unblockAt: unblockAt.toISOString(),
            },
          });
        }

        // Check hour velocity
        const hourCount = await redis.incr(hourKey);
        if (hourCount === 1) {
          await redis.expire(hourKey, 3600);
        }

        if (hourCount > maxTransactionsPerHour) {
          logger.warn('Hourly velocity limit reached', {
            userId,
            hourCount,
            limit: maxTransactionsPerHour,
          });

          return res.status(429).json({
            success: false,
            error: {
              code: 'HOURLY_LIMIT_REACHED',
              message: 'Hourly transaction limit reached. Please try again later.',
            },
          });
        }
      }
    } catch (error) {
      logger.error('Velocity check failed', { error: error.message });
    }

    next();
  };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

/**
 * Log rate limit violation to audit
 */
async function logRateLimitViolation(req, category, operation, options) {
  try {
    const { prisma } = require('../config/database');

    await prisma.financialAuditLog.create({
      data: {
        category: 'SECURITY',
        action: 'RATE_LIMIT_EXCEEDED',
        entityType: 'rate_limit',
        entityId: `${category}:${operation}`,
        userId: req.user?.id,
        severity: 'WARNING',
        details: {
          category,
          operation,
          limit: options.max,
          windowMs: options.windowMs,
          endpoint: req.originalUrl,
          method: req.method,
        },
        ipAddress: req.ip,
        userAgent: req.get('user-agent'),
      },
    });
  } catch (error) {
    logger.error('Failed to log rate limit violation', { error: error.message });
  }
}

/**
 * Alert for suspicious activity
 */
async function alertSuspiciousActivity(userId, type, details) {
  try {
    // Create alert in database
    await prisma.securityAlert.create({
      data: {
        userId,
        type,
        severity: 'HIGH',
        details,
        status: 'NEW',
      },
    });

    // Log for monitoring
    logger.warn('Suspicious activity alert', { userId, type, details });

    // In production, would also send notifications to security team
  } catch (error) {
    logger.error('Failed to create security alert', { error: error.message });
  }
}

// =============================================================================
// EXPORT CONFIGURATION
// =============================================================================

exports.FINANCIAL_LIMITS = FINANCIAL_LIMITS;
exports.createRateLimiter = createRateLimiter;
