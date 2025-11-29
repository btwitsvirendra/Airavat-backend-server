# AIRAVAT B2B MARKETPLACE - CODING STANDARDS & GUIDELINES
## For Claude/Cursor AI Code Generation

This document captures the exact coding patterns, conventions, and rules used throughout the Airavat backend. Follow these guidelines to generate consistent, production-quality code.

---

## TABLE OF CONTENTS

1. [General Principles](#1-general-principles)
2. [File Organization](#2-file-organization)
3. [Naming Conventions](#3-naming-conventions)
4. [Code Structure Patterns](#4-code-structure-patterns)
5. [Service Layer Pattern](#5-service-layer-pattern)
6. [Controller Layer Pattern](#6-controller-layer-pattern)
7. [Route Layer Pattern](#7-route-layer-pattern)
8. [Middleware Pattern](#8-middleware-pattern)
9. [Database & Prisma Patterns](#9-database--prisma-patterns)
10. [Error Handling](#10-error-handling)
11. [Validation Patterns](#11-validation-patterns)
12. [Testing Patterns](#12-testing-patterns)
13. [Security Practices](#13-security-practices)
14. [Documentation Standards](#14-documentation-standards)
15. [Financial Services Specific](#15-financial-services-specific)

---

## 1. GENERAL PRINCIPLES

### 1.1 Code Philosophy
```
- Write self-documenting code with clear variable/function names
- Prefer explicit over implicit
- Keep functions focused on single responsibility
- Maximum function length: ~50-80 lines (break into helpers if longer)
- Maximum file length: ~800-1000 lines (split into modules if longer)
- Always handle edge cases and errors
- Never trust user input - validate everything
- Log important operations for debugging
- Use async/await consistently (no mixing with .then())
```

### 1.2 Language & Runtime
```
- Node.js 18+ with ES6+ features
- CommonJS modules (require/module.exports)
- Express.js 4.x for HTTP
- Prisma ORM for database
- Jest for testing
```

### 1.3 Code Quality Checklist
Before completing any file, ensure:
- [ ] All functions have JSDoc comments
- [ ] Error handling is comprehensive
- [ ] Input validation exists
- [ ] Logging is in place for important operations
- [ ] No hardcoded values (use constants/config)
- [ ] Security considerations addressed
- [ ] Edge cases handled

---

## 2. FILE ORGANIZATION

### 2.1 Directory Structure
```
src/
├── app.js                 # Express app configuration
├── server.js              # Server entry point
├── config/                # Configuration files
│   ├── index.js           # Main config aggregator
│   ├── database.js        # Database connection
│   ├── redis.js           # Redis connection
│   ├── logger.js          # Winston logger setup
│   └── cors.js            # CORS configuration
├── controllers/           # Request handlers
│   └── [entity].controller.js
├── services/              # Business logic
│   └── [entity].service.js
├── routes/                # API routes
│   ├── index.js           # Route aggregator
│   └── [entity].routes.js
├── middleware/            # Express middleware
│   └── [name].middleware.js
├── validations/           # Joi schemas
│   └── [entity].validation.js
├── jobs/                  # Background jobs
│   ├── index.js
│   ├── queue.js
│   ├── processors.js
│   └── scheduler.js
├── utils/                 # Utility functions
│   ├── errors.js
│   ├── helpers.js
│   └── pagination.js
├── templates/             # Email/notification templates
└── tests/                 # Test files
    ├── unit/
    ├── integration/
    └── services/
```

### 2.2 File Naming
```
- Controllers: [entity].controller.js (e.g., financial.controller.js)
- Services: [entity].service.js (e.g., wallet.service.js)
- Routes: [entity].routes.js (e.g., financial.routes.js)
- Middleware: [name].middleware.js (e.g., auth.middleware.js)
- Tests: [entity].service.test.js or [entity].test.js
- Validations: [entity].validation.js
```

### 2.3 File Header Template
Every file MUST start with this header:
```javascript
// =============================================================================
// AIRAVAT B2B MARKETPLACE - [FILE DESCRIPTION IN CAPS]
// [Optional: Additional description of what this file does]
// =============================================================================
```

---

## 3. NAMING CONVENTIONS

### 3.1 Variables & Functions
```javascript
// Variables: camelCase
const userId = 'user_123';
const transactionAmount = 5000;
const isActive = true;

// Functions: camelCase, verb-first for actions
async function getUserById(id) {}
async function calculateEMI(principal, rate, tenure) {}
async function validateGSTNumber(gstNumber) {}
function formatCurrency(amount, currency) {}

// Boolean variables: is/has/can/should prefix
const isVerified = true;
const hasPermission = false;
const canEdit = true;
const shouldNotify = false;
```

### 3.2 Constants
```javascript
// SCREAMING_SNAKE_CASE for constants
const MAX_RETRY_ATTEMPTS = 3;
const DEFAULT_PAGE_SIZE = 20;
const CACHE_TTL_SECONDS = 3600;

// Configuration objects: SCREAMING_SNAKE_CASE
const WALLET_CONFIG = {
  maxDailyWithdrawal: 100000,
  minBalance: 0,
  currencies: ['INR', 'AED', 'USD'],
};
```

### 3.3 Database Fields (Prisma)
```javascript
// camelCase for field names
model User {
  id            String   @id @default(uuid())
  email         String   @unique
  businessId    String?  // Foreign keys: [entity]Id
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  isVerified    Boolean  @default(false)
  trustScore    Int      @default(50)
}
```

### 3.4 API Endpoints
```javascript
// kebab-case for URL paths
// RESTful naming
GET    /api/v1/financial/wallet/balance
POST   /api/v1/financial/wallet/credit
GET    /api/v1/financial/emi/plans
POST   /api/v1/financial/trade-finance/lc/create
PUT    /api/v1/admin/financial/emi/:id/approve
DELETE /api/v1/financial/cards/:id
```

### 3.5 Event Names
```javascript
// SCREAMING_SNAKE_CASE or dot.notation
const EVENTS = {
  WALLET_CREDITED: 'WALLET_CREDITED',
  EMI_PAYMENT_DUE: 'EMI_PAYMENT_DUE',
  // or
  'wallet.credited': 'wallet.credited',
  'emi.payment.due': 'emi.payment.due',
};
```

---

## 4. CODE STRUCTURE PATTERNS

### 4.1 Module Exports Pattern
```javascript
// =============================================================================
// AIRAVAT B2B MARKETPLACE - [SERVICE NAME]
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  maxItems: 100,
  defaultCurrency: 'INR',
};

// =============================================================================
// MAIN FUNCTIONS
// =============================================================================

/**
 * Function description
 * @param {string} param1 - Description
 * @returns {Promise<Object>} Description
 */
exports.functionName = async (param1) => {
  // Implementation
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function helperFunction() {
  // Implementation
}

// =============================================================================
// EXPORTS (if using module.exports style)
// =============================================================================

module.exports = exports;
```

### 4.2 Section Separators
Use these exact separators to organize code:
```javascript
// =============================================================================
// SECTION NAME IN CAPS
// =============================================================================
```

For sub-sections within a section:
```javascript
// -----------------------------------------------------------------------------
// Sub-section name
// -----------------------------------------------------------------------------
```

### 4.3 Import Order
```javascript
// 1. Node.js built-in modules
const crypto = require('crypto');
const path = require('path');

// 2. Third-party modules
const axios = require('axios');
const dayjs = require('dayjs');

// 3. Internal config/utils
const { prisma } = require('../config/database');
const logger = require('../config/logger');

// 4. Internal services
const walletService = require('./wallet.service');
const emailService = require('./email.service');

// 5. Constants/Types
const { WALLET_STATUS, TRANSACTION_TYPES } = require('../constants');
```

---

## 5. SERVICE LAYER PATTERN

### 5.1 Service File Structure
```javascript
// =============================================================================
// AIRAVAT B2B MARKETPLACE - [ENTITY] SERVICE
// [Description of what this service handles]
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  // Service-specific configuration
};

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

/**
 * Create a new [entity]
 * @param {string} userId - User ID
 * @param {Object} data - Entity data
 * @returns {Promise<Object>} Created entity
 */
exports.create = async (userId, data) => {
  try {
    // 1. Validate prerequisites
    // 2. Generate any IDs/numbers
    // 3. Create in database
    // 4. Log operation
    // 5. Return result
  } catch (error) {
    logger.error('Error creating [entity]', { error: error.message, userId });
    throw error;
  }
};

// =============================================================================
// READ OPERATIONS
// =============================================================================

exports.getById = async (id, userId) => {};
exports.getAll = async (filters, pagination) => {};
exports.search = async (query, options) => {};

// =============================================================================
// UPDATE OPERATIONS
// =============================================================================

exports.update = async (id, userId, data) => {};
exports.updateStatus = async (id, status, updatedBy) => {};

// =============================================================================
// DELETE OPERATIONS
// =============================================================================

exports.delete = async (id, userId) => {};
exports.softDelete = async (id, userId) => {};

// =============================================================================
// BUSINESS LOGIC OPERATIONS
// =============================================================================

exports.process = async (id, data) => {};
exports.approve = async (id, approvedBy, notes) => {};
exports.reject = async (id, rejectedBy, reason) => {};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function generateNumber(prefix) {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  return `${prefix}${year}${month}-${Date.now().toString().slice(-5)}`;
}

async function validateOwnership(entityId, userId) {
  // Verify user owns/has access to entity
}

// =============================================================================
// SCHEDULED/BATCH OPERATIONS
// =============================================================================

exports.processExpired = async () => {};
exports.sendReminders = async () => {};
exports.cleanupOld = async (daysOld) => {};

module.exports = exports;
```

### 5.2 Service Function Pattern
```javascript
/**
 * [Action description]
 * @param {string} entityId - Entity ID
 * @param {string} userId - User performing action
 * @param {Object} data - Action data
 * @param {number} data.amount - Amount (required)
 * @param {string} [data.notes] - Optional notes
 * @returns {Promise<Object>} Result object
 * @throws {AppError} If validation fails or entity not found
 */
exports.performAction = async (entityId, userId, data) => {
  // 1. Input validation (if not done in controller)
  if (!entityId || !userId) {
    throw new AppError('Entity ID and User ID are required', 400);
  }

  // 2. Fetch entity with ownership check
  const entity = await prisma.entity.findUnique({
    where: { id: entityId },
    include: { relatedEntity: true },
  });

  if (!entity) {
    throw new AppError('Entity not found', 404);
  }

  if (entity.userId !== userId) {
    throw new AppError('Not authorized to access this entity', 403);
  }

  // 3. Business logic validation
  if (entity.status !== 'ACTIVE') {
    throw new AppError('Entity must be active to perform this action', 400);
  }

  // 4. Perform operation (use transaction for multiple writes)
  const result = await prisma.$transaction(async (tx) => {
    // Update entity
    const updated = await tx.entity.update({
      where: { id: entityId },
      data: {
        field: data.value,
        updatedAt: new Date(),
      },
    });

    // Create related record
    await tx.entityLog.create({
      data: {
        entityId,
        action: 'ACTION_NAME',
        performedBy: userId,
        details: data,
      },
    });

    return updated;
  });

  // 5. Log operation
  logger.info('Action performed on entity', {
    entityId,
    userId,
    action: 'ACTION_NAME',
  });

  // 6. Return result
  return result;
};
```

### 5.3 Pagination Pattern
```javascript
exports.getAll = async (filters = {}, options = {}) => {
  const {
    page = 1,
    limit = 20,
    sortBy = 'createdAt',
    sortOrder = 'desc',
  } = options;

  const skip = (page - 1) * limit;

  // Build where clause
  const where = {};
  
  if (filters.status) {
    where.status = filters.status;
  }
  
  if (filters.startDate && filters.endDate) {
    where.createdAt = {
      gte: new Date(filters.startDate),
      lte: new Date(filters.endDate),
    };
  }

  if (filters.search) {
    where.OR = [
      { name: { contains: filters.search, mode: 'insensitive' } },
      { description: { contains: filters.search, mode: 'insensitive' } },
    ];
  }

  // Execute queries
  const [items, total] = await Promise.all([
    prisma.entity.findMany({
      where,
      skip,
      take: limit,
      orderBy: { [sortBy]: sortOrder },
      include: {
        user: { select: { id: true, name: true, email: true } },
      },
    }),
    prisma.entity.count({ where }),
  ]);

  return {
    items,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
      hasMore: skip + items.length < total,
    },
  };
};
```

---

## 6. CONTROLLER LAYER PATTERN

### 6.1 Controller File Structure
```javascript
// =============================================================================
// AIRAVAT B2B MARKETPLACE - [ENTITY] CONTROLLER
// Controller for [entity] management endpoints
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const entityService = require('../services/entity.service');
const logger = require('../config/logger');

// =============================================================================
// CREATE ENDPOINTS
// =============================================================================

/**
 * @desc    Create new [entity]
 * @route   POST /api/v1/[entities]
 * @access  Private
 */
exports.create = asyncHandler(async (req, res) => {
  const result = await entityService.create(req.user.id, req.body);

  res.status(201).json({
    success: true,
    data: result,
  });
});

// =============================================================================
// READ ENDPOINTS
// =============================================================================

/**
 * @desc    Get [entity] by ID
 * @route   GET /api/v1/[entities]/:id
 * @access  Private
 */
exports.getById = asyncHandler(async (req, res) => {
  const entity = await entityService.getById(req.params.id, req.user.id);

  res.status(200).json({
    success: true,
    data: entity,
  });
});

/**
 * @desc    Get all [entities] with filters
 * @route   GET /api/v1/[entities]
 * @access  Private
 */
exports.getAll = asyncHandler(async (req, res) => {
  const { page, limit, status, startDate, endDate, search } = req.query;

  const result = await entityService.getAll(
    {
      userId: req.user.id,
      status,
      startDate,
      endDate,
      search,
    },
    {
      page: parseInt(page) || 1,
      limit: parseInt(limit) || 20,
    }
  );

  res.status(200).json({
    success: true,
    data: result.items,
    pagination: result.pagination,
  });
});

// =============================================================================
// UPDATE ENDPOINTS
// =============================================================================

/**
 * @desc    Update [entity]
 * @route   PUT /api/v1/[entities]/:id
 * @access  Private
 */
exports.update = asyncHandler(async (req, res) => {
  const result = await entityService.update(
    req.params.id,
    req.user.id,
    req.body
  );

  res.status(200).json({
    success: true,
    data: result,
  });
});

// =============================================================================
// DELETE ENDPOINTS
// =============================================================================

/**
 * @desc    Delete [entity]
 * @route   DELETE /api/v1/[entities]/:id
 * @access  Private
 */
exports.delete = asyncHandler(async (req, res) => {
  await entityService.delete(req.params.id, req.user.id);

  res.status(200).json({
    success: true,
    message: '[Entity] deleted successfully',
  });
});

// =============================================================================
// BUSINESS LOGIC ENDPOINTS
// =============================================================================

/**
 * @desc    Approve [entity]
 * @route   PUT /api/v1/[entities]/:id/approve
 * @access  Private (Admin)
 */
exports.approve = asyncHandler(async (req, res) => {
  const result = await entityService.approve(
    req.params.id,
    req.user.id,
    req.body.notes
  );

  res.status(200).json({
    success: true,
    data: result,
  });
});

module.exports = exports;
```

### 6.2 Response Format
Always use consistent response format:
```javascript
// Success response
res.status(200).json({
  success: true,
  data: result,
});

// Success with pagination
res.status(200).json({
  success: true,
  data: items,
  pagination: {
    page: 1,
    limit: 20,
    total: 100,
    totalPages: 5,
  },
});

// Success with message
res.status(200).json({
  success: true,
  message: 'Operation completed successfully',
  data: result,
});

// Created response
res.status(201).json({
  success: true,
  data: createdEntity,
});

// Error response (handled by error middleware)
throw new AppError('Error message', 400);
```

---

## 7. ROUTE LAYER PATTERN

### 7.1 Route File Structure
```javascript
// =============================================================================
// AIRAVAT B2B MARKETPLACE - [ENTITY] ROUTES
// Routes for [entity] management endpoints
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const entityController = require('../controllers/entity.controller');
const { protect, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');
const { rateLimiter } = require('../middleware/rateLimiter.middleware');

// Apply authentication to all routes
router.use(protect);

// =============================================================================
// PUBLIC ROUTES (authenticated users)
// =============================================================================

/**
 * @route   GET /api/v1/entities
 * @desc    Get all entities
 */
router.get(
  '/',
  [
    query('page').optional().isInt({ min: 1 }).withMessage('Page must be positive'),
    query('limit').optional().isInt({ min: 1, max: 100 }).withMessage('Limit must be 1-100'),
    query('status').optional().isIn(['ACTIVE', 'INACTIVE', 'PENDING']),
    query('startDate').optional().isISO8601().withMessage('Invalid start date'),
    query('endDate').optional().isISO8601().withMessage('Invalid end date'),
  ],
  validate,
  entityController.getAll
);

/**
 * @route   GET /api/v1/entities/:id
 * @desc    Get entity by ID
 */
router.get(
  '/:id',
  [param('id').notEmpty().withMessage('Entity ID is required')],
  validate,
  entityController.getById
);

/**
 * @route   POST /api/v1/entities
 * @desc    Create new entity
 */
router.post(
  '/',
  rateLimiter,
  [
    body('name').notEmpty().withMessage('Name is required').trim(),
    body('amount')
      .isFloat({ min: 0 })
      .withMessage('Amount must be a positive number'),
    body('currency')
      .optional()
      .isIn(['INR', 'AED', 'USD'])
      .withMessage('Invalid currency'),
    body('description').optional().isLength({ max: 500 }),
  ],
  validate,
  entityController.create
);

/**
 * @route   PUT /api/v1/entities/:id
 * @desc    Update entity
 */
router.put(
  '/:id',
  [
    param('id').notEmpty().withMessage('Entity ID is required'),
    body('name').optional().trim(),
    body('status').optional().isIn(['ACTIVE', 'INACTIVE']),
  ],
  validate,
  entityController.update
);

/**
 * @route   DELETE /api/v1/entities/:id
 * @desc    Delete entity
 */
router.delete(
  '/:id',
  [param('id').notEmpty().withMessage('Entity ID is required')],
  validate,
  entityController.delete
);

// =============================================================================
// ADMIN ROUTES
// =============================================================================

/**
 * @route   PUT /api/v1/entities/:id/approve
 * @desc    Approve entity (Admin only)
 */
router.put(
  '/:id/approve',
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    param('id').notEmpty().withMessage('Entity ID is required'),
    body('notes').optional().isLength({ max: 500 }),
  ],
  validate,
  entityController.approve
);

/**
 * @route   PUT /api/v1/entities/:id/reject
 * @desc    Reject entity (Admin only)
 */
router.put(
  '/:id/reject',
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    param('id').notEmpty().withMessage('Entity ID is required'),
    body('reason').notEmpty().withMessage('Rejection reason is required'),
  ],
  validate,
  entityController.reject
);

module.exports = router;
```

### 7.2 Route Registration (index.js)
```javascript
// =============================================================================
// AIRAVAT B2B MARKETPLACE - ROUTES INDEX
// =============================================================================

const express = require('express');
const router = express.Router();

// Import route modules
const authRoutes = require('./auth.routes');
const entityRoutes = require('./entity.routes');

// Mount routes
router.use('/auth', authRoutes);
router.use('/entities', entityRoutes);

// 404 handler
router.use('*', (req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: 'NOT_FOUND',
      message: `Route ${req.method} ${req.originalUrl} not found`,
    },
  });
});

module.exports = router;
```

---

## 8. MIDDLEWARE PATTERN

### 8.1 Middleware File Structure
```javascript
// =============================================================================
// AIRAVAT B2B MARKETPLACE - [NAME] MIDDLEWARE
// [Description of what this middleware does]
// =============================================================================

const logger = require('../config/logger');

/**
 * [Middleware description]
 * @param {Object} options - Configuration options
 */
const middlewareName = (options = {}) => {
  const {
    option1 = 'default',
    option2 = 100,
  } = options;

  return async (req, res, next) => {
    try {
      // Middleware logic here
      
      // Call next middleware
      next();
    } catch (error) {
      logger.error('Middleware error', { error: error.message });
      next(error);
    }
  };
};

/**
 * Pre-configured middleware instance
 */
const defaultMiddleware = middlewareName();

module.exports = {
  middlewareName,
  defaultMiddleware,
};
```

### 8.2 Authentication Middleware Pattern
```javascript
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');
const { AppError } = require('../utils/errors');

exports.protect = async (req, res, next) => {
  try {
    // 1. Get token from header
    let token;
    if (req.headers.authorization?.startsWith('Bearer')) {
      token = req.headers.authorization.split(' ')[1];
    }

    if (!token) {
      return next(new AppError('Not authorized to access this route', 401));
    }

    // 2. Verify token
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // 3. Check if user exists
    const user = await prisma.user.findUnique({
      where: { id: decoded.id },
      select: {
        id: true,
        email: true,
        role: true,
        businessId: true,
        isActive: true,
      },
    });

    if (!user || !user.isActive) {
      return next(new AppError('User no longer exists or is inactive', 401));
    }

    // 4. Attach user to request
    req.user = user;
    next();
  } catch (error) {
    return next(new AppError('Not authorized to access this route', 401));
  }
};

exports.authorize = (...roles) => {
  return (req, res, next) => {
    if (!roles.includes(req.user.role)) {
      return next(new AppError('Not authorized to perform this action', 403));
    }
    next();
  };
};
```

---

## 9. DATABASE & PRISMA PATTERNS

### 9.1 Prisma Schema Conventions
```prisma
// =============================================================================
// MODEL: [EntityName]
// [Description]
// =============================================================================

model EntityName {
  // Primary Key
  id            String   @id @default(uuid())
  
  // Foreign Keys (grouped together)
  userId        String
  businessId    String?
  
  // Core Fields (alphabetical or logical grouping)
  amount        Decimal  @db.Decimal(15, 2)
  currency      String   @default("INR")
  description   String?
  name          String
  status        EntityStatus @default(PENDING)
  
  // Metadata Fields
  metadata      Json?
  
  // Timestamps (always at the end)
  createdAt     DateTime @default(now())
  updatedAt     DateTime @updatedAt
  deletedAt     DateTime?
  
  // Relations
  user          User     @relation(fields: [userId], references: [id])
  business      Business? @relation(fields: [businessId], references: [id])
  items         EntityItem[]
  
  // Indexes
  @@index([userId])
  @@index([businessId])
  @@index([status])
  @@index([createdAt])
  
  // Unique constraints
  @@unique([userId, name])
  
  // Table mapping (if needed)
  @@map("entity_names")
}

enum EntityStatus {
  PENDING
  ACTIVE
  COMPLETED
  CANCELLED
}
```

### 9.2 Transaction Pattern
```javascript
// Use transactions for multiple related writes
const result = await prisma.$transaction(async (tx) => {
  // All operations use 'tx' instead of 'prisma'
  const entity = await tx.entity.create({
    data: { ... },
  });

  await tx.entityLog.create({
    data: {
      entityId: entity.id,
      action: 'CREATED',
    },
  });

  await tx.relatedEntity.update({
    where: { id: relatedId },
    data: { ... },
  });

  return entity;
});
```

### 9.3 Query Patterns
```javascript
// Single entity with relations
const entity = await prisma.entity.findUnique({
  where: { id },
  include: {
    user: {
      select: { id: true, name: true, email: true },
    },
    items: {
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    },
  },
});

// Aggregation
const stats = await prisma.entity.aggregate({
  where: { status: 'COMPLETED' },
  _sum: { amount: true },
  _count: true,
  _avg: { amount: true },
});

// Group by
const byStatus = await prisma.entity.groupBy({
  by: ['status'],
  _count: true,
  _sum: { amount: true },
});

// Raw query (when needed)
const result = await prisma.$queryRaw`
  SELECT * FROM entities 
  WHERE amount > ${minAmount}
  LIMIT ${limit}
`;
```

---

## 10. ERROR HANDLING

### 10.1 Custom Error Class
```javascript
// utils/errors.js
class AppError extends Error {
  constructor(message, statusCode, code = null) {
    super(message);
    this.statusCode = statusCode;
    this.code = code || this.getDefaultCode(statusCode);
    this.isOperational = true;

    Error.captureStackTrace(this, this.constructor);
  }

  getDefaultCode(statusCode) {
    const codes = {
      400: 'BAD_REQUEST',
      401: 'UNAUTHORIZED',
      403: 'FORBIDDEN',
      404: 'NOT_FOUND',
      409: 'CONFLICT',
      422: 'VALIDATION_ERROR',
      429: 'TOO_MANY_REQUESTS',
      500: 'INTERNAL_ERROR',
    };
    return codes[statusCode] || 'ERROR';
  }
}

module.exports = { AppError };
```

### 10.2 Error Handler Middleware
```javascript
// middleware/errorHandler.js
const errorHandler = (err, req, res, next) => {
  let error = { ...err };
  error.message = err.message;

  // Log error
  logger.error('Error:', {
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  // Prisma errors
  if (err.code === 'P2002') {
    error = new AppError('Duplicate field value', 409);
  }
  if (err.code === 'P2025') {
    error = new AppError('Record not found', 404);
  }

  // JWT errors
  if (err.name === 'JsonWebTokenError') {
    error = new AppError('Invalid token', 401);
  }
  if (err.name === 'TokenExpiredError') {
    error = new AppError('Token expired', 401);
  }

  // Validation errors
  if (err.name === 'ValidationError') {
    error = new AppError(err.message, 422);
  }

  res.status(error.statusCode || 500).json({
    success: false,
    error: {
      code: error.code || 'INTERNAL_ERROR',
      message: error.message || 'Internal server error',
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
};
```

### 10.3 Async Handler Wrapper
```javascript
// middleware/async.middleware.js
const asyncHandler = (fn) => (req, res, next) => {
  Promise.resolve(fn(req, res, next)).catch(next);
};

module.exports = asyncHandler;
```

---

## 11. VALIDATION PATTERNS

### 11.1 Joi Validation Schema
```javascript
// validations/entity.validation.js
const Joi = require('joi');

const schemas = {
  create: Joi.object({
    name: Joi.string().required().trim().min(2).max(100),
    amount: Joi.number().required().positive().max(10000000),
    currency: Joi.string().valid('INR', 'AED', 'USD').default('INR'),
    description: Joi.string().max(500).allow(''),
    type: Joi.string().valid('TYPE_A', 'TYPE_B').required(),
    metadata: Joi.object().optional(),
  }),

  update: Joi.object({
    name: Joi.string().trim().min(2).max(100),
    description: Joi.string().max(500).allow(''),
    status: Joi.string().valid('ACTIVE', 'INACTIVE'),
  }).min(1), // At least one field required

  query: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    status: Joi.string().valid('PENDING', 'ACTIVE', 'COMPLETED'),
    startDate: Joi.date().iso(),
    endDate: Joi.date().iso().greater(Joi.ref('startDate')),
    search: Joi.string().max(100),
    sortBy: Joi.string().valid('createdAt', 'amount', 'name'),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
};

module.exports = schemas;
```

### 11.2 Express-Validator Pattern
```javascript
// In routes file
const { body, param, query } = require('express-validator');

router.post(
  '/',
  [
    body('email')
      .isEmail()
      .withMessage('Please provide a valid email')
      .normalizeEmail(),
    body('amount')
      .isFloat({ min: 0.01, max: 10000000 })
      .withMessage('Amount must be between 0.01 and 10,000,000'),
    body('phone')
      .matches(/^[+]?[0-9]{10,15}$/)
      .withMessage('Invalid phone number format'),
  ],
  validate,
  controller.create
);
```

---

## 12. TESTING PATTERNS

### 12.1 Test File Structure
```javascript
// =============================================================================
// AIRAVAT B2B MARKETPLACE - [ENTITY] SERVICE TESTS
// =============================================================================

const entityService = require('../../services/entity.service');
const { prisma } = require('../../config/database');

// Mock dependencies
jest.mock('../../config/database', () => ({
  prisma: {
    entity: {
      create: jest.fn(),
      findUnique: jest.fn(),
      findMany: jest.fn(),
      update: jest.fn(),
      delete: jest.fn(),
      count: jest.fn(),
    },
    $transaction: jest.fn((callback) => callback(prisma)),
  },
}));

jest.mock('../../config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
}));

describe('Entity Service', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  // ===========================================================================
  // CREATE OPERATIONS
  // ===========================================================================
  
  describe('create', () => {
    it('should create entity successfully', async () => {
      const mockEntity = {
        id: 'entity_123',
        name: 'Test Entity',
        status: 'PENDING',
      };

      prisma.entity.create.mockResolvedValue(mockEntity);

      const result = await entityService.create('user_123', {
        name: 'Test Entity',
      });

      expect(result.id).toBe('entity_123');
      expect(prisma.entity.create).toHaveBeenCalled();
    });

    it('should throw error if required field missing', async () => {
      await expect(entityService.create('user_123', {}))
        .rejects.toThrow('Name is required');
    });
  });

  // ===========================================================================
  // READ OPERATIONS
  // ===========================================================================
  
  describe('getById', () => {
    it('should return entity if found', async () => {
      const mockEntity = { id: 'entity_123', userId: 'user_123' };
      prisma.entity.findUnique.mockResolvedValue(mockEntity);

      const result = await entityService.getById('entity_123', 'user_123');

      expect(result.id).toBe('entity_123');
    });

    it('should throw error if entity not found', async () => {
      prisma.entity.findUnique.mockResolvedValue(null);

      await expect(entityService.getById('invalid_id', 'user_123'))
        .rejects.toThrow('Entity not found');
    });

    it('should throw error if user not authorized', async () => {
      prisma.entity.findUnique.mockResolvedValue({
        id: 'entity_123',
        userId: 'other_user',
      });

      await expect(entityService.getById('entity_123', 'user_123'))
        .rejects.toThrow('Not authorized');
    });
  });

  // ===========================================================================
  // BUSINESS LOGIC
  // ===========================================================================
  
  describe('approve', () => {
    it('should approve pending entity', async () => {
      const mockEntity = {
        id: 'entity_123',
        status: 'PENDING',
      };

      prisma.entity.findUnique.mockResolvedValue(mockEntity);
      prisma.entity.update.mockResolvedValue({
        ...mockEntity,
        status: 'APPROVED',
      });

      const result = await entityService.approve('entity_123', 'admin_123');

      expect(result.status).toBe('APPROVED');
    });

    it('should throw error if not in pending status', async () => {
      prisma.entity.findUnique.mockResolvedValue({
        id: 'entity_123',
        status: 'APPROVED',
      });

      await expect(entityService.approve('entity_123', 'admin_123'))
        .rejects.toThrow('Can only approve pending entities');
    });
  });
});
```

### 12.2 Integration Test Pattern
```javascript
const request = require('supertest');
const app = require('../../app');
const { prisma } = require('../../config/database');

describe('Entity API', () => {
  let authToken;
  let testEntity;

  beforeAll(async () => {
    // Create test user and get token
    const response = await request(app)
      .post('/api/v1/auth/login')
      .send({ email: 'test@example.com', password: 'password123' });
    
    authToken = response.body.token;
  });

  afterAll(async () => {
    // Cleanup test data
    await prisma.entity.deleteMany({
      where: { id: testEntity?.id },
    });
    await prisma.$disconnect();
  });

  describe('POST /api/v1/entities', () => {
    it('should create entity', async () => {
      const response = await request(app)
        .post('/api/v1/entities')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          name: 'Test Entity',
          amount: 1000,
        });

      expect(response.status).toBe(201);
      expect(response.body.success).toBe(true);
      testEntity = response.body.data;
    });

    it('should return 401 without auth', async () => {
      const response = await request(app)
        .post('/api/v1/entities')
        .send({ name: 'Test' });

      expect(response.status).toBe(401);
    });
  });
});
```

---

## 13. SECURITY PRACTICES

### 13.1 Input Sanitization
```javascript
// Always sanitize user input
const sanitizedInput = {
  name: validator.escape(input.name),
  email: validator.normalizeEmail(input.email),
  amount: parseFloat(input.amount),
};

// Never trust client-side data
// Always re-validate on server
// Use parameterized queries (Prisma does this automatically)
```

### 13.2 Authentication Checks
```javascript
// Always verify ownership
if (entity.userId !== req.user.id && req.user.role !== 'ADMIN') {
  throw new AppError('Not authorized', 403);
}

// Check business access
if (entity.businessId !== req.user.businessId) {
  throw new AppError('Not authorized to access this business resource', 403);
}
```

### 13.3 Sensitive Data Handling
```javascript
// Never log sensitive data
logger.info('User action', {
  userId: user.id,
  action: 'LOGIN',
  // DON'T: password, token, cardNumber, etc.
});

// Mask sensitive fields in responses
const maskedCard = {
  ...card,
  cardNumber: `****${card.cardNumber.slice(-4)}`,
  cvv: '***',
};

// Encrypt sensitive data before storage
const encrypted = encryptionService.encrypt(sensitiveData);
```

### 13.4 Rate Limiting Pattern
```javascript
// Apply rate limiting to sensitive endpoints
router.post(
  '/wallet/withdraw',
  rateLimiter({
    windowMs: 24 * 60 * 60 * 1000, // 24 hours
    max: 5, // 5 withdrawals per day
    message: 'Too many withdrawal requests',
  }),
  controller.withdraw
);
```

---

## 14. DOCUMENTATION STANDARDS

### 14.1 JSDoc Comments
```javascript
/**
 * Create a new EMI order for the given order
 * 
 * @param {string} userId - The user creating the EMI order
 * @param {Object} data - EMI order data
 * @param {string} data.orderId - Order ID to create EMI for
 * @param {string} data.emiPlanId - Selected EMI plan ID
 * @param {string} data.bankName - Bank name for auto-debit
 * @param {string} [data.accountLast4] - Last 4 digits of account (optional)
 * @returns {Promise<Object>} Created EMI order with installments
 * @throws {AppError} If order not found, already has EMI, or plan invalid
 * 
 * @example
 * const emiOrder = await emiService.createOrder('user_123', {
 *   orderId: 'order_456',
 *   emiPlanId: 'plan_789',
 *   bankName: 'HDFC Bank',
 * });
 */
exports.createOrder = async (userId, data) => {
  // Implementation
};
```

### 14.2 API Route Documentation
```javascript
/**
 * @route   POST /api/v1/financial/emi/create
 * @desc    Create EMI order for an existing order
 * @access  Private
 * 
 * @body    {string} orderId - Order ID (required)
 * @body    {string} emiPlanId - EMI Plan ID (required)
 * @body    {string} bankName - Bank name (required)
 * @body    {string} [accountLast4] - Last 4 digits of account
 * 
 * @returns {Object} 201 - Created EMI order
 * @returns {Object} 400 - Validation error
 * @returns {Object} 404 - Order or plan not found
 * @returns {Object} 409 - EMI already exists for order
 */
router.post('/create', ...);
```

---

## 15. FINANCIAL SERVICES SPECIFIC

### 15.1 Amount Handling
```javascript
// Always use Decimal for money (Prisma Decimal type)
// Store as smallest unit or with fixed precision

// Format amounts consistently
function formatAmount(amount, currency = 'INR') {
  const num = parseFloat(amount);
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(num);
}

// Validate amounts
if (amount <= 0) {
  throw new AppError('Amount must be positive', 400);
}
if (amount > MAX_TRANSACTION_AMOUNT) {
  throw new AppError(`Amount cannot exceed ${MAX_TRANSACTION_AMOUNT}`, 400);
}
```

### 15.2 Transaction Patterns
```javascript
// Always use database transactions for financial operations
const result = await prisma.$transaction(async (tx) => {
  // 1. Validate balances
  const wallet = await tx.wallet.findUnique({
    where: { id: walletId },
  });

  if (parseFloat(wallet.balance) < amount) {
    throw new AppError('Insufficient balance', 400);
  }

  // 2. Debit source
  const updatedWallet = await tx.wallet.update({
    where: { id: walletId },
    data: {
      balance: { decrement: amount },
    },
  });

  // 3. Create transaction record
  const transaction = await tx.walletTransaction.create({
    data: {
      walletId,
      type: 'DEBIT',
      amount,
      balanceBefore: wallet.balance,
      balanceAfter: updatedWallet.balance,
      status: 'COMPLETED',
    },
  });

  // 4. Credit destination (if transfer)
  // ...

  return { wallet: updatedWallet, transaction };
});
```

### 15.3 Number Generation Pattern
```javascript
// Generate unique reference numbers
function generateReferenceNumber(prefix) {
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const random = Math.random().toString(36).substring(2, 8).toUpperCase();
  return `${prefix}${year}${month}-${random}`;
}

// Generate sequential numbers (use database counter)
async function generateSequentialNumber(prefix, counterName) {
  const counter = await prisma.counter.update({
    where: { name: counterName },
    data: { value: { increment: 1 } },
  });
  
  const date = new Date();
  const year = date.getFullYear().toString().slice(-2);
  const month = (date.getMonth() + 1).toString().padStart(2, '0');
  const seq = counter.value.toString().padStart(5, '0');
  
  return `${prefix}${year}${month}-${seq}`;
}
```

### 15.4 Audit Logging Pattern
```javascript
// Log all financial operations
async function logFinancialOperation(data) {
  await prisma.financialAuditLog.create({
    data: {
      category: data.category, // WALLET, EMI, LC, etc.
      action: data.action,
      entityType: data.entityType,
      entityId: data.entityId,
      userId: data.userId,
      businessId: data.businessId,
      severity: data.severity || 'INFO',
      details: data.details,
      ipAddress: data.ipAddress,
      userAgent: data.userAgent,
      integrityHash: generateIntegrityHash(data),
    },
  });
}

// Generate hash for tamper detection
function generateIntegrityHash(data) {
  const content = JSON.stringify({
    category: data.category,
    action: data.action,
    entityId: data.entityId,
    timestamp: new Date().toISOString(),
  });
  return crypto.createHash('sha256').update(content).digest('hex');
}
```

---

## QUICK REFERENCE CHECKLIST

When writing new code, ensure:

### Service Layer
- [ ] File header with description
- [ ] Section separators for organization
- [ ] JSDoc for all exported functions
- [ ] Input validation at start of function
- [ ] Ownership/authorization checks
- [ ] Database transactions for multi-write operations
- [ ] Comprehensive error handling with try/catch
- [ ] Logging for important operations
- [ ] Return consistent data structures

### Controller Layer
- [ ] File header with description
- [ ] Route documentation comments
- [ ] asyncHandler wrapper on all functions
- [ ] Consistent response format
- [ ] Status codes: 200 (OK), 201 (Created), 400 (Bad Request), 401 (Unauthorized), 403 (Forbidden), 404 (Not Found)

### Route Layer
- [ ] File header with description
- [ ] Apply authentication middleware
- [ ] Validation with express-validator
- [ ] Rate limiting on sensitive endpoints
- [ ] Role-based authorization where needed

### Tests
- [ ] Mock all external dependencies
- [ ] Test success cases
- [ ] Test error cases (not found, unauthorized, validation)
- [ ] Test edge cases
- [ ] Clear test descriptions

### Security
- [ ] Never trust user input
- [ ] Validate ownership/access
- [ ] Don't expose sensitive data
- [ ] Use parameterized queries
- [ ] Rate limit sensitive operations
- [ ] Log security events

---

**Follow these patterns consistently to maintain code quality across the entire codebase.**
