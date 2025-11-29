// =============================================================================
// AIRAVAT B2B MARKETPLACE - INTEGRATION TESTS
// End-to-end API testing
// =============================================================================

const request = require('supertest');
const app = require('../../src/app');
const { prisma } = require('../../src/config/database');
const { 
  createTestUser, 
  createTestBusiness, 
  createTestProduct,
  generateTestToken,
  cleanDatabase 
} = require('../setup');

describe('API Integration Tests', () => {
  let buyerToken;
  let sellerToken;
  let adminToken;
  let buyer;
  let seller;
  let business;
  let product;
  let category;

  beforeAll(async () => {
    await cleanDatabase();

    // Create test category
    category = await prisma.category.create({
      data: {
        name: 'Test Category',
        slug: 'test-category',
        description: 'Test category for integration tests',
        isActive: true,
      },
    });

    // Create buyer
    buyer = await createTestUser({ role: 'BUYER' });
    buyerToken = generateTestToken(buyer);

    // Create seller with business
    seller = await createTestUser({ role: 'SELLER' });
    sellerToken = generateTestToken(seller);
    
    business = await createTestBusiness(seller.id);
    
    // Create admin
    const admin = await createTestUser({ role: 'ADMIN' });
    adminToken = generateTestToken(admin);

    // Create test product
    product = await createTestProduct(business.id, category.id);
  });

  afterAll(async () => {
    await cleanDatabase();
    await prisma.$disconnect();
  });

  // ===========================================================================
  // AUTH TESTS
  // ===========================================================================

  describe('Authentication Flow', () => {
    const testEmail = 'newuser@test.com';
    
    it('should register a new user', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: 'Test@123456',
          firstName: 'Test',
          lastName: 'User',
          phone: '+919876543210',
          role: 'BUYER',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.user.email).toBe(testEmail);
      expect(res.body.data.tokens).toBeDefined();
    });

    it('should not register with existing email', async () => {
      const res = await request(app)
        .post('/api/v1/auth/register')
        .send({
          email: testEmail,
          password: 'Test@123456',
          firstName: 'Test',
          lastName: 'User',
          phone: '+919876543211',
          role: 'BUYER',
        });

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
    });

    it('should login with valid credentials', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'Test@123456',
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.tokens.accessToken).toBeDefined();
    });

    it('should not login with wrong password', async () => {
      const res = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testEmail,
          password: 'wrongpassword',
        });

      expect(res.status).toBe(401);
    });

    it('should get current user with valid token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(buyer.id);
    });

    it('should reject requests without token', async () => {
      const res = await request(app)
        .get('/api/v1/auth/me');

      expect(res.status).toBe(401);
    });
  });

  // ===========================================================================
  // PRODUCT TESTS
  // ===========================================================================

  describe('Product Management', () => {
    let newProductId;

    it('should list products', async () => {
      const res = await request(app)
        .get('/api/v1/products')
        .query({ page: 1, limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.products).toBeInstanceOf(Array);
      expect(res.body.data.pagination).toBeDefined();
    });

    it('should get product by ID', async () => {
      const res = await request(app)
        .get(`/api/v1/products/${product.id}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(product.id);
      expect(res.body.data.name).toBe(product.name);
    });

    it('should create product as seller', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          name: 'New Test Product',
          description: 'Test product description',
          categoryId: category.id,
          brand: 'Test Brand',
          hsnCode: '85171100',
          gstRate: 18,
          variants: [{
            variantName: 'Default',
            sku: `SKU-${Date.now()}`,
            basePrice: 1000,
            stockQuantity: 100,
          }],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      newProductId = res.body.data.id;
    });

    it('should not create product as buyer', async () => {
      const res = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          name: 'Buyer Product',
          categoryId: category.id,
          variants: [{
            variantName: 'Default',
            sku: 'SKU-BUYER',
            basePrice: 100,
            stockQuantity: 10,
          }],
        });

      expect(res.status).toBe(403);
    });

    it('should update own product', async () => {
      const res = await request(app)
        .put(`/api/v1/products/${newProductId}`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          name: 'Updated Product Name',
          description: 'Updated description',
        });

      expect(res.status).toBe(200);
      expect(res.body.data.name).toBe('Updated Product Name');
    });

    it('should search products', async () => {
      const res = await request(app)
        .get('/api/v1/search/products')
        .query({ q: 'Test', page: 1, limit: 10 });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
    });
  });

  // ===========================================================================
  // CART TESTS
  // ===========================================================================

  describe('Cart Operations', () => {
    it('should add item to cart', async () => {
      const variant = await prisma.productVariant.findFirst({
        where: { productId: product.id },
      });

      const res = await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          productId: product.id,
          variantId: variant.id,
          quantity: 2,
        });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.items.length).toBeGreaterThan(0);
    });

    it('should get cart', async () => {
      const res = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.items).toBeInstanceOf(Array);
      expect(res.body.data.total).toBeDefined();
    });

    it('should update cart item quantity', async () => {
      const cart = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${buyerToken}`);

      const itemId = cart.body.data.items[0].id;

      const res = await request(app)
        .put(`/api/v1/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({ quantity: 5 });

      expect(res.status).toBe(200);
    });

    it('should remove item from cart', async () => {
      const cart = await request(app)
        .get('/api/v1/cart')
        .set('Authorization', `Bearer ${buyerToken}`);

      const itemId = cart.body.data.items[0].id;

      const res = await request(app)
        .delete(`/api/v1/cart/items/${itemId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
    });
  });

  // ===========================================================================
  // ORDER TESTS
  // ===========================================================================

  describe('Order Management', () => {
    let orderId;

    beforeAll(async () => {
      // Add item to cart first
      const variant = await prisma.productVariant.findFirst({
        where: { productId: product.id },
      });

      await request(app)
        .post('/api/v1/cart/items')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          productId: product.id,
          variantId: variant.id,
          quantity: 2,
        });
    });

    it('should create order from cart', async () => {
      // Create address first
      const addressRes = await request(app)
        .post('/api/v1/users/addresses')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          label: 'Office',
          addressLine1: '123 Test Street',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
          country: 'IN',
          phone: '+919876543210',
          type: 'SHIPPING',
          isDefault: true,
        });

      const addressId = addressRes.body.data.id;

      const res = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          shippingAddressId: addressId,
          billingAddressId: addressId,
          paymentMethod: 'ONLINE',
          notes: 'Test order',
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.orderNumber).toBeDefined();
      orderId = res.body.data.id;
    });

    it('should get order details', async () => {
      const res = await request(app)
        .get(`/api/v1/orders/${orderId}`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.id).toBe(orderId);
    });

    it('should list buyer orders', async () => {
      const res = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.orders).toBeInstanceOf(Array);
    });

    it('seller should see order', async () => {
      const res = await request(app)
        .get('/api/v1/orders/seller')
        .set('Authorization', `Bearer ${sellerToken}`);

      expect(res.status).toBe(200);
    });

    it('seller should update order status', async () => {
      const res = await request(app)
        .patch(`/api/v1/orders/${orderId}/status`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({ status: 'CONFIRMED' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('CONFIRMED');
    });
  });

  // ===========================================================================
  // RFQ TESTS
  // ===========================================================================

  describe('RFQ System', () => {
    let rfqId;

    it('should create RFQ', async () => {
      const res = await request(app)
        .post('/api/v1/rfq')
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          title: 'Bulk Order Request',
          description: 'Need 1000 units of electronics',
          categoryId: category.id,
          quantity: 1000,
          unit: 'pieces',
          targetPrice: 50000,
          currency: 'INR',
          deliveryLocation: 'Mumbai',
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      rfqId = res.body.data.id;
    });

    it('should list RFQs', async () => {
      const res = await request(app)
        .get('/api/v1/rfq')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.rfqs).toBeInstanceOf(Array);
    });

    it('seller should submit quote', async () => {
      const res = await request(app)
        .post(`/api/v1/rfq/${rfqId}/quotes`)
        .set('Authorization', `Bearer ${sellerToken}`)
        .send({
          price: 45000,
          quantity: 1000,
          deliveryDays: 7,
          validUntil: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000).toISOString(),
          notes: 'Best price for bulk order',
        });

      expect(res.status).toBe(201);
    });

    it('buyer should see quotes', async () => {
      const res = await request(app)
        .get(`/api/v1/rfq/${rfqId}/quotes`)
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.quotes).toBeInstanceOf(Array);
    });
  });

  // ===========================================================================
  // REVIEW TESTS
  // ===========================================================================

  describe('Review System', () => {
    it('should create product review', async () => {
      const res = await request(app)
        .post(`/api/v1/reviews/products/${product.id}`)
        .set('Authorization', `Bearer ${buyerToken}`)
        .send({
          rating: 5,
          title: 'Great product!',
          comment: 'Excellent quality and fast delivery',
          pros: ['Quality', 'Price'],
          cons: [],
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
    });

    it('should get product reviews', async () => {
      const res = await request(app)
        .get(`/api/v1/reviews/products/${product.id}`);

      expect(res.status).toBe(200);
      expect(res.body.data.reviews).toBeInstanceOf(Array);
    });
  });

  // ===========================================================================
  // ADMIN TESTS
  // ===========================================================================

  describe('Admin Operations', () => {
    it('should access admin dashboard', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dashboard')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.stats).toBeDefined();
    });

    it('should deny admin access to regular users', async () => {
      const res = await request(app)
        .get('/api/v1/admin/dashboard')
        .set('Authorization', `Bearer ${buyerToken}`);

      expect(res.status).toBe(403);
    });

    it('should list users', async () => {
      const res = await request(app)
        .get('/api/v1/admin/users')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.users).toBeInstanceOf(Array);
    });

    it('should get system health', async () => {
      const res = await request(app)
        .get('/api/v1/admin/system/health')
        .set('Authorization', `Bearer ${adminToken}`);

      expect(res.status).toBe(200);
      expect(res.body.data.database).toBeDefined();
    });
  });

  // ===========================================================================
  // SEARCH TESTS
  // ===========================================================================

  describe('Search Functionality', () => {
    it('should search products', async () => {
      const res = await request(app)
        .get('/api/v1/search/products')
        .query({ q: 'Test' });

      expect(res.status).toBe(200);
      expect(res.body.data.products).toBeInstanceOf(Array);
    });

    it('should get autocomplete suggestions', async () => {
      const res = await request(app)
        .get('/api/v1/search/autocomplete')
        .query({ q: 'Tes' });

      expect(res.status).toBe(200);
    });

    it('should get trending searches', async () => {
      const res = await request(app)
        .get('/api/v1/search/trending');

      expect(res.status).toBe(200);
    });
  });

  // ===========================================================================
  // HEALTH CHECK TESTS
  // ===========================================================================

  describe('Health Checks', () => {
    it('should return health status', async () => {
      const res = await request(app)
        .get('/health');

      expect(res.status).toBe(200);
      expect(res.body.status).toBeDefined();
    });

    it('should return liveness check', async () => {
      const res = await request(app)
        .get('/health/live');

      expect(res.status).toBe(200);
    });

    it('should return readiness check', async () => {
      const res = await request(app)
        .get('/health/ready');

      expect([200, 503]).toContain(res.status);
    });
  });
});
