// =============================================================================
// AIRAVAT B2B MARKETPLACE - ORDER TEMPLATE SERVICE
// Reusable order templates for frequent purchases
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const {
  NotFoundError,
  BadRequestError,
  ForbiddenError,
} = require('../utils/errors');

// =============================================================================
// CONSTANTS
// =============================================================================

const CACHE_TTL = { TEMPLATES: 300 };
const MAX_TEMPLATES_PER_USER = 50;
const MAX_ITEMS_PER_TEMPLATE = 100;

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const getTemplatesCacheKey = (userId) => `order_templates:${userId}`;

const invalidateTemplatesCache = async (userId) => {
  await cache.del(getTemplatesCacheKey(userId));
};

// =============================================================================
// TEMPLATE MANAGEMENT
// =============================================================================

/**
 * Create order template
 */
const createTemplate = async (userId, businessId, data) => {
  const { name, description, items, isDefault = false } = data;

  // Check template limit
  const count = await prisma.orderTemplate.count({ where: { userId } });
  if (count >= MAX_TEMPLATES_PER_USER) {
    throw new BadRequestError(`Maximum templates limit (${MAX_TEMPLATES_PER_USER}) reached`);
  }

  // Validate items
  if (!items || items.length === 0) {
    throw new BadRequestError('At least one item is required');
  }

  if (items.length > MAX_ITEMS_PER_TEMPLATE) {
    throw new BadRequestError(`Maximum ${MAX_ITEMS_PER_TEMPLATE} items per template`);
  }

  // Verify all products exist
  const productIds = items.map((item) => item.productId);
  const products = await prisma.product.findMany({
    where: { id: { in: productIds } },
    select: { id: true, name: true, price: true, minOrderQuantity: true },
  });

  if (products.length !== productIds.length) {
    throw new BadRequestError('One or more products not found');
  }

  const productMap = new Map(products.map((p) => [p.id, p]));

  // Validate quantities
  for (const item of items) {
    const product = productMap.get(item.productId);
    if (product.minOrderQuantity && item.quantity < product.minOrderQuantity) {
      throw new BadRequestError(
        `Minimum quantity for ${product.name} is ${product.minOrderQuantity}`
      );
    }
  }

  // If setting as default, unset other defaults
  if (isDefault) {
    await prisma.orderTemplate.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
  }

  const template = await prisma.orderTemplate.create({
    data: {
      userId,
      businessId,
      name,
      description,
      isDefault,
      items: {
        create: items.map((item) => ({
          productId: item.productId,
          quantity: item.quantity,
          specifications: item.specifications || null,
          notes: item.notes || null,
        })),
      },
    },
    include: {
      items: {
        include: {
          product: {
            select: { id: true, name: true, price: true, images: true },
          },
        },
      },
    },
  });

  await invalidateTemplatesCache(userId);

  logger.info('Order template created', { userId, templateId: template.id, name });

  return template;
};

/**
 * Get all templates for user
 */
const getTemplates = async (userId, options = {}) => {
  const { page = 1, limit = 20 } = options;
  const skip = (page - 1) * limit;

  const [templates, total] = await Promise.all([
    prisma.orderTemplate.findMany({
      where: { userId },
      include: {
        items: {
          include: {
            product: {
              select: { id: true, name: true, price: true, images: true, stockQuantity: true },
            },
          },
        },
      },
      orderBy: [{ isDefault: 'desc' }, { lastUsedAt: 'desc' }, { createdAt: 'desc' }],
      skip,
      take: limit,
    }),
    prisma.orderTemplate.count({ where: { userId } }),
  ]);

  // Calculate template totals
  const templatesWithTotals = templates.map((template) => {
    const total = template.items.reduce((sum, item) => {
      return sum + parseFloat(item.product.price) * item.quantity;
    }, 0);

    const hasUnavailableItems = template.items.some(
      (item) => item.product.stockQuantity < item.quantity
    );

    return {
      ...template,
      estimatedTotal: total,
      itemCount: template.items.length,
      hasUnavailableItems,
    };
  });

  return {
    templates: templatesWithTotals,
    pagination: {
      page,
      limit,
      total,
      totalPages: Math.ceil(total / limit),
    },
  };
};

