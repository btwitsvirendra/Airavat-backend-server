// =============================================================================
// AIRAVAT B2B MARKETPLACE - E-INVOICE SERVICE UNIT TESTS
// Comprehensive tests for GST e-invoice generation and compliance
// =============================================================================

const EInvoiceService = require('../../src/services/eInvoice.service');
const { prisma, factories } = require('../setup');

// Mock dependencies
jest.mock('../../src/config/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    setex: jest.fn(),
  },
}));

jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

// Mock external GST API
jest.mock('axios', () => ({
  create: jest.fn(() => ({
    post: jest.fn().mockResolvedValue({
      data: {
        success: true,
        irn: 'IRN123456789',
        ackNo: 'ACK123456',
        ackDt: new Date().toISOString(),
        signedInvoice: 'base64signeddata',
        signedQRCode: 'base64qrcode',
      },
    }),
    get: jest.fn().mockResolvedValue({
      data: {
        success: true,
        status: 'ACTIVE',
      },
    }),
  })),
}));

describe('EInvoiceService', () => {
  let sellerUser;
  let buyerUser;
  let sellerBusiness;
  let buyerBusiness;
  let testOrder;
  let testCategory;
  let testProduct;

  beforeAll(async () => {
    // Create seller with GST
    sellerUser = await factories.createUser({
      email: 'einvoice-seller@example.com',
      role: 'SELLER',
    });
    sellerBusiness = await factories.createBusiness(sellerUser.id, {
      businessName: 'GST Seller Pvt Ltd',
      gstNumber: '29ABCDE1234F1ZK',
      panNumber: 'ABCDE1234F',
      legalName: 'GST Seller Private Limited',
    });

    // Create buyer with GST
    buyerUser = await factories.createUser({
      email: 'einvoice-buyer@example.com',
      role: 'BUYER',
    });
    buyerBusiness = await factories.createBusiness(buyerUser.id, {
      businessName: 'GST Buyer Co',
      gstNumber: '27FGHIJ5678K2ZL',
      panNumber: 'FGHIJ5678K',
      legalName: 'GST Buyer Company',
    });

    // Create test product
    testCategory = await factories.createCategory();
    testProduct = await factories.createProduct(sellerBusiness.id, testCategory.id, {
      hsnCode: '85171290',
    });

    // Create test order
    testOrder = await factories.createOrder(buyerUser.id, sellerUser.id, [], {
      subtotal: 10000,
      taxAmount: 1800, // 18% GST
      totalAmount: 11800,
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.eInvoice.deleteMany({});
    await prisma.order.deleteMany({ where: { id: testOrder.id } });
    await prisma.productVariant.deleteMany({ where: { productId: testProduct.id } });
    await prisma.product.deleteMany({ where: { id: testProduct.id } });
    await prisma.category.deleteMany({ where: { id: testCategory.id } });
    await prisma.business.deleteMany({
      where: { id: { in: [sellerBusiness.id, buyerBusiness.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [sellerUser.id, buyerUser.id] } },
    });
  });

  // ===========================================================================
  // E-INVOICE GENERATION
  // ===========================================================================

  describe('generateEInvoice', () => {
    it('should generate e-invoice for order', async () => {
      const eInvoice = await EInvoiceService.generateEInvoice(testOrder.id, sellerBusiness.id);

      expect(eInvoice).toBeDefined();
      expect(eInvoice.orderId).toBe(testOrder.id);
      expect(eInvoice.irn).toBeDefined();
      expect(eInvoice.status).toBe('GENERATED');
    });

    it('should include all required GST fields', async () => {
      const eInvoice = await EInvoiceService.getEInvoice(testOrder.id);

      expect(eInvoice.sellerGstin).toBeDefined();
      expect(eInvoice.buyerGstin).toBeDefined();
      expect(eInvoice.documentNumber).toBeDefined();
      expect(eInvoice.documentDate).toBeDefined();
    });

    it('should generate QR code', async () => {
      const eInvoice = await EInvoiceService.getEInvoice(testOrder.id);

      expect(eInvoice.qrCode).toBeDefined();
    });

    it('should not generate duplicate e-invoice', async () => {
      await expect(
        EInvoiceService.generateEInvoice(testOrder.id, sellerBusiness.id)
      ).rejects.toThrow(/already exists|duplicate/i);
    });

    it('should reject generation for non-GST business', async () => {
      const nonGstBusiness = await factories.createBusiness(sellerUser.id, {
        businessName: 'Non GST Business',
        gstNumber: null,
      });

      const order = await factories.createOrder(buyerUser.id, sellerUser.id);

      await expect(
        EInvoiceService.generateEInvoice(order.id, nonGstBusiness.id)
      ).rejects.toThrow(/GST/i);

      // Cleanup
      await prisma.order.delete({ where: { id: order.id } });
      await prisma.business.delete({ where: { id: nonGstBusiness.id } });
    });
  });

  // ===========================================================================
  // E-INVOICE VALIDATION
  // ===========================================================================

  describe('validateInvoiceData', () => {
    it('should validate correct invoice data', async () => {
      const invoiceData = {
        sellerGstin: '29ABCDE1234F1ZK',
        buyerGstin: '27FGHIJ5678K2ZL',
        documentNumber: 'INV-2024-001',
        documentDate: new Date().toISOString(),
        totalValue: 10000,
        taxableValue: 10000,
        cgstAmount: 900,
        sgstAmount: 900,
        igstAmount: 0,
        items: [
          {
            hsnCode: '85171290',
            description: 'Product',
            quantity: 10,
            unitPrice: 1000,
            taxRate: 18,
          },
        ],
      };

      const result = await EInvoiceService.validateInvoiceData(invoiceData);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
    });

    it('should reject invalid GSTIN', async () => {
      const invoiceData = {
        sellerGstin: 'INVALID_GSTIN',
        buyerGstin: '27FGHIJ5678K2ZL',
        documentNumber: 'INV-2024-001',
        documentDate: new Date().toISOString(),
        totalValue: 10000,
      };

      const result = await EInvoiceService.validateInvoiceData(invoiceData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(expect.stringMatching(/GSTIN/i));
    });

    it('should validate HSN code format', async () => {
      const invoiceData = {
        sellerGstin: '29ABCDE1234F1ZK',
        buyerGstin: '27FGHIJ5678K2ZL',
        items: [
          {
            hsnCode: '12', // Too short
            description: 'Product',
            quantity: 10,
            unitPrice: 1000,
          },
        ],
      };

      const result = await EInvoiceService.validateInvoiceData(invoiceData);

      expect(result.isValid).toBe(false);
      expect(result.errors).toContain(expect.stringMatching(/HSN/i));
    });
  });

  // ===========================================================================
  // E-INVOICE CANCELLATION
  // ===========================================================================

  describe('cancelEInvoice', () => {
    let cancelTestOrder;
    let cancelTestInvoice;

    beforeAll(async () => {
      cancelTestOrder = await factories.createOrder(buyerUser.id, sellerUser.id, [], {
        subtotal: 5000,
        taxAmount: 900,
        totalAmount: 5900,
      });

      cancelTestInvoice = await EInvoiceService.generateEInvoice(
        cancelTestOrder.id,
        sellerBusiness.id
      );
    });

    it('should cancel e-invoice within 24 hours', async () => {
      const result = await EInvoiceService.cancelEInvoice(
        cancelTestInvoice.id,
        sellerBusiness.id,
        {
          reason: 'ORDER_CANCELLED',
          remarks: 'Customer cancelled the order',
        }
      );

      expect(result.status).toBe('CANCELLED');
      expect(result.cancelledAt).toBeDefined();
    });

    it('should not cancel already cancelled invoice', async () => {
      await expect(
        EInvoiceService.cancelEInvoice(cancelTestInvoice.id, sellerBusiness.id, {
          reason: 'ORDER_CANCELLED',
        })
      ).rejects.toThrow(/already cancelled|status/i);
    });

    it('should require cancellation reason', async () => {
      const order = await factories.createOrder(buyerUser.id, sellerUser.id);
      const invoice = await EInvoiceService.generateEInvoice(order.id, sellerBusiness.id);

      await expect(
        EInvoiceService.cancelEInvoice(invoice.id, sellerBusiness.id, {})
      ).rejects.toThrow(/reason/i);
    });
  });

  // ===========================================================================
  // IRN STATUS CHECK
  // ===========================================================================

  describe('checkIRNStatus', () => {
    it('should check IRN status from GST portal', async () => {
      const eInvoice = await EInvoiceService.getEInvoice(testOrder.id);

      const status = await EInvoiceService.checkIRNStatus(eInvoice.irn);

      expect(status).toBeDefined();
      expect(status.isActive).toBeDefined();
    });
  });

  // ===========================================================================
  // E-INVOICE PDF
  // ===========================================================================

  describe('generatePDF', () => {
    it('should generate e-invoice PDF', async () => {
      const eInvoice = await EInvoiceService.getEInvoice(testOrder.id);

      const result = await EInvoiceService.generatePDF(eInvoice.id);

      expect(result.pdfUrl).toBeDefined();
    });

    it('should include QR code in PDF', async () => {
      const eInvoice = await EInvoiceService.getEInvoice(testOrder.id);

      const result = await EInvoiceService.generatePDF(eInvoice.id, {
        includeQR: true,
      });

      expect(result.hasQRCode).toBe(true);
    });
  });

  // ===========================================================================
  // BULK E-INVOICE GENERATION
  // ===========================================================================

  describe('bulkGenerateEInvoices', () => {
    let bulkOrders;

    beforeAll(async () => {
      bulkOrders = [];
      for (let i = 0; i < 5; i++) {
        const order = await factories.createOrder(buyerUser.id, sellerUser.id, [], {
          subtotal: 1000 * (i + 1),
          taxAmount: 180 * (i + 1),
          totalAmount: 1180 * (i + 1),
        });
        bulkOrders.push(order);
      }
    });

    it('should generate multiple e-invoices in batch', async () => {
      const orderIds = bulkOrders.map((o) => o.id);

      const result = await EInvoiceService.bulkGenerateEInvoices(orderIds, sellerBusiness.id);

      expect(result.success).toBeGreaterThan(0);
      expect(result.generated).toHaveLength(result.success);
    });

    it('should return failed orders', async () => {
      const orderIds = [...bulkOrders.map((o) => o.id), 'invalid-order-id'];

      const result = await EInvoiceService.bulkGenerateEInvoices(orderIds, sellerBusiness.id);

      expect(result.failed).toBeDefined();
    });
  });

  // ===========================================================================
  // E-INVOICE QUERIES
  // ===========================================================================

  describe('getEInvoices', () => {
    it('should get paginated e-invoices', async () => {
      const result = await EInvoiceService.getBusinessEInvoices(sellerBusiness.id, {
        page: 1,
        limit: 10,
      });

      expect(result.invoices).toBeDefined();
      expect(Array.isArray(result.invoices)).toBe(true);
      expect(result.pagination).toBeDefined();
    });

    it('should filter by status', async () => {
      const result = await EInvoiceService.getBusinessEInvoices(sellerBusiness.id, {
        status: 'GENERATED',
      });

      result.invoices.forEach((invoice) => {
        expect(invoice.status).toBe('GENERATED');
      });
    });

    it('should filter by date range', async () => {
      const startDate = new Date();
      startDate.setMonth(startDate.getMonth() - 1);

      const result = await EInvoiceService.getBusinessEInvoices(sellerBusiness.id, {
        startDate: startDate.toISOString(),
        endDate: new Date().toISOString(),
      });

      result.invoices.forEach((invoice) => {
        expect(new Date(invoice.createdAt) >= startDate).toBe(true);
      });
    });

    it('should search by IRN or document number', async () => {
      const result = await EInvoiceService.getBusinessEInvoices(sellerBusiness.id, {
        search: 'IRN',
      });

      expect(result.invoices).toBeDefined();
    });
  });

  // ===========================================================================
  // E-INVOICE STATISTICS
  // ===========================================================================

  describe('getEInvoiceStats', () => {
    it('should get e-invoice statistics', async () => {
      const stats = await EInvoiceService.getBusinessStats(sellerBusiness.id);

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('totalGenerated');
      expect(stats).toHaveProperty('totalCancelled');
      expect(stats).toHaveProperty('totalValue');
      expect(stats).toHaveProperty('byMonth');
    });

    it('should get monthly breakdown', async () => {
      const stats = await EInvoiceService.getBusinessStats(sellerBusiness.id, {
        groupBy: 'month',
      });

      expect(stats.byMonth).toBeDefined();
      expect(Array.isArray(stats.byMonth)).toBe(true);
    });
  });
});



