// =============================================================================
// AIRAVAT B2B MARKETPLACE - CART CONTROLLER
// Shopping cart management for authenticated and guest users
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const { successResponse } = require('../utils/response');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const logger = require('../config/logger');

class CartController {
  // =============================================================================
  // CART OPERATIONS
  // =============================================================================

  /**
   * Get cart
   */
  async getCart(req, res, next) {
    try {
      const userId = req.user?.id;
      const sessionId = req.sessionId || req.cookies?.sessionId;

      let cart;

      if (userId) {
        cart = await this.getUserCart(userId);
      } else if (sessionId) {
        cart = await this.getGuestCart(sessionId);
      } else {
        return successResponse(res, {
          items: [],
          itemCount: 0,
          subtotal: 0,
          savings: 0,
          currency: 'INR',
        });
      }

      if (!cart) {
        return successResponse(res, {
          items: [],
          itemCount: 0,
          subtotal: 0,
          savings: 0,
          currency: 'INR',
        });
      }

      // Calculate totals
      const cartData = await this.calculateCartTotals(cart);

      return successResponse(res, cartData, 'Cart retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add item to cart
   */
  async addItem(req, res, next) {
    try {
      const userId = req.user?.id;
      const sessionId = req.sessionId || req.cookies?.sessionId;
      const { productId, variantId, quantity = 1 } = req.body;

      if (!productId) {
        throw new BadRequestError('Product ID is required');
      }

      // Verify product exists and is active
      const product = await prisma.product.findUnique({
        where: { id: productId },
        include: {
          variants: {
            where: variantId ? { id: variantId } : { isDefault: true },
          },
          business: {
            select: { id: true, businessName: true },
          },
        },
      });

      if (!product || product.status !== 'ACTIVE') {
        throw new NotFoundError('Product not found or not available');
      }

      const variant = product.variants[0];
      if (!variant) {
        throw new NotFoundError('Product variant not found');
      }

      // Check stock
      if (variant.stockQuantity < quantity) {
        throw new BadRequestError(
          `Only ${variant.stockQuantity} items available in stock`
        );
      }

      // Check minimum order quantity
      if (quantity < product.minOrderQuantity) {
        throw new BadRequestError(
          `Minimum order quantity is ${product.minOrderQuantity}`
        );
      }

      // Get or create cart
      let cart;
      if (userId) {
        cart = await this.getOrCreateUserCart(userId);
      } else if (sessionId) {
        cart = await this.getOrCreateGuestCart(sessionId);
      } else {
        throw new BadRequestError('Session required to add items to cart');
      }

      // Check if item already in cart
      const existingItem = await prisma.cartItem.findFirst({
        where: {
          cartId: cart.id,
          productId,
          variantId: variant.id,
        },
      });

      if (existingItem) {
        // Update quantity
        const newQuantity = existingItem.quantity + quantity;

        if (newQuantity > variant.stockQuantity) {
          throw new BadRequestError(
            `Cannot add more. Only ${variant.stockQuantity} items available`
          );
        }

        await prisma.cartItem.update({
          where: { id: existingItem.id },
          data: { quantity: newQuantity },
        });
      } else {
        // Add new item
        await prisma.cartItem.create({
          data: {
            cartId: cart.id,
            productId,
            variantId: variant.id,
            quantity,
            price: variant.basePrice,
            sellerId: product.businessId,
          },
        });
      }

      // Update cart
      await prisma.cart.update({
        where: { id: cart.id },
        data: { updatedAt: new Date() },
      });

      // Get updated cart
      const updatedCart = await this.getCartById(cart.id);
      const cartData = await this.calculateCartTotals(updatedCart);

      logger.info('Item added to cart', { cartId: cart.id, productId, quantity });

      return successResponse(res, cartData, 'Item added to cart');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update cart item quantity
   */
  async updateItem(req, res, next) {
    try {
      const userId = req.user?.id;
      const sessionId = req.sessionId || req.cookies?.sessionId;
      const { itemId } = req.params;
      const { quantity } = req.body;

      if (quantity < 1) {
        throw new BadRequestError('Quantity must be at least 1');
      }

      // Get cart
      let cart;
      if (userId) {
        cart = await this.getUserCart(userId);
      } else if (sessionId) {
        cart = await this.getGuestCart(sessionId);
      }

      if (!cart) {
        throw new NotFoundError('Cart not found');
      }

      // Find item in cart
      const cartItem = await prisma.cartItem.findFirst({
        where: { id: itemId, cartId: cart.id },
        include: {
          variant: true,
          product: true,
        },
      });

      if (!cartItem) {
        throw new NotFoundError('Item not found in cart');
      }

      // Check stock
      if (quantity > cartItem.variant.stockQuantity) {
        throw new BadRequestError(
          `Only ${cartItem.variant.stockQuantity} items available`
        );
      }

      // Check minimum order quantity
      if (quantity < cartItem.product.minOrderQuantity) {
        throw new BadRequestError(
          `Minimum order quantity is ${cartItem.product.minOrderQuantity}`
        );
      }

      // Update quantity
      await prisma.cartItem.update({
        where: { id: itemId },
        data: { quantity },
      });

      // Get updated cart
      const updatedCart = await this.getCartById(cart.id);
      const cartData = await this.calculateCartTotals(updatedCart);

      return successResponse(res, cartData, 'Cart updated');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove item from cart
   */
  async removeItem(req, res, next) {
    try {
      const userId = req.user?.id;
      const sessionId = req.sessionId || req.cookies?.sessionId;
      const { itemId } = req.params;

      // Get cart
      let cart;
      if (userId) {
        cart = await this.getUserCart(userId);
      } else if (sessionId) {
        cart = await this.getGuestCart(sessionId);
      }

      if (!cart) {
        throw new NotFoundError('Cart not found');
      }

      // Delete item
      await prisma.cartItem.deleteMany({
        where: { id: itemId, cartId: cart.id },
      });

      // Get updated cart
      const updatedCart = await this.getCartById(cart.id);
      const cartData = await this.calculateCartTotals(updatedCart);

      return successResponse(res, cartData, 'Item removed from cart');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Clear cart
   */
  async clearCart(req, res, next) {
    try {
      const userId = req.user?.id;
      const sessionId = req.sessionId || req.cookies?.sessionId;

      let cart;
      if (userId) {
        cart = await this.getUserCart(userId);
      } else if (sessionId) {
        cart = await this.getGuestCart(sessionId);
      }

      if (cart) {
        await prisma.cartItem.deleteMany({
          where: { cartId: cart.id },
        });
      }

      return successResponse(res, {
        items: [],
        itemCount: 0,
        subtotal: 0,
        savings: 0,
      }, 'Cart cleared');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Apply coupon code
   */
  async applyCoupon(req, res, next) {
    try {
      const userId = req.user?.id;
      const sessionId = req.sessionId || req.cookies?.sessionId;
      const { code } = req.body;

      let cart;
      if (userId) {
        cart = await this.getUserCart(userId);
      } else if (sessionId) {
        cart = await this.getGuestCart(sessionId);
      }

      if (!cart) {
        throw new NotFoundError('Cart not found');
      }

      // Find coupon
      const coupon = await prisma.coupon.findFirst({
        where: {
          code: code.toUpperCase(),
          isActive: true,
          startDate: { lte: new Date() },
          endDate: { gte: new Date() },
        },
      });

      if (!coupon) {
        throw new BadRequestError('Invalid or expired coupon code');
      }

      // Check usage limit
      if (coupon.usageLimit && coupon.usageCount >= coupon.usageLimit) {
        throw new BadRequestError('Coupon usage limit exceeded');
      }

      // Check user usage limit
      if (userId && coupon.perUserLimit) {
        const userUsage = await prisma.couponUsage.count({
          where: { couponId: coupon.id, userId },
        });
        if (userUsage >= coupon.perUserLimit) {
          throw new BadRequestError('You have already used this coupon');
        }
      }

      // Calculate cart total
      const cartData = await this.calculateCartTotals(cart);

      // Check minimum order value
      if (coupon.minOrderValue && cartData.subtotal < parseFloat(coupon.minOrderValue)) {
        throw new BadRequestError(
          `Minimum order value of ${coupon.minOrderValue} required`
        );
      }

      // Calculate discount
      let discount = 0;
      if (coupon.discountType === 'PERCENTAGE') {
        discount = (cartData.subtotal * parseFloat(coupon.discountValue)) / 100;
        if (coupon.maxDiscount) {
          discount = Math.min(discount, parseFloat(coupon.maxDiscount));
        }
      } else {
        discount = parseFloat(coupon.discountValue);
      }

      // Apply to cart
      await prisma.cart.update({
        where: { id: cart.id },
        data: {
          couponId: coupon.id,
          couponCode: code.toUpperCase(),
          discountAmount: discount,
        },
      });

      // Get updated cart
      const updatedCart = await this.getCartById(cart.id);
      const updatedCartData = await this.calculateCartTotals(updatedCart);

      return successResponse(res, updatedCartData, 'Coupon applied successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Remove coupon
   */
  async removeCoupon(req, res, next) {
    try {
      const userId = req.user?.id;
      const sessionId = req.sessionId || req.cookies?.sessionId;

      let cart;
      if (userId) {
        cart = await this.getUserCart(userId);
      } else if (sessionId) {
        cart = await this.getGuestCart(sessionId);
      }

      if (cart) {
        await prisma.cart.update({
          where: { id: cart.id },
          data: {
            couponId: null,
            couponCode: null,
            discountAmount: 0,
          },
        });
      }

      const updatedCart = await this.getCartById(cart.id);
      const cartData = await this.calculateCartTotals(updatedCart);

      return successResponse(res, cartData, 'Coupon removed');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Merge guest cart to user cart (on login)
   */
  async mergeCart(req, res, next) {
    try {
      const userId = req.user.id;
      const { guestSessionId } = req.body;

      if (!guestSessionId) {
        return successResponse(res, null, 'No guest cart to merge');
      }

      const guestCart = await this.getGuestCart(guestSessionId);
      if (!guestCart || guestCart.items.length === 0) {
        return successResponse(res, null, 'No guest cart to merge');
      }

      const userCart = await this.getOrCreateUserCart(userId);

      // Merge items
      for (const item of guestCart.items) {
        const existingItem = await prisma.cartItem.findFirst({
          where: {
            cartId: userCart.id,
            productId: item.productId,
            variantId: item.variantId,
          },
        });

        if (existingItem) {
          // Update quantity
          await prisma.cartItem.update({
            where: { id: existingItem.id },
            data: { quantity: existingItem.quantity + item.quantity },
          });
        } else {
          // Add new item
          await prisma.cartItem.create({
            data: {
              cartId: userCart.id,
              productId: item.productId,
              variantId: item.variantId,
              quantity: item.quantity,
              price: item.price,
              sellerId: item.sellerId,
            },
          });
        }
      }

      // Delete guest cart
      await prisma.cart.delete({ where: { id: guestCart.id } });

      const updatedCart = await this.getCartById(userCart.id);
      const cartData = await this.calculateCartTotals(updatedCart);

      logger.info('Guest cart merged', { userId, guestSessionId });

      return successResponse(res, cartData, 'Cart merged successfully');
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // HELPER METHODS
  // =============================================================================

  async getUserCart(userId) {
    return prisma.cart.findFirst({
      where: { userId, status: 'ACTIVE' },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                images: true,
                minOrderQuantity: true,
              },
            },
            variant: {
              select: {
                id: true,
                variantName: true,
                sku: true,
                basePrice: true,
                salePrice: true,
                stockQuantity: true,
                images: true,
              },
            },
            seller: {
              select: {
                id: true,
                businessName: true,
                slug: true,
              },
            },
          },
        },
        coupon: true,
      },
    });
  }

  async getGuestCart(sessionId) {
    return prisma.cart.findFirst({
      where: { sessionId, status: 'ACTIVE', userId: null },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                images: true,
                minOrderQuantity: true,
              },
            },
            variant: {
              select: {
                id: true,
                variantName: true,
                sku: true,
                basePrice: true,
                salePrice: true,
                stockQuantity: true,
                images: true,
              },
            },
            seller: {
              select: {
                id: true,
                businessName: true,
                slug: true,
              },
            },
          },
        },
        coupon: true,
      },
    });
  }

  async getCartById(cartId) {
    return prisma.cart.findUnique({
      where: { id: cartId },
      include: {
        items: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                slug: true,
                images: true,
                minOrderQuantity: true,
              },
            },
            variant: {
              select: {
                id: true,
                variantName: true,
                sku: true,
                basePrice: true,
                salePrice: true,
                stockQuantity: true,
                images: true,
              },
            },
            seller: {
              select: {
                id: true,
                businessName: true,
                slug: true,
              },
            },
          },
        },
        coupon: true,
      },
    });
  }

  async getOrCreateUserCart(userId) {
    let cart = await prisma.cart.findFirst({
      where: { userId, status: 'ACTIVE' },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: { userId, status: 'ACTIVE' },
      });
    }

    return cart;
  }

  async getOrCreateGuestCart(sessionId) {
    let cart = await prisma.cart.findFirst({
      where: { sessionId, status: 'ACTIVE', userId: null },
    });

    if (!cart) {
      cart = await prisma.cart.create({
        data: { sessionId, status: 'ACTIVE' },
      });
    }

    return cart;
  }

  async calculateCartTotals(cart) {
    if (!cart || !cart.items) {
      return {
        items: [],
        itemCount: 0,
        subtotal: 0,
        savings: 0,
        discount: 0,
        total: 0,
        currency: 'INR',
      };
    }

    let subtotal = 0;
    let savings = 0;
    let itemCount = 0;

    const items = cart.items.map((item) => {
      const price = parseFloat(item.variant?.basePrice || item.price);
      const salePrice = item.variant?.salePrice ? parseFloat(item.variant.salePrice) : null;
      const effectivePrice = salePrice || price;
      const itemTotal = effectivePrice * item.quantity;
      const itemSavings = salePrice ? (price - salePrice) * item.quantity : 0;

      subtotal += itemTotal;
      savings += itemSavings;
      itemCount += item.quantity;

      return {
        id: item.id,
        productId: item.productId,
        variantId: item.variantId,
        product: item.product,
        variant: item.variant,
        seller: item.seller,
        quantity: item.quantity,
        price,
        salePrice,
        effectivePrice,
        itemTotal,
        inStock: item.variant?.stockQuantity >= item.quantity,
        stockQuantity: item.variant?.stockQuantity || 0,
      };
    });

    const discount = parseFloat(cart.discountAmount || 0);
    const total = subtotal - discount;

    return {
      id: cart.id,
      items,
      itemCount,
      subtotal,
      savings,
      coupon: cart.couponCode ? {
        code: cart.couponCode,
        discount,
      } : null,
      discount,
      total,
      currency: 'INR',
    };
  }
}

module.exports = new CartController();
