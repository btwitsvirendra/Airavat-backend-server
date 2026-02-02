// =============================================================================
// AIRAVAT B2B MARKETPLACE - EXPRESS APPLICATION
// Main application setup with all middleware and routes
// =============================================================================

const express = require('express');
const helmet = require('helmet');
const compression = require('compression');
const morgan = require('morgan');
const cookieParser = require('cookie-parser');
const path = require('path');

const config = require('./config');
const logger = require('./config/logger');
const { corsMiddleware, securityHeaders, corsErrorHandler } = require('./config/cors');
const { notFoundHandler, errorHandler } = require('./middleware/errorHandler');
const { apiLimiter } = require('./middleware/rateLimiter');
const { advancedRateLimiter } = require('./middleware/advancedRateLimiter.middleware');
const { requestLogger, errorLogger, requestContext } = require('./middleware/requestLogger.middleware');
const { tracingMiddleware, tracedLogger } = require('./middleware/tracing.middleware');
const { sanitizationMiddleware } = require('./middleware/sanitization.middleware');
const { versioningMiddleware } = require('./middleware/versioning.middleware');
const { paginationMiddleware } = require('./utils/pagination');
const { responseHelpers } = require('./utils/apiResponse');
const { router: healthRouter } = require('./services/healthCheck.service');
const { errorTracking } = require('./services/errorTracking.service');
const performanceMonitor = require('./services/performance.service');

// Import routes
const authRoutes = require('./routes/auth.routes');
const userRoutes = require('./routes/user.routes');
const businessRoutes = require('./routes/business.routes');
const categoryRoutes = require('./routes/category.routes');
const productRoutes = require('./routes/product.routes');
const cartRoutes = require('./routes/cart.routes');
const orderRoutes = require('./routes/order.routes');
const rfqRoutes = require('./routes/rfq.routes');
const chatRoutes = require('./routes/chat.routes');
const paymentRoutes = require('./routes/payment.routes');
const reviewRoutes = require('./routes/review.routes');
const subscriptionRoutes = require('./routes/subscription.routes');
const promotionRoutes = require('./routes/promotion.routes');
const searchRoutes = require('./routes/search.routes');
const adminRoutes = require('./routes/admin.routes');
const webhookRoutes = require('./routes/webhook.routes');
const uploadRoutes = require('./routes/upload.routes');
const metricsRoutes = require('./routes/metrics.routes');
const bookingRoutes = require('./routes/booking.routes');
const logisticsRoutes = require('./routes/logistics.routes');

// V2 Feature Routes - Enhanced B2B Trading
const wishlistRoutes = require('./routes/wishlist.routes');
const alertRoutes = require('./routes/alert.routes');
const orderTemplateRoutes = require('./routes/orderTemplate.routes');
const quickOrderRoutes = require('./routes/quickOrder.routes');
const sampleRoutes = require('./routes/sample.routes');
const auctionRoutes = require('./routes/auction.routes');
const contractRoutes = require('./routes/contract.routes');
const approvalRoutes = require('./routes/approval.routes');
const loyaltyRoutes = require('./routes/loyalty.routes');
const tradeAssuranceRoutes = require('./routes/tradeAssurance.routes');
const vendorScorecardRoutes = require('./routes/vendorScorecard.routes');

// V3 Feature Routes - Financial, GST Compliance, Security
const v3Routes = require('./routes/v3.index');

// Create Express app
const app = express();

// Trust proxy for accurate IP addresses behind reverse proxy
app.set('trust proxy', 1);

// Disable x-powered-by header
app.disable('x-powered-by');

// =============================================================================
// ERROR TRACKING (Initialize first to capture all errors)
// =============================================================================

if (errorTracking.requestHandler) {
  app.use(errorTracking.requestHandler());
}

// =============================================================================
// REQUEST TRACING & CORRELATION IDS
// =============================================================================

app.use(tracingMiddleware());
app.use(requestContext());

// =============================================================================
// SECURITY MIDDLEWARE
// =============================================================================

