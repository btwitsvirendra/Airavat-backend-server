/**
 * Category Service
 * Handles category management, hierarchy, and attribute schemas
 */

const prisma = require('../config/database');
const { cache } = require('../config/redis');
const { NotFoundError, BadRequestError, ConflictError } = require('../utils/errors');
const { generateSlug } = require('../utils/helpers');
const logger = require('../config/logger');

// Cache keys
const CACHE_KEYS = {
  ALL_CATEGORIES: 'categories:all',
  CATEGORY_TREE: 'categories:tree',
  CATEGORY_BY_SLUG: (slug) => `category:slug:${slug}`,
  CATEGORY_BY_ID: (id) => `category:id:${id}`,
  CATEGORY_CHILDREN: (id) => `category:children:${id}`,
};

const CACHE_TTL = 3600; // 1 hour

class CategoryService {
  /**
   * Get all categories (flat list)
   */
  async getAllCategories({ includeInactive = false } = {}) {
    const cacheKey = `${CACHE_KEYS.ALL_CATEGORIES}:${includeInactive}`;
    
    // Try cache first
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const where = includeInactive ? {} : { isActive: true };

    const categories = await prisma.category.findMany({
      where,
      orderBy: [
        { level: 'asc' },
        { sortOrder: 'asc' },
        { name: 'asc' },
      ],
      include: {
        _count: {
          select: { products: true, children: true },
        },
      },
    });

    await cache.set(cacheKey, categories, CACHE_TTL);
    return categories;
  }

