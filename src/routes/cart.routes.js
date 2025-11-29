// =============================================================================
// AIRAVAT B2B MARKETPLACE - CART ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, optionalAuth, requireBusiness } = require('../middleware/auth');
const { prisma } = require('../config/database');
const { success, created } = require('../utils/response');
const { asyncHandler } = require('../middleware/errorHandler');
const { BadRequestError, NotFoundError } = require('../utils/errors');

// =============================================================================
// CART OPERATIONS
// =============================================================================

// Get cart
router.get(
  '/',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const cartId = req.business?.id || req.cookies.cartId || req.query.sessionId;
    
    if (!cartId) {
      return success(res, { cart: null, items: [], summary: { subtotal: 0, itemCount: 0 } });
    }
    
    const cart = await prisma.cart.findFirst({
      where: req.business 
        ? { businessId: req.business.id }
        : { sessionId: cartId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                images: true,
                businessId: true,
                business: {
                  select: { id: true, businessName: true, slug: true },
                },
              },
            },
            variant: {
              select: {
                id: true,
                sku: true,
                variantName: true,
                attributes: true,
                basePrice: true,
                stockQuantity: true,
                images: true,
              },
            },
          },
        },
      },
    });
    
    if (!cart) {
      return success(res, { cart: null, items: [], summary: { subtotal: 0, itemCount: 0 } });
    }
    
    // Calculate summary
    const summary = {
      subtotal: cart.items.reduce((sum, item) => sum + (parseFloat(item.unitPrice) * item.quantity), 0),
      itemCount: cart.items.reduce((sum, item) => sum + item.quantity, 0),
    };
    
    // Group items by seller
    const itemsBySeller = {};
    cart.items.forEach((item) => {
      const sellerId = item.product.businessId;
      if (!itemsBySeller[sellerId]) {
        itemsBySeller[sellerId] = {
          seller: item.product.business,
          items: [],
          subtotal: 0,
        };
      }
      itemsBySeller[sellerId].items.push(item);
      itemsBySeller[sellerId].subtotal += parseFloat(item.unitPrice) * item.quantity;
    });
    
    success(res, { 
      cart, 
      items: cart.items, 
      itemsBySeller: Object.values(itemsBySeller),
      summary,
    });
  })
);

// Add to cart
router.post(
  '/add',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { variantId, quantity = 1, note } = req.body;
    
    if (!variantId) {
      throw new BadRequestError('Variant ID is required');
    }
    
    // Get variant with product info
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: {
        product: {
          select: { 
            id: true, 
            businessId: true,
            minOrderQuantity: true,
            status: true,
          },
        },
        pricingTiers: {
          orderBy: { minQuantity: 'asc' },
        },
      },
    });
    
    if (!variant) {
      throw new NotFoundError('Product variant');
    }
    
    if (variant.product.status !== 'ACTIVE') {
      throw new BadRequestError('Product is not available');
    }
    
    if (!variant.isActive) {
      throw new BadRequestError('This variant is not available');
    }
    
    // Check stock
    if (variant.trackInventory && variant.stockQuantity < quantity) {
      throw new BadRequestError(`Only ${variant.stockQuantity} items available`);
    }
    
    // Check MOQ
    if (quantity < variant.product.minOrderQuantity) {
      throw new BadRequestError(`Minimum order quantity is ${variant.product.minOrderQuantity}`);
    }
    
    // Calculate price based on quantity (tiered pricing)
    let unitPrice = parseFloat(variant.basePrice);
    for (const tier of variant.pricingTiers) {
      if (quantity >= tier.minQuantity && (!tier.maxQuantity || quantity <= tier.maxQuantity)) {
        unitPrice = parseFloat(tier.unitPrice);
        break;
      }
    }
    
    // Get or create cart
    let cart;
    if (req.business) {
      cart = await prisma.cart.upsert({
        where: { businessId: req.business.id },
        update: {},
        create: { businessId: req.business.id },
      });
    } else {
      const sessionId = req.cookies.cartId || req.body.sessionId || require('crypto').randomUUID();
      cart = await prisma.cart.upsert({
        where: { sessionId },
        update: {},
        create: { 
          sessionId,
          expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
        },
      });
      
      // Set cookie if new cart
      if (!req.cookies.cartId) {
        res.cookie('cartId', sessionId, {
          httpOnly: true,
          maxAge: 7 * 24 * 60 * 60 * 1000,
        });
      }
    }
    
    // Add or update cart item
    const existingItem = await prisma.cartItem.findUnique({
      where: {
        cartId_variantId: {
          cartId: cart.id,
          variantId,
        },
      },
    });
    
    let cartItem;
    if (existingItem) {
      const newQuantity = existingItem.quantity + quantity;
      
      // Recalculate price for new quantity
      for (const tier of variant.pricingTiers) {
        if (newQuantity >= tier.minQuantity && (!tier.maxQuantity || newQuantity <= tier.maxQuantity)) {
          unitPrice = parseFloat(tier.unitPrice);
          break;
        }
      }
      
      cartItem = await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: { 
          quantity: newQuantity,
          unitPrice,
          note: note || existingItem.note,
        },
      });
    } else {
      cartItem = await prisma.cartItem.create({
        data: {
          cartId: cart.id,
          productId: variant.product.id,
          variantId,
          quantity,
          unitPrice,
          note,
        },
      });
    }
    
    created(res, { cartItem }, 'Added to cart');
  })
);

