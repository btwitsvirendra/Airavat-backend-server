// =============================================================================
// AIRAVAT B2B MARKETPLACE - WAREHOUSE SERVICE
// Multi-Warehouse Inventory Management
// =============================================================================

const { prisma } = require('../config/database');
const { cache, inventory } = require('../config/redis');
const logger = require('../config/logger');
const { NotFoundError, BadRequestError, ForbiddenError } = require('../utils/errors');
const { generateId } = require('../utils/helpers');
const { emitToBusiness } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const WAREHOUSE_STATUS = { ACTIVE: 'ACTIVE', INACTIVE: 'INACTIVE', MAINTENANCE: 'MAINTENANCE' };
const TRANSFER_STATUS = { PENDING: 'PENDING', APPROVED: 'APPROVED', IN_TRANSIT: 'IN_TRANSIT', COMPLETED: 'COMPLETED', CANCELLED: 'CANCELLED' };
const CACHE_TTL = { WAREHOUSE: 300, INVENTORY: 60 };

// =============================================================================
// WAREHOUSE MANAGEMENT
// =============================================================================

const createWarehouse = async (businessId, warehouseData) => {
  const code = warehouseData.code?.toUpperCase() || `WH-${generateId().substring(0, 6).toUpperCase()}`;

  const existing = await prisma.warehouse.findFirst({ where: { businessId, code } });
  if (existing) throw new BadRequestError('Warehouse code already exists');

  const warehouse = await prisma.warehouse.create({
    data: {
      businessId, code, name: warehouseData.name, type: warehouseData.type || 'WAREHOUSE',
      addressLine1: warehouseData.addressLine1, addressLine2: warehouseData.addressLine2,
      city: warehouseData.city, state: warehouseData.state, pincode: warehouseData.pincode,
      country: warehouseData.country || 'India', phone: warehouseData.phone, email: warehouseData.email,
      managerName: warehouseData.managerName, managerPhone: warehouseData.managerPhone,
      capacity: warehouseData.capacity, operatingHours: warehouseData.operatingHours,
      isDefault: warehouseData.isDefault || false, status: WAREHOUSE_STATUS.ACTIVE,
      geoLocation: warehouseData.geoLocation, serviceablePincodes: warehouseData.serviceablePincodes || [],
    },
  });

  if (warehouse.isDefault) {
    await prisma.warehouse.updateMany({ where: { businessId, id: { not: warehouse.id } }, data: { isDefault: false } });
  }

  logger.info('Warehouse created', { warehouseId: warehouse.id, businessId, code });
  return warehouse;
};

const updateWarehouse = async (warehouseId, businessId, updateData) => {
  const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, businessId } });
  if (!warehouse) throw new NotFoundError('Warehouse');

  if (updateData.code && updateData.code !== warehouse.code) {
    const hasInventory = await prisma.warehouseInventory.count({ where: { warehouseId } });
    if (hasInventory > 0) delete updateData.code;
  }

  const updated = await prisma.warehouse.update({ where: { id: warehouseId }, data: updateData });

  if (updateData.isDefault === true) {
    await prisma.warehouse.updateMany({ where: { businessId, id: { not: warehouseId } }, data: { isDefault: false } });
  }

  await cache.del(`warehouse:${warehouseId}`);
  return updated;
};

const deleteWarehouse = async (warehouseId, businessId) => {
  const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, businessId } });
  if (!warehouse) throw new NotFoundError('Warehouse');

  const inventoryCount = await prisma.warehouseInventory.count({ where: { warehouseId, quantity: { gt: 0 } } });
  if (inventoryCount > 0) throw new BadRequestError('Cannot delete warehouse with existing inventory');

  await prisma.warehouse.delete({ where: { id: warehouseId } });
  logger.info('Warehouse deleted', { warehouseId, businessId });
  return { success: true };
};

const getWarehouse = async (warehouseId, businessId) => {
  const cacheKey = `warehouse:${warehouseId}`;
  const cached = await cache.get(cacheKey);
  if (cached) return cached;

  const warehouse = await prisma.warehouse.findFirst({ where: { id: warehouseId, businessId } });
  if (!warehouse) throw new NotFoundError('Warehouse');

  const inventorySummary = await prisma.warehouseInventory.aggregate({ where: { warehouseId }, _sum: { quantity: true, reservedQuantity: true }, _count: true });

  const result = { ...warehouse, inventory: { totalProducts: inventorySummary._count, totalQuantity: inventorySummary._sum.quantity || 0, reservedQuantity: inventorySummary._sum.reservedQuantity || 0 } };
  await cache.set(cacheKey, result, CACHE_TTL.WAREHOUSE);
  return result;
};

