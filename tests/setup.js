// =============================================================================
// AIRAVAT B2B MARKETPLACE - TEST SETUP
// Jest configuration and test utilities
// =============================================================================

const { PrismaClient } = require('@prisma/client');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

// Test database URL
const TEST_DATABASE_URL = process.env.TEST_DATABASE_URL || 
  'postgresql://airavat:airavat123@localhost:5432/airavat_test?schema=public';

// Prisma client for tests
const prisma = new PrismaClient({
  datasources: {
    db: {
      url: TEST_DATABASE_URL,
    },
  },
});

// =============================================================================
// DATABASE SETUP/TEARDOWN
// =============================================================================

/**
 * Reset database before tests
 */
const resetDatabase = async () => {
  // Delete all data in reverse order of dependencies
  const tablenames = await prisma.$queryRaw`
    SELECT tablename FROM pg_tables WHERE schemaname='public'
  `;

  for (const { tablename } of tablenames) {
    if (tablename !== '_prisma_migrations') {
      try {
        await prisma.$executeRawUnsafe(`TRUNCATE TABLE "public"."${tablename}" CASCADE;`);
      } catch (error) {
        console.log(`Could not truncate ${tablename}`);
      }
    }
  }
};

/**
 * Setup test database
 */
const setupTestDatabase = async () => {
  // Run migrations
  execSync('npx prisma migrate deploy', {
    env: { ...process.env, DATABASE_URL: TEST_DATABASE_URL },
  });
};

/**
 * Close database connections
 */
const closeDatabase = async () => {
  await prisma.$disconnect();
};

// =============================================================================
// TEST DATA FACTORIES
// =============================================================================

const factories = {
  /**
   * Create test user
   */
  async createUser(overrides = {}) {
    const password = await bcrypt.hash('Test@123', 10);
    
    return prisma.user.create({
      data: {
        id: uuidv4(),
        email: `test-${Date.now()}@example.com`,
        password,
        firstName: 'Test',
        lastName: 'User',
        role: 'BUYER',
        status: 'ACTIVE',
        isEmailVerified: true,
        ...overrides,
      },
    });
  },

  /**
   * Create test business
   */
  async createBusiness(userId, overrides = {}) {
    return prisma.business.create({
      data: {
        id: uuidv4(),
        ownerId: userId,
        businessName: `Test Business ${Date.now()}`,
        slug: `test-business-${Date.now()}`,
        businessType: 'MANUFACTURER',
        email: `business-${Date.now()}@example.com`,
        phone: '+919876543210',
        addressLine1: '123 Test Street',
        city: 'Mumbai',
        state: 'Maharashtra',
        country: 'IN',
        pincode: '400001',
        verificationStatus: 'VERIFIED',
        ...overrides,
      },
    });
  },

  /**
   * Create test category
   */
  async createCategory(overrides = {}) {
    return prisma.category.create({
      data: {
        id: uuidv4(),
        name: `Category ${Date.now()}`,
        slug: `category-${Date.now()}`,
        isActive: true,
        ...overrides,
      },
    });
  },

  /**
   * Create test product
   */
  async createProduct(businessId, categoryId, overrides = {}) {
    const productId = uuidv4();
    
    const product = await prisma.product.create({
      data: {
        id: productId,
        businessId,
        categoryId,
        name: `Test Product ${Date.now()}`,
        slug: `test-product-${Date.now()}`,
        description: 'This is a test product description',
        images: ['https://example.com/image.jpg'],
        status: 'ACTIVE',
        minOrderQuantity: 1,
        ...overrides,
      },
    });

    // Create default variant
    await prisma.productVariant.create({
      data: {
        id: uuidv4(),
        productId,
        sku: `SKU-${Date.now()}`,
        basePrice: 1000,
        stockQuantity: 100,
        isDefault: true,
        isActive: true,
      },
    });

    return product;
  },

  /**
   * Create test order
   */
  async createOrder(buyerId, sellerId, items = [], overrides = {}) {
    const orderId = uuidv4();
    
    const order = await prisma.order.create({
      data: {
        id: orderId,
        orderNumber: `ORD-${Date.now()}`,
        buyerId,
        sellerId,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        subtotal: 1000,
        taxAmount: 180,
        totalAmount: 1180,
        currency: 'INR',
        ...overrides,
      },
    });

    // Create order items
    for (const item of items) {
      await prisma.orderItem.create({
        data: {
          id: uuidv4(),
          orderId,
          productId: item.productId,
          variantId: item.variantId,
          productName: item.productName || 'Test Product',
          quantity: item.quantity || 1,
          unitPrice: item.unitPrice || 1000,
          totalPrice: item.totalPrice || 1000,
        },
      });
    }

    return order;
  },

  /**
   * Create test RFQ
   */
  async createRFQ(businessId, categoryId, overrides = {}) {
    return prisma.rFQ.create({
      data: {
        id: uuidv4(),
        rfqNumber: `RFQ-${Date.now()}`,
        businessId,
        categoryId,
        title: 'Test RFQ',
        description: 'This is a test RFQ description',
        quantity: 100,
        unitType: 'piece',
        status: 'OPEN',
        deliveryCity: 'Mumbai',
        deliveryState: 'Maharashtra',
        deliveryCountry: 'IN',
        ...overrides,
      },
    });
  },
};