// Helmet security headers
app.use(helmet({
  contentSecurityPolicy: config.app.isProd ? {
    directives: {
      defaultSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
      fontSrc: ["'self'", "https://fonts.gstatic.com"],
      imgSrc: ["'self'", "data:", "https:", "blob:"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdnjs.cloudflare.com"],
      connectSrc: ["'self'", "https://api.airavat.com", "wss://api.airavat.com"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  } : false,
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: { policy: "cross-origin" },
}));

// Additional security headers
app.use(securityHeaders());

// CORS configuration
app.use(corsMiddleware());
app.use(corsErrorHandler);

// =============================================================================
// BODY PARSING
// =============================================================================

// Webhooks need raw body for signature verification
app.use('/api/v1/webhooks', express.raw({ type: 'application/json' }));

// JSON body parser
app.use(express.json({ 
  limit: '10mb',
  verify: (req, res, buf) => {
    // Store raw body for signature verification if needed
    req.rawBody = buf;
  },
}));

// URL-encoded body parser
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Cookie parser
app.use(cookieParser(process.env.COOKIE_SECRET));

// =============================================================================
// INPUT SANITIZATION
// =============================================================================

app.use(sanitizationMiddleware({
  blockOnThreat: process.env.NODE_ENV === 'production',
  logThreats: true,
  sanitizeAll: true,
}));

// =============================================================================
// COMPRESSION & LOGGING
// =============================================================================

// Gzip compression (skip for already compressed assets)
app.use(compression({
  filter: (req, res) => {
    if (req.headers['x-no-compression']) return false;
    return compression.filter(req, res);
  },
  level: 6,
  threshold: 1024, // Only compress responses > 1KB
}));

// Request logging
app.use(requestLogger({
  excludePaths: ['/health', '/health/live', '/health/ready', '/favicon.ico'],
}));

// Morgan for access logs (production format)
if (config.app.isProd) {
  app.use(morgan('combined', {
    stream: { write: (message) => logger.info(message.trim()) },
    skip: (req) => req.path === '/health',
  }));
} else {
  app.use(morgan('dev'));
}

// =============================================================================
// RESPONSE HELPERS & PAGINATION
// =============================================================================

app.use(responseHelpers);
app.use(paginationMiddleware({ maxLimit: 100, defaultLimit: 20 }));

// =============================================================================
// PERFORMANCE MONITORING
// =============================================================================

app.use(performanceMonitor.middleware());

// =============================================================================
// RATE LIMITING
// =============================================================================

// Apply advanced rate limiting to all API routes
app.use('/api', advancedRateLimiter({
  enableBurstProtection: true,
  enableGlobalProtection: true,
  skipPaths: ['/api/v1/webhooks'],
}));

// Legacy rate limiter as backup
app.use('/api', apiLimiter);

// =============================================================================
// API VERSIONING
// =============================================================================

app.use('/api', versioningMiddleware({
  currentVersion: 'v1',
  supportedVersions: ['v1'],
  deprecatedVersions: [],
}));

// =============================================================================
// HEALTH CHECK & INFO
// =============================================================================

// Mount health check router
app.use('/health', healthRouter);

// Basic health check (for load balancers)
app.get('/ping', (req, res) => {
  res.send('pong');
});

// API info endpoint
app.get('/api', (req, res) => {
  res.json({
    name: config.app.name,
    version: config.app.apiVersion,
    documentation: `${config.app.url}/api-docs`,
    status: 'running',
    environment: process.env.NODE_ENV,
    timestamp: new Date().toISOString(),
  });
});

// =============================================================================
// API ROUTES
// =============================================================================

const apiRouter = express.Router();

// Mount routes
apiRouter.use('/auth', authRoutes);
apiRouter.use('/users', userRoutes);
apiRouter.use('/businesses', businessRoutes);
apiRouter.use('/categories', categoryRoutes);
apiRouter.use('/products', productRoutes);
apiRouter.use('/cart', cartRoutes);
apiRouter.use('/orders', orderRoutes);
apiRouter.use('/rfq', rfqRoutes);
apiRouter.use('/chat', chatRoutes);
apiRouter.use('/payments', paymentRoutes);
apiRouter.use('/reviews', reviewRoutes);
apiRouter.use('/subscriptions', subscriptionRoutes);
apiRouter.use('/promotions', promotionRoutes);
apiRouter.use('/search', searchRoutes);
apiRouter.use('/admin', adminRoutes);
apiRouter.use('/webhooks', webhookRoutes);
apiRouter.use('/upload', uploadRoutes);
apiRouter.use('/metrics', metricsRoutes);
apiRouter.use('/bookings', bookingRoutes);
apiRouter.use('/logistics', logisticsRoutes);

// V2 Feature Routes - Enhanced B2B Trading
apiRouter.use('/wishlists', wishlistRoutes);
apiRouter.use('/alerts', alertRoutes);
apiRouter.use('/order-templates', orderTemplateRoutes);
apiRouter.use('/quick-order', quickOrderRoutes);
apiRouter.use('/samples', sampleRoutes);
apiRouter.use('/auctions', auctionRoutes);
apiRouter.use('/contracts', contractRoutes);
apiRouter.use('/approvals', approvalRoutes);
apiRouter.use('/loyalty', loyaltyRoutes);
apiRouter.use('/trade-assurance', tradeAssuranceRoutes);
apiRouter.use('/vendor-scorecards', vendorScorecardRoutes);

// V3 Feature Routes - Financial, GST Compliance, Security, Logistics
apiRouter.use('/', v3Routes);

// Mount API router with version prefix
app.use(`/api/${config.app.apiVersion}`, apiRouter);

// =============================================================================
// STATIC FILES (if needed)
// =============================================================================

// Serve static files in development
if (config.app.isDev) {
  app.use('/uploads', express.static(path.join(__dirname, '../uploads')));
}

// =============================================================================
// ERROR HANDLING
// =============================================================================

// Error logging middleware
app.use(errorLogger());

// Error tracking middleware (Sentry)
if (errorTracking.errorHandler) {
  app.use(errorTracking.errorHandler());
}

// 404 handler
app.use(notFoundHandler);

// Global error handler
app.use(errorHandler);

module.exports = app;
