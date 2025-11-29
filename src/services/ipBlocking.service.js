// =============================================================================
// AIRAVAT B2B MARKETPLACE - IP BLOCKING SERVICE
// Manages IP bans, blocks, and suspicious activity tracking
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');

class IPBlockingService {
  constructor() {
    this.cachePrefix = 'ip:';
    this.blockDuration = 24 * 60 * 60; // 24 hours in seconds
    this.suspiciousThreshold = 10;
    this.suspiciousWindow = 60 * 60; // 1 hour
  }

  // ===========================================================================
  // IP CHECKING
  // ===========================================================================

  /**
   * Check if IP is blocked
   */
  async isBlocked(ip) {
    const cacheKey = `${this.cachePrefix}blocked:${ip}`;

    // Check cache first
    const cached = await cache.get(cacheKey);
    if (cached) {
      return JSON.parse(cached);
    }

    // Check database
    const block = await prisma.iPBlock.findFirst({
      where: {
        ip,
        OR: [
          { expiresAt: null }, // Permanent ban
          { expiresAt: { gt: new Date() } }, // Not expired
        ],
      },
    });

    if (block) {
      // Cache the result
      const ttl = block.expiresAt
        ? Math.floor((new Date(block.expiresAt) - Date.now()) / 1000)
        : this.blockDuration;

      await cache.set(cacheKey, JSON.stringify({
        blocked: true,
        reason: block.reason,
        expiresAt: block.expiresAt,
      }), Math.min(ttl, this.blockDuration));

      return { blocked: true, reason: block.reason, expiresAt: block.expiresAt };
    }

    // Cache negative result (not blocked)
    await cache.set(cacheKey, JSON.stringify({ blocked: false }), 300); // 5 minutes

    return { blocked: false };
  }

  /**
   * Check if IP is in whitelist
   */
  async isWhitelisted(ip) {
    const cacheKey = `${this.cachePrefix}whitelist:${ip}`;

    const cached = await cache.get(cacheKey);
    if (cached !== null) {
      return cached === 'true';
    }

    const whitelist = await prisma.iPWhitelist.findFirst({
      where: { ip },
    });

    await cache.set(cacheKey, whitelist ? 'true' : 'false', 3600);
    return !!whitelist;
  }

  // ===========================================================================
  // IP BLOCKING
  // ===========================================================================

  /**
   * Block an IP address
   */
  async blockIP(ip, reason, duration = null, blockedBy = null) {
    const expiresAt = duration
      ? new Date(Date.now() + duration * 1000)
      : null;

    const block = await prisma.iPBlock.create({
      data: {
        ip,
        reason,
        expiresAt,
        blockedBy,
        metadata: {
          timestamp: new Date().toISOString(),
        },
      },
    });

    // Clear cache
    await cache.del(`${this.cachePrefix}blocked:${ip}`);

    logger.warn('IP blocked', { ip, reason, duration, expiresAt });

    return block;
  }

  /**
   * Unblock an IP address
   */
  async unblockIP(ip) {
    await prisma.iPBlock.deleteMany({
      where: { ip },
    });

    // Clear cache
    await cache.del(`${this.cachePrefix}blocked:${ip}`);

    logger.info('IP unblocked', { ip });
  }

  /**
   * Temporarily block IP (rate limiting)
   */
  async temporaryBlock(ip, duration = 3600, reason = 'Rate limit exceeded') {
    return this.blockIP(ip, reason, duration);
  }

  /**
   * Permanently block IP
   */
  async permanentBlock(ip, reason) {
    return this.blockIP(ip, reason, null);
  }

  // ===========================================================================
  // WHITELIST MANAGEMENT
  // ===========================================================================

  /**
   * Add IP to whitelist
   */
  async addToWhitelist(ip, note = null, addedBy = null) {
    const entry = await prisma.iPWhitelist.create({
      data: {
        ip,
        note,
        addedBy,
      },
    });

    await cache.del(`${this.cachePrefix}whitelist:${ip}`);
    logger.info('IP whitelisted', { ip, note });

    return entry;
  }

  /**
   * Remove IP from whitelist
   */
  async removeFromWhitelist(ip) {
    await prisma.iPWhitelist.deleteMany({
      where: { ip },
    });

    await cache.del(`${this.cachePrefix}whitelist:${ip}`);
    logger.info('IP removed from whitelist', { ip });
  }

  // ===========================================================================
  // SUSPICIOUS ACTIVITY TRACKING
  // ===========================================================================

  /**
   * Record suspicious activity
   */
  async recordSuspiciousActivity(ip, activity, metadata = {}) {
    const key = `${this.cachePrefix}suspicious:${ip}`;

    // Increment counter
    const count = await cache.incr(key);

    // Set expiry on first increment
    if (count === 1) {
      await cache.expire(key, this.suspiciousWindow);
    }

    // Log the activity
    await prisma.suspiciousActivity.create({
      data: {
        ip,
        activity,
        metadata,
      },
    });

    logger.warn('Suspicious activity recorded', { ip, activity, count, metadata });

    // Auto-block if threshold exceeded
    if (count >= this.suspiciousThreshold) {
      await this.blockIP(
        ip,
        `Auto-blocked: ${count} suspicious activities in ${this.suspiciousWindow / 60} minutes`,
        this.blockDuration
      );
    }

    return count;
  }

  /**
   * Get suspicious activity count
   */
  async getSuspiciousCount(ip) {
    const key = `${this.cachePrefix}suspicious:${ip}`;
    const count = await cache.get(key);
    return parseInt(count) || 0;
  }

