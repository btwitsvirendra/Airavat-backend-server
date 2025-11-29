// =============================================================================
// AIRAVAT B2B MARKETPLACE - END-TO-END INTEGRATION TESTS
// Comprehensive tests for complete user flows
// =============================================================================

const request = require('supertest');
const app = require('../../src/app');
const {
  prisma,
  factories,
  createAuthenticatedUser,
  createSellerWithBusiness,
  expectSuccess,
  expectError,
  authGet,
  authPost,
  authPut,
  authDelete,
} = require('../setup');

describe('E2E Integration Tests', () => {
  // ===========================================================================
  // BUYER JOURNEY
  // ===========================================================================

  describe('Buyer Journey', () => {
    let buyer;
    let seller;
    let product;
    let order;

    beforeAll(async () => {
      // Create seller with products
      seller = await createSellerWithBusiness();

      // Create category and product
      const category = await factories.createCategory();
      product = await factories.createProduct(seller.business.id, category.id);

      // Create buyer
      buyer = await createAuthenticatedUser({ role: 'BUYER' });
    });

    describe('1. Browse Products', () => {
      it('should view product listing', async () => {
        const response = await request(app)
          .get('/api/v1/products')
          .query({ page: 1, limit: 10 });

        expectSuccess(response);
        expect(response.body.data.products).toBeDefined();
        expect(Array.isArray(response.body.data.products)).toBe(true);
      });

      it('should view product details', async () => {
        const response = await request(app)
          .get(`/api/v1/products/${product.id}`);

        expectSuccess(response);
        expect(response.body.data.name).toBe(product.name);
      });

      it('should search products', async () => {
        const response = await request(app)
          .get('/api/v1/search')
          .query({ q: 'test', type: 'products' });

        expectSuccess(response);
      });
    });

    describe('2. Cart Management', () => {
      it('should add product to cart', async () => {
        const variant = await prisma.productVariant.findFirst({
          where: { productId: product.id },
        });

        const response = await authPost('/api/v1/cart/items', buyer.token, {
          productId: product.id,
          variantId: variant.id,
          quantity: 5,
        });

        expectSuccess(response, 201);
        expect(response.body.data.items.length).toBeGreaterThan(0);
      });

      it('should view cart', async () => {
        const response = await authGet('/api/v1/cart', buyer.token);

        expectSuccess(response);
        expect(response.body.data.items).toBeDefined();
        expect(response.body.data.totals).toBeDefined();
      });

      it('should update cart quantity', async () => {
        const cartResponse = await authGet('/api/v1/cart', buyer.token);
        const cartItem = cartResponse.body.data.items[0];

        const response = await authPut(`/api/v1/cart/items/${cartItem.id}`, buyer.token, {
          quantity: 10,
        });

        expectSuccess(response);
        expect(response.body.data.items[0].quantity).toBe(10);
      });
    });

    describe('3. Checkout & Order', () => {
      it('should checkout and create order', async () => {
        const response = await authPost('/api/v1/orders', buyer.token, {
          shippingAddress: {
            addressLine1: '123 Test Street',
            city: 'Mumbai',
            state: 'Maharashtra',
            country: 'IN',
            pincode: '400001',
          },
          paymentMethod: 'COD',
        });

        expectSuccess(response, 201);
        expect(response.body.data.orderNumber).toBeDefined();
        expect(response.body.data.status).toBe('PENDING');

        order = response.body.data;
      });

      it('should view order details', async () => {
        const response = await authGet(`/api/v1/orders/${order.id}`, buyer.token);

        expectSuccess(response);
        expect(response.body.data.orderNumber).toBe(order.orderNumber);
      });

      it('should list buyer orders', async () => {
        const response = await authGet('/api/v1/orders', buyer.token);

        expectSuccess(response);
        expect(response.body.data.orders.length).toBeGreaterThan(0);
      });
    });

    describe('4. Post-Order Actions', () => {
      it('should submit product review', async () => {
        // First, complete the order
        await prisma.order.update({
          where: { id: order.id },
          data: { status: 'DELIVERED' },
        });

        const response = await authPost('/api/v1/reviews', buyer.token, {
          productId: product.id,
          orderId: order.id,
          rating: 5,
          title: 'Great product!',
          comment: 'Very satisfied with the quality.',
        });

        expectSuccess(response, 201);
      });

      it('should add product to wishlist', async () => {
        // Get or create default wishlist
        const wishlistResponse = await authGet('/api/v1/wishlists', buyer.token);
        let wishlistId;

        if (wishlistResponse.body.data.length > 0) {
          wishlistId = wishlistResponse.body.data[0].id;
        } else {
          const createResponse = await authPost('/api/v1/wishlists', buyer.token, {
            name: 'My Favorites',
          });
          wishlistId = createResponse.body.data.id;
        }

        const variant = await prisma.productVariant.findFirst({
          where: { productId: product.id },
        });

        const response = await authPost(`/api/v1/wishlists/${wishlistId}/items`, buyer.token, {
          productId: product.id,
          variantId: variant.id,
        });

        expectSuccess(response, 201);
      });
    });
  });

  // ===========================================================================
  // SELLER JOURNEY
  // ===========================================================================

  describe('Seller Journey', () => {
    let seller;
    let category;
    let product;

    beforeAll(async () => {
      seller = await createSellerWithBusiness();
      category = await factories.createCategory();
    });

    describe('1. Product Management', () => {
      it('should create new product', async () => {
        const response = await authPost('/api/v1/products', seller.token, {
          categoryId: category.id,
          name: 'Industrial Valve',
          description: 'High-quality industrial valve for chemical plants',
          images: ['https://example.com/valve.jpg'],
          minOrderQuantity: 10,
          variants: [
            {
              sku: 'VALVE-001',
              basePrice: 5000,
              stockQuantity: 100,
              attributes: { size: '2 inch', material: 'Stainless Steel' },
            },
          ],
        });

        expectSuccess(response, 201);
        expect(response.body.data.name).toBe('Industrial Valve');
        product = response.body.data;
      });

      it('should update product', async () => {
        const response = await authPut(`/api/v1/products/${product.id}`, seller.token, {
          description: 'Updated description with more details',
        });

        expectSuccess(response);
        expect(response.body.data.description).toContain('Updated');
      });

      it('should list seller products', async () => {
        const response = await authGet('/api/v1/products/my-products', seller.token);

        expectSuccess(response);
        expect(response.body.data.products.length).toBeGreaterThan(0);
      });
    });

    describe('2. Order Management', () => {
      let buyerOrder;

      beforeAll(async () => {
        // Create a buyer and order
        const buyer = await createAuthenticatedUser({ role: 'BUYER' });
        const variant = await prisma.productVariant.findFirst({
          where: { productId: product.id },
        });

        buyerOrder = await prisma.order.create({
          data: {
            orderNumber: `ORD-${Date.now()}`,
            buyerId: buyer.user.id,
            sellerId: seller.user.id,
            status: 'PENDING',
            paymentStatus: 'PENDING',
            subtotal: 50000,
            taxAmount: 9000,
            totalAmount: 59000,
            currency: 'INR',
          },
        });

        await prisma.orderItem.create({
          data: {
            orderId: buyerOrder.id,
            productId: product.id,
            variantId: variant.id,
            productName: product.name,
            quantity: 10,
            unitPrice: 5000,
            totalPrice: 50000,
          },
        });
      });

      it('should list seller orders', async () => {
        const response = await authGet('/api/v1/orders/seller', seller.token);

        expectSuccess(response);
        expect(response.body.data.orders.length).toBeGreaterThan(0);
      });

      it('should confirm order', async () => {
        const response = await authPut(`/api/v1/orders/${buyerOrder.id}/confirm`, seller.token);

        expectSuccess(response);
        expect(response.body.data.status).toBe('CONFIRMED');
      });

      it('should update order status to shipped', async () => {
        const response = await authPut(`/api/v1/orders/${buyerOrder.id}/ship`, seller.token, {
          trackingNumber: 'TRACK123456',
          carrier: 'Blue Dart',
        });

        expectSuccess(response);
        expect(response.body.data.status).toBe('SHIPPED');
      });
    });

    describe('3. RFQ Response', () => {
      let rfq;

      beforeAll(async () => {
        const buyer = await createAuthenticatedUser({ role: 'BUYER' });
        const buyerBusiness = await factories.createBusiness(buyer.user.id);

        rfq = await prisma.rFQ.create({
          data: {
            rfqNumber: `RFQ-${Date.now()}`,
            businessId: buyerBusiness.id,
            categoryId: category.id,
            title: 'Need Industrial Valves',
            description: 'Looking for quality valves',
            quantity: 100,
            unitType: 'pieces',
            status: 'OPEN',
            deliveryCity: 'Chennai',
            deliveryState: 'Tamil Nadu',
            deliveryCountry: 'IN',
          },
        });
      });

      it('should view open RFQs', async () => {
        const response = await authGet('/api/v1/rfq', seller.token);

        expectSuccess(response);
      });

      it('should submit quotation', async () => {
        const response = await authPost(`/api/v1/rfq/${rfq.id}/quotations`, seller.token, {
          unitPrice: 4500,
          totalPrice: 450000,
          deliveryDays: 14,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          notes: 'Best quality guaranteed',
        });

        expectSuccess(response, 201);
      });
    });
  });

  // ===========================================================================
  // RFQ FLOW
  // ===========================================================================

  describe('RFQ Complete Flow', () => {
    let buyer;
    let seller;
    let buyerBusiness;
    let sellerBusiness;
    let category;
    let rfq;
    let quotation;

    beforeAll(async () => {
      // Setup buyer
      buyer = await createAuthenticatedUser({ role: 'BUYER' });
      buyerBusiness = await factories.createBusiness(buyer.user.id);
      await prisma.user.update({
        where: { id: buyer.user.id },
        data: { businessId: buyerBusiness.id },
      });

      // Setup seller
      seller = await createSellerWithBusiness();
      sellerBusiness = seller.business;

      category = await factories.createCategory();
    });

    it('1. Buyer creates RFQ', async () => {
      const response = await authPost('/api/v1/rfq', buyer.token, {
        categoryId: category.id,
        title: 'Need Raw Materials',
        description: 'Looking for quality raw materials for manufacturing',
        quantity: 500,
        unitType: 'kg',
        budget: 100000,
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        deliveryCity: 'Bangalore',
        deliveryState: 'Karnataka',
        deliveryCountry: 'IN',
      });

      expectSuccess(response, 201);
      rfq = response.body.data;
    });

    it('2. Seller views RFQ', async () => {
      const response = await authGet(`/api/v1/rfq/${rfq.id}`, seller.token);

      expectSuccess(response);
      expect(response.body.data.title).toBe('Need Raw Materials');
    });

    it('3. Seller submits quotation', async () => {
      const response = await authPost(`/api/v1/rfq/${rfq.id}/quotations`, seller.token, {
        unitPrice: 180,
        totalPrice: 90000,
        deliveryDays: 10,
        validUntil: new Date(Date.now() + 14 * 24 * 60 * 60 * 1000),
        termsAndConditions: 'Standard terms apply',
      });

      expectSuccess(response, 201);
      quotation = response.body.data;
    });

    it('4. Buyer views quotations', async () => {
      const response = await authGet(`/api/v1/rfq/${rfq.id}/quotations`, buyer.token);

      expectSuccess(response);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('5. Buyer accepts quotation', async () => {
      const response = await authPost(`/api/v1/rfq/quotations/${quotation.id}/accept`, buyer.token);

      expectSuccess(response);
      expect(response.body.data.status).toBe('ACCEPTED');
    });

    it('6. RFQ is closed after acceptance', async () => {
      const response = await authGet(`/api/v1/rfq/${rfq.id}`, buyer.token);

      expectSuccess(response);
      expect(response.body.data.status).toBe('CLOSED');
    });
  });

  // ===========================================================================
  // WALLET FLOW
  // ===========================================================================

  describe('Wallet Complete Flow', () => {
    let user;

    beforeAll(async () => {
      user = await createAuthenticatedUser();
    });

    it('1. Create wallet', async () => {
      const response = await authPost('/api/v1/wallet', user.token);

      expectSuccess(response, 201);
      expect(response.body.data.balance).toBe(0);
    });

    it('2. Add money to wallet', async () => {
      const response = await authPost('/api/v1/wallet/deposit', user.token, {
        amount: 5000,
        paymentMethod: 'CARD',
      });

      expectSuccess(response);
      expect(response.body.data.balance).toBe(5000);
    });

    it('3. Check wallet balance', async () => {
      const response = await authGet('/api/v1/wallet', user.token);

      expectSuccess(response);
      expect(response.body.data.balance).toBe(5000);
    });

    it('4. View transaction history', async () => {
      const response = await authGet('/api/v1/wallet/transactions', user.token);

      expectSuccess(response);
      expect(response.body.data.transactions.length).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // AUCTION FLOW
  // ===========================================================================

  describe('Auction Complete Flow', () => {
    let seller;
    let buyer1;
    let buyer2;
    let product;
    let auction;

    beforeAll(async () => {
      seller = await createSellerWithBusiness();
      buyer1 = await createAuthenticatedUser({ role: 'BUYER' });
      buyer2 = await createAuthenticatedUser({ role: 'BUYER' });

      const category = await factories.createCategory();
      product = await factories.createProduct(seller.business.id, category.id);
    });

    it('1. Seller creates auction', async () => {
      const response = await authPost('/api/v1/auctions', seller.token, {
        productId: product.id,
        title: 'Bulk Inventory Auction',
        description: 'Selling excess inventory at auction',
        startingPrice: 10000,
        reservePrice: 50000,
        minimumIncrement: 500,
        startDate: new Date().toISOString(),
        endDate: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
        quantity: 100,
      });

      expectSuccess(response, 201);
      auction = response.body.data;

      // Activate auction
      await prisma.auction.update({
        where: { id: auction.id },
        data: { status: 'ACTIVE' },
      });
    });

    it('2. Buyer 1 places bid', async () => {
      const response = await authPost(`/api/v1/auctions/${auction.id}/bids`, buyer1.token, {
        amount: 15000,
      });

      expectSuccess(response, 201);
      expect(response.body.data.amount).toBe(15000);
    });

    it('3. Buyer 2 outbids', async () => {
      const response = await authPost(`/api/v1/auctions/${auction.id}/bids`, buyer2.token, {
        amount: 20000,
      });

      expectSuccess(response, 201);
      expect(response.body.data.amount).toBe(20000);
    });

    it('4. View bid history', async () => {
      const response = await authGet(`/api/v1/auctions/${auction.id}/bids`, buyer1.token);

      expectSuccess(response);
      expect(response.body.data.bids.length).toBe(2);
    });

    it('5. Check current price', async () => {
      const response = await authGet(`/api/v1/auctions/${auction.id}`, buyer1.token);

      expectSuccess(response);
      expect(response.body.data.currentPrice).toBe(20000);
    });
  });
});