/**
 * Get template by ID
 */
const getTemplateById = async (userId, templateId) => {
  const template = await prisma.orderTemplate.findFirst({
    where: { id: templateId, userId },
    include: {
      items: {
        include: {
          product: {
            select: {
              id: true,
              name: true,
              slug: true,
              price: true,
              images: true,
              stockQuantity: true,
              minOrderQuantity: true,
              seller: { select: { id: true, businessName: true } },
            },
          },
        },
      },
    },
  });

  if (!template) {
    throw new NotFoundError('Order template');
  }

  // Calculate totals and availability
  let estimatedTotal = 0;
  const itemsWithStatus = template.items.map((item) => {
    const itemTotal = parseFloat(item.product.price) * item.quantity;
    estimatedTotal += itemTotal;

    return {
      ...item,
      itemTotal,
      isAvailable: item.product.stockQuantity >= item.quantity,
      availableQuantity: item.product.stockQuantity,
    };
  });

  return {
    ...template,
    items: itemsWithStatus,
    estimatedTotal,
  };
};

/**
 * Update template
 */
const updateTemplate = async (userId, templateId, updates) => {
  const template = await prisma.orderTemplate.findFirst({
    where: { id: templateId, userId },
  });

  if (!template) {
    throw new NotFoundError('Order template');
  }

  const { name, description, isDefault, items } = updates;
  const updateData = {};

  if (name !== undefined) updateData.name = name;
  if (description !== undefined) updateData.description = description;

  if (isDefault === true) {
    await prisma.orderTemplate.updateMany({
      where: { userId, isDefault: true },
      data: { isDefault: false },
    });
    updateData.isDefault = true;
  }

  // If items are provided, replace all items
  if (items && items.length > 0) {
    if (items.length > MAX_ITEMS_PER_TEMPLATE) {
      throw new BadRequestError(`Maximum ${MAX_ITEMS_PER_TEMPLATE} items per template`);
    }

    // Delete existing items
    await prisma.orderTemplateItem.deleteMany({
      where: { templateId },
    });

    // Create new items
    await prisma.orderTemplateItem.createMany({
      data: items.map((item) => ({
        templateId,
        productId: item.productId,
        quantity: item.quantity,
        specifications: item.specifications || null,
        notes: item.notes || null,
      })),
    });
  }

  const updated = await prisma.orderTemplate.update({
    where: { id: templateId },
    data: updateData,
    include: {
      items: {
        include: {
          product: {
            select: { id: true, name: true, price: true, images: true },
          },
        },
      },
    },
  });

  await invalidateTemplatesCache(userId);

  logger.info('Order template updated', { userId, templateId });

  return updated;
};

/**
 * Delete template
 */
const deleteTemplate = async (userId, templateId) => {
  const template = await prisma.orderTemplate.findFirst({
    where: { id: templateId, userId },
  });

  if (!template) {
    throw new NotFoundError('Order template');
  }

  await prisma.orderTemplate.delete({
    where: { id: templateId },
  });

  await invalidateTemplatesCache(userId);

  logger.info('Order template deleted', { userId, templateId });

  return { success: true };
};

/**
 * Add item to template
 */