const getWarehouses = async (businessId, options = {}) => {
  const { page = 1, limit = 20, status, includeInventory = false } = options;
  const skip = (page - 1) * limit;
  const where = { businessId };
  if (status) where.status = status;

  const [warehouses, total] = await Promise.all([
    prisma.warehouse.findMany({ where, skip, take: limit, orderBy: [{ isDefault: 'desc' }, { name: 'asc' }] }),
    prisma.warehouse.count({ where }),
  ]);

  let warehousesWithInventory = warehouses;
  if (includeInventory) {
    warehousesWithInventory = await Promise.all(warehouses.map(async (wh) => {
      const inv = await prisma.warehouseInventory.aggregate({ where: { warehouseId: wh.id }, _sum: { quantity: true }, _count: true });
      return { ...wh, inventoryCount: inv._count, totalStock: inv._sum.quantity || 0 };
    }));
  }

  return { warehouses: warehousesWithInventory, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

// =============================================================================
// INVENTORY MANAGEMENT
// =============================================================================

const addInventory = async (warehouseId, variantId, quantity, options = {}) => {
  const warehouse = await prisma.warehouse.findUnique({ where: { id: warehouseId } });
  if (!warehouse) throw new NotFoundError('Warehouse');

  const variant = await prisma.productVariant.findUnique({ where: { id: variantId } });
  if (!variant) throw new NotFoundError('Product variant');

  const inv = await prisma.warehouseInventory.upsert({
    where: { warehouseId_variantId: { warehouseId, variantId } },
    create: { warehouseId, variantId, quantity, reservedQuantity: 0, reorderPoint: options.reorderPoint || 10, reorderQuantity: options.reorderQuantity || 50, location: options.location, batchNumber: options.batchNumber, expiryDate: options.expiryDate },
    update: { quantity: { increment: quantity }, location: options.location || undefined },
  });

  await updateTotalStock(variantId);
  await inventory.setStock(variantId, await getTotalStock(variantId));

  logger.info('Inventory added', { warehouseId, variantId, quantity, newQuantity: inv.quantity });
  return inv;
};

const removeInventory = async (warehouseId, variantId, quantity) => {
  const inv = await prisma.warehouseInventory.findUnique({ where: { warehouseId_variantId: { warehouseId, variantId } } });
  if (!inv) throw new NotFoundError('Inventory');

  const availableQuantity = inv.quantity - inv.reservedQuantity;
  if (quantity > availableQuantity) throw new BadRequestError(`Insufficient available stock. Available: ${availableQuantity}`);

  const updated = await prisma.warehouseInventory.update({ where: { id: inv.id }, data: { quantity: { decrement: quantity } } });

  await updateTotalStock(variantId);
  await inventory.setStock(variantId, await getTotalStock(variantId));

  logger.info('Inventory removed', { warehouseId, variantId, quantity });
  return updated;
};

const reserveInventory = async (variantId, quantity, orderId) => {
  const inventories = await prisma.warehouseInventory.findMany({
    where: { variantId, warehouse: { status: WAREHOUSE_STATUS.ACTIVE } },
    include: { warehouse: { select: { isDefault: true } } },
    orderBy: [{ warehouse: { isDefault: 'desc' } }, { quantity: 'desc' }],
  });

  let remainingQuantity = quantity;
  const reservations = [];

  for (const inv of inventories) {
    if (remainingQuantity <= 0) break;

    const availableQuantity = inv.quantity - inv.reservedQuantity;
    if (availableQuantity <= 0) continue;

    const reserveQty = Math.min(availableQuantity, remainingQuantity);
    await prisma.warehouseInventory.update({ where: { id: inv.id }, data: { reservedQuantity: { increment: reserveQty } } });

    reservations.push({ warehouseId: inv.warehouseId, variantId, quantity: reserveQty, orderId });
    remainingQuantity -= reserveQty;
  }

  if (remainingQuantity > 0) {
    for (const res of reservations) {
      await prisma.warehouseInventory.update({ where: { warehouseId_variantId: { warehouseId: res.warehouseId, variantId } }, data: { reservedQuantity: { decrement: res.quantity } } });
    }
    throw new BadRequestError(`Insufficient stock. Short by ${remainingQuantity} units`);
  }

  return reservations;
};

const releaseReservedInventory = async (warehouseId, variantId, quantity) => {
  await prisma.warehouseInventory.update({ where: { warehouseId_variantId: { warehouseId, variantId } }, data: { reservedQuantity: { decrement: quantity } } });
  return { success: true };
};

const confirmReservation = async (warehouseId, variantId, quantity) => {
  await prisma.warehouseInventory.update({ where: { warehouseId_variantId: { warehouseId, variantId } }, data: { quantity: { decrement: quantity }, reservedQuantity: { decrement: quantity } } });
  await updateTotalStock(variantId);
  return { success: true };
};

const getWarehouseInventory = async (warehouseId, options = {}) => {
  const { page = 1, limit = 20, lowStock } = options;
  const skip = (page - 1) * limit;
  const where = { warehouseId };

  const [inv, total] = await Promise.all([
    prisma.warehouseInventory.findMany({ where, include: { variant: { include: { product: { select: { name: true, images: true } } } } }, skip, take: limit, orderBy: { updatedAt: 'desc' } }),
    prisma.warehouseInventory.count({ where }),
  ]);

  return { inventory: inv.map((i) => ({ ...i, availableQuantity: i.quantity - i.reservedQuantity, isLowStock: i.quantity <= i.reorderPoint })), pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

const getTotalStock = async (variantId) => {
  const result = await prisma.warehouseInventory.aggregate({ where: { variantId, warehouse: { status: WAREHOUSE_STATUS.ACTIVE } }, _sum: { quantity: true } });
  return result._sum.quantity || 0;
};

const updateTotalStock = async (variantId) => {
  const total = await getTotalStock(variantId);
  await prisma.productVariant.update({ where: { id: variantId }, data: { stockQuantity: total } });
};

// =============================================================================
// INVENTORY TRANSFERS
// =============================================================================

const createTransfer = async (businessId, transferData) => {
  const { fromWarehouseId, toWarehouseId, items, notes } = transferData;

  const [fromWh, toWh] = await Promise.all([
    prisma.warehouse.findFirst({ where: { id: fromWarehouseId, businessId } }),
    prisma.warehouse.findFirst({ where: { id: toWarehouseId, businessId } }),
  ]);

  if (!fromWh) throw new NotFoundError('Source warehouse');
  if (!toWh) throw new NotFoundError('Destination warehouse');
  if (fromWarehouseId === toWarehouseId) throw new BadRequestError('Source and destination cannot be the same');

  for (const item of items) {
    const inv = await prisma.warehouseInventory.findUnique({ where: { warehouseId_variantId: { warehouseId: fromWarehouseId, variantId: item.variantId } } });
    const available = inv ? inv.quantity - inv.reservedQuantity : 0;
    if (available < item.quantity) throw new BadRequestError(`Insufficient stock for ${item.variantId}. Available: ${available}`);
  }

  const transfer = await prisma.inventoryTransfer.create({
    data: { businessId, fromWarehouseId, toWarehouseId, transferNumber: `TRF-${Date.now().toString(36).toUpperCase()}`, items, notes, status: TRANSFER_STATUS.PENDING },
  });

  logger.info('Inventory transfer created', { transferId: transfer.id, fromWarehouseId, toWarehouseId });
  return transfer;
};

const approveTransfer = async (transferId, businessId) => {
  const transfer = await prisma.inventoryTransfer.findFirst({ where: { id: transferId, businessId, status: TRANSFER_STATUS.PENDING } });
  if (!transfer) throw new NotFoundError('Transfer');

  for (const item of transfer.items) {
    await removeInventory(transfer.fromWarehouseId, item.variantId, item.quantity);
    await addInventory(transfer.toWarehouseId, item.variantId, item.quantity);
  }

  await prisma.inventoryTransfer.update({ where: { id: transferId }, data: { status: TRANSFER_STATUS.COMPLETED, completedAt: new Date() } });

  logger.info('Inventory transfer completed', { transferId });
  emitToBusiness(businessId, 'inventory:transfer_completed', { transferId });

  return { success: true };
};

const cancelTransfer = async (transferId, businessId, reason) => {
  const transfer = await prisma.inventoryTransfer.findFirst({ where: { id: transferId, businessId, status: TRANSFER_STATUS.PENDING } });
  if (!transfer) throw new NotFoundError('Transfer');

  await prisma.inventoryTransfer.update({ where: { id: transferId }, data: { status: TRANSFER_STATUS.CANCELLED, cancelReason: reason, cancelledAt: new Date() } });
  return { success: true };
};

const getTransfers = async (businessId, options = {}) => {
  const { page = 1, limit = 20, status, warehouseId } = options;
  const skip = (page - 1) * limit;
  const where = { businessId };
  if (status) where.status = status;
  if (warehouseId) where.OR = [{ fromWarehouseId: warehouseId }, { toWarehouseId: warehouseId }];

  const [transfers, total] = await Promise.all([
    prisma.inventoryTransfer.findMany({ where, include: { fromWarehouse: { select: { name: true, code: true } }, toWarehouse: { select: { name: true, code: true } } }, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.inventoryTransfer.count({ where }),
  ]);

  return { transfers, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  WAREHOUSE_STATUS, TRANSFER_STATUS,
  createWarehouse, updateWarehouse, deleteWarehouse, getWarehouse, getWarehouses,
  addInventory, removeInventory, reserveInventory, releaseReservedInventory, confirmReservation,
  getWarehouseInventory, getTotalStock, updateTotalStock,
  createTransfer, approveTransfer, cancelTransfer, getTransfers,
};
