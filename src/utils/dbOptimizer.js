// =============================================================================
// AIRAVAT B2B MARKETPLACE - DATABASE OPTIMIZATION UTILITIES
// Query optimization, connection pooling, and performance monitoring
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');

class DatabaseOptimizer {
  constructor() {
    this.slowQueryThreshold = 1000; // 1 second
    this.queryStats = new Map();
    this.connectionStats = {
      active: 0,
      idle: 0,
      waiting: 0,
    };
  }

  // ===========================================================================
  // QUERY MONITORING
  // ===========================================================================

  /**
   * Setup Prisma query logging middleware
   */
  setupQueryLogging() {
    prisma.$use(async (params, next) => {
      const startTime = Date.now();
      const result = await next(params);
      const duration = Date.now() - startTime;

      // Track query stats
      const key = `${params.model}.${params.action}`;
      if (!this.queryStats.has(key)) {
        this.queryStats.set(key, {
          count: 0,
          totalDuration: 0,
          avgDuration: 0,
          maxDuration: 0,
          slowCount: 0,
        });
      }

      const stats = this.queryStats.get(key);
      stats.count++;
      stats.totalDuration += duration;
      stats.avgDuration = stats.totalDuration / stats.count;
      stats.maxDuration = Math.max(stats.maxDuration, duration);

      if (duration > this.slowQueryThreshold) {
        stats.slowCount++;
        logger.warn('Slow query detected', {
          model: params.model,
          action: params.action,
          duration,
          args: this.sanitizeArgs(params.args),
        });
      }

      return result;
    });

    logger.info('Database query logging enabled');
  }

  /**
   * Sanitize query arguments for logging (remove sensitive data)
   */
  sanitizeArgs(args) {
    if (!args) return {};

    const sanitized = { ...args };

    // Remove sensitive fields
    const sensitiveFields = ['password', 'token', 'secret', 'apiKey'];
    
    const sanitize = (obj) => {
      if (typeof obj !== 'object' || obj === null) return obj;

      const result = Array.isArray(obj) ? [] : {};
      
      for (const [key, value] of Object.entries(obj)) {
        if (sensitiveFields.some((f) => key.toLowerCase().includes(f))) {
          result[key] = '***';
        } else if (typeof value === 'object') {
          result[key] = sanitize(value);
        } else {
          result[key] = value;
        }
      }

      return result;
    };

    return sanitize(sanitized);
  }

  /**
   * Get query statistics
   */
  getQueryStats() {
    const stats = {};
    for (const [key, value] of this.queryStats) {
      stats[key] = { ...value };
    }
    return stats;
  }

  /**
   * Get slow queries
   */
  getSlowQueries() {
    const slow = [];
    for (const [key, stats] of this.queryStats) {
      if (stats.slowCount > 0) {
        slow.push({
          query: key,
          slowCount: stats.slowCount,
          avgDuration: stats.avgDuration,
          maxDuration: stats.maxDuration,
        });
      }
    }
    return slow.sort((a, b) => b.slowCount - a.slowCount);
  }

  /**
   * Reset query statistics
   */
  resetQueryStats() {
    this.queryStats.clear();
  }

  // ===========================================================================
  // QUERY OPTIMIZATION HELPERS
  // ===========================================================================

  /**
   * Paginated query helper
   */
  paginate(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const take = Math.min(limit, 100); // Cap at 100

    return { skip, take };
  }

  /**
   * Cursor-based pagination helper (more efficient for large datasets)
   */
  cursorPaginate(cursor, limit = 20) {
    const take = Math.min(limit, 100);
    
    if (cursor) {
      return {
        take: take + 1, // Fetch one extra to check if there's more
        cursor: { id: cursor },
        skip: 1, // Skip the cursor item
      };
    }

    return { take: take + 1 };
  }

  /**
   * Process cursor pagination results
   */
  processCursorResult(items, limit) {
    const hasMore = items.length > limit;
    const data = hasMore ? items.slice(0, -1) : items;
    const nextCursor = hasMore ? data[data.length - 1]?.id : null;

    return { data, hasMore, nextCursor };
  }

