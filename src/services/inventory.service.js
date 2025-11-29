// =============================================================================
// AIRAVAT B2B MARKETPLACE - INVENTORY SERVICE
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const { BadRequestError } = require('../utils/errors');

class InventoryService {
  /**
   * Get variant stock
   */
  async getStock(variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      select: {
        id: true,
        sku: true,
        stockQuantity: true,
        reservedQuantity: true,
        lowStockThreshold: true,
        trackInventory: true,
      },
    });
    
    if (!variant) {
      return null;
    }
    
    return {
      ...variant,
      availableQuantity: variant.stockQuantity - variant.reservedQuantity,
      isLowStock: variant.stockQuantity <= variant.lowStockThreshold,
      isOutOfStock: variant.stockQuantity <= 0,
    };
  }
  
  /**
   * Update stock quantity
   */
  async updateStock(variantId, quantity, type = 'set', options = {}) {
    const { reason, referenceType, referenceId, updatedBy } = options;
    
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
    });
    
    if (!variant) {
      throw new BadRequestError('Variant not found');
    }
    
    let newQuantity;
    switch (type) {
      case 'set':
        newQuantity = quantity;
        break;
      case 'add':
        newQuantity = variant.stockQuantity + quantity;
        break;
      case 'subtract':
        newQuantity = variant.stockQuantity - quantity;
        break;
      default:
        throw new BadRequestError('Invalid update type');
    }
    
    if (newQuantity < 0) {
      throw new BadRequestError('Stock cannot be negative');
    }
    
    // Update variant and create log in transaction
    const [updatedVariant] = await prisma.$transaction([
      prisma.productVariant.update({
        where: { id: variantId },
        data: { stockQuantity: newQuantity },
      }),
      prisma.inventoryLog.create({
        data: {
          variantId,
          previousQuantity: variant.stockQuantity,
          newQuantity,
          change: newQuantity - variant.stockQuantity,
          type: type.toUpperCase(),
          reason,
          referenceType,
          referenceId,
          createdBy: updatedBy,
        },
      }),
    ]);
    
    // Check low stock alert
    if (newQuantity <= variant.lowStockThreshold && variant.stockQuantity > variant.lowStockThreshold) {
      await this.triggerLowStockAlert(variantId);
    }
    
    // Invalidate cache
    await cache.del(`stock:${variantId}`);
    
    return updatedVariant;
  }
  
  /**
   * Reserve stock for order
   */
  async reserveStock(items, orderId) {
    const reservations = [];
    
    for (const item of items) {
      const variant = await prisma.productVariant.findUnique({
        where: { id: item.variantId },
      });
      
      if (!variant) {
        throw new BadRequestError(`Variant ${item.variantId} not found`);
      }
      
      const availableQty = variant.stockQuantity - variant.reservedQuantity;
      
      if (availableQty < item.quantity) {
        throw new BadRequestError(
          `Insufficient stock for ${variant.sku}. Available: ${availableQty}, Requested: ${item.quantity}`
        );
      }
      
      reservations.push({
        variantId: item.variantId,
        quantity: item.quantity,
        orderId,
      });
    }
    
    // Create reservations in transaction
    await prisma.$transaction(
      reservations.map((r) =>
        prisma.productVariant.update({
          where: { id: r.variantId },
          data: {
            reservedQuantity: { increment: r.quantity },
          },
        })
      )
    );
    
    // Create reservation records
    await prisma.stockReservation.createMany({
      data: reservations.map((r) => ({
        variantId: r.variantId,
        quantity: r.quantity,
        orderId: r.orderId,
        expiresAt: new Date(Date.now() + 30 * 60 * 1000), // 30 minutes
      })),
    });
    
    return reservations;
  }
  
  /**
   * Confirm stock reservation (deduct actual stock)
   */
  async confirmReservation(orderId) {
    const reservations = await prisma.stockReservation.findMany({
      where: { orderId, status: 'PENDING' },
    });
    
    if (reservations.length === 0) {
      return;
    }
    
    await prisma.$transaction([
      // Deduct stock and release reservation
      ...reservations.map((r) =>
        prisma.productVariant.update({
          where: { id: r.variantId },
          data: {
            stockQuantity: { decrement: r.quantity },
            reservedQuantity: { decrement: r.quantity },
          },
        })
      ),
      // Update reservation status
      prisma.stockReservation.updateMany({
        where: { orderId },
        data: { status: 'CONFIRMED' },
      }),
      // Create inventory logs
      ...reservations.map((r) =>
        prisma.inventoryLog.create({
          data: {
            variantId: r.variantId,
            previousQuantity: 0, // Will be calculated
            newQuantity: 0,
            change: -r.quantity,
            type: 'SALE',
            reason: 'Order confirmed',
            referenceType: 'order',
            referenceId: orderId,
          },
        })
      ),
    ]);
  }
  
  /**
   * Release stock reservation
   */
  async releaseReservation(orderId, reason = 'Order cancelled') {
    const reservations = await prisma.stockReservation.findMany({
      where: { orderId, status: 'PENDING' },
    });
    
    if (reservations.length === 0) {
      return;
    }
    
    await prisma.$transaction([
      ...reservations.map((r) =>
        prisma.productVariant.update({
          where: { id: r.variantId },
          data: {
            reservedQuantity: { decrement: r.quantity },
          },
        })
      ),
      prisma.stockReservation.updateMany({
        where: { orderId },
        data: { 
          status: 'RELEASED',
          releasedReason: reason,
        },
      }),
    ]);
  }
  
  /**
   * Bulk update inventory
   */
  async bulkUpdate(businessId, updates) {
    const results = {
      successful: [],
      failed: [],
    };
    
    for (const update of updates) {
      try {
        // Verify variant belongs to business
        const variant = await prisma.productVariant.findFirst({
          where: {
            id: update.variantId,
            product: { businessId },
          },
        });
        
        if (!variant) {
          results.failed.push({
            variantId: update.variantId,
            error: 'Variant not found or access denied',
          });
          continue;
        }
        
        await this.updateStock(update.variantId, update.quantity, update.type || 'set', {
          reason: update.reason || 'Bulk update',
          updatedBy: update.updatedBy,
        });
        
        results.successful.push(update.variantId);
      } catch (error) {
        results.failed.push({
          variantId: update.variantId,
          error: error.message,
        });
      }
    }
    
    return results;
  }
  
  /**
   * Get inventory history
   */
  async getHistory(variantId, options = {}) {
    const { skip = 0, limit = 20, dateFrom, dateTo } = options;
    
    const where = {
      variantId,
      ...(dateFrom && { createdAt: { gte: new Date(dateFrom) } }),
      ...(dateTo && { createdAt: { lte: new Date(dateTo) } }),
    };
    
    const [logs, total] = await Promise.all([
      prisma.inventoryLog.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.inventoryLog.count({ where }),
    ]);
    
    return { logs, total };
  }
  
  /**
   * Get low stock products
   */
  async getLowStockProducts(businessId, options = {}) {
    const { skip = 0, limit = 20 } = options;
    
    const where = {
      product: { businessId },
      trackInventory: true,
      stockQuantity: {
        lte: prisma.productVariant.fields.lowStockThreshold,
      },
    };
    
    const [variants, total] = await Promise.all([
      prisma.productVariant.findMany({
        where,
        skip,
        take: limit,
        include: {
          product: {
            select: { id: true, name: true, slug: true },
          },
        },
        orderBy: { stockQuantity: 'asc' },
      }),
      prisma.productVariant.count({ where }),
    ]);
    
    return { variants, total };
  }
  
  /**
   * Get out of stock products
   */
  async getOutOfStockProducts(businessId, options = {}) {
    const { skip = 0, limit = 20 } = options;
    
    const where = {
      product: { businessId },
      trackInventory: true,
      stockQuantity: 0,
    };
    
    const [variants, total] = await Promise.all([
      prisma.productVariant.findMany({
        where,
        skip,
        take: limit,
        include: {
          product: {
            select: { id: true, name: true, slug: true },
          },
        },
      }),
      prisma.productVariant.count({ where }),
    ]);
    
    return { variants, total };
  }
  
  /**
   * Set low stock threshold
   */
  async setLowStockThreshold(variantId, threshold) {
    return prisma.productVariant.update({
      where: { id: variantId },
      data: { lowStockThreshold: threshold },
    });
  }
  
  /**
   * Trigger low stock alert
   */
  async triggerLowStockAlert(variantId) {
    const variant = await prisma.productVariant.findUnique({
      where: { id: variantId },
      include: {
        product: {
          include: {
            business: {
              include: {
                owner: true,
              },
            },
          },
        },
      },
    });
    
    if (!variant) return;
    
    // Create notification
    await prisma.notification.create({
      data: {
        userId: variant.product.business.ownerId,
        type: 'LOW_STOCK_ALERT',
        title: 'Low Stock Alert',
        message: `${variant.product.name} (${variant.sku}) is running low on stock. Current quantity: ${variant.stockQuantity}`,
        data: {
          productId: variant.product.id,
          variantId: variant.id,
          currentStock: variant.stockQuantity,
        },
      },
    });
    
    logger.info('Low stock alert triggered', {
      variantId,
      sku: variant.sku,
      currentStock: variant.stockQuantity,
    });
  }
  
  /**
   * Get inventory summary for business
   */
  async getInventorySummary(businessId) {
    const stats = await prisma.productVariant.aggregate({
      where: {
        product: { businessId },
        trackInventory: true,
      },
      _sum: {
        stockQuantity: true,
        reservedQuantity: true,
      },
      _count: true,
    });
    
    const lowStock = await prisma.productVariant.count({
      where: {
        product: { businessId },
        trackInventory: true,
        stockQuantity: { gt: 0 },
        // This is a simplified check - in production use raw SQL
      },
    });
    
    const outOfStock = await prisma.productVariant.count({
      where: {
        product: { businessId },
        trackInventory: true,
        stockQuantity: 0,
      },
    });
    
    return {
      totalVariants: stats._count,
      totalStock: stats._sum.stockQuantity || 0,
      reservedStock: stats._sum.reservedQuantity || 0,
      availableStock: (stats._sum.stockQuantity || 0) - (stats._sum.reservedQuantity || 0),
      lowStockCount: lowStock,
      outOfStockCount: outOfStock,
    };
  }
  
  /**
   * Clean up expired reservations
   */
  async cleanupExpiredReservations() {
    const expired = await prisma.stockReservation.findMany({
      where: {
        status: 'PENDING',
        expiresAt: { lt: new Date() },
      },
    });
    
    for (const reservation of expired) {
      await this.releaseReservation(reservation.orderId, 'Reservation expired');
    }
    
    logger.info(`Cleaned up ${expired.length} expired reservations`);
    
    return expired.length;
  }
}

module.exports = new InventoryService();
