// =============================================================================
// AIRAVAT B2B MARKETPLACE - PRODUCT CONTROLLER TESTS
// Unit and integration tests for products
// =============================================================================

const request = require('supertest');
const app = require('../../src/app');
const {
  prisma,
  cleanDatabase,
  createTestCategory,
  createTestProduct,
  createAuthenticatedUser,
  expectSuccess,
  expectError,
  expectPagination,
} = require('../setup');

describe('Product Controller', () => {
  let sellerAuth;
  let buyerAuth;
  let category;

  beforeEach(async () => {
    await cleanDatabase();
    sellerAuth = await createAuthenticatedUser('SELLER');
    buyerAuth = await createAuthenticatedUser('BUYER');
    category = await createTestCategory();
  });

  // ===========================================================================
  // LIST PRODUCTS
  // ===========================================================================

  describe('GET /api/v1/products', () => {
    beforeEach(async () => {
      // Create test products
      await createTestProduct(sellerAuth.business.id, category.id, { name: 'Product A' });
      await createTestProduct(sellerAuth.business.id, category.id, { name: 'Product B' });
      await createTestProduct(sellerAuth.business.id, category.id, { name: 'Product C' });
    });

    it('should list products with pagination', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .query({ page: 1, limit: 10 });

      expectSuccess(response);
      expect(response.body.data.products).toHaveLength(3);
      expectPagination(response.body.data);
    });

    it('should filter by category', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .query({ category: category.id });

      expectSuccess(response);
      expect(response.body.data.products.length).toBeGreaterThan(0);
    });

    it('should sort by price ascending', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .query({ sort: 'price_low' });

      expectSuccess(response);
      const prices = response.body.data.products.map((p) => p.minPrice);
      expect(prices).toEqual([...prices].sort((a, b) => a - b));
    });

    it('should search by keyword', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .query({ q: 'Product A' });

      expectSuccess(response);
    });
  });

  // ===========================================================================
  // GET SINGLE PRODUCT
  // ===========================================================================

  describe('GET /api/v1/products/:id', () => {
    let product;

    beforeEach(async () => {
      product = await createTestProduct(sellerAuth.business.id, category.id);
    });

    it('should get product by ID', async () => {
      const response = await request(app)
        .get(`/api/v1/products/${product.id}`);

      expectSuccess(response);
      expect(response.body.data.id).toBe(product.id);
      expect(response.body.data).toHaveProperty('variants');
      expect(response.body.data).toHaveProperty('business');
    });

    it('should get product by slug', async () => {
      const response = await request(app)
        .get(`/api/v1/products/${product.slug}`);

      expectSuccess(response);
      expect(response.body.data.slug).toBe(product.slug);
    });

    it('should return 404 for non-existent product', async () => {
      const response = await request(app)
        .get('/api/v1/products/non-existent-id');

      expectError(response, 404);
    });

    it('should increment view count', async () => {
      await request(app).get(`/api/v1/products/${product.id}`);

      const updatedProduct = await prisma.product.findUnique({
        where: { id: product.id },
      });

      expect(updatedProduct.viewCount).toBeGreaterThan(product.viewCount || 0);
    });
  });

  // ===========================================================================
  // CREATE PRODUCT
  // ===========================================================================

  describe('POST /api/v1/products', () => {
    const validProduct = {
      name: 'New Test Product',
      description: 'This is a test product description',
      categoryId: null, // Will be set in beforeEach
      images: ['https://example.com/image1.jpg'],
      variants: [
        {
          variantName: 'Default',
          basePrice: 1000,
          stockQuantity: 50,
          isDefault: true,
        },
      ],
    };

    beforeEach(() => {
      validProduct.categoryId = category.id;
    });

    it('should create product as seller', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${sellerAuth.token}`)
        .send(validProduct);

      expectSuccess(response, 201);
      expect(response.body.data.name).toBe(validProduct.name);
      expect(response.body.data).toHaveProperty('slug');
      expect(response.body.data.variants).toHaveLength(1);
    });

    it('should fail without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .send(validProduct);

      expectError(response, 401);
    });

    it('should fail as buyer', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${buyerAuth.token}`)
        .send(validProduct);

      expectError(response, 403);
    });

    it('should fail with invalid category', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${sellerAuth.token}`)
        .send({ ...validProduct, categoryId: 'invalid-id' });

      expectError(response, 400);
    });

    it('should fail without variants', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .set('Authorization', `Bearer ${sellerAuth.token}`)
        .send({ ...validProduct, variants: [] });

      expectError(response, 400);
    });
  });

  // ===========================================================================
  // UPDATE PRODUCT
  // ===========================================================================

  describe('PUT /api/v1/products/:id', () => {
    let product;

    beforeEach(async () => {
      product = await createTestProduct(sellerAuth.business.id, category.id);
    });

    it('should update own product', async () => {
      const response = await request(app)
        .put(`/api/v1/products/${product.id}`)
        .set('Authorization', `Bearer ${sellerAuth.token}`)
        .send({ name: 'Updated Product Name' });

      expectSuccess(response);
      expect(response.body.data.name).toBe('Updated Product Name');
    });

    it('should not update another seller\'s product', async () => {
      const otherSeller = await createAuthenticatedUser('SELLER');
      
      const response = await request(app)
        .put(`/api/v1/products/${product.id}`)
        .set('Authorization', `Bearer ${otherSeller.token}`)
        .send({ name: 'Hacked Name' });

      expectError(response, 403);
    });

    it('should update product status', async () => {
      const response = await request(app)
        .put(`/api/v1/products/${product.id}`)
        .set('Authorization', `Bearer ${sellerAuth.token}`)
        .send({ status: 'INACTIVE' });

      expectSuccess(response);
      expect(response.body.data.status).toBe('INACTIVE');
    });
  });

  // ===========================================================================
  // DELETE PRODUCT
  // ===========================================================================

  describe('DELETE /api/v1/products/:id', () => {
    let product;

    beforeEach(async () => {
      product = await createTestProduct(sellerAuth.business.id, category.id);
    });

    it('should delete own product', async () => {
      const response = await request(app)
        .delete(`/api/v1/products/${product.id}`)
        .set('Authorization', `Bearer ${sellerAuth.token}`);

      expectSuccess(response);

      // Verify soft delete
      const deletedProduct = await prisma.product.findUnique({
        where: { id: product.id },
      });
      expect(deletedProduct.status).toBe('DELETED');
    });

    it('should not delete another seller\'s product', async () => {
      const otherSeller = await createAuthenticatedUser('SELLER');

      const response = await request(app)
        .delete(`/api/v1/products/${product.id}`)
        .set('Authorization', `Bearer ${otherSeller.token}`);

      expectError(response, 403);
    });
  });

  // ===========================================================================
  // PRODUCT VARIANTS
  // ===========================================================================

  describe('Product Variants', () => {
    let product;

    beforeEach(async () => {
      product = await createTestProduct(sellerAuth.business.id, category.id);
    });

    it('should add variant to product', async () => {
      const response = await request(app)
        .post(`/api/v1/products/${product.id}/variants`)
        .set('Authorization', `Bearer ${sellerAuth.token}`)
        .send({
          variantName: 'Large',
          basePrice: 1500,
          stockQuantity: 30,
        });

      expectSuccess(response, 201);
      expect(response.body.data.variantName).toBe('Large');
    });

    it('should update variant', async () => {
      const variant = product.variants[0];

      const response = await request(app)
        .put(`/api/v1/products/${product.id}/variants/${variant.id}`)
        .set('Authorization', `Bearer ${sellerAuth.token}`)
        .send({ basePrice: 1200 });

      expectSuccess(response);
      expect(response.body.data.basePrice).toBe(1200);
    });

    it('should delete variant', async () => {
      // First add another variant
      await prisma.productVariant.create({
        data: {
          productId: product.id,
          variantName: 'Extra',
          basePrice: 2000,
          stockQuantity: 20,
          isDefault: false,
          isActive: true,
        },
      });

      const variant = product.variants[0];

      const response = await request(app)
        .delete(`/api/v1/products/${product.id}/variants/${variant.id}`)
        .set('Authorization', `Bearer ${sellerAuth.token}`);

      expectSuccess(response);
    });

    it('should not delete last variant', async () => {
      const variant = product.variants[0];

      const response = await request(app)
        .delete(`/api/v1/products/${product.id}/variants/${variant.id}`)
        .set('Authorization', `Bearer ${sellerAuth.token}`);

      expectError(response, 400);
    });
  });

  // ===========================================================================
  // BULK PRICING
  // ===========================================================================

  describe('Bulk Pricing', () => {
    let product;

    beforeEach(async () => {
      product = await createTestProduct(sellerAuth.business.id, category.id);
    });

    it('should add bulk pricing', async () => {
      const response = await request(app)
        .post(`/api/v1/products/${product.id}/bulk-pricing`)
        .set('Authorization', `Bearer ${sellerAuth.token}`)
        .send({
          pricing: [
            { minQuantity: 10, maxQuantity: 49, price: 900 },
            { minQuantity: 50, maxQuantity: 99, price: 800 },
            { minQuantity: 100, price: 700 },
          ],
        });

      expectSuccess(response);
    });
  });

  // ===========================================================================
  // MY PRODUCTS (SELLER)
  // ===========================================================================

  describe('GET /api/v1/products/my', () => {
    beforeEach(async () => {
      await createTestProduct(sellerAuth.business.id, category.id);
      await createTestProduct(sellerAuth.business.id, category.id);
    });

    it('should list seller\'s products', async () => {
      const response = await request(app)
        .get('/api/v1/products/my')
        .set('Authorization', `Bearer ${sellerAuth.token}`);

      expectSuccess(response);
      expect(response.body.data.products).toHaveLength(2);
    });

    it('should filter by status', async () => {
      const response = await request(app)
        .get('/api/v1/products/my')
        .set('Authorization', `Bearer ${sellerAuth.token}`)
        .query({ status: 'ACTIVE' });

      expectSuccess(response);
    });
  });
});
