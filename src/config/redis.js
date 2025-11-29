// =============================================================================
// AIRAVAT B2B MARKETPLACE - REDIS CLIENT
// Redis connection with connection pooling and error handling
// =============================================================================

const Redis = require('ioredis');
const config = require('./index');

// Redis client for general caching
let redis = null;

// Redis client for pub/sub (separate connection required)
let redisPub = null;
let redisSub = null;

/**
 * Create Redis client with configuration
 */
const createRedisClient = (name = 'default') => {
  const options = {
    host: config.redis.host,
    port: config.redis.port,
    password: config.redis.password || undefined,
    db: config.redis.db,
    retryStrategy: (times) => {
      const delay = Math.min(times * 50, 2000);
      return delay;
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: true,
    lazyConnect: true,
  };

  // Use URL if provided (for cloud Redis)
  if (config.redis.url) {
    return new Redis(config.redis.url, options);
  }

  const client = new Redis(options);

  client.on('connect', () => {
    console.log(`🔴 Redis [${name}] connecting...`);
  });

  client.on('ready', () => {
    console.log(`🟢 Redis [${name}] connected and ready`);
  });

  client.on('error', (err) => {
    console.error(`❌ Redis [${name}] error:`, err.message);
  });

  client.on('close', () => {
    console.log(`🔴 Redis [${name}] connection closed`);
  });

  return client;
};

/**
 * Initialize Redis connections
 */
const initRedis = async () => {
  try {
    redis = createRedisClient('main');
    redisPub = createRedisClient('publisher');
    redisSub = createRedisClient('subscriber');

    // Connect all clients
    await Promise.all([
      redis.connect(),
      redisPub.connect(),
      redisSub.connect(),
    ]);

    console.log('🟢 All Redis connections established');
    return true;
  } catch (error) {
    console.error('❌ Redis initialization failed:', error.message);
    // Don't throw - app can work without Redis (with degraded performance)
    return false;
  }
};

/**
 * Close all Redis connections
 */
const closeRedis = async () => {
  const clients = [redis, redisPub, redisSub].filter(Boolean);
  await Promise.all(clients.map((client) => client.quit()));
  console.log('🔴 Redis connections closed');
};

/**
 * Get the main Redis client
 */
const getRedis = () => {
  if (!redis) {
    throw new Error('Redis not initialized. Call initRedis() first.');
  }
  return redis;
};

/**
 * Get pub/sub clients
 */
const getPubSub = () => ({
  pub: redisPub,
  sub: redisSub,
});

// =============================================================================
// REDIS HELPER FUNCTIONS
// =============================================================================

/**
 * Cache with automatic JSON serialization
 */
const cache = {
  /**
   * Get cached value
   */
  async get(key) {
    if (!redis) return null;
    try {
      const value = await redis.get(key);
      return value ? JSON.parse(value) : null;
    } catch (error) {
      console.error('Cache get error:', error.message);
      return null;
    }
  },

  /**
   * Set cached value with optional TTL
   */
  async set(key, value, ttlSeconds = 3600) {
    if (!redis) return false;
    try {
      const serialized = JSON.stringify(value);
      if (ttlSeconds) {
        await redis.setex(key, ttlSeconds, serialized);
      } else {
        await redis.set(key, serialized);
      }
      return true;
    } catch (error) {
      console.error('Cache set error:', error.message);
      return false;
    }
  },

  /**
   * Delete cached value
   */
  async del(key) {
    if (!redis) return false;
    try {
      await redis.del(key);
      return true;
    } catch (error) {
      console.error('Cache del error:', error.message);
      return false;
    }
  },

  /**
   * Delete multiple keys by pattern
   */
  async delPattern(pattern) {
    if (!redis) return false;
    try {
      const keys = await redis.keys(pattern);
      if (keys.length > 0) {
        await redis.del(...keys);
      }
      return true;
    } catch (error) {
      console.error('Cache delPattern error:', error.message);
      return false;
    }
  },

  /**
   * Check if key exists
   */
  async exists(key) {
    if (!redis) return false;
    try {
      return await redis.exists(key);
    } catch (error) {
      console.error('Cache exists error:', error.message);
      return false;
    }
  },

  /**
   * Increment counter
   */
  async incr(key, ttlSeconds = null) {
    if (!redis) return 0;
    try {
      const value = await redis.incr(key);
      if (ttlSeconds && value === 1) {
        await redis.expire(key, ttlSeconds);
      }
      return value;
    } catch (error) {
      console.error('Cache incr error:', error.message);
      return 0;
    }
  },

  /**
   * Get or set with callback
   */
  async getOrSet(key, callback, ttlSeconds = 3600) {
    const cached = await this.get(key);
    if (cached !== null) {
      return cached;
    }

    const value = await callback();
    await this.set(key, value, ttlSeconds);
    return value;
  },
};

// =============================================================================
// INVENTORY MANAGEMENT (Redis + Lua for atomic operations)
// =============================================================================

/**
 * Lua script for atomic inventory deduction
 * Returns: 1 if successful, 0 if insufficient stock
 */
const DEDUCT_INVENTORY_SCRIPT = `
local key = KEYS[1]
local quantity = tonumber(ARGV[1])
local current = tonumber(redis.call('GET', key) or '0')

if current >= quantity then
  redis.call('DECRBY', key, quantity)
  return 1
else
  return 0
end
`;

/**
 * Lua script for releasing reserved inventory
 */
const RELEASE_INVENTORY_SCRIPT = `
local key = KEYS[1]
local quantity = tonumber(ARGV[1])
redis.call('INCRBY', key, quantity)
return redis.call('GET', key)
`;

const inventory = {
  /**
   * Initialize inventory in Redis (call before flash sales)
   */
  async initialize(variantId, quantity) {
    if (!redis) return false;
    const key = `inventory:${variantId}`;
    await redis.set(key, quantity);
    return true;
  },

  /**
   * Get current inventory level
   */
  async get(variantId) {
    if (!redis) return null;
    const key = `inventory:${variantId}`;
    const value = await redis.get(key);
    return value !== null ? parseInt(value, 10) : null;
  },

  /**
   * Atomically deduct inventory
   * Returns true if successful, false if insufficient stock
   */
  async deduct(variantId, quantity) {
    if (!redis) return false;
    const key = `inventory:${variantId}`;
    const result = await redis.eval(DEDUCT_INVENTORY_SCRIPT, 1, key, quantity);
    return result === 1;
  },

  /**
   * Release inventory (e.g., order cancelled)
   */
  async release(variantId, quantity) {
    if (!redis) return null;
    const key = `inventory:${variantId}`;
    const result = await redis.eval(RELEASE_INVENTORY_SCRIPT, 1, key, quantity);
    return parseInt(result, 10);
  },

  /**
   * Sync Redis inventory with database
   */
  async syncFromDB(variantId, quantity) {
    return this.initialize(variantId, quantity);
  },
};

// =============================================================================
// RATE LIMITING
// =============================================================================

const rateLimit = {
  /**
   * Check and increment rate limit
   * Returns: { allowed: boolean, remaining: number, resetTime: number }
   */
  async check(key, maxRequests, windowSeconds) {
    if (!redis) {
      return { allowed: true, remaining: maxRequests, resetTime: 0 };
    }

    const redisKey = `ratelimit:${key}`;
    const current = await redis.incr(redisKey);
    
    if (current === 1) {
      await redis.expire(redisKey, windowSeconds);
    }

    const ttl = await redis.ttl(redisKey);
    
    return {
      allowed: current <= maxRequests,
      remaining: Math.max(0, maxRequests - current),
      resetTime: Date.now() + (ttl * 1000),
    };
  },

  /**
   * Reset rate limit for a key
   */
  async reset(key) {
    if (!redis) return;
    await redis.del(`ratelimit:${key}`);
  },
};

// =============================================================================
// SESSION MANAGEMENT
// =============================================================================

const session = {
  /**
   * Store session data
   */
  async set(sessionId, data, ttlSeconds = 86400) {
    if (!redis) return false;
    const key = `session:${sessionId}`;
    await redis.setex(key, ttlSeconds, JSON.stringify(data));
    return true;
  },

  /**
   * Get session data
   */
  async get(sessionId) {
    if (!redis) return null;
    const key = `session:${sessionId}`;
    const data = await redis.get(key);
    return data ? JSON.parse(data) : null;
  },

  /**
   * Delete session
   */
  async destroy(sessionId) {
    if (!redis) return false;
    const key = `session:${sessionId}`;
    await redis.del(key);
    return true;
  },

  /**
   * Extend session TTL
   */
  async extend(sessionId, ttlSeconds = 86400) {
    if (!redis) return false;
    const key = `session:${sessionId}`;
    await redis.expire(key, ttlSeconds);
    return true;
  },
};

module.exports = {
  initRedis,
  closeRedis,
  getRedis,
  getPubSub,
  cache,
  inventory,
  rateLimit,
  session,
};
