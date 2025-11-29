// =============================================================================
// AIRAVAT B2B MARKETPLACE - CACHE MANAGER
// Advanced caching with multiple strategies, patterns, and invalidation
// =============================================================================

const { cache, redis } = require('../config/redis');
const logger = require('../config/logger');
const crypto = require('crypto');

class CacheManager {
  constructor() {
    this.defaultTTL = 3600; // 1 hour
    this.prefix = 'airavat:';
    this.stats = {
      hits: 0,
      misses: 0,
      sets: 0,
      deletes: 0,
    };
  }

  // ===========================================================================
  // BASIC OPERATIONS
  // ===========================================================================

  /**
   * Generate cache key
   */
  key(...parts) {
    return this.prefix + parts.join(':');
  }

  /**
   * Generate hash key for objects
   */
  hashKey(data) {
    return crypto.createHash('md5').update(JSON.stringify(data)).digest('hex');
  }

  /**
   * Get value from cache
   */
  async get(key) {
    try {
      const value = await cache.get(key);
      if (value) {
        this.stats.hits++;
        return JSON.parse(value);
      }
      this.stats.misses++;
      return null;
    } catch (error) {
      logger.error('Cache get error', { key, error: error.message });
      return null;
    }
  }

  /**
   * Set value in cache
   */
  async set(key, value, ttl = this.defaultTTL) {
    try {
      await cache.set(key, JSON.stringify(value), ttl);
      this.stats.sets++;
      return true;
    } catch (error) {
      logger.error('Cache set error', { key, error: error.message });
      return false;
    }
  }

  /**
   * Delete value from cache
   */
  async del(key) {
    try {
      await cache.del(key);
      this.stats.deletes++;
      return true;
    } catch (error) {
      logger.error('Cache delete error', { key, error: error.message });
      return false;
    }
  }

  /**
   * Delete multiple keys by pattern
   */
  async delByPattern(pattern) {
    try {
      const keys = await cache.keys(`${this.prefix}${pattern}`);
      if (keys.length > 0) {
        await Promise.all(keys.map((key) => cache.del(key)));
        this.stats.deletes += keys.length;
      }
      return keys.length;
    } catch (error) {
      logger.error('Cache pattern delete error', { pattern, error: error.message });
      return 0;
    }
  }

  // ===========================================================================
  // CACHE PATTERNS
  // ===========================================================================

  /**
   * Cache-Aside Pattern (Lazy Loading)
   * Try cache first, fall back to data source, then cache
   */
  async cacheAside(key, fetchFn, ttl = this.defaultTTL) {
    // Try cache first
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    // Cache miss - fetch from source
    const value = await fetchFn();

    // Cache the result
    if (value !== null && value !== undefined) {
      await this.set(key, value, ttl);
    }

    return value;
  }

  /**
   * Write-Through Pattern
   * Write to cache and data source simultaneously
   */
  async writeThrough(key, value, writeFn, ttl = this.defaultTTL) {
    // Write to data source first
    const result = await writeFn(value);

    // Then update cache
    await this.set(key, result, ttl);

    return result;
  }

  /**
   * Write-Behind Pattern (Write-Back)
   * Write to cache first, async write to data source
   */
  async writeBehind(key, value, writeFn, ttl = this.defaultTTL) {
    // Write to cache immediately
    await this.set(key, value, ttl);

    // Async write to data source
    setImmediate(async () => {
      try {
        await writeFn(value);
      } catch (error) {
        logger.error('Write-behind failed', { key, error: error.message });
        // Could implement retry queue here
      }
    });

    return value;
  }

  /**
   * Read-Through Pattern
   * Cache automatically fetches on miss
   */
  readThrough(fetchFn, ttl = this.defaultTTL) {
    return async (key) => {
      const cached = await this.get(key);
      if (cached !== null) {
        return cached;
      }

      const value = await fetchFn(key);
      if (value !== null) {
        await this.set(key, value, ttl);
      }

      return value;
    };
  }