  /**
   * Build dynamic where clause
   */
  buildWhereClause(filters = {}, allowedFields = []) {
    const where = {};

    for (const [field, value] of Object.entries(filters)) {
      if (!allowedFields.includes(field) || value === undefined || value === null) {
        continue;
      }

      // Handle different filter types
      if (typeof value === 'object' && !Array.isArray(value)) {
        // Range queries
        if (value.min !== undefined || value.max !== undefined) {
          where[field] = {};
          if (value.min !== undefined) where[field].gte = value.min;
          if (value.max !== undefined) where[field].lte = value.max;
        }
        // Contains query
        else if (value.contains !== undefined) {
          where[field] = { contains: value.contains, mode: 'insensitive' };
        }
        // In query
        else if (value.in !== undefined) {
          where[field] = { in: value.in };
        }
      }
      // Array - use IN query
      else if (Array.isArray(value)) {
        where[field] = { in: value };
      }
      // String with wildcards
      else if (typeof value === 'string' && (value.includes('*') || value.includes('%'))) {
        where[field] = { contains: value.replace(/[*%]/g, ''), mode: 'insensitive' };
      }
      // Exact match
      else {
        where[field] = value;
      }
    }

    return where;
  }

  /**
   * Build sort clause
   */
  buildOrderBy(sort, allowedFields = []) {
    if (!sort) return undefined;

    const [field, direction] = sort.split(':');
    
    if (!allowedFields.includes(field)) {
      return undefined;
    }

    return { [field]: direction?.toLowerCase() === 'desc' ? 'desc' : 'asc' };
  }

  /**
   * Optimize select for partial data
   */
  selectFields(fields = [], model) {
    if (!fields.length) return undefined;

    const select = {};
    for (const field of fields) {
      if (field.includes('.')) {
        // Nested field
        const [relation, subField] = field.split('.');
        if (!select[relation]) {
          select[relation] = { select: {} };
        }
        select[relation].select[subField] = true;
      } else {
        select[field] = true;
      }
    }

    return select;
  }

  // ===========================================================================
  // BATCH OPERATIONS
  // ===========================================================================

  /**
   * Batch insert with chunking
   */
  async batchInsert(model, data, chunkSize = 1000) {
    const chunks = [];
    for (let i = 0; i < data.length; i += chunkSize) {
      chunks.push(data.slice(i, i + chunkSize));
    }

    const results = [];
    for (const chunk of chunks) {
      const result = await prisma[model].createMany({
        data: chunk,
        skipDuplicates: true,
      });
      results.push(result);
    }

    return {
      inserted: results.reduce((sum, r) => sum + r.count, 0),
      chunks: results.length,
    };
  }

  /**
   * Batch update with chunking
   */
  async batchUpdate(model, updates, idField = 'id', chunkSize = 500) {
    const chunks = [];
    for (let i = 0; i < updates.length; i += chunkSize) {
      chunks.push(updates.slice(i, i + chunkSize));
    }

    let updated = 0;
    for (const chunk of chunks) {
      await prisma.$transaction(
        chunk.map((item) =>
          prisma[model].update({
            where: { [idField]: item[idField] },
            data: item,
          })
        )
      );
      updated += chunk.length;
    }

    return { updated };
  }

  /**
   * Batch delete with chunking
   */
  async batchDelete(model, ids, chunkSize = 1000) {
    const chunks = [];
    for (let i = 0; i < ids.length; i += chunkSize) {
      chunks.push(ids.slice(i, i + chunkSize));
    }

    let deleted = 0;
    for (const chunk of chunks) {
      const result = await prisma[model].deleteMany({
        where: { id: { in: chunk } },
      });
      deleted += result.count;
    }

    return { deleted };
  }

  // ===========================================================================
  // TRANSACTION HELPERS
  // ===========================================================================