const addItemToTemplate = async (userId, templateId, itemData) => {
  const template = await prisma.orderTemplate.findFirst({
    where: { id: templateId, userId },
    include: { items: true },
  });

  if (!template) {
    throw new NotFoundError('Order template');
  }

  if (template.items.length >= MAX_ITEMS_PER_TEMPLATE) {
    throw new BadRequestError(`Maximum ${MAX_ITEMS_PER_TEMPLATE} items per template`);
  }

  // Check if product already exists in template
  const existing = template.items.find((i) => i.productId === itemData.productId);
  if (existing) {
    // Update quantity instead
    return updateTemplateItem(userId, templateId, existing.id, {
      quantity: existing.quantity + itemData.quantity,
    });
  }

  // Verify product exists
  const product = await prisma.product.findUnique({
    where: { id: itemData.productId },
    select: { id: true, name: true, price: true },
  });

  if (!product) {
    throw new NotFoundError('Product');
  }

  const item = await prisma.orderTemplateItem.create({
    data: {
      templateId,
      productId: itemData.productId,
      quantity: itemData.quantity,
      specifications: itemData.specifications || null,
      notes: itemData.notes || null,
    },
    include: {
      product: {
        select: { id: true, name: true, price: true, images: true },
      },
    },
  });

  await invalidateTemplatesCache(userId);

  return item;
};

/**
 * Update template item
 */
const updateTemplateItem = async (userId, templateId, itemId, updates) => {
  const template = await prisma.orderTemplate.findFirst({
    where: { id: templateId, userId },
  });

  if (!template) {
    throw new NotFoundError('Order template');
  }

  const item = await prisma.orderTemplateItem.findFirst({
    where: { id: itemId, templateId },
  });

  if (!item) {
    throw new NotFoundError('Template item');
  }

  const updated = await prisma.orderTemplateItem.update({
    where: { id: itemId },
    data: {
      ...(updates.quantity !== undefined && { quantity: updates.quantity }),
      ...(updates.specifications !== undefined && { specifications: updates.specifications }),
      ...(updates.notes !== undefined && { notes: updates.notes }),
    },
    include: {
      product: {
        select: { id: true, name: true, price: true, images: true },
      },
    },
  });

  await invalidateTemplatesCache(userId);

  return updated;
};

/**
 * Remove item from template
 */
const removeItemFromTemplate = async (userId, templateId, itemId) => {
  const template = await prisma.orderTemplate.findFirst({
    where: { id: templateId, userId },
    include: { items: true },
  });

  if (!template) {
    throw new NotFoundError('Order template');
  }

  if (template.items.length <= 1) {
    throw new BadRequestError('Template must have at least one item');
  }

  await prisma.orderTemplateItem.delete({
    where: { id: itemId },
  });

  await invalidateTemplatesCache(userId);

  return { success: true };
};

/**
 * Create template from order
 */
const createFromOrder = async (userId, businessId, orderId, name) => {
  const order = await prisma.order.findFirst({
    where: { id: orderId, buyerId: businessId },
    include: {
      items: {
        select: { productId: true, quantity: true },
      },
    },
  });

  if (!order) {
    throw new NotFoundError('Order');
  }

  return createTemplate(userId, businessId, {
    name: name || `Template from Order #${order.orderNumber}`,
    items: order.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
    })),
  });
};

/**
 * Duplicate template
 */
const duplicateTemplate = async (userId, templateId, newName) => {
  const template = await getTemplateById(userId, templateId);

  return createTemplate(userId, template.businessId, {
    name: newName || `${template.name} (Copy)`,
    description: template.description,
    items: template.items.map((item) => ({
      productId: item.productId,
      quantity: item.quantity,
      specifications: item.specifications,
      notes: item.notes,
    })),
  });
};

/**
 * Record template usage
 */
const recordUsage = async (templateId) => {
  await prisma.orderTemplate.update({
    where: { id: templateId },
    data: {
      usageCount: { increment: 1 },
      lastUsedAt: new Date(),
    },
  });
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  createTemplate,
  getTemplates,
  getTemplateById,
  updateTemplate,
  deleteTemplate,
  addItemToTemplate,
  updateTemplateItem,
  removeItemFromTemplate,
  createFromOrder,
  duplicateTemplate,
  recordUsage,
};