  /**
   * Refresh-Ahead Pattern
   * Proactively refresh cache before expiration
   */
  async refreshAhead(key, fetchFn, ttl = this.defaultTTL, refreshThreshold = 0.75) {
    const cached = await this.getWithTTL(key);

    if (cached.value !== null) {
      // Check if we should refresh
      const remainingTTL = cached.ttl;
      const refreshPoint = ttl * (1 - refreshThreshold);

      if (remainingTTL < refreshPoint) {
        // Refresh in background
        setImmediate(async () => {
          try {
            const value = await fetchFn();
            await this.set(key, value, ttl);
          } catch (error) {
            logger.error('Refresh-ahead failed', { key, error: error.message });
          }
        });
      }

      return cached.value;
    }

    // Cache miss
    const value = await fetchFn();
    await this.set(key, value, ttl);
    return value;
  }

  /**
   * Get value with remaining TTL
   */
  async getWithTTL(key) {
    const value = await this.get(key);
    const ttl = await cache.ttl(key);
    return { value, ttl: ttl > 0 ? ttl : 0 };
  }

  // ===========================================================================
  // ADVANCED CACHING STRATEGIES
  // ===========================================================================

  /**
   * Memoize a function with caching
   */
  memoize(fn, options = {}) {
    const { ttl = this.defaultTTL, keyGenerator } = options;

    return async (...args) => {
      const key = keyGenerator
        ? keyGenerator(...args)
        : this.key(fn.name, this.hashKey(args));

      return this.cacheAside(key, () => fn(...args), ttl);
    };
  }

  /**
   * Batch cache lookup
   */
  async getMany(keys) {
    try {
      const values = await cache.mget(keys);
      const result = {};

      keys.forEach((key, index) => {
        if (values[index]) {
          result[key] = JSON.parse(values[index]);
          this.stats.hits++;
        } else {
          this.stats.misses++;
        }
      });

      return result;
    } catch (error) {
      logger.error('Cache getMany error', { error: error.message });
      return {};
    }
  }

  /**
   * Batch cache set
   */
  async setMany(items, ttl = this.defaultTTL) {
    try {
      const pipeline = redis.pipeline();

      for (const [key, value] of Object.entries(items)) {
        pipeline.setex(key, ttl, JSON.stringify(value));
      }

      await pipeline.exec();
      this.stats.sets += Object.keys(items).length;
      return true;
    } catch (error) {
      logger.error('Cache setMany error', { error: error.message });
      return false;
    }
  }

  /**
   * Cache with tags for group invalidation
   */
  async setWithTags(key, value, tags = [], ttl = this.defaultTTL) {
    await this.set(key, value, ttl);

    // Store key in tag sets
    for (const tag of tags) {
      const tagKey = this.key('tag', tag);
      await cache.sadd(tagKey, key);
      await cache.expire(tagKey, ttl * 2); // Tags expire after keys
    }
  }

  /**
   * Invalidate all keys with a tag
   */
  async invalidateTag(tag) {
    const tagKey = this.key('tag', tag);
    const keys = await cache.smembers(tagKey);

    if (keys.length > 0) {
      await Promise.all(keys.map((key) => cache.del(key)));
      await cache.del(tagKey);
    }

    return keys.length;
  }

  /**
   * Distributed lock for cache stampede prevention
   */
  async withLock(key, fn, options = {}) {
    const { lockTTL = 30, retries = 3, retryDelay = 100 } = options;
    const lockKey = `${key}:lock`;

    for (let attempt = 0; attempt < retries; attempt++) {
      // Try to acquire lock
      const acquired = await cache.set(lockKey, '1', lockTTL, 'NX');

      if (acquired) {
        try {
          const result = await fn();
          return result;
        } finally {
          await cache.del(lockKey);
        }
      }

      // Wait before retry
      await new Promise((resolve) => setTimeout(resolve, retryDelay));
    }

    throw new Error('Failed to acquire cache lock');
  }

  /**
   * Stale-While-Revalidate pattern
   */
  async staleWhileRevalidate(key, fetchFn, options = {}) {
    const { ttl = this.defaultTTL, staleTTL = ttl * 2 } = options;
    const staleKey = `${key}:stale`;

    // Try to get fresh value
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    // Try to get stale value
    const stale = await this.get(staleKey);

    if (stale !== null) {
      // Return stale, revalidate in background
      setImmediate(async () => {
        try {
          const fresh = await fetchFn();
          await this.set(key, fresh, ttl);
          await this.set(staleKey, fresh, staleTTL);
        } catch (error) {
          logger.error('Revalidation failed', { key, error: error.message });
        }
      });

      return stale;
    }

    // No cache - fetch synchronously
    const value = await fetchFn();
    await this.set(key, value, ttl);
    await this.set(staleKey, value, staleTTL);

    return value;
  }

