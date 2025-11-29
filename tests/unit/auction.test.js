// =============================================================================
// AIRAVAT B2B MARKETPLACE - AUCTION SERVICE UNIT TESTS
// Comprehensive tests for auction functionality
// =============================================================================

const AuctionService = require('../../src/services/auction.service');
const { prisma, factories } = require('../setup');

// Mock dependencies
jest.mock('../../src/config/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    setex: jest.fn(),
    publish: jest.fn(),
  },
}));

jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('AuctionService', () => {
  let sellerUser;
  let buyerUser;
  let testBusiness;
  let testCategory;
  let testProduct;

  beforeAll(async () => {
    // Create seller with business
    sellerUser = await factories.createUser({
      email: 'auction-seller@example.com',
      role: 'SELLER',
    });
    testBusiness = await factories.createBusiness(sellerUser.id);
    testCategory = await factories.createCategory();
    testProduct = await factories.createProduct(testBusiness.id, testCategory.id);

    // Create buyer
    buyerUser = await factories.createUser({
      email: 'auction-buyer@example.com',
      role: 'BUYER',
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.bid.deleteMany({});
    await prisma.auction.deleteMany({});
    await prisma.productVariant.deleteMany({ where: { productId: testProduct.id } });
    await prisma.product.deleteMany({ where: { id: testProduct.id } });
    await prisma.category.deleteMany({ where: { id: testCategory.id } });
    await prisma.business.deleteMany({ where: { id: testBusiness.id } });
    await prisma.user.deleteMany({ where: { id: { in: [sellerUser.id, buyerUser.id] } } });
  });

  // ===========================================================================
  // AUCTION CREATION
  // ===========================================================================

  describe('createAuction', () => {
    it('should create a new auction', async () => {
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000); // 7 days

      const auction = await AuctionService.createAuction(sellerUser.id, {
        productId: testProduct.id,
        title: 'Test Auction',
        description: 'Auction description',
        startingPrice: 1000,
        reservePrice: 5000,
        minimumIncrement: 100,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
        quantity: 10,
      });

      expect(auction).toBeDefined();
      expect(auction.title).toBe('Test Auction');
      expect(auction.startingPrice).toBe(1000);
      expect(auction.status).toBe('SCHEDULED');
    });

    it('should reject auction with end date before start date', async () => {
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() - 24 * 60 * 60 * 1000); // Yesterday

      await expect(
        AuctionService.createAuction(sellerUser.id, {
          productId: testProduct.id,
          title: 'Invalid Auction',
          startingPrice: 1000,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        })
      ).rejects.toThrow(/date/i);
    });

    it('should reject auction with reserve price below starting price', async () => {
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      await expect(
        AuctionService.createAuction(sellerUser.id, {
          productId: testProduct.id,
          title: 'Invalid Auction',
          startingPrice: 5000,
          reservePrice: 1000, // Lower than starting
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        })
      ).rejects.toThrow(/reserve/i);
    });

    it('should reject auction creation by non-owner', async () => {
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      await expect(
        AuctionService.createAuction(buyerUser.id, {
          productId: testProduct.id,
          title: 'Unauthorized Auction',
          startingPrice: 1000,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        })
      ).rejects.toThrow(/permission|unauthorized/i);
    });
  });

  // ===========================================================================
  // GET AUCTIONS
  // ===========================================================================

  describe('getAuctions', () => {
    beforeAll(async () => {
      // Create multiple auctions
      const startDate = new Date();
      const endDate = new Date(startDate.getTime() + 7 * 24 * 60 * 60 * 1000);

      for (let i = 0; i < 5; i++) {
        await AuctionService.createAuction(sellerUser.id, {
          productId: testProduct.id,
          title: `List Auction ${i + 1}`,
          startingPrice: 1000 + i * 100,
          startDate: startDate.toISOString(),
          endDate: endDate.toISOString(),
        });
      }
    });

    it('should return paginated auctions', async () => {
      const result = await AuctionService.getAuctions({ page: 1, limit: 10 });

      expect(result.auctions).toBeDefined();
      expect(Array.isArray(result.auctions)).toBe(true);
      expect(result.pagination).toBeDefined();
    });

    it('should filter by status', async () => {
      const result = await AuctionService.getAuctions({
        status: 'SCHEDULED',
      });

      result.auctions.forEach((auction) => {
        expect(auction.status).toBe('SCHEDULED');
      });
    });

    it('should search by title', async () => {
      const result = await AuctionService.getAuctions({
        search: 'List Auction',
      });

      expect(result.auctions.length).toBeGreaterThan(0);
      result.auctions.forEach((auction) => {
        expect(auction.title.toLowerCase()).toContain('list auction');
      });
    });
  });

  // ===========================================================================
  // BIDDING
  // ===========================================================================

  describe('placeBid', () => {
    let activeAuction;

    beforeAll(async () => {
      // Create an active auction
      const startDate = new Date(Date.now() - 60000); // Started 1 minute ago
      const endDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);

      activeAuction = await AuctionService.createAuction(sellerUser.id, {
        productId: testProduct.id,
        title: 'Active Bidding Auction',
        startingPrice: 1000,
        minimumIncrement: 100,
        startDate: startDate.toISOString(),
        endDate: endDate.toISOString(),
      });

      // Activate the auction
      await prisma.auction.update({
        where: { id: activeAuction.id },
        data: { status: 'ACTIVE' },
      });
    });

    it('should place a valid bid', async () => {
      const bid = await AuctionService.placeBid(activeAuction.id, buyerUser.id, {
        amount: 1100,
      });

      expect(bid).toBeDefined();
      expect(bid.amount).toBe(1100);
      expect(bid.bidderId).toBe(buyerUser.id);
    });

    it('should reject bid below minimum increment', async () => {
      await expect(
        AuctionService.placeBid(activeAuction.id, buyerUser.id, {
          amount: 1150, // Only 50 above current, needs 100
        })
      ).rejects.toThrow(/minimum/i);
    });

    it('should reject bid below starting price', async () => {
      // Create fresh auction
      const newAuction = await prisma.auction.create({
        data: {
          productId: testProduct.id,
          sellerId: sellerUser.id,
          title: 'Fresh Auction',
          startingPrice: 5000,
          minimumIncrement: 100,
          status: 'ACTIVE',
          startDate: new Date(),
          endDate: new Date(Date.now() + 86400000),
        },
      });

      await expect(
        AuctionService.placeBid(newAuction.id, buyerUser.id, {
          amount: 4000,
        })
      ).rejects.toThrow(/starting price/i);
    });

    it('should reject seller bidding on own auction', async () => {
      await expect(
        AuctionService.placeBid(activeAuction.id, sellerUser.id, {
          amount: 2000,
        })
      ).rejects.toThrow(/own auction/i);
    });

    it('should update current price after bid', async () => {
      const newAmount = 1500;

      await AuctionService.placeBid(activeAuction.id, buyerUser.id, {
        amount: newAmount,
      });

      const updatedAuction = await AuctionService.getAuctionById(activeAuction.id);
      expect(updatedAuction.currentPrice).toBe(newAmount);
    });
  });

  // ===========================================================================
  // BID HISTORY
  // ===========================================================================

  describe('getBidHistory', () => {
    let auctionWithBids;

    beforeAll(async () => {
      // Create auction with multiple bids
      auctionWithBids = await prisma.auction.create({
        data: {
          productId: testProduct.id,
          sellerId: sellerUser.id,
          title: 'Auction With Bids',
          startingPrice: 1000,
          currentPrice: 1000,
          minimumIncrement: 100,
          status: 'ACTIVE',
          startDate: new Date(),
          endDate: new Date(Date.now() + 86400000),
        },
      });

      // Create multiple bids
      for (let i = 1; i <= 5; i++) {
        await prisma.bid.create({
          data: {
            auctionId: auctionWithBids.id,
            bidderId: buyerUser.id,
            amount: 1000 + i * 100,
          },
        });
      }
    });

    it('should return bid history', async () => {
      const result = await AuctionService.getBidHistory(auctionWithBids.id);

      expect(result.bids).toBeDefined();
      expect(Array.isArray(result.bids)).toBe(true);
      expect(result.bids.length).toBe(5);
    });

    it('should order bids by amount descending', async () => {
      const result = await AuctionService.getBidHistory(auctionWithBids.id);

      for (let i = 0; i < result.bids.length - 1; i++) {
        expect(result.bids[i].amount).toBeGreaterThanOrEqual(result.bids[i + 1].amount);
      }
    });

    it('should include bidder information', async () => {
      const result = await AuctionService.getBidHistory(auctionWithBids.id);

      result.bids.forEach((bid) => {
        expect(bid).toHaveProperty('bidder');
        expect(bid.bidder).toHaveProperty('firstName');
      });
    });
  });

  // ===========================================================================
  // AUCTION LIFECYCLE
  // ===========================================================================

  describe('Auction Lifecycle', () => {
    let lifecycleAuction;

    beforeEach(async () => {
      lifecycleAuction = await prisma.auction.create({
        data: {
          productId: testProduct.id,
          sellerId: sellerUser.id,
          title: 'Lifecycle Test Auction',
          startingPrice: 1000,
          currentPrice: 1000,
          minimumIncrement: 100,
          status: 'SCHEDULED',
          startDate: new Date(Date.now() + 60000),
          endDate: new Date(Date.now() + 86400000),
        },
      });
    });

    it('should start scheduled auction', async () => {
      const result = await AuctionService.startAuction(lifecycleAuction.id, sellerUser.id);

      expect(result.status).toBe('ACTIVE');
    });

    it('should cancel auction before start', async () => {
      const result = await AuctionService.cancelAuction(
        lifecycleAuction.id,
        sellerUser.id,
        'Changed my mind'
      );

      expect(result.status).toBe('CANCELLED');
    });

    it('should not cancel active auction with bids', async () => {
      // Activate auction
      await prisma.auction.update({
        where: { id: lifecycleAuction.id },
        data: { status: 'ACTIVE' },
      });

      // Place a bid
      await prisma.bid.create({
        data: {
          auctionId: lifecycleAuction.id,
          bidderId: buyerUser.id,
          amount: 1100,
        },
      });

      await expect(
        AuctionService.cancelAuction(lifecycleAuction.id, sellerUser.id, 'Want to cancel')
      ).rejects.toThrow(/bids|cannot cancel/i);
    });

    it('should end auction and select winner', async () => {
      // Setup auction with bids
      await prisma.auction.update({
        where: { id: lifecycleAuction.id },
        data: {
          status: 'ACTIVE',
          endDate: new Date(Date.now() - 1000), // Already ended
        },
      });

      await prisma.bid.create({
        data: {
          auctionId: lifecycleAuction.id,
          bidderId: buyerUser.id,
          amount: 2000,
        },
      });

      const result = await AuctionService.endAuction(lifecycleAuction.id);

      expect(result.status).toBe('ENDED');
      expect(result.winnerId).toBe(buyerUser.id);
      expect(result.winningBidAmount).toBe(2000);
    });
  });

  // ===========================================================================
  // WATCHLIST
  // ===========================================================================

  describe('Auction Watchlist', () => {
    let watchAuction;

    beforeAll(async () => {
      watchAuction = await prisma.auction.create({
        data: {
          productId: testProduct.id,
          sellerId: sellerUser.id,
          title: 'Watch Test Auction',
          startingPrice: 1000,
          status: 'ACTIVE',
          startDate: new Date(),
          endDate: new Date(Date.now() + 86400000),
        },
      });
    });

    it('should add auction to watchlist', async () => {
      const result = await AuctionService.watchAuction(watchAuction.id, buyerUser.id);

      expect(result.success).toBe(true);
    });

    it('should get user watched auctions', async () => {
      const result = await AuctionService.getWatchedAuctions(buyerUser.id);

      expect(Array.isArray(result)).toBe(true);
      const watched = result.find((a) => a.id === watchAuction.id);
      expect(watched).toBeDefined();
    });

    it('should remove auction from watchlist', async () => {
      const result = await AuctionService.unwatchAuction(watchAuction.id, buyerUser.id);

      expect(result.success).toBe(true);

      const watchedAfter = await AuctionService.getWatchedAuctions(buyerUser.id);
      const found = watchedAfter.find((a) => a.id === watchAuction.id);
      expect(found).toBeUndefined();
    });
  });
});