// Update cart item
router.patch(
  '/items/:itemId',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const { quantity, note } = req.body;
    
    const item = await prisma.cartItem.findUnique({
      where: { id: req.params.itemId },
      include: {
        cart: true,
        variant: {
          include: {
            pricingTiers: { orderBy: { minQuantity: 'asc' } },
          },
        },
      },
    });
    
    if (!item) {
      throw new NotFoundError('Cart item');
    }
    
    // Verify cart ownership
    if (req.business && item.cart.businessId !== req.business.id) {
      throw new BadRequestError('Invalid cart item');
    }
    
    // Check stock if updating quantity
    if (quantity !== undefined) {
      if (item.variant.trackInventory && item.variant.stockQuantity < quantity) {
        throw new BadRequestError(`Only ${item.variant.stockQuantity} items available`);
      }
      
      // Recalculate price
      let unitPrice = parseFloat(item.variant.basePrice);
      for (const tier of item.variant.pricingTiers) {
        if (quantity >= tier.minQuantity && (!tier.maxQuantity || quantity <= tier.maxQuantity)) {
          unitPrice = parseFloat(tier.unitPrice);
          break;
        }
      }
      
      const updatedItem = await prisma.cartItem.update({
        where: { id: item.id },
        data: { quantity, unitPrice, note },
      });
      
      return success(res, { cartItem: updatedItem }, 'Cart updated');
    }
    
    // Just update note
    if (note !== undefined) {
      const updatedItem = await prisma.cartItem.update({
        where: { id: item.id },
        data: { note },
      });
      
      return success(res, { cartItem: updatedItem }, 'Cart updated');
    }
    
    success(res, { cartItem: item });
  })
);

// Remove from cart
router.delete(
  '/items/:itemId',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const item = await prisma.cartItem.findUnique({
      where: { id: req.params.itemId },
      include: { cart: true },
    });
    
    if (!item) {
      throw new NotFoundError('Cart item');
    }
    
    // Verify cart ownership
    if (req.business && item.cart.businessId !== req.business.id) {
      throw new BadRequestError('Invalid cart item');
    }
    
    await prisma.cartItem.delete({
      where: { id: item.id },
    });
    
    success(res, null, 'Item removed from cart');
  })
);

// Clear cart
router.delete(
  '/clear',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const cartId = req.business?.id;
    
    if (!cartId) {
      return success(res, null, 'Cart cleared');
    }
    
    const cart = await prisma.cart.findFirst({
      where: { businessId: cartId },
    });
    
    if (cart) {
      await prisma.cartItem.deleteMany({
        where: { cartId: cart.id },
      });
    }
    
    success(res, null, 'Cart cleared');
  })
);

// Merge guest cart with user cart (after login)
router.post(
  '/merge',
  authenticate,
  requireBusiness,
  asyncHandler(async (req, res) => {
    const { sessionId } = req.body;
    
    if (!sessionId) {
      return success(res, null, 'No cart to merge');
    }
    
    // Find guest cart
    const guestCart = await prisma.cart.findFirst({
      where: { sessionId },
      include: { items: true },
    });
    
    if (!guestCart || guestCart.items.length === 0) {
      return success(res, null, 'No cart to merge');
    }
    
    // Get or create user cart
    const userCart = await prisma.cart.upsert({
      where: { businessId: req.business.id },
      update: {},
      create: { businessId: req.business.id },
    });
    
    // Merge items
    for (const item of guestCart.items) {
      await prisma.cartItem.upsert({
        where: {
          cartId_variantId: {
            cartId: userCart.id,
            variantId: item.variantId,
          },
        },
        update: {
          quantity: { increment: item.quantity },
        },
        create: {
          cartId: userCart.id,
          productId: item.productId,
          variantId: item.variantId,
          quantity: item.quantity,
          unitPrice: item.unitPrice,
          note: item.note,
        },
      });
    }
    
    // Delete guest cart
    await prisma.cart.delete({
      where: { id: guestCart.id },
    });
    
    // Clear cookie
    res.clearCookie('cartId');
    
    success(res, null, 'Cart merged successfully');
  })
);

// Get cart count
router.get(
  '/count',
  optionalAuth,
  asyncHandler(async (req, res) => {
    const cartId = req.business?.id || req.cookies.cartId;
    
    if (!cartId) {
      return success(res, { count: 0 });
    }
    
    const cart = await prisma.cart.findFirst({
      where: req.business 
        ? { businessId: req.business.id }
        : { sessionId: cartId },
      include: {
        items: {
          select: { quantity: true },
        },
      },
    });
    
    const count = cart?.items.reduce((sum, item) => sum + item.quantity, 0) || 0;
    
    success(res, { count });
  })
);

module.exports = router;