  // ===========================================================================
  // ENTITY-SPECIFIC CACHING
  // ===========================================================================

  /**
   * Cache product
   */
  async cacheProduct(product) {
    const key = this.key('product', product.id);
    await this.setWithTags(key, product, [
      `category:${product.categoryId}`,
      `business:${product.businessId}`,
    ], 3600);
  }

  /**
   * Get cached product
   */
  async getCachedProduct(productId) {
    return this.get(this.key('product', productId));
  }

  /**
   * Invalidate product cache
   */
  async invalidateProduct(productId) {
    await this.del(this.key('product', productId));
  }

  /**
   * Invalidate all products for a category
   */
  async invalidateCategoryProducts(categoryId) {
    return this.invalidateTag(`category:${categoryId}`);
  }

  /**
   * Cache user session
   */
  async cacheSession(sessionId, data, ttl = 86400) {
    const key = this.key('session', sessionId);
    await this.set(key, data, ttl);
  }

  /**
   * Get cached session
   */
  async getCachedSession(sessionId) {
    return this.get(this.key('session', sessionId));
  }

  // ===========================================================================
  // CACHE WARMING
  // ===========================================================================

  /**
   * Warm cache with frequently accessed data
   */
  async warmCache() {
    logger.info('Starting cache warm-up...');
    const startTime = Date.now();

    try {
      // Warm categories
      await this.warmCategories();

      // Warm popular products
      await this.warmPopularProducts();

      // Warm settings
      await this.warmSettings();

      logger.info(`Cache warm-up completed in ${Date.now() - startTime}ms`);
    } catch (error) {
      logger.error('Cache warm-up failed', { error: error.message });
    }
  }

  async warmCategories() {
    const { prisma } = require('../config/database');
    const categories = await prisma.category.findMany({
      where: { isActive: true },
    });

    for (const category of categories) {
      await this.set(this.key('category', category.id), category, 7200);
    }

    logger.info(`Warmed ${categories.length} categories`);
  }

  async warmPopularProducts() {
    const { prisma } = require('../config/database');
    const products = await prisma.product.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { viewCount: 'desc' },
      take: 100,
      include: {
        variants: { where: { isActive: true } },
        category: true,
      },
    });

    for (const product of products) {
      await this.cacheProduct(product);
    }

    logger.info(`Warmed ${products.length} popular products`);
  }

  async warmSettings() {
    const { prisma } = require('../config/database');
    const settings = await prisma.systemSetting.findMany();

    for (const setting of settings) {
      await this.set(this.key('setting', setting.key), setting.value, 86400);
    }

    logger.info(`Warmed ${settings.length} settings`);
  }

  // ===========================================================================
  // STATISTICS & MONITORING
  // ===========================================================================

  /**
   * Get cache statistics
   */
  getStats() {
    const total = this.stats.hits + this.stats.misses;
    return {
      ...this.stats,
      hitRate: total > 0 ? (this.stats.hits / total * 100).toFixed(2) + '%' : '0%',
    };
  }

  /**
   * Reset statistics
   */
  resetStats() {
    this.stats = { hits: 0, misses: 0, sets: 0, deletes: 0 };
  }

  /**
   * Get cache info from Redis
   */
  async getInfo() {
    try {
      const info = await redis.info('memory');
      const keyCount = await redis.dbsize();

      return {
        keyCount,
        memory: info,
        stats: this.getStats(),
      };
    } catch (error) {
      logger.error('Failed to get cache info', { error: error.message });
      return { stats: this.getStats() };
    }
  }

  /**
   * Clear all cache
   */
  async flush() {
    try {
      const keys = await cache.keys(`${this.prefix}*`);
      if (keys.length > 0) {
        await Promise.all(keys.map((key) => cache.del(key)));
      }
      this.resetStats();
      logger.info(`Flushed ${keys.length} cache keys`);
      return keys.length;
    } catch (error) {
      logger.error('Cache flush error', { error: error.message });
      return 0;
    }
  }
}

// Export singleton
const cacheManager = new CacheManager();

module.exports = cacheManager;
