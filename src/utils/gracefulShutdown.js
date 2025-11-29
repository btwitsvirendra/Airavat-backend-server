// =============================================================================
// AIRAVAT B2B MARKETPLACE - GRACEFUL SHUTDOWN
// Handles graceful shutdown for zero-downtime deployments
// =============================================================================

const logger = require('../config/logger');
const { prisma } = require('../config/database');
const { redis, cache } = require('../config/redis');

class GracefulShutdown {
  constructor() {
    this.isShuttingDown = false;
    this.connections = new Set();
    this.shutdownCallbacks = [];
    this.shutdownTimeout = 30000; // 30 seconds
    this.server = null;
    this.io = null;
  }

  /**
   * Initialize shutdown handlers
   */
  init(server, io = null) {
    this.server = server;
    this.io = io;

    // Track connections
    server.on('connection', (socket) => {
      this.connections.add(socket);
      socket.on('close', () => {
        this.connections.delete(socket);
      });
    });

    // Register signal handlers
    process.on('SIGTERM', () => this.shutdown('SIGTERM'));
    process.on('SIGINT', () => this.shutdown('SIGINT'));
    process.on('SIGHUP', () => this.shutdown('SIGHUP'));

    // Handle uncaught exceptions
    process.on('uncaughtException', (error) => {
      logger.error('Uncaught exception', { error: error.message, stack: error.stack });
      this.shutdown('uncaughtException');
    });

    // Handle unhandled promise rejections
    process.on('unhandledRejection', (reason, promise) => {
      logger.error('Unhandled rejection', { reason: reason?.toString() });
      this.shutdown('unhandledRejection');
    });

    logger.info('Graceful shutdown handlers registered');
  }

  /**
   * Register a callback to run during shutdown
   */
  onShutdown(callback, priority = 10) {
    this.shutdownCallbacks.push({ callback, priority });
    // Sort by priority (lower number = higher priority)
    this.shutdownCallbacks.sort((a, b) => a.priority - b.priority);
  }

  /**
   * Perform graceful shutdown
   */
  async shutdown(signal) {
    if (this.isShuttingDown) {
      logger.warn('Shutdown already in progress');
      return;
    }

    this.isShuttingDown = true;
    logger.info(`Received ${signal}, starting graceful shutdown...`);

    // Set a timeout for forced shutdown
    const forceShutdownTimer = setTimeout(() => {
      logger.error('Shutdown timeout exceeded, forcing exit');
      process.exit(1);
    }, this.shutdownTimeout);

    try {
      // 1. Stop accepting new connections
      await this.stopAcceptingConnections();

      // 2. Wait for existing requests to complete
      await this.waitForConnectionsDrain();

      // 3. Close WebSocket connections
      await this.closeWebSockets();

      // 4. Run custom shutdown callbacks
      await this.runShutdownCallbacks();

      // 5. Close database connections
      await this.closeDatabaseConnections();

      // 6. Close Redis connections
      await this.closeRedisConnections();

      // 7. Flush logs
      await this.flushLogs();

      clearTimeout(forceShutdownTimer);
      logger.info('Graceful shutdown completed');
      process.exit(0);
    } catch (error) {
      clearTimeout(forceShutdownTimer);
      logger.error('Error during shutdown', { error: error.message });
      process.exit(1);
    }
  }

  /**
   * Stop accepting new connections
   */
  async stopAcceptingConnections() {
    return new Promise((resolve, reject) => {
      if (!this.server) {
        resolve();
        return;
      }

      logger.info('Stopping acceptance of new connections...');

      this.server.close((err) => {
        if (err) {
          logger.error('Error closing server', { error: err.message });
          reject(err);
        } else {
          logger.info('Server closed, no longer accepting connections');
          resolve();
        }
      });
    });
  }

  /**
   * Wait for existing connections to drain
   */
  async waitForConnectionsDrain(timeout = 10000) {
    logger.info(`Waiting for ${this.connections.size} connections to drain...`);

    const startTime = Date.now();

    return new Promise((resolve) => {
      const checkConnections = () => {
        if (this.connections.size === 0) {
          logger.info('All connections drained');
          resolve();
          return;
        }

        if (Date.now() - startTime > timeout) {
          logger.warn(`Timeout waiting for connections, forcing close of ${this.connections.size} connections`);
          this.forceCloseConnections();
          resolve();
          return;
        }

        setTimeout(checkConnections, 100);
      };

      checkConnections();
    });
  }

  /**
   * Force close remaining connections
   */
  forceCloseConnections() {
    for (const socket of this.connections) {
      socket.destroy();
    }
    this.connections.clear();
  }

  /**
   * Close WebSocket connections
   */
  async closeWebSockets() {
    if (!this.io) return;

    logger.info('Closing WebSocket connections...');

    return new Promise((resolve) => {
      // Notify all connected clients
      this.io.emit('server:shutdown', { message: 'Server is shutting down' });

      // Close all sockets
      this.io.close(() => {
        logger.info('WebSocket server closed');
        resolve();
      });

      // Timeout for WebSocket close
      setTimeout(resolve, 5000);
    });
  }

  /**
   * Run custom shutdown callbacks
   */
  async runShutdownCallbacks() {
    logger.info(`Running ${this.shutdownCallbacks.length} shutdown callbacks...`);

    for (const { callback } of this.shutdownCallbacks) {
      try {
        await callback();
      } catch (error) {
        logger.error('Shutdown callback failed', { error: error.message });
      }
    }
  }

  /**
   * Close database connections
   */
  async closeDatabaseConnections() {
    logger.info('Closing database connections...');

    try {
      await prisma.$disconnect();
      logger.info('Database connections closed');
    } catch (error) {
      logger.error('Error closing database', { error: error.message });
    }
  }

  /**
   * Close Redis connections
   */
  async closeRedisConnections() {
    logger.info('Closing Redis connections...');

    try {
      if (redis?.quit) {
        await redis.quit();
      }
      if (cache?.redis?.quit) {
        await cache.redis.quit();
      }
      logger.info('Redis connections closed');
    } catch (error) {
      logger.error('Error closing Redis', { error: error.message });
    }
  }

  /**
   * Flush any remaining logs
   */
  async flushLogs() {
    logger.info('Flushing logs...');

    return new Promise((resolve) => {
      // Give Winston time to flush
      setTimeout(resolve, 1000);
    });
  }

  /**
   * Check if server is shutting down
   */
  isShuttingDownCheck() {
    return this.isShuttingDown;
  }

  /**
   * Middleware to reject new requests during shutdown
   */
  middleware() {
    return (req, res, next) => {
      if (this.isShuttingDown) {
        res.setHeader('Connection', 'close');
        return res.status(503).json({
          success: false,
          error: 'Server is shutting down',
          retryAfter: 30,
        });
      }
      next();
    };
  }

  /**
   * Health check that reflects shutdown state
   */
  healthCheck() {
    return (req, res) => {
      if (this.isShuttingDown) {
        return res.status(503).json({
          status: 'shutting_down',
          accepting_requests: false,
        });
      }

      res.json({
        status: 'healthy',
        accepting_requests: true,
        connections: this.connections.size,
      });
    };
  }
}

// Export singleton
const gracefulShutdown = new GracefulShutdown();

module.exports = gracefulShutdown;
