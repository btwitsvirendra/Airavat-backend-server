// =============================================================================
// AIRAVAT B2B MARKETPLACE - PRODUCT TESTS
// Tests for product endpoints
// =============================================================================

const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  resetDatabase,
  closeDatabase,
  factories,
  createSellerWithBusiness,
  createAuthenticatedUser,
  authGet,
  authPost,
  authPut,
  authDelete,
  expectSuccess,
  expectError,
  expectPagination,
} = require('./setup');

describe('Product API', () => {
  let seller, buyer, category;

  beforeEach(async () => {
    await resetDatabase();
    seller = await createSellerWithBusiness();
    buyer = await createAuthenticatedUser({ role: 'BUYER' });
    category = await factories.createCategory();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  // ===========================================================================
  // LIST PRODUCTS
  // ===========================================================================

  describe('GET /api/v1/products', () => {
    beforeEach(async () => {
      // Create test products
      await factories.createProduct(seller.business.id, category.id);
      await factories.createProduct(seller.business.id, category.id);
      await factories.createProduct(seller.business.id, category.id);
    });

    it('should list products without authentication', async () => {
      const response = await request(app).get('/api/v1/products');

      expectSuccess(response);
      expect(response.body.data.products.length).toBe(3);
      expectPagination(response);
    });

    it('should filter products by category', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .query({ category: category.id });

      expectSuccess(response);
      expect(response.body.data.products.length).toBe(3);
    });

    it('should sort products by price', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .query({ sort: 'price_low' });

      expectSuccess(response);
    });

    it('should paginate results', async () => {
      const response = await request(app)
        .get('/api/v1/products')
        .query({ page: 1, limit: 2 });

      expectSuccess(response);
      expect(response.body.data.products.length).toBe(2);
      expect(response.body.data.pagination.total).toBe(3);
    });
  });

  // ===========================================================================
  // GET SINGLE PRODUCT
  // ===========================================================================

  describe('GET /api/v1/products/:id', () => {
    let product;

    beforeEach(async () => {
      product = await factories.createProduct(seller.business.id, category.id);
    });

    it('should get product by ID', async () => {
      const response = await request(app).get(`/api/v1/products/${product.id}`);

      expectSuccess(response);
      expect(response.body.data.id).toBe(product.id);
      expect(response.body.data.name).toBe(product.name);
    });

    it('should get product by slug', async () => {
      const response = await request(app).get(`/api/v1/products/${product.slug}`);

      expectSuccess(response);
      expect(response.body.data.slug).toBe(product.slug);
    });

    it('should return 404 for non-existent product', async () => {
      const response = await request(app).get('/api/v1/products/non-existent-id');

      expectError(response, 404);
    });

    it('should increment view count', async () => {
      await request(app).get(`/api/v1/products/${product.id}`);
      
      const updated = await prisma.product.findUnique({
        where: { id: product.id },
      });
      
      expect(updated.viewCount).toBe(1);
    });
  });

  // ===========================================================================
  // CREATE PRODUCT
  // ===========================================================================

  describe('POST /api/v1/products', () => {
    const validProduct = {
      name: 'New Test Product',
      description: 'This is a detailed description of the test product with at least 20 characters',
      images: ['https://example.com/image1.jpg'],
      variants: [
        {
          sku: 'TEST-SKU-001',
          basePrice: 1500,
          stockQuantity: 50,
          isDefault: true,
        },
      ],
    };

    it('should create product as seller', async () => {
      const response = await authPost(
        '/api/v1/products',
        seller.token,
        { ...validProduct, categoryId: category.id }
      );

      expectSuccess(response, 201);
      expect(response.body.data.name).toBe(validProduct.name);
      expect(response.body.data.variants.length).toBe(1);
    });

    it('should return error for buyer role', async () => {
      const response = await authPost(
        '/api/v1/products',
        buyer.token,
        { ...validProduct, categoryId: category.id }
      );

      expectError(response, 403);
    });

    it('should return error for missing required fields', async () => {
      const response = await authPost('/api/v1/products', seller.token, {
        name: 'Test',
      });

      expectError(response, 400);
    });

    it('should return error without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/products')
        .send({ ...validProduct, categoryId: category.id });

      expectError(response, 401);
    });
  });

  // ===========================================================================
  // UPDATE PRODUCT
  // ===========================================================================

  describe('PUT /api/v1/products/:id', () => {
    let product;

    beforeEach(async () => {
      product = await factories.createProduct(seller.business.id, category.id);
    });

    it('should update own product', async () => {
      const response = await authPut(
        `/api/v1/products/${product.id}`,
        seller.token,
        { name: 'Updated Product Name' }
      );

      expectSuccess(response);
      expect(response.body.data.name).toBe('Updated Product Name');
    });

    it('should return error for other seller product', async () => {
      const otherSeller = await createSellerWithBusiness();
      
      const response = await authPut(
        `/api/v1/products/${product.id}`,
        otherSeller.token,
        { name: 'Hacked Name' }
      );

      expectError(response, 403);
    });

    it('should return 404 for non-existent product', async () => {
      const response = await authPut(
        '/api/v1/products/non-existent-id',
        seller.token,
        { name: 'Test' }
      );

      expectError(response, 404);
    });
  });

  // ===========================================================================
  // DELETE PRODUCT
  // ===========================================================================

  describe('DELETE /api/v1/products/:id', () => {
    let product;

    beforeEach(async () => {
      product = await factories.createProduct(seller.business.id, category.id);
    });

    it('should delete own product', async () => {
      const response = await authDelete(`/api/v1/products/${product.id}`, seller.token);

      expectSuccess(response);

      // Verify soft delete
      const deleted = await prisma.product.findUnique({
        where: { id: product.id },
      });
      expect(deleted.status).toBe('DELETED');
    });

    it('should return error for other seller product', async () => {
      const otherSeller = await createSellerWithBusiness();
      
      const response = await authDelete(
        `/api/v1/products/${product.id}`,
        otherSeller.token
      );

      expectError(response, 403);
    });
  });

  // ===========================================================================
  // MY PRODUCTS (SELLER)
  // ===========================================================================

  describe('GET /api/v1/products/my', () => {
    beforeEach(async () => {
      await factories.createProduct(seller.business.id, category.id);
      await factories.createProduct(seller.business.id, category.id);
    });

    it('should list seller own products', async () => {
      const response = await authGet('/api/v1/products/my', seller.token);

      expectSuccess(response);
      expect(response.body.data.products.length).toBe(2);
    });

    it('should filter by status', async () => {
      const response = await authGet('/api/v1/products/my', seller.token)
        .query({ status: 'ACTIVE' });

      expectSuccess(response);
    });
  });

  // ===========================================================================
  // PRODUCT VARIANTS
  // ===========================================================================

  describe('POST /api/v1/products/:id/variants', () => {
    let product;

    beforeEach(async () => {
      product = await factories.createProduct(seller.business.id, category.id);
    });

    it('should add variant to product', async () => {
      const response = await authPost(
        `/api/v1/products/${product.id}/variants`,
        seller.token,
        {
          sku: 'NEW-VARIANT-SKU',
          variantName: 'Large Size',
          basePrice: 2000,
          stockQuantity: 30,
          attributes: { size: 'Large' },
        }
      );

      expectSuccess(response, 201);
      expect(response.body.data.sku).toBe('NEW-VARIANT-SKU');
    });

    it('should return error for duplicate SKU', async () => {
      // Get existing variant SKU
      const existingVariant = await prisma.productVariant.findFirst({
        where: { productId: product.id },
      });

      const response = await authPost(
        `/api/v1/products/${product.id}/variants`,
        seller.token,
        {
          sku: existingVariant.sku,
          basePrice: 2000,
          stockQuantity: 30,
        }
      );

      expectError(response, 400, 'SKU');
    });
  });

  // ===========================================================================
  // INVENTORY
  // ===========================================================================

  describe('PATCH /api/v1/products/:id/inventory', () => {
    let product, variant;

    beforeEach(async () => {
      product = await factories.createProduct(seller.business.id, category.id);
      variant = await prisma.productVariant.findFirst({
        where: { productId: product.id },
      });
    });

    it('should update inventory stock', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${product.id}/inventory`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({
          variantId: variant.id,
          quantity: 50,
          type: 'ADD',
          reason: 'Restock',
        });

      expectSuccess(response);
      expect(response.body.data.stockQuantity).toBe(150); // 100 + 50
    });

    it('should deduct inventory', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${product.id}/inventory`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({
          variantId: variant.id,
          quantity: 20,
          type: 'REMOVE',
          reason: 'Damaged goods',
        });

      expectSuccess(response);
      expect(response.body.data.stockQuantity).toBe(80); // 100 - 20
    });

    it('should prevent negative stock', async () => {
      const response = await request(app)
        .patch(`/api/v1/products/${product.id}/inventory`)
        .set('Authorization', `Bearer ${seller.token}`)
        .send({
          variantId: variant.id,
          quantity: 200,
          type: 'REMOVE',
        });

      expectError(response, 400, 'insufficient');
    });
  });
});
