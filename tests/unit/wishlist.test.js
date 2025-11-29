// =============================================================================
// AIRAVAT B2B MARKETPLACE - WISHLIST SERVICE UNIT TESTS
// Comprehensive tests for wishlist functionality
// =============================================================================

const WishlistService = require('../../src/services/wishlist.service');
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

describe('WishlistService', () => {
  let testUser;
  let testBusiness;
  let testCategory;
  let testProduct;
  let testVariant;

  beforeAll(async () => {
    // Create test data
    testUser = await factories.createUser({ email: 'wishlist-test@example.com' });
    testBusiness = await factories.createBusiness(testUser.id);
    testCategory = await factories.createCategory();
    testProduct = await factories.createProduct(testBusiness.id, testCategory.id);
    
    // Get the variant
    testVariant = await prisma.productVariant.findFirst({
      where: { productId: testProduct.id },
    });
  });

  afterAll(async () => {
    // Cleanup in order
    await prisma.wishlistItem.deleteMany({ where: { wishlist: { userId: testUser.id } } });
    await prisma.wishlist.deleteMany({ where: { userId: testUser.id } });
    await prisma.productVariant.deleteMany({ where: { productId: testProduct.id } });
    await prisma.product.deleteMany({ where: { id: testProduct.id } });
    await prisma.category.deleteMany({ where: { id: testCategory.id } });
    await prisma.business.deleteMany({ where: { id: testBusiness.id } });
    await prisma.user.deleteMany({ where: { id: testUser.id } });
  });

  // ===========================================================================
  // WISHLIST CREATION
  // ===========================================================================

  describe('createWishlist', () => {
    it('should create a new wishlist', async () => {
      const wishlist = await WishlistService.createWishlist(testUser.id, {
        name: 'My Favorites',
        description: 'Products I love',
        isPublic: false,
      });

      expect(wishlist).toBeDefined();
      expect(wishlist.userId).toBe(testUser.id);
      expect(wishlist.name).toBe('My Favorites');
      expect(wishlist.isPublic).toBe(false);
    });

    it('should create default wishlist automatically', async () => {
      const newUser = await factories.createUser();

      const wishlist = await WishlistService.getOrCreateDefaultWishlist(newUser.id);

      expect(wishlist).toBeDefined();
      expect(wishlist.isDefault).toBe(true);

      // Cleanup
      await prisma.wishlist.deleteMany({ where: { userId: newUser.id } });
      await prisma.user.deleteMany({ where: { id: newUser.id } });
    });

    it('should enforce wishlist name uniqueness for user', async () => {
      await expect(
        WishlistService.createWishlist(testUser.id, {
          name: 'My Favorites', // Same name as before
        })
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // GET WISHLISTS
  // ===========================================================================

  describe('getWishlists', () => {
    it('should return all wishlists for user', async () => {
      const wishlists = await WishlistService.getUserWishlists(testUser.id);

      expect(Array.isArray(wishlists)).toBe(true);
      expect(wishlists.length).toBeGreaterThan(0);
    });

    it('should include item count in wishlists', async () => {
      const wishlists = await WishlistService.getUserWishlists(testUser.id);

      wishlists.forEach((wishlist) => {
        expect(wishlist).toHaveProperty('_count');
        expect(wishlist._count).toHaveProperty('items');
      });
    });
  });

  // ===========================================================================
  // ADD ITEMS
  // ===========================================================================

  describe('addToWishlist', () => {
    let wishlistId;

    beforeAll(async () => {
      const wishlist = await WishlistService.createWishlist(testUser.id, {
        name: 'Test Items Wishlist',
      });
      wishlistId = wishlist.id;
    });

    it('should add product to wishlist', async () => {
      const result = await WishlistService.addItem(testUser.id, wishlistId, {
        productId: testProduct.id,
        variantId: testVariant.id,
        notes: 'Love this product',
      });

      expect(result).toBeDefined();
      expect(result.productId).toBe(testProduct.id);
    });

    it('should not add duplicate product', async () => {
      await expect(
        WishlistService.addItem(testUser.id, wishlistId, {
          productId: testProduct.id,
          variantId: testVariant.id,
        })
      ).rejects.toThrow(/already exists|duplicate/i);
    });

    it('should add same product to different wishlist', async () => {
      const anotherWishlist = await WishlistService.createWishlist(testUser.id, {
        name: 'Another Wishlist',
      });

      const result = await WishlistService.addItem(testUser.id, anotherWishlist.id, {
        productId: testProduct.id,
        variantId: testVariant.id,
      });

      expect(result).toBeDefined();
    });

    it('should reject invalid product ID', async () => {
      await expect(
        WishlistService.addItem(testUser.id, wishlistId, {
          productId: 'non-existent-product',
        })
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // GET WISHLIST ITEMS
  // ===========================================================================

  describe('getWishlistItems', () => {
    let testWishlist;

    beforeAll(async () => {
      testWishlist = await WishlistService.createWishlist(testUser.id, {
        name: 'Items Test Wishlist',
      });

      // Add some items
      const products = [];
      for (let i = 0; i < 5; i++) {
        const product = await factories.createProduct(testBusiness.id, testCategory.id);
        products.push(product);

        const variant = await prisma.productVariant.findFirst({
          where: { productId: product.id },
        });

        await WishlistService.addItem(testUser.id, testWishlist.id, {
          productId: product.id,
          variantId: variant.id,
        });
      }
    });

    it('should return wishlist items with product details', async () => {
      const result = await WishlistService.getWishlistItems(testWishlist.id, testUser.id);

      expect(result.items).toBeDefined();
      expect(Array.isArray(result.items)).toBe(true);
      expect(result.items.length).toBeGreaterThan(0);

      result.items.forEach((item) => {
        expect(item).toHaveProperty('product');
        expect(item.product).toHaveProperty('name');
      });
    });

    it('should paginate items', async () => {
      const page1 = await WishlistService.getWishlistItems(testWishlist.id, testUser.id, {
        page: 1,
        limit: 2,
      });

      const page2 = await WishlistService.getWishlistItems(testWishlist.id, testUser.id, {
        page: 2,
        limit: 2,
      });

      expect(page1.items.length).toBeLessThanOrEqual(2);
      expect(page2.items.length).toBeLessThanOrEqual(2);
    });
  });

  // ===========================================================================
  // REMOVE ITEMS
  // ===========================================================================

  describe('removeFromWishlist', () => {
    let testWishlist;
    let testItem;

    beforeAll(async () => {
      testWishlist = await WishlistService.createWishlist(testUser.id, {
        name: 'Remove Test Wishlist',
      });

      const product = await factories.createProduct(testBusiness.id, testCategory.id);
      const variant = await prisma.productVariant.findFirst({
        where: { productId: product.id },
      });

      testItem = await WishlistService.addItem(testUser.id, testWishlist.id, {
        productId: product.id,
        variantId: variant.id,
      });
    });

    it('should remove item from wishlist', async () => {
      const result = await WishlistService.removeItem(testUser.id, testItem.id);

      expect(result.success).toBe(true);

      // Verify item is removed
      const items = await WishlistService.getWishlistItems(testWishlist.id, testUser.id);
      const found = items.items.find((i) => i.id === testItem.id);
      expect(found).toBeUndefined();
    });

    it('should reject removing non-existent item', async () => {
      await expect(
        WishlistService.removeItem(testUser.id, 'non-existent-item-id')
      ).rejects.toThrow();
    });
  });

  // ===========================================================================
  // SHARE WISHLIST
  // ===========================================================================

  describe('shareWishlist', () => {
    let publicWishlist;

    beforeAll(async () => {
      publicWishlist = await WishlistService.createWishlist(testUser.id, {
        name: 'Public Wishlist',
        isPublic: true,
      });
    });

    it('should generate share link', async () => {
      const result = await WishlistService.getShareLink(publicWishlist.id, testUser.id);

      expect(result.shareUrl).toBeDefined();
      expect(result.shareUrl).toContain(publicWishlist.id);
    });

    it('should allow access to public wishlist', async () => {
      const result = await WishlistService.getPublicWishlist(publicWishlist.id);

      expect(result).toBeDefined();
      expect(result.isPublic).toBe(true);
    });

    it('should not share private wishlist without permission', async () => {
      const privateWishlist = await WishlistService.createWishlist(testUser.id, {
        name: 'Private Wishlist',
        isPublic: false,
      });

      await expect(WishlistService.getPublicWishlist(privateWishlist.id)).rejects.toThrow();
    });
  });

  // ===========================================================================
  // DELETE WISHLIST
  // ===========================================================================

  describe('deleteWishlist', () => {
    it('should delete wishlist and its items', async () => {
      const wishlist = await WishlistService.createWishlist(testUser.id, {
        name: 'To Be Deleted',
      });

      const result = await WishlistService.deleteWishlist(testUser.id, wishlist.id);

      expect(result.success).toBe(true);

      // Verify wishlist is deleted
      await expect(
        WishlistService.getWishlistItems(wishlist.id, testUser.id)
      ).rejects.toThrow();
    });

    it('should not delete default wishlist', async () => {
      const defaultWishlist = await WishlistService.getOrCreateDefaultWishlist(testUser.id);

      await expect(
        WishlistService.deleteWishlist(testUser.id, defaultWishlist.id)
      ).rejects.toThrow(/default|cannot delete/i);
    });

    it('should not delete other user wishlist', async () => {
      const otherUser = await factories.createUser();
      const otherWishlist = await WishlistService.createWishlist(otherUser.id, {
        name: 'Other User Wishlist',
      });

      await expect(
        WishlistService.deleteWishlist(testUser.id, otherWishlist.id)
      ).rejects.toThrow();

      // Cleanup
      await prisma.wishlist.deleteMany({ where: { userId: otherUser.id } });
      await prisma.user.deleteMany({ where: { id: otherUser.id } });
    });
  });
});



