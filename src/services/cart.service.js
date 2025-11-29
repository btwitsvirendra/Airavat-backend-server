/**
 * Cart Service
 * Handles shopping cart operations with Redis caching for performance
 */

const prisma = require('../config/database');
const { cache, inventory } = require('../config/redis');
const { NotFoundError, BadRequestError, InsufficientStockError } = require('../utils/errors');
const { parsePagination } = require('../utils/helpers');
const logger = require('../config/logger');

// Cart expiry in seconds (7 days)
const CART_EXPIRY = 7 * 24 * 60 * 60;

class CartService {
  /**
   * Get or create cart for user/session
   */
  async getOrCreateCart(userId = null, sessionId = null, businessId = null) {
    if (!userId && !sessionId) {
      throw new BadRequestError('Either userId or sessionId is required');
    }

    // Try to find existing cart
    let cart = await prisma.cart.findFirst({
      where: {
        OR: [
          ...(userId ? [{ userId }] : []),
          ...(sessionId ? [{ sessionId }] : []),
        ],
        expiresAt: { gt: new Date() },
      },
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
                status: true,
              },
            },
            variant: {
              select: {
                id: true,
                sku: true,
                variantAttributes: true,
                basePrice: true,
                stockQuantity: true,
                trackInventory: true,
              },
            },
          },
        },
      },
    });

    // Create new cart if not exists
    if (!cart) {
      cart = await prisma.cart.create({
        data: {
          userId,
          sessionId,
          businessId,
          expiresAt: new Date(Date.now() + CART_EXPIRY * 1000),
        },
        include: {
          items: true,
        },
      });
    }

    // Merge carts if user logs in with existing session cart
    if (userId && sessionId) {
      await this.mergeSessionCart(userId, sessionId);
    }

    return this.enrichCart(cart);
  }

  /**
   * Get cart with full details
   */
  async getCart(cartId) {
    const cart = await prisma.cart.findUnique({
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
                status: true,
                businessId: true,
                business: {
                  select: {
                    id: true,
                    legalName: true,
                    displayName: true,
                  },
                },
              },
            },
            variant: {
              select: {
                id: true,
                sku: true,
                variantAttributes: true,
                basePrice: true,
                comparePrice: true,
                stockQuantity: true,
                trackInventory: true,
                images: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!cart) {
      throw new NotFoundError('Cart not found');
    }

    return this.enrichCart(cart);
  }

  /**
   * Add item to cart
   */
  async addItem(cartId, data) {
    const { productId, variantId, quantity, notes } = data;

    // Validate product
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        status: true,
        minOrderQuantity: true,
        businessId: true,
      },
    });

    if (!product || product.status !== 'ACTIVE') {
      throw new NotFoundError('Product not found or not available');
    }

    // Validate variant
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        productId: true,
        basePrice: true,
        stockQuantity: true,
        trackInventory: true,
        allowBackorder: true,
        isActive: true,
      },
    });

    if (!variant || !variant.isActive || variant.productId !== productId) {
      throw new NotFoundError('Product variant not found or not available');
    }

    // Check minimum order quantity
    if (quantity < (product.minOrderQuantity || 1)) {
      throw new BadRequestError(`Minimum order quantity is ${product.minOrderQuantity || 1}`);
    }

    // Check stock availability
    if (variant.trackInventory && !variant.allowBackorder) {
      if (quantity > variant.stockQuantity) {
        throw new InsufficientStockError(
          `Only ${variant.stockQuantity} units available`,
          variant.stockQuantity
        );
      }
    }

    // Check if item already in cart
    const existingItem = await prisma.cartItem.findFirst({
      where: {
        cartId,
        productId,
        variantId,
      },
    });

    let cartItem;

    if (existingItem) {
      // Update quantity
      const newQuantity = existingItem.quantity + quantity;

      // Re-check stock for new total
      if (variant.trackInventory && !variant.allowBackorder) {
        if (newQuantity > variant.stockQuantity) {
          throw new InsufficientStockError(
            `Cannot add more. Only ${variant.stockQuantity} units available`,
            variant.stockQuantity
          );
        }
      }

      cartItem = await prisma.cartItem.update({
        where: { id: existingItem.id },
        data: {
          quantity: newQuantity,
          unitPrice: variant.basePrice,
          notes: notes || existingItem.notes,
        },
      });
    } else {
      // Add new item
      cartItem = await prisma.cartItem.create({
        data: {
          cartId,
          productId,
          variantId,
          quantity,
          unitPrice: variant.basePrice,
          notes,
        },
      });
    }

    // Update cart expiry
    await prisma.cart.update({
      where: { id: cartId },
      data: { expiresAt: new Date(Date.now() + CART_EXPIRY * 1000) },
    });

    // Return updated cart
    return this.getCart(cartId);
  }

  /**
   * Update cart item quantity
   */
  async updateItemQuantity(cartId, itemId, quantity) {
    const item = await prisma.cartItem.findFirst({
      where: { id: itemId, cartId },
      include: {
        product: {
          select: { minOrderQuantity: true },
        },
        variant: {
          select: {
            stockQuantity: true,
            trackInventory: true,
            allowBackorder: true,
            basePrice: true,
          },
        },
      },
    });

    if (!item) {
      throw new NotFoundError('Cart item not found');
    }

    // Validate quantity
    if (quantity < 1) {
      // Remove item if quantity is 0 or negative
      return this.removeItem(cartId, itemId);
    }

    // Check minimum order quantity
    if (quantity < (item.product.minOrderQuantity || 1)) {
      throw new BadRequestError(`Minimum order quantity is ${item.product.minOrderQuantity || 1}`);
    }

    // Check stock
    if (item.variant.trackInventory && !item.variant.allowBackorder) {
      if (quantity > item.variant.stockQuantity) {
        throw new InsufficientStockError(
          `Only ${item.variant.stockQuantity} units available`,
          item.variant.stockQuantity
        );
      }
    }

    await prisma.cartItem.update({
      where: { id: itemId },
      data: {
        quantity,
        unitPrice: item.variant.basePrice, // Update price in case it changed
      },
    });

    return this.getCart(cartId);
  }

  /**
   * Remove item from cart
   */
  async removeItem(cartId, itemId) {
    const item = await prisma.cartItem.findFirst({
      where: { id: itemId, cartId },
    });

    if (!item) {
      throw new NotFoundError('Cart item not found');
    }

    await prisma.cartItem.delete({
      where: { id: itemId },
    });

    return this.getCart(cartId);
  }

  /**
   * Clear cart
   */
  async clearCart(cartId) {
    await prisma.cartItem.deleteMany({
      where: { cartId },
    });

    return this.getCart(cartId);
  }

  /**
   * Apply coupon to cart
   */
  async applyCoupon(cartId, couponCode) {
    // Placeholder for coupon functionality
    // Would validate coupon, check eligibility, apply discount
    throw new BadRequestError('Coupon functionality not yet implemented');
  }

  /**
   * Remove coupon from cart
   */
  async removeCoupon(cartId) {
    return prisma.cart.update({
      where: { id: cartId },
      data: { couponCode: null },
    });
  }

  /**
   * Validate cart for checkout
   */
  async validateForCheckout(cartId, buyerBusinessId) {
    const cart = await this.getCart(cartId);
    const errors = [];
    const warnings = [];

    if (cart.items.length === 0) {
      errors.push({ type: 'EMPTY_CART', message: 'Cart is empty' });
      return { valid: false, errors, warnings, cart };
    }

    // Group items by seller
    const sellerGroups = {};

    for (const item of cart.items) {
      // Check product availability
      if (item.product.status !== 'ACTIVE') {
        errors.push({
          type: 'PRODUCT_UNAVAILABLE',
          itemId: item.id,
          message: `${item.product.name} is no longer available`,
        });
        continue;
      }

      // Check stock
      if (item.variant.trackInventory) {
        if (item.quantity > item.variant.stockQuantity) {
          if (item.variant.stockQuantity === 0) {
            errors.push({
              type: 'OUT_OF_STOCK',
              itemId: item.id,
              message: `${item.product.name} is out of stock`,
            });
          } else {
            warnings.push({
              type: 'LOW_STOCK',
              itemId: item.id,
              message: `Only ${item.variant.stockQuantity} units available for ${item.product.name}`,
              availableQuantity: item.variant.stockQuantity,
            });
          }
        }
      }

      // Check minimum order quantity
      if (item.quantity < (item.product.minOrderQuantity || 1)) {
        errors.push({
          type: 'BELOW_MOQ',
          itemId: item.id,
          message: `Minimum order quantity for ${item.product.name} is ${item.product.minOrderQuantity}`,
        });
      }

      // Check price changes
      if (item.unitPrice !== item.variant.basePrice) {
        warnings.push({
          type: 'PRICE_CHANGED',
          itemId: item.id,
          message: `Price changed for ${item.product.name}`,
          oldPrice: item.unitPrice,
          newPrice: item.variant.basePrice,
        });
      }

      // Group by seller
      const sellerId = item.product.businessId;
      if (!sellerGroups[sellerId]) {
        sellerGroups[sellerId] = {
          seller: item.product.business,
          items: [],
          subtotal: 0,
        };
      }
      sellerGroups[sellerId].items.push(item);
      sellerGroups[sellerId].subtotal += item.quantity * item.variant.basePrice;
    }

    // Check seller-specific minimums
    for (const [sellerId, group] of Object.entries(sellerGroups)) {
      const sellerSettings = await prisma.businessSettings.findUnique({
        where: { businessId: sellerId },
        select: { minOrderValue: true },
      });

      if (sellerSettings?.minOrderValue && group.subtotal < sellerSettings.minOrderValue) {
        warnings.push({
          type: 'BELOW_MIN_ORDER',
          sellerId,
          sellerName: group.seller.displayName || group.seller.legalName,
          message: `Minimum order value for ${group.seller.displayName || group.seller.legalName} is ₹${sellerSettings.minOrderValue}`,
          currentValue: group.subtotal,
          minValue: sellerSettings.minOrderValue,
        });
      }
    }

    return {
      valid: errors.length === 0,
      errors,
      warnings,
      cart,
      sellerGroups: Object.values(sellerGroups),
    };
  }

  /**
   * Merge session cart into user cart after login
   */
  async mergeSessionCart(userId, sessionId) {
    const [userCart, sessionCart] = await Promise.all([
      prisma.cart.findFirst({
        where: { userId },
        include: { items: true },
      }),
      prisma.cart.findFirst({
        where: { sessionId, userId: null },
        include: { items: true },
      }),
    ]);

    if (!sessionCart || sessionCart.items.length === 0) {
      return userCart;
    }

    // If no user cart, assign session cart to user
    if (!userCart) {
      return prisma.cart.update({
        where: { id: sessionCart.id },
        data: {
          userId,
          sessionId: null,
        },
      });
    }

    // Merge session cart items into user cart
    for (const sessionItem of sessionCart.items) {
      const existingItem = userCart.items.find(
        (item) => item.productId === sessionItem.productId && item.variantId === sessionItem.variantId
      );

      if (existingItem) {
        // Update quantity (take higher)
        await prisma.cartItem.update({
          where: { id: existingItem.id },
          data: {
            quantity: Math.max(existingItem.quantity, sessionItem.quantity),
          },
        });
      } else {
        // Move item to user cart
        await prisma.cartItem.update({
          where: { id: sessionItem.id },
          data: { cartId: userCart.id },
        });
      }
    }

    // Delete session cart
    await prisma.cart.delete({
      where: { id: sessionCart.id },
    });

    return this.getCart(userCart.id);
  }

  /**
   * Get cart count (number of items)
   */
  async getCartCount(userId = null, sessionId = null) {
    const cart = await prisma.cart.findFirst({
      where: {
        OR: [
          ...(userId ? [{ userId }] : []),
          ...(sessionId ? [{ sessionId }] : []),
        ],
        expiresAt: { gt: new Date() },
      },
      include: {
        _count: {
          select: { items: true },
        },
      },
    });

    return cart?._count?.items || 0;
  }

  /**
   * Cleanup expired carts (called by cron job)
   */
  async cleanupExpiredCarts() {
    const result = await prisma.cart.deleteMany({
      where: {
        expiresAt: { lt: new Date() },
      },
    });

    logger.info(`Cleaned up ${result.count} expired carts`);
    return result.count;
  }

  /**
   * Enrich cart with calculated totals
   */
  enrichCart(cart) {
    let subtotal = 0;
    let totalItems = 0;
    let totalQuantity = 0;

    const enrichedItems = cart.items.map((item) => {
      const currentPrice = item.variant?.basePrice || item.unitPrice;
      const itemTotal = item.quantity * currentPrice;
      const priceChanged = item.unitPrice !== currentPrice;

      subtotal += itemTotal;
      totalItems++;
      totalQuantity += item.quantity;

      return {
        ...item,
        currentPrice,
        priceChanged,
        itemTotal,
        inStock: !item.variant?.trackInventory || item.quantity <= item.variant.stockQuantity,
      };
    });

    return {
      ...cart,
      items: enrichedItems,
      summary: {
        subtotal,
        totalItems,
        totalQuantity,
        // Shipping calculated at checkout based on address
        // Tax calculated at checkout based on GST
      },
    };
  }
}

module.exports = new CartService();
