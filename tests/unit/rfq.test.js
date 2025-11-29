// =============================================================================
// AIRAVAT B2B MARKETPLACE - RFQ SERVICE UNIT TESTS
// Comprehensive tests for Request for Quotation functionality
// =============================================================================

const RFQService = require('../../src/services/rfq.service');
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

describe('RFQService', () => {
  let buyerUser;
  let sellerUser;
  let buyerBusiness;
  let sellerBusiness;
  let testCategory;

  beforeAll(async () => {
    // Create buyer
    buyerUser = await factories.createUser({
      email: 'rfq-buyer@example.com',
      role: 'BUYER',
    });
    buyerBusiness = await factories.createBusiness(buyerUser.id, {
      businessName: 'Buyer Business',
    });
    await prisma.user.update({
      where: { id: buyerUser.id },
      data: { businessId: buyerBusiness.id },
    });

    // Create seller
    sellerUser = await factories.createUser({
      email: 'rfq-seller@example.com',
      role: 'SELLER',
    });
    sellerBusiness = await factories.createBusiness(sellerUser.id, {
      businessName: 'Seller Business',
    });
    await prisma.user.update({
      where: { id: sellerUser.id },
      data: { businessId: sellerBusiness.id },
    });

    // Create category
    testCategory = await factories.createCategory();
  });

  afterAll(async () => {
    // Cleanup
    await prisma.quotation.deleteMany({});
    await prisma.rFQ.deleteMany({});
    await prisma.category.deleteMany({ where: { id: testCategory.id } });
    await prisma.business.deleteMany({
      where: { id: { in: [buyerBusiness.id, sellerBusiness.id] } },
    });
    await prisma.user.deleteMany({
      where: { id: { in: [buyerUser.id, sellerUser.id] } },
    });
  });

  // ===========================================================================
  // RFQ CREATION
  // ===========================================================================

  describe('createRFQ', () => {
    it('should create a new RFQ', async () => {
      const rfqData = {
        categoryId: testCategory.id,
        title: 'Need Industrial Components',
        description: 'Looking for high-quality industrial components',
        quantity: 1000,
        unitType: 'pieces',
        budget: 50000,
        currency: 'INR',
        deliveryCity: 'Mumbai',
        deliveryState: 'Maharashtra',
        deliveryCountry: 'IN',
        deliveryPincode: '400001',
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        requirements: {
          quality: 'high',
          certifications: ['ISO 9001'],
        },
      };

      const rfq = await RFQService.createRFQ(buyerBusiness.id, rfqData);

      expect(rfq).toBeDefined();
      expect(rfq.title).toBe(rfqData.title);
      expect(rfq.quantity).toBe(rfqData.quantity);
      expect(rfq.status).toBe('OPEN');
      expect(rfq.rfqNumber).toBeDefined();
    });

    it('should reject RFQ with past valid date', async () => {
      const rfqData = {
        categoryId: testCategory.id,
        title: 'Invalid RFQ',
        quantity: 100,
        validUntil: new Date(Date.now() - 86400000), // Yesterday
      };

      await expect(RFQService.createRFQ(buyerBusiness.id, rfqData)).rejects.toThrow();
    });

    it('should reject RFQ with invalid category', async () => {
      const rfqData = {
        categoryId: 'non-existent-category',
        title: 'Invalid Category RFQ',
        quantity: 100,
      };

      await expect(RFQService.createRFQ(buyerBusiness.id, rfqData)).rejects.toThrow();
    });
  });

  // ===========================================================================
  // GET RFQs
  // ===========================================================================

  describe('getRFQs', () => {
    beforeAll(async () => {
      // Create multiple RFQs
      for (let i = 0; i < 5; i++) {
        await RFQService.createRFQ(buyerBusiness.id, {
          categoryId: testCategory.id,
          title: `Test RFQ ${i + 1}`,
          quantity: 100 * (i + 1),
          unitType: 'pieces',
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });
      }
    });

    it('should return paginated RFQs', async () => {
      const result = await RFQService.getRFQs({ page: 1, limit: 10 });

      expect(result.rfqs).toBeDefined();
      expect(Array.isArray(result.rfqs)).toBe(true);
      expect(result.pagination).toBeDefined();
    });

    it('should filter by status', async () => {
      const result = await RFQService.getRFQs({ status: 'OPEN' });

      result.rfqs.forEach((rfq) => {
        expect(rfq.status).toBe('OPEN');
      });
    });

    it('should filter by category', async () => {
      const result = await RFQService.getRFQs({ categoryId: testCategory.id });

      result.rfqs.forEach((rfq) => {
        expect(rfq.categoryId).toBe(testCategory.id);
      });
    });

    it('should search by title', async () => {
      const result = await RFQService.getRFQs({ search: 'Test RFQ' });

      expect(result.rfqs.length).toBeGreaterThan(0);
    });

    it('should get user RFQs', async () => {
      const result = await RFQService.getBusinessRFQs(buyerBusiness.id, { page: 1, limit: 10 });

      expect(result.rfqs.length).toBeGreaterThan(0);
      result.rfqs.forEach((rfq) => {
        expect(rfq.businessId).toBe(buyerBusiness.id);
      });
    });
  });

  // ===========================================================================
  // QUOTATIONS
  // ===========================================================================

  describe('Quotations', () => {
    let testRFQ;

    beforeAll(async () => {
      testRFQ = await RFQService.createRFQ(buyerBusiness.id, {
        categoryId: testCategory.id,
        title: 'RFQ for Quotations',
        quantity: 500,
        unitType: 'kg',
        validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      });
    });

    describe('submitQuotation', () => {
      it('should submit quotation for RFQ', async () => {
        const quotation = await RFQService.submitQuotation(testRFQ.id, sellerBusiness.id, {
          unitPrice: 100,
          totalPrice: 50000,
          currency: 'INR',
          deliveryDays: 15,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          notes: 'Best quality products',
          termsAndConditions: 'Standard T&C apply',
        });

        expect(quotation).toBeDefined();
        expect(quotation.rfqId).toBe(testRFQ.id);
        expect(quotation.businessId).toBe(sellerBusiness.id);
        expect(quotation.status).toBe('PENDING');
      });

      it('should reject duplicate quotation from same seller', async () => {
        await expect(
          RFQService.submitQuotation(testRFQ.id, sellerBusiness.id, {
            unitPrice: 90,
            totalPrice: 45000,
            currency: 'INR',
            deliveryDays: 10,
            validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          })
        ).rejects.toThrow(/already submitted|duplicate/i);
      });

      it('should reject quotation from RFQ creator', async () => {
        await expect(
          RFQService.submitQuotation(testRFQ.id, buyerBusiness.id, {
            unitPrice: 100,
            totalPrice: 50000,
            currency: 'INR',
            deliveryDays: 15,
            validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
          })
        ).rejects.toThrow(/own RFQ|creator/i);
      });
    });

    describe('getQuotations', () => {
      it('should get quotations for RFQ', async () => {
        const result = await RFQService.getQuotationsForRFQ(testRFQ.id, buyerBusiness.id);

        expect(Array.isArray(result)).toBe(true);
        expect(result.length).toBeGreaterThan(0);
      });

      it('should include seller information', async () => {
        const result = await RFQService.getQuotationsForRFQ(testRFQ.id, buyerBusiness.id);

        result.forEach((quotation) => {
          expect(quotation).toHaveProperty('business');
          expect(quotation.business).toHaveProperty('businessName');
        });
      });
    });

    describe('acceptQuotation', () => {
      let quotationToAccept;

      beforeAll(async () => {
        // Create a new RFQ and quotation for acceptance test
        const rfq = await RFQService.createRFQ(buyerBusiness.id, {
          categoryId: testCategory.id,
          title: 'RFQ for Acceptance Test',
          quantity: 200,
          unitType: 'pieces',
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        quotationToAccept = await RFQService.submitQuotation(rfq.id, sellerBusiness.id, {
          unitPrice: 50,
          totalPrice: 10000,
          currency: 'INR',
          deliveryDays: 7,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      });

      it('should accept quotation', async () => {
        const result = await RFQService.acceptQuotation(
          quotationToAccept.id,
          buyerBusiness.id,
          'Accepted for quality'
        );

        expect(result.quotation.status).toBe('ACCEPTED');
        expect(result.rfq.status).toBe('CLOSED');
      });

      it('should reject already accepted quotation', async () => {
        await expect(
          RFQService.acceptQuotation(quotationToAccept.id, buyerBusiness.id)
        ).rejects.toThrow(/already|status/i);
      });
    });

    describe('rejectQuotation', () => {
      let quotationToReject;

      beforeAll(async () => {
        const rfq = await RFQService.createRFQ(buyerBusiness.id, {
          categoryId: testCategory.id,
          title: 'RFQ for Rejection Test',
          quantity: 150,
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        quotationToReject = await RFQService.submitQuotation(rfq.id, sellerBusiness.id, {
          unitPrice: 75,
          totalPrice: 11250,
          currency: 'INR',
          deliveryDays: 10,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });
      });

      it('should reject quotation', async () => {
        const result = await RFQService.rejectQuotation(
          quotationToReject.id,
          buyerBusiness.id,
          'Price too high'
        );

        expect(result.status).toBe('REJECTED');
      });
    });
  });

  // ===========================================================================
  // RFQ LIFECYCLE
  // ===========================================================================

  describe('RFQ Lifecycle', () => {
    describe('closeRFQ', () => {
      it('should close RFQ manually', async () => {
        const rfq = await RFQService.createRFQ(buyerBusiness.id, {
          categoryId: testCategory.id,
          title: 'RFQ to Close',
          quantity: 100,
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        const result = await RFQService.closeRFQ(rfq.id, buyerBusiness.id, 'No longer needed');

        expect(result.status).toBe('CLOSED');
      });

      it('should not close already closed RFQ', async () => {
        const rfq = await RFQService.createRFQ(buyerBusiness.id, {
          categoryId: testCategory.id,
          title: 'Already Closed RFQ',
          quantity: 100,
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        await RFQService.closeRFQ(rfq.id, buyerBusiness.id);

        await expect(
          RFQService.closeRFQ(rfq.id, buyerBusiness.id)
        ).rejects.toThrow(/already closed|status/i);
      });
    });

    describe('cancelRFQ', () => {
      it('should cancel RFQ without quotations', async () => {
        const rfq = await RFQService.createRFQ(buyerBusiness.id, {
          categoryId: testCategory.id,
          title: 'RFQ to Cancel',
          quantity: 100,
          validUntil: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        });

        const result = await RFQService.cancelRFQ(rfq.id, buyerBusiness.id, 'Changed requirements');

        expect(result.status).toBe('CANCELLED');
      });
    });

    describe('extendRFQ', () => {
      it('should extend RFQ validity', async () => {
        const rfq = await RFQService.createRFQ(buyerBusiness.id, {
          categoryId: testCategory.id,
          title: 'RFQ to Extend',
          quantity: 100,
          validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000),
        });

        const newValidUntil = new Date(Date.now() + 60 * 24 * 60 * 60 * 1000);

        const result = await RFQService.extendRFQ(rfq.id, buyerBusiness.id, newValidUntil);

        expect(new Date(result.validUntil).getTime()).toBe(newValidUntil.getTime());
      });
    });
  });

  // ===========================================================================
  // RFQ STATISTICS
  // ===========================================================================

  describe('RFQ Statistics', () => {
    it('should get RFQ statistics for business', async () => {
      const stats = await RFQService.getBusinessRFQStats(buyerBusiness.id);

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('byStatus');
    });

    it('should get quotation statistics for seller', async () => {
      const stats = await RFQService.getBusinessQuotationStats(sellerBusiness.id);

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('total');
      expect(stats).toHaveProperty('accepted');
      expect(stats).toHaveProperty('rejected');
    });
  });
});