// =============================================================================
// AUTHENTICATION HELPERS
// =============================================================================

/**
 * Generate test JWT token
 */
const generateTestToken = (user, expiresIn = '1h') => {
  return jwt.sign(
    {
      id: user.id,
      email: user.email,
      role: user.role,
    },
    process.env.JWT_SECRET || 'test-secret-key',
    { expiresIn }
  );
};

/**
 * Create authenticated user with token
 */
const createAuthenticatedUser = async (overrides = {}) => {
  const user = await factories.createUser(overrides);
  const token = generateTestToken(user);
  return { user, token };
};

/**
 * Create seller with business
 */
const createSellerWithBusiness = async () => {
  const user = await factories.createUser({ role: 'SELLER' });
  const business = await factories.createBusiness(user.id);
  const token = generateTestToken(user);
  
  // Update user with businessId
  await prisma.user.update({
    where: { id: user.id },
    data: { businessId: business.id },
  });

  return { user, business, token };
};

// =============================================================================
// REQUEST HELPERS
// =============================================================================

const request = require('supertest');
const app = require('../src/app');

/**
 * Make authenticated GET request
 */
const authGet = (url, token) => {
  return request(app)
    .get(url)
    .set('Authorization', `Bearer ${token}`);
};

/**
 * Make authenticated POST request
 */
const authPost = (url, token, data) => {
  return request(app)
    .post(url)
    .set('Authorization', `Bearer ${token}`)
    .send(data);
};

/**
 * Make authenticated PUT request
 */
const authPut = (url, token, data) => {
  return request(app)
    .put(url)
    .set('Authorization', `Bearer ${token}`)
    .send(data);
};

/**
 * Make authenticated DELETE request
 */
const authDelete = (url, token) => {
  return request(app)
    .delete(url)
    .set('Authorization', `Bearer ${token}`);
};

// =============================================================================
// ASSERTION HELPERS
// =============================================================================

/**
 * Assert successful response
 */
const expectSuccess = (response, statusCode = 200) => {
  expect(response.status).toBe(statusCode);
  expect(response.body.success).toBe(true);
};

/**
 * Assert error response
 */
const expectError = (response, statusCode, message) => {
  expect(response.status).toBe(statusCode);
  expect(response.body.success).toBe(false);
  if (message) {
    expect(response.body.message).toContain(message);
  }
};

/**
 * Assert pagination structure
 */
const expectPagination = (response) => {
  expect(response.body.data.pagination).toBeDefined();
  expect(response.body.data.pagination.page).toBeDefined();
  expect(response.body.data.pagination.limit).toBeDefined();
  expect(response.body.data.pagination.total).toBeDefined();
  expect(response.body.data.pagination.pages).toBeDefined();
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  prisma,
  resetDatabase,
  setupTestDatabase,
  closeDatabase,
  factories,
  generateTestToken,
  createAuthenticatedUser,
  createSellerWithBusiness,
  authGet,
  authPost,
  authPut,
  authDelete,
  expectSuccess,
  expectError,
  expectPagination,
};
