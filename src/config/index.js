// =============================================================================
// AIRAVAT B2B MARKETPLACE - CONFIGURATION
// Centralized configuration management
// =============================================================================

require('dotenv').config();

const config = {
  // Application
  app: {
    name: process.env.APP_NAME || 'Airavat',
    env: process.env.NODE_ENV || 'development',
    port: parseInt(process.env.PORT, 10) || 5000,
    apiVersion: process.env.API_VERSION || 'v1',
    url: process.env.APP_URL || 'http://localhost:5000',
    frontendUrl: process.env.FRONTEND_URL || 'http://localhost:3000',
    isDev: process.env.NODE_ENV === 'development',
    isProd: process.env.NODE_ENV === 'production',
    isTest: process.env.NODE_ENV === 'test',
  },

  // Database
  database: {
    url: process.env.DATABASE_URL,
  },

  // Redis
  redis: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT, 10) || 6379,
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_DB, 10) || 0,
    url: process.env.REDIS_URL || null,
  },

  // JWT Authentication
  jwt: {
    secret: process.env.JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d',
    refreshSecret: process.env.JWT_REFRESH_SECRET,
    refreshExpiresIn: process.env.JWT_REFRESH_EXPIRES_IN || '30d',
  },

  // Encryption
  encryption: {
    key: process.env.ENCRYPTION_KEY,
  },

  // AWS S3
  aws: {
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
    region: process.env.AWS_REGION || 'ap-south-1',
    s3Bucket: process.env.AWS_S3_BUCKET,
    s3Url: `https://${process.env.AWS_S3_BUCKET}.s3.${process.env.AWS_REGION || 'ap-south-1'}.amazonaws.com`,
  },

  // Razorpay
  razorpay: {
    keyId: process.env.RAZORPAY_KEY_ID,
    keySecret: process.env.RAZORPAY_KEY_SECRET,
    webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET,
  },

  // Email
  email: {
    host: process.env.SMTP_HOST,
    port: parseInt(process.env.SMTP_PORT, 10) || 587,
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASS,
    from: process.env.EMAIL_FROM || 'Airavat <noreply@airavat.com>',
  },

  // SMS
  sms: {
    provider: process.env.SMS_PROVIDER || 'msg91',
    msg91: {
      authKey: process.env.MSG91_AUTH_KEY,
      senderId: process.env.MSG91_SENDER_ID || 'AIRAVT',
      templateId: process.env.MSG91_TEMPLATE_ID,
    },
  },

  // Shiprocket
  shiprocket: {
    email: process.env.SHIPROCKET_EMAIL,
    password: process.env.SHIPROCKET_PASSWORD,
    apiUrl: process.env.SHIPROCKET_API_URL || 'https://apiv2.shiprocket.in/v1/external',
  },

  // Elasticsearch
  elasticsearch: {
    node: process.env.ELASTICSEARCH_NODE || 'http://localhost:9200',
    username: process.env.ELASTICSEARCH_USERNAME,
    password: process.env.ELASTICSEARCH_PASSWORD,
  },

  // Firebase
  firebase: {
    projectId: process.env.FIREBASE_PROJECT_ID,
    privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n'),
    clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
  },

  // GST APIs
  gst: {
    apiUrl: process.env.GST_API_URL,
    apiKey: process.env.GST_API_KEY,
    apiSecret: process.env.GST_API_SECRET,
  },

  // Rate Limiting
  rateLimit: {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS, 10) || 15 * 60 * 1000, // 15 minutes
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS, 10) || 100,
  },

  // Logging
  logging: {
    level: process.env.LOG_LEVEL || 'info',
    filePath: process.env.LOG_FILE_PATH || 'logs/app.log',
  },

  // Sentry
  sentry: {
    dsn: process.env.SENTRY_DSN,
  },

  // Feature Flags
  features: {
    rfqEnabled: process.env.FEATURE_RFQ_ENABLED === 'true',
    chatEnabled: process.env.FEATURE_CHAT_ENABLED === 'true',
    promotionsEnabled: process.env.FEATURE_PROMOTIONS_ENABLED === 'true',
    bnplEnabled: process.env.FEATURE_BNPL_ENABLED === 'true',
  },

  // Admin
  admin: {
    email: process.env.SUPER_ADMIN_EMAIL || 'admin@airavat.com',
    password: process.env.SUPER_ADMIN_PASSWORD,
  },

  // Business Rules
  businessRules: {
    // Listing allocation
    organicListingPercentage: 90,
    paidListingPercentage: 10,
    
    // Commission rates (default, can be overridden per category)
    defaultCommissionRate: 5, // 5%
    
    // Trust Score weights
    trustScoreWeights: {
      verificationStatus: 30,
      reviewRating: 25,
      responseRate: 15,
      orderCompletion: 15,
      accountAge: 10,
      documentVerification: 5,
    },
    
    // Organic ranking factors
    organicRankingWeights: {
      trustScore: 25,
      reviewRating: 20,
      reviewCount: 10,
      responseRate: 10,
      orderCount: 10,
      productQuality: 10,
      recency: 10,
      categoryRelevance: 5,
    },
    
    // Payment escrow
    escrowHoldDays: 7, // Days to hold payment after delivery
    
    // Session
    sessionMaxAge: 7 * 24 * 60 * 60 * 1000, // 7 days
    
    // OTP
    otpExpiryMinutes: 10,
    otpMaxAttempts: 5,
    
    // File upload
    maxFileSize: 10 * 1024 * 1024, // 10MB
    allowedImageTypes: ['image/jpeg', 'image/png', 'image/webp'],
    allowedDocTypes: ['application/pdf', 'image/jpeg', 'image/png'],
  },
};

// Validate required configuration
const validateConfig = () => {
  const required = [
    'jwt.secret',
    'jwt.refreshSecret',
  ];

  const missing = required.filter((key) => {
    const keys = key.split('.');
    let value = config;
    for (const k of keys) {
      value = value?.[k];
    }
    return !value;
  });

  if (missing.length > 0 && config.app.isProd) {
    throw new Error(`Missing required configuration: ${missing.join(', ')}`);
  }

  if (missing.length > 0) {
    console.warn(`⚠️  Missing configuration (OK for development): ${missing.join(', ')}`);
  }
};

validateConfig();

module.exports = config;
