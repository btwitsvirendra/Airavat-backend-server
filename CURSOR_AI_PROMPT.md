# AIRAVAT BACKEND - AI CODE GENERATION PROMPT

Use this prompt when asking Cursor/Claude to generate code for the Airavat backend:

---

## SYSTEM PROMPT FOR CURSOR

```
You are generating code for the Airavat B2B Marketplace backend. Follow these exact patterns:

## TECH STACK
- Node.js 18+ with CommonJS (require/module.exports)
- Express.js 4.x
- Prisma ORM with PostgreSQL
- Redis for caching/rate limiting
- Jest for testing
- Joi + express-validator for validation

## FILE STRUCTURE
Every file MUST start with this header:
```javascript
// =============================================================================
// AIRAVAT B2B MARKETPLACE - [FILE NAME IN CAPS]
// [Description of what this file does]
// =============================================================================
```

Use section separators:
```javascript
// =============================================================================
// SECTION NAME
// =============================================================================
```

## SERVICE PATTERN
```javascript
const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

/**
 * [Function description]
 * @param {string} userId - User ID
 * @param {Object} data - Input data
 * @returns {Promise<Object>} Result
 */
exports.functionName = async (userId, data) => {
  try {
    // 1. Validate input
    if (!userId) throw new AppError('User ID required', 400);
    
    // 2. Check ownership/permissions
    const entity = await prisma.entity.findUnique({ where: { id } });
    if (!entity) throw new AppError('Not found', 404);
    if (entity.userId !== userId) throw new AppError('Not authorized', 403);
    
    // 3. Business logic with transaction
    const result = await prisma.$transaction(async (tx) => {
      // Multiple writes here
      return updated;
    });
    
    // 4. Log operation
    logger.info('Action completed', { userId, entityId: result.id });
    
    return result;
  } catch (error) {
    logger.error('Error in functionName', { error: error.message });
    throw error;
  }
};
```

## CONTROLLER PATTERN
```javascript
const asyncHandler = require('../middleware/async.middleware');
const service = require('../services/entity.service');

/**
 * @desc    Description
 * @route   POST /api/v1/entities
 * @access  Private
 */
exports.create = asyncHandler(async (req, res) => {
  const result = await service.create(req.user.id, req.body);
  res.status(201).json({ success: true, data: result });
});
```

## ROUTE PATTERN
```javascript
const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');
const { protect, authorize } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

router.use(protect);

router.post(
  '/',
  [
    body('name').notEmpty().withMessage('Name required'),
    body('amount').isFloat({ min: 0 }).withMessage('Invalid amount'),
  ],
  validate,
  controller.create
);
```

## NAMING CONVENTIONS
- Files: camelCase.js (e.g., walletService.js)
- Variables/Functions: camelCase (e.g., getUserById)
- Constants: SCREAMING_SNAKE_CASE (e.g., MAX_LIMIT)
- Database fields: camelCase (e.g., userId, createdAt)
- URLs: kebab-case (e.g., /api/v1/trade-finance)
- Boolean vars: is/has/can prefix (e.g., isActive, hasPermission)

## RESPONSE FORMAT
Always use:
```javascript
// Success
res.status(200).json({ success: true, data: result });

// With pagination
res.status(200).json({
  success: true,
  data: items,
  pagination: { page, limit, total, totalPages }
});

// Error (via AppError)
throw new AppError('Message', statusCode);
```

## ERROR HANDLING
- Use AppError class for all errors
- Status codes: 400 (bad request), 401 (unauthorized), 403 (forbidden), 404 (not found), 409 (conflict)
- Always wrap async functions with asyncHandler
- Log errors with context

## FINANCIAL OPERATIONS
- Always use Prisma transactions for money operations
- Validate amounts (positive, within limits)
- Check balances before debits
- Create audit logs for all financial actions
- Generate reference numbers: PREFIX + YYMM + SEQUENCE

## DATABASE QUERIES
- Use Prisma's include for relations
- Use select to limit returned fields
- Always paginate list queries
- Use transactions for multiple writes

## TESTING
- Mock prisma with jest.mock
- Test success cases
- Test error cases (not found, unauthorized, validation)
- Use descriptive test names
```

---

## EXAMPLE USAGE IN CURSOR

When asking Cursor to generate code, prefix your request with:

```
Following the Airavat coding standards (CommonJS, Express, Prisma, section headers, JSDoc, error handling with AppError, asyncHandler for controllers, validation middleware):

[Your request here]
```

### Example Prompts:

**For a new service:**
```
Following the Airavat coding standards, create a refund.service.js that handles:
- createRefund(orderId, userId, data) - create refund request
- approveRefund(refundId, adminId) - approve and process refund
- getRefundsByUser(userId, pagination) - list user's refunds
Include proper validation, transactions, and audit logging.
```

**For a new controller:**
```
Following the Airavat coding standards, create refund.controller.js with endpoints:
- POST /refunds - create refund request
- GET /refunds - list user's refunds with pagination
- GET /refunds/:id - get refund details
- PUT /refunds/:id/approve - admin approve (Admin only)
```

**For tests:**
```
Following the Airavat coding standards, create refund.service.test.js testing:
- createRefund success and error cases
- approveRefund authorization and status checks
- getRefundsByUser pagination
Mock prisma and logger.
```

---

## KEY PATTERNS TO REMEMBER

### 1. Always Start Files With Header
```javascript
// =============================================================================
// AIRAVAT B2B MARKETPLACE - REFUND SERVICE
// Service for handling order refund requests and processing
// =============================================================================
```

### 2. Section Organization
```javascript
// =============================================================================
// CONFIGURATION
// =============================================================================

// =============================================================================
// CREATE OPERATIONS
// =============================================================================

// =============================================================================
// READ OPERATIONS
// =============================================================================

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================
```

### 3. Function Documentation
```javascript
/**
 * Create a refund request for an order
 * @param {string} orderId - Order ID to refund
 * @param {string} userId - User requesting refund
 * @param {Object} data - Refund data
 * @param {number} data.amount - Refund amount
 * @param {string} data.reason - Reason for refund
 * @returns {Promise<Object>} Created refund
 * @throws {AppError} If order not found or not eligible
 */
```

### 4. Pagination Response
```javascript
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
```

### 5. Financial Transaction
```javascript
const result = await prisma.$transaction(async (tx) => {
  // Debit
  await tx.wallet.update({
    where: { id: walletId },
    data: { balance: { decrement: amount } },
  });
  
  // Create record
  const txn = await tx.transaction.create({ data: {...} });
  
  // Credit destination
  await tx.wallet.update({
    where: { id: destWalletId },
    data: { balance: { increment: amount } },
  });
  
  return txn;
});
```

### 6. Number Generation
```javascript
function generateRefNumber(prefix) {
  const d = new Date();
  const yy = d.getFullYear().toString().slice(-2);
  const mm = (d.getMonth() + 1).toString().padStart(2, '0');
  const seq = Date.now().toString().slice(-5);
  return `${prefix}${yy}${mm}-${seq}`;
}
// Output: REF2411-12345
```

---

## CHECKLIST BEFORE SUBMITTING CODE

- [ ] File header present
- [ ] Section separators used
- [ ] JSDoc on all exported functions
- [ ] Input validation
- [ ] Authorization checks
- [ ] Error handling with AppError
- [ ] Logging for important operations
- [ ] Consistent response format
- [ ] Tests cover success + error cases

---

Save this file and reference it when generating new code to maintain consistency.