  /**
   * Clear suspicious activity record
   */
  async clearSuspiciousActivity(ip) {
    const key = `${this.cachePrefix}suspicious:${ip}`;
    await cache.del(key);
  }

  // ===========================================================================
  // ACTIVITY PATTERNS
  // ===========================================================================

  /**
   * Check for brute force patterns
   */
  async checkBruteForce(ip, action, window = 300, threshold = 10) {
    const key = `${this.cachePrefix}bruteforce:${action}:${ip}`;

    const count = await cache.incr(key);
    if (count === 1) {
      await cache.expire(key, window);
    }

    if (count >= threshold) {
      await this.recordSuspiciousActivity(ip, `brute_force_${action}`, {
        attempts: count,
        window,
      });
      return true;
    }

    return false;
  }

  /**
   * Check for scanning patterns
   */
  async checkScanning(ip, paths = []) {
    const key = `${this.cachePrefix}scanning:${ip}`;

    // Add paths to set
    for (const path of paths) {
      await cache.sadd(key, path);
    }
    await cache.expire(key, 3600);

    // Get unique path count
    const uniquePaths = await cache.scard(key);

    // If hitting too many different paths, might be scanning
    if (uniquePaths > 50) {
      await this.recordSuspiciousActivity(ip, 'path_scanning', {
        uniquePaths,
      });
      return true;
    }

    return false;
  }

  /**
   * Check for credential stuffing
   */
  async checkCredentialStuffing(ip, window = 600, threshold = 5) {
    const key = `${this.cachePrefix}credstuff:${ip}`;

    const count = await cache.incr(key);
    if (count === 1) {
      await cache.expire(key, window);
    }

    if (count >= threshold) {
      await this.recordSuspiciousActivity(ip, 'credential_stuffing', {
        failedAttempts: count,
      });
      return true;
    }

    return false;
  }

  // ===========================================================================
  // GEO BLOCKING
  // ===========================================================================

  /**
   * Check if country is blocked
   */
  async isCountryBlocked(countryCode) {
    const cacheKey = `${this.cachePrefix}country:blocked:${countryCode}`;

    const cached = await cache.get(cacheKey);
    if (cached !== null) {
      return cached === 'true';
    }

    const blocked = await prisma.blockedCountry.findFirst({
      where: { countryCode, isActive: true },
    });

    await cache.set(cacheKey, blocked ? 'true' : 'false', 3600);
    return !!blocked;
  }

  /**
   * Block a country
   */
  async blockCountry(countryCode, reason) {
    await prisma.blockedCountry.upsert({
      where: { countryCode },
      update: { isActive: true, reason },
      create: { countryCode, reason, isActive: true },
    });

    await cache.del(`${this.cachePrefix}country:blocked:${countryCode}`);
    logger.info('Country blocked', { countryCode, reason });
  }

  /**
   * Unblock a country
   */
  async unblockCountry(countryCode) {
    await prisma.blockedCountry.updateMany({
      where: { countryCode },
      data: { isActive: false },
    });

    await cache.del(`${this.cachePrefix}country:blocked:${countryCode}`);
    logger.info('Country unblocked', { countryCode });
  }

  // ===========================================================================
  // ADMIN & REPORTING
  // ===========================================================================

  /**
   * Get all blocked IPs
   */
  async getBlockedIPs(page = 1, limit = 50) {
    const [blocks, total] = await Promise.all([
      prisma.iPBlock.findMany({
        where: {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      prisma.iPBlock.count({
        where: {
          OR: [
            { expiresAt: null },
            { expiresAt: { gt: new Date() } },
          ],
        },
      }),
    ]);

    return {
      blocks,
      pagination: {
        page,
        limit,
        total,
        pages: Math.ceil(total / limit),
      },
    };
  }

  /**
   * Get suspicious activity report
   */
  async getSuspiciousActivityReport(startDate, endDate, limit = 100) {
    return prisma.suspiciousActivity.findMany({
      where: {
        createdAt: {
          gte: new Date(startDate),
          lte: new Date(endDate),
        },
      },
      orderBy: { createdAt: 'desc' },
      take: limit,
    });
  }

  /**
   * Get top offending IPs
   */
  async getTopOffendingIPs(days = 7, limit = 20) {
    const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    return prisma.suspiciousActivity.groupBy({
      by: ['ip'],
      where: {
        createdAt: { gte: since },
      },
      _count: { ip: true },
      orderBy: { _count: { ip: 'desc' } },
      take: limit,
    });
  }

  /**
   * Cleanup expired blocks
   */
  async cleanupExpiredBlocks() {
    const result = await prisma.iPBlock.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    logger.info(`Cleaned up ${result.count} expired IP blocks`);
    return result.count;
  }

  // ===========================================================================
  // MIDDLEWARE
  // ===========================================================================

  /**
   * Express middleware for IP blocking
   */
  middleware(options = {}) {
    const { bypassWhitelist = true } = options;

    return async (req, res, next) => {
      const ip = req.clientIP || req.ip;

      // Check whitelist first
      if (bypassWhitelist) {
        const whitelisted = await this.isWhitelisted(ip);
        if (whitelisted) {
          return next();
        }
      }

      // Check if blocked
      const blockStatus = await this.isBlocked(ip);
      if (blockStatus.blocked) {
        logger.warn('Blocked IP attempted access', { ip, reason: blockStatus.reason });

        return res.status(403).json({
          success: false,
          error: 'Access denied',
          reason: blockStatus.reason,
          expiresAt: blockStatus.expiresAt,
        });
      }

      next();
    };
  }
}

module.exports = new IPBlockingService();