  /**
   * Execute in transaction with retry
   */
  async withTransaction(fn, options = {}) {
    const { maxRetries = 3, isolationLevel = 'ReadCommitted' } = options;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await prisma.$transaction(fn, {
          isolationLevel,
          timeout: 30000,
        });
      } catch (error) {
        // Retry on deadlock or serialization failure
        if (
          error.code === 'P2034' || // Transaction conflict
          error.message.includes('deadlock') ||
          error.message.includes('serialization')
        ) {
          if (attempt < maxRetries) {
            logger.warn('Transaction retry', { attempt, error: error.message });
            await new Promise((r) => setTimeout(r, 100 * attempt));
            continue;
          }
        }
        throw error;
      }
    }
  }

  /**
   * Sequential transaction for ordered operations
   */
  async sequentialTransaction(operations) {
    return prisma.$transaction(operations, {
      isolationLevel: 'Serializable',
    });
  }

  // ===========================================================================
  // CONNECTION MANAGEMENT
  // ===========================================================================

  /**
   * Health check for database connection
   */
  async healthCheck() {
    try {
      const start = Date.now();
      await prisma.$queryRaw`SELECT 1`;
      const latency = Date.now() - start;

      return {
        healthy: true,
        latency,
        status: 'connected',
      };
    } catch (error) {
      return {
        healthy: false,
        error: error.message,
        status: 'disconnected',
      };
    }
  }

  /**
   * Get connection pool stats (for pg)
   */
  async getPoolStats() {
    try {
      const result = await prisma.$queryRaw`
        SELECT 
          numbackends as active,
          (SELECT count(*) FROM pg_stat_activity WHERE state = 'idle') as idle,
          (SELECT count(*) FROM pg_stat_activity WHERE wait_event_type = 'Client') as waiting
        FROM pg_stat_database 
        WHERE datname = current_database()
      `;

      return result[0] || this.connectionStats;
    } catch (error) {
      logger.error('Failed to get pool stats', { error: error.message });
      return this.connectionStats;
    }
  }

  /**
   * Disconnect and reconnect (useful for connection issues)
   */
  async reconnect() {
    logger.info('Reconnecting to database...');
    await prisma.$disconnect();
    await prisma.$connect();
    logger.info('Database reconnected');
  }

  // ===========================================================================
  // INDEX RECOMMENDATIONS
  // ===========================================================================

  /**
   * Analyze slow queries and suggest indexes
   */
  getIndexRecommendations() {
    const recommendations = [];
    const slowQueries = this.getSlowQueries();

    for (const query of slowQueries) {
      const [model, action] = query.query.split('.');

      if (['findMany', 'findFirst', 'count'].includes(action)) {
        recommendations.push({
          model,
          action,
          avgDuration: query.avgDuration,
          suggestion: `Consider adding an index on frequently filtered columns in ${model}`,
        });
      }
    }

    return recommendations;
  }

  /**
   * Get table statistics
   */
  async getTableStats() {
    try {
      const result = await prisma.$queryRaw`
        SELECT 
          schemaname,
          relname as table_name,
          n_tup_ins as inserts,
          n_tup_upd as updates,
          n_tup_del as deletes,
          n_live_tup as live_rows,
          n_dead_tup as dead_rows,
          last_vacuum,
          last_autovacuum,
          last_analyze,
          last_autoanalyze
        FROM pg_stat_user_tables
        ORDER BY n_live_tup DESC
      `;

      return result;
    } catch (error) {
      logger.error('Failed to get table stats', { error: error.message });
      return [];
    }
  }

  /**
   * Get index usage statistics
   */
  async getIndexStats() {
    try {
      const result = await prisma.$queryRaw`
        SELECT 
          schemaname,
          relname as table_name,
          indexrelname as index_name,
          idx_scan as scans,
          idx_tup_read as tuples_read,
          idx_tup_fetch as tuples_fetched
        FROM pg_stat_user_indexes
        ORDER BY idx_scan DESC
      `;

      return result;
    } catch (error) {
      logger.error('Failed to get index stats', { error: error.message });
      return [];
    }
  }
}

// Export singleton
const dbOptimizer = new DatabaseOptimizer();

module.exports = dbOptimizer;