  /**
   * Get category tree (hierarchical)
   */
  async getCategoryTree({ includeInactive = false, maxDepth = 3 } = {}) {
    const cacheKey = `${CACHE_KEYS.CATEGORY_TREE}:${includeInactive}:${maxDepth}`;
    
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const where = includeInactive ? {} : { isActive: true };

    // Get root categories
    const rootCategories = await prisma.category.findMany({
      where: {
        ...where,
        parentId: null,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    // Recursively build tree
    const tree = await Promise.all(
      rootCategories.map((cat) => this.buildCategoryTree(cat, where, 1, maxDepth))
    );

    await cache.set(cacheKey, tree, CACHE_TTL);
    return tree;
  }

  /**
   * Build category tree recursively
   */
  async buildCategoryTree(category, where, currentDepth, maxDepth) {
    if (currentDepth >= maxDepth) {
      return {
        ...category,
        children: [],
      };
    }

    const children = await prisma.category.findMany({
      where: {
        ...where,
        parentId: category.id,
      },
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { products: true },
        },
      },
    });

    const childrenWithSubtree = await Promise.all(
      children.map((child) =>
        this.buildCategoryTree(child, where, currentDepth + 1, maxDepth)
      )
    );

    return {
      ...category,
      children: childrenWithSubtree,
    };
  }

  /**
   * Get category by ID
   */
  async getCategoryById(id) {
    const cacheKey = CACHE_KEYS.CATEGORY_BY_ID(id);
    
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        parent: true,
        children: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
        _count: {
          select: { products: true, children: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundError('Category not found');
    }

    await cache.set(cacheKey, category, CACHE_TTL);
    return category;
  }

  /**
   * Get category by slug
   */
  async getCategoryBySlug(slug) {
    const cacheKey = CACHE_KEYS.CATEGORY_BY_SLUG(slug);
    
    const cached = await cache.get(cacheKey);
    if (cached) return cached;

    const category = await prisma.category.findUnique({
      where: { slug },
      include: {
        parent: true,
        children: {
          where: { isActive: true },
          orderBy: { sortOrder: 'asc' },
        },
        _count: {
          select: { products: true, children: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundError('Category not found');
    }

    // Get breadcrumb path
    const breadcrumbs = await this.getCategoryBreadcrumbs(category.id);

    const result = { ...category, breadcrumbs };
    await cache.set(cacheKey, result, CACHE_TTL);
    return result;
  }

  /**
   * Get category breadcrumbs (path from root)
   */
  async getCategoryBreadcrumbs(categoryId) {
    const breadcrumbs = [];
    let currentId = categoryId;

    while (currentId) {
      const category = await prisma.category.findUnique({
        where: { id: currentId },
        select: { id: true, name: true, slug: true, parentId: true },
      });

      if (!category) break;

      breadcrumbs.unshift(category);
      currentId = category.parentId;
    }

    return breadcrumbs;
  }

  /**
   * Get category children
   */
  async getCategoryChildren(parentId, { includeInactive = false } = {}) {
    const where = {
      parentId,
      ...(includeInactive ? {} : { isActive: true }),
    };

    return prisma.category.findMany({
      where,
      orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
      include: {
        _count: {
          select: { products: true, children: true },
        },
      },
    });
  }

  /**
   * Create new category
   */
  async createCategory(data, adminId) {
    const { name, parentId, description, attributeSchema, commissionRate, metaTitle, metaDescription, metaKeywords, image, icon, sortOrder, isActive } = data;

    // Generate unique slug
    const slug = await this.generateUniqueSlug(name);

    // Validate parent exists if provided
    let level = 0;
    let path = slug;
    
    if (parentId) {
      const parent = await prisma.category.findUnique({
        where: { id: parentId },
      });

      if (!parent) {
        throw new NotFoundError('Parent category not found');
      }

      level = parent.level + 1;
      path = `${parent.path}/${slug}`;

      // Max depth check (usually 3-4 levels)
      if (level > 4) {
        throw new BadRequestError('Maximum category depth exceeded');
      }
    }

    const category = await prisma.category.create({
      data: {
        name,
        slug,
        description,
        parentId,
        level,
        path,
        attributeSchema: attributeSchema || {},
        commissionRate: commissionRate || 5.0,
        metaTitle,
        metaDescription,
        metaKeywords,
        image,
        icon,
        sortOrder: sortOrder || 0,
        isActive: isActive !== false,
      },
    });

    // Log audit
    await this.logAudit(adminId, 'CREATE', 'Category', category.id, null, category);

    // Invalidate cache
    await this.invalidateCache();

    return category;
  }

  /**
   * Update category
   */
  async updateCategory(id, data, adminId) {
    const existing = await prisma.category.findUnique({
      where: { id },
    });

    if (!existing) {
      throw new NotFoundError('Category not found');
    }

    const updateData = {};

    if (data.name && data.name !== existing.name) {
      updateData.name = data.name;
      updateData.slug = await this.generateUniqueSlug(data.name, id);
    }

    // Handle parent change
    if (data.parentId !== undefined && data.parentId !== existing.parentId) {
      // Prevent circular reference
      if (data.parentId) {
        const isDescendant = await this.isDescendant(data.parentId, id);
        if (isDescendant) {
          throw new BadRequestError('Cannot set a descendant as parent (circular reference)');
        }

        const newParent = await prisma.category.findUnique({
          where: { id: data.parentId },
        });

        if (!newParent) {
          throw new NotFoundError('Parent category not found');
        }

        updateData.parentId = data.parentId;
        updateData.level = newParent.level + 1;
        updateData.path = `${newParent.path}/${updateData.slug || existing.slug}`;
      } else {
        updateData.parentId = null;
        updateData.level = 0;
        updateData.path = updateData.slug || existing.slug;
      }

      // Update descendants' levels and paths
      await this.updateDescendants(id, updateData.level, updateData.path);
    }

    // Other fields
    if (data.description !== undefined) updateData.description = data.description;
    if (data.attributeSchema) updateData.attributeSchema = data.attributeSchema;
    if (data.commissionRate !== undefined) updateData.commissionRate = data.commissionRate;
    if (data.metaTitle !== undefined) updateData.metaTitle = data.metaTitle;
    if (data.metaDescription !== undefined) updateData.metaDescription = data.metaDescription;
    if (data.metaKeywords !== undefined) updateData.metaKeywords = data.metaKeywords;
    if (data.image !== undefined) updateData.image = data.image;
    if (data.icon !== undefined) updateData.icon = data.icon;
    if (data.sortOrder !== undefined) updateData.sortOrder = data.sortOrder;
    if (data.isActive !== undefined) updateData.isActive = data.isActive;

    const updated = await prisma.category.update({
      where: { id },
      data: updateData,
    });

    // Log audit
    await this.logAudit(adminId, 'UPDATE', 'Category', id, existing, updated);

    // Invalidate cache
    await this.invalidateCache(id);

    return updated;
  }

  /**
   * Delete category
   */
  async deleteCategory(id, adminId) {
    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        _count: {
          select: { products: true, children: true },
        },
      },
    });

    if (!category) {
      throw new NotFoundError('Category not found');
    }

    // Check if has children
    if (category._count.children > 0) {
      throw new ConflictError('Cannot delete category with subcategories. Delete or move subcategories first.');
    }

    // Check if has products
    if (category._count.products > 0) {
      throw new ConflictError('Cannot delete category with products. Move products to another category first.');
    }

    await prisma.category.delete({
      where: { id },
    });

    // Log audit
    await this.logAudit(adminId, 'DELETE', 'Category', id, category, null);

    // Invalidate cache
    await this.invalidateCache(id);

    return { message: 'Category deleted successfully' };
  }

  /**
   * Reorder categories
   */
  async reorderCategories(orders, adminId) {
    // orders = [{ id: 'cat1', sortOrder: 1 }, { id: 'cat2', sortOrder: 2 }]
    
    const updates = orders.map(({ id, sortOrder }) =>
      prisma.category.update({
        where: { id },
        data: { sortOrder },
      })
    );

    await prisma.$transaction(updates);

    // Invalidate cache
    await this.invalidateCache();

    return { message: 'Categories reordered successfully' };
  }

  /**
   * Get popular categories (by product count)
   */
  async getPopularCategories(limit = 10) {
    return prisma.category.findMany({
      where: { isActive: true },
      orderBy: { productCount: 'desc' },
      take: limit,
      select: {
        id: true,
        name: true,
        slug: true,
        image: true,
        icon: true,
        productCount: true,
      },
    });
  }

  /**
   * Get category statistics
   */
  async getCategoryStats(id) {
    const category = await prisma.category.findUnique({
      where: { id },
      include: {
        products: {
          select: {
            status: true,
            orderCount: true,
            viewCount: true,
            averageRating: true,
          },
        },
      },
    });

    if (!category) {
      throw new NotFoundError('Category not found');
    }

    const products = category.products;
    
    const stats = {
      totalProducts: products.length,
      activeProducts: products.filter(p => p.status === 'ACTIVE').length,
      totalOrders: products.reduce((sum, p) => sum + p.orderCount, 0),
      totalViews: products.reduce((sum, p) => sum + p.viewCount, 0),
      averageRating: products.length > 0 
        ? products.reduce((sum, p) => sum + (p.averageRating || 0), 0) / products.filter(p => p.averageRating).length 
        : 0,
    };

    return stats;
  }

  /**
   * Search categories
   */
  async searchCategories(query, limit = 20) {
    return prisma.category.findMany({
      where: {
        isActive: true,
        OR: [
          { name: { contains: query, mode: 'insensitive' } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: limit,
      orderBy: { productCount: 'desc' },
      select: {
        id: true,
        name: true,
        slug: true,
        path: true,
        level: true,
        image: true,
        productCount: true,
      },
    });
  }

  /**
   * Get attribute schema for a category (inherited from ancestors)
   */
  async getInheritedAttributeSchema(categoryId) {
    const breadcrumbs = await this.getCategoryBreadcrumbs(categoryId);
    
    // Merge attribute schemas from root to leaf
    const mergedSchema = {};
    
    for (const category of breadcrumbs) {
      const cat = await prisma.category.findUnique({
        where: { id: category.id },
        select: { attributeSchema: true },
      });
      
      if (cat?.attributeSchema) {
        Object.assign(mergedSchema, cat.attributeSchema);
      }
    }

    return mergedSchema;
  }

  // Helper methods

  /**
   * Generate unique slug
   */
  async generateUniqueSlug(name, excludeId = null) {
    let slug = generateSlug(name);
    let counter = 0;
    let finalSlug = slug;

    while (true) {
      const existing = await prisma.category.findFirst({
        where: {
          slug: finalSlug,
          ...(excludeId ? { NOT: { id: excludeId } } : {}),
        },
      });

      if (!existing) break;

      counter++;
      finalSlug = `${slug}-${counter}`;
    }

    return finalSlug;
  }

  /**
   * Check if targetId is a descendant of parentId
   */
  async isDescendant(targetId, parentId) {
    const children = await prisma.category.findMany({
      where: { parentId },
      select: { id: true },
    });

    for (const child of children) {
      if (child.id === targetId) return true;
      const isDesc = await this.isDescendant(targetId, child.id);
      if (isDesc) return true;
    }

    return false;
  }

  /**
   * Update descendants when parent changes
   */
  async updateDescendants(parentId, parentLevel, parentPath) {
    const children = await prisma.category.findMany({
      where: { parentId },
    });

    for (const child of children) {
      const newLevel = parentLevel + 1;
      const newPath = `${parentPath}/${child.slug}`;

      await prisma.category.update({
        where: { id: child.id },
        data: { level: newLevel, path: newPath },
      });

      await this.updateDescendants(child.id, newLevel, newPath);
    }
  }

  /**
   * Invalidate category cache
   */
  async invalidateCache(categoryId = null) {
    try {
      await cache.delPattern('categories:*');
      if (categoryId) {
        await cache.del(CACHE_KEYS.CATEGORY_BY_ID(categoryId));
      }
    } catch (error) {
      logger.error('Failed to invalidate category cache:', error);
    }
  }

  /**
   * Log audit trail
   */
  async logAudit(userId, action, entity, entityId, oldValues, newValues) {
    try {
      await prisma.auditLog.create({
        data: {
          userId,
          action,
          entity,
          entityId,
          oldValues,
          newValues,
        },
      });
    } catch (error) {
      logger.error('Failed to log audit:', error);
    }
  }
}

module.exports = new CategoryService();
