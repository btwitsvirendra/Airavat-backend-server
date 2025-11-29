// =============================================================================
// AIRAVAT B2B MARKETPLACE - ORDER CONTROLLER TESTS
// Unit and integration tests for orders
// =============================================================================

const request = require('supertest');
const app = require('../../src/app');
const {
  prisma,
  cleanDatabase,
  createTestCategory,
  createTestProduct,
  createTestOrder,
  createAuthenticatedUser,
  expectSuccess,
  expectError,
  expectPagination,
} = require('../setup');

describe('Order Controller', () => {
  let buyerAuth;
  let sellerAuth;
  let category;
  let product;

  beforeEach(async () => {
    await cleanDatabase();
    buyerAuth = await createAuthenticatedUser('BUYER');
    sellerAuth = await createAuthenticatedUser('SELLER');
    category = await createTestCategory();
    product = await createTestProduct(sellerAuth.business.id, category.id);

    // Create buyer business for orders
    const buyerBusiness = await prisma.business.create({
      data: {
        ownerId: buyerAuth.user.id,
        businessName: 'Buyer Business',
        slug: `buyer-business-${Date.now()}`,
        businessType: 'RETAILER',
        addressLine1: '456 Buyer Street',
        city: 'Delhi',
        state: 'Delhi',
        country: 'India',
        pincode: '110001',
        verificationStatus: 'VERIFIED',
      },
    });

    await prisma.user.update({
      where: { id: buyerAuth.user.id },
      data: { businessId: buyerBusiness.id },
    });

    buyerAuth.business = buyerBusiness;

    // Create address for buyer
    await prisma.address.create({
      data: {
        userId: buyerAuth.user.id,
        label: 'Default',
        contactName: 'Test Buyer',
        phone: '+919876543210',
        addressLine1: '456 Buyer Street',
        city: 'Delhi',
        state: 'Delhi',
        country: 'India',
        pincode: '110001',
        isDefault: true,
        type: 'BOTH',
      },
    });
  });

  // ===========================================================================
  // CREATE ORDER
  // ===========================================================================

  describe('POST /api/v1/orders', () => {
    it('should create order successfully', async () => {
      const address = await prisma.address.findFirst({
        where: { userId: buyerAuth.user.id },
      });

      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerAuth.token}`)
        .send({
          items: [
            {
              productId: product.id,
              variantId: product.variants[0].id,
              quantity: 2,
            },
          ],
          shippingAddressId: address.id,
        });

      expectSuccess(response, 201);
      expect(response.body.data).toHaveProperty('orderNumber');
      expect(response.body.data.status).toBe('PENDING');
      expect(response.body.data.items).toHaveLength(1);
    });

    it('should fail without items', async () => {
      const address = await prisma.address.findFirst({
        where: { userId: buyerAuth.user.id },
      });

      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerAuth.token}`)
        .send({
          items: [],
          shippingAddressId: address.id,
        });

      expectError(response, 400);
    });

    it('should fail with insufficient stock', async () => {
      // Update stock to 1
      await prisma.productVariant.update({
        where: { id: product.variants[0].id },
        data: { stockQuantity: 1 },
      });

      const address = await prisma.address.findFirst({
        where: { userId: buyerAuth.user.id },
      });

      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerAuth.token}`)
        .send({
          items: [
            {
              productId: product.id,
              variantId: product.variants[0].id,
              quantity: 10,
            },
          ],
          shippingAddressId: address.id,
        });

      expectError(response, 400);
      expect(response.body.message).toContain('stock');
    });

    it('should fail for own product', async () => {
      const address = await prisma.address.findFirst({
        where: { userId: buyerAuth.user.id },
      });

      // Try to buy own product
      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${sellerAuth.token}`)
        .send({
          items: [
            {
              productId: product.id,
              variantId: product.variants[0].id,
              quantity: 1,
            },
          ],
          shippingAddressId: address.id,
        });

      expectError(response, 400);
    });

    it('should apply coupon code', async () => {
      // Create coupon
      await prisma.coupon.create({
        data: {
          code: 'TEST10',
          discountType: 'PERCENTAGE',
          discountValue: 10,
          minOrderValue: 500,
          isActive: true,
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        },
      });

      const address = await prisma.address.findFirst({
        where: { userId: buyerAuth.user.id },
      });

      const response = await request(app)
        .post('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerAuth.token}`)
        .send({
          items: [
            {
              productId: product.id,
              variantId: product.variants[0].id,
              quantity: 2,
            },
          ],
          shippingAddressId: address.id,
          couponCode: 'TEST10',
        });

      expectSuccess(response, 201);
      expect(response.body.data.discount).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // LIST ORDERS
  // ===========================================================================

  describe('GET /api/v1/orders', () => {
    beforeEach(async () => {
      // Create test orders
      await createTestOrder(
        buyerAuth.business.id,
        sellerAuth.business.id,
        [{ productId: product.id, variantId: product.variants[0].id }]
      );
      await createTestOrder(
        buyerAuth.business.id,
        sellerAuth.business.id,
        [{ productId: product.id, variantId: product.variants[0].id }],
        { status: 'DELIVERED' }
      );
    });

    it('should list buyer orders', async () => {
      const response = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerAuth.token}`);

      expectSuccess(response);
      expect(response.body.data.orders.length).toBeGreaterThan(0);
      expectPagination(response.body.data);
    });

    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/v1/orders')
        .set('Authorization', `Bearer ${buyerAuth.token}`)
        .query({ status: 'DELIVERED' });

      expectSuccess(response);
      response.body.data.orders.forEach((order) => {
        expect(order.status).toBe('DELIVERED');
      });
    });

    it('should list seller orders', async () => {
      const response = await request(app)
        .get('/api/v1/orders/seller')
        .set('Authorization', `Bearer ${sellerAuth.token}`);

      expectSuccess(response);
    });
  });

  // ===========================================================================
  // GET ORDER DETAILS
  // ===========================================================================

  describe('GET /api/v1/orders/:id', () => {
    let order;

    beforeEach(async () => {
      order = await createTestOrder(
        buyerAuth.business.id,
        sellerAuth.business.id,
        [{ productId: product.id, variantId: product.variants[0].id }]
      );
    });

    it('should get order details as buyer', async () => {
      const response = await request(app)
        .get(`/api/v1/orders/${order.id}`)
        .set('Authorization', `Bearer ${buyerAuth.token}`);

      expectSuccess(response);
      expect(response.body.data.id).toBe(order.id);
      expect(response.body.data).toHaveProperty('items');
    });

    it('should get order details as seller', async () => {
      const response = await request(app)
        .get(`/api/v1/orders/${order.id}`)
        .set('Authorization', `Bearer ${sellerAuth.token}`);

      expectSuccess(response);
    });

    it('should deny access to other users', async () => {
      const otherUser = await createAuthenticatedUser('BUYER');

      const response = await request(app)
        .get(`/api/v1/orders/${order.id}`)
        .set('Authorization', `Bearer ${otherUser.token}`);

      expectError(response, 403);
    });
  });

  // ===========================================================================
  // UPDATE ORDER STATUS
  // ===========================================================================

  describe('PUT /api/v1/orders/:id/status', () => {
    let order;

    beforeEach(async () => {
      order = await createTestOrder(
        buyerAuth.business.id,
        sellerAuth.business.id,
        [{ productId: product.id, variantId: product.variants[0].id }]
      );
    });

    it('should confirm order as seller', async () => {
      const response = await request(app)
        .put(`/api/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${sellerAuth.token}`)
        .send({ status: 'CONFIRMED' });

      expectSuccess(response);
      expect(response.body.data.status).toBe('CONFIRMED');
    });

    it('should ship order with tracking', async () => {
      // First confirm
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'CONFIRMED' },
      });

      const response = await request(app)
        .put(`/api/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${sellerAuth.token}`)
        .send({
          status: 'SHIPPED',
          trackingNumber: 'TRACK123456',
          carrier: 'Delhivery',
        });

      expectSuccess(response);
      expect(response.body.data.status).toBe('SHIPPED');
    });

    it('should not allow invalid status transition', async () => {
      const response = await request(app)
        .put(`/api/v1/orders/${order.id}/status`)
        .set('Authorization', `Bearer ${sellerAuth.token}`)
        .send({ status: 'DELIVERED' }); // Can't jump from PENDING to DELIVERED

      expectError(response, 400);
    });
  });

  // ===========================================================================
  // CANCEL ORDER
  // ===========================================================================

  describe('POST /api/v1/orders/:id/cancel', () => {
    let order;

    beforeEach(async () => {
      order = await createTestOrder(
        buyerAuth.business.id,
        sellerAuth.business.id,
        [{ productId: product.id, variantId: product.variants[0].id }]
      );
    });

    it('should cancel pending order as buyer', async () => {
      const response = await request(app)
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${buyerAuth.token}`)
        .send({ reason: 'Changed my mind' });

      expectSuccess(response);
      expect(response.body.data.status).toBe('CANCELLED');
    });

    it('should not cancel shipped order', async () => {
      await prisma.order.update({
        where: { id: order.id },
        data: { status: 'SHIPPED' },
      });

      const response = await request(app)
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${buyerAuth.token}`)
        .send({ reason: 'Want to cancel' });

      expectError(response, 400);
    });

    it('should restore stock on cancellation', async () => {
      const variant = product.variants[0];
      const originalStock = variant.stockQuantity;

      // Simulate stock reduction
      await prisma.productVariant.update({
        where: { id: variant.id },
        data: { stockQuantity: originalStock - 1 },
      });

      await request(app)
        .post(`/api/v1/orders/${order.id}/cancel`)
        .set('Authorization', `Bearer ${buyerAuth.token}`)
        .send({ reason: 'Cancel' });

      const updatedVariant = await prisma.productVariant.findUnique({
        where: { id: variant.id },
      });

      expect(updatedVariant.stockQuantity).toBe(originalStock);
    });
  });

  // ===========================================================================
  // ORDER TIMELINE
  // ===========================================================================

  describe('GET /api/v1/orders/:id/timeline', () => {
    let order;

    beforeEach(async () => {
      order = await createTestOrder(
        buyerAuth.business.id,
        sellerAuth.business.id,
        [{ productId: product.id, variantId: product.variants[0].id }]
      );

      // Add status history
      await prisma.orderStatusHistory.createMany({
        data: [
          {
            orderId: order.id,
            status: 'PENDING',
            notes: 'Order placed',
          },
          {
            orderId: order.id,
            status: 'CONFIRMED',
            notes: 'Order confirmed by seller',
          },
        ],
      });
    });

    it('should get order timeline', async () => {
      const response = await request(app)
        .get(`/api/v1/orders/${order.id}/timeline`)
        .set('Authorization', `Bearer ${buyerAuth.token}`);

      expectSuccess(response);
      expect(response.body.data.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // REORDER
  // ===========================================================================

  describe('POST /api/v1/orders/:id/reorder', () => {
    let order;

    beforeEach(async () => {
      order = await createTestOrder(
        buyerAuth.business.id,
        sellerAuth.business.id,
        [{ productId: product.id, variantId: product.variants[0].id }],
        { status: 'DELIVERED' }
      );
    });

    it('should reorder completed order', async () => {
      const response = await request(app)
        .post(`/api/v1/orders/${order.id}/reorder`)
        .set('Authorization', `Bearer ${buyerAuth.token}`);

      expectSuccess(response, 201);
      expect(response.body.data.id).not.toBe(order.id);
    });
  });
});
