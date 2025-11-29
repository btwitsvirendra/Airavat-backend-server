// =============================================================================
// AIRAVAT B2B MARKETPLACE - SERVER ENTRY POINT
// Application bootstrap with graceful shutdown handling
// =============================================================================

const http = require('http');
const app = require('./app');
const config = require('./config');
const logger = require('./config/logger');
const { connectDB, disconnectDB, prisma } = require('./config/database');
const { initRedis, closeRedis } = require('./config/redis');
const { initSocketIO } = require('./services/socket.service');

// Additional services
const gracefulShutdownHandler = require('./utils/gracefulShutdown');
const scheduledJobs = require('./jobs/scheduler');
const { jobQueue, initializeProcessors } = require('./services/jobQueue.service');
const performanceMonitor = require('./services/performance.service');
const { healthCheck } = require('./services/healthCheck.service');
const { errorTracking } = require('./services/errorTracking.service');
const cacheManager = require('./services/cacheManager.service');
const dbOptimizer = require('./utils/dbOptimizer');

// Create HTTP server
const server = http.createServer(app);

// Socket.IO instance holder
let io = null;

/**
 * Initialize all services and start server
 */
const startServer = async () => {
  try {
    logger.info('🚀 Starting Airavat B2B Marketplace Backend...');

    // Initialize error tracking first
    errorTracking.init();
    logger.info('📊 Error tracking initialized');

    // Connect to database
    await connectDB();
    logger.info('📦 Database connected');

    // Setup database query logging
    dbOptimizer.setupQueryLogging();

    // Initialize Redis
    const redisConnected = await initRedis();
    if (redisConnected) {
      logger.info('🔴 Redis connected');

      // Warm up cache
      await cacheManager.warmCache();
      logger.info('🔥 Cache warmed up');

      // Initialize job queue
      jobQueue.init();
      initializeProcessors();
      logger.info('📬 Job queues initialized');
    } else {
      logger.warn('⚠️ Redis not available - running with degraded performance');
    }

    // Initialize Socket.IO for real-time features
    io = initSocketIO(server);
    logger.info('🔌 Socket.IO initialized');

    // Initialize graceful shutdown handler
    gracefulShutdownHandler.init(server, io);

    // Register additional shutdown callbacks
    gracefulShutdownHandler.onShutdown(async () => {
      logger.info('Stopping scheduled jobs...');
      scheduledJobs.stop();
    }, 1);

    gracefulShutdownHandler.onShutdown(async () => {
      logger.info('Closing job queues...');
      await jobQueue.close();
    }, 2);

    gracefulShutdownHandler.onShutdown(async () => {
      logger.info('Flushing error tracking...');
      await errorTracking.shutdown();
    }, 3);

    // Start performance monitoring
    performanceMonitor.start();
    logger.info('📈 Performance monitoring started');

    // Start health checks
    healthCheck.startPeriodicChecks();
    logger.info('💚 Health checks started');

    // Initialize scheduled jobs
    scheduledJobs.init();
    scheduledJobs.start();
    logger.info('⏰ Scheduled jobs started');

    // Start HTTP server
    const port = config.app.port || 5000;
    server.listen(port, () => {
      const env = config.app.env || process.env.NODE_ENV || 'development';
      const apiUrl = `http://localhost:${port}/api/${config.app.apiVersion || 'v1'}`;
      
      logger.info(`
╔═══════════════════════════════════════════════════════════════════╗
║                                                                   ║
║   🚀 AIRAVAT B2B MARKETPLACE BACKEND                              ║
║                                                                   ║
║   ✅ Server Status: RUNNING                                       ║
║   🌍 Environment: ${env.toUpperCase().padEnd(44)}║
║   🔌 Port: ${String(port).padEnd(52)}║
║   📡 API: ${apiUrl.padEnd(52)}║
║   📚 Docs: ${'http://localhost:' + port + '/api-docs'.padEnd(47)}║
║   💚 Health: ${'http://localhost:' + port + '/health'.padEnd(45)}║
║                                                                   ║
║   Services:                                                       ║
║   ├─ 📦 Database: Connected                                       ║
║   ├─ 🔴 Redis: ${redisConnected ? 'Connected' : 'Not Available'}${' '.repeat(redisConnected ? 39 : 34)}║
║   ├─ 🔌 WebSocket: Active                                         ║
║   ├─ 📬 Job Queues: ${redisConnected ? 'Active' : 'Disabled'}${' '.repeat(redisConnected ? 41 : 40)}║
║   ├─ ⏰ Scheduler: Active                                         ║
║   └─ 📈 Monitoring: Active                                        ║
║                                                                   ║
╚═══════════════════════════════════════════════════════════════════╝
      `);
    });

    // Handle server errors
    server.on('error', (error) => {
      if (error.code === 'EADDRINUSE') {
        logger.error(`Port ${port} is already in use`);
      } else {
        logger.error('Server error:', error);
      }
      process.exit(1);
    });

  } catch (error) {
    logger.error('Failed to start server:', error);
    errorTracking.captureException(error, {
      tags: { phase: 'startup' },
      severity: 'fatal',
    });
    process.exit(1);
  }
};

/**
 * Graceful shutdown handler (fallback if gracefulShutdown utility fails)
 */
const gracefulShutdown = async (signal) => {
  logger.info(`\n${signal} received. Starting graceful shutdown...`);

  // Use the graceful shutdown handler
  await gracefulShutdownHandler.shutdown(signal);
};

// Handle shutdown signals
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

// Handle uncaught exceptions
process.on('uncaughtException', (error) => {
  logger.error('Uncaught Exception:', error);
  errorTracking.captureException(error, {
    tags: { type: 'uncaughtException' },
    severity: 'fatal',
  });
  gracefulShutdown('UNCAUGHT_EXCEPTION');
});

// Handle unhandled promise rejections
process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Rejection at:', promise, 'reason:', reason);
  errorTracking.captureException(reason instanceof Error ? reason : new Error(String(reason)), {
    tags: { type: 'unhandledRejection' },
    severity: 'fatal',
  });
  gracefulShutdown('UNHANDLED_REJECTION');
});

// Start the server
startServer();

module.exports = server;
