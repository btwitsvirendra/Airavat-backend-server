// =============================================================================
// AIRAVAT B2B MARKETPLACE - BULK IMPORT/EXPORT SERVICE
// CSV/Excel import and export for products, orders, etc.
// =============================================================================

const { Parser } = require('json2csv');
const csv = require('csv-parser');
const { Readable } = require('stream');
const ExcelJS = require('exceljs');
const { prisma } = require('../config/database');
const { uploadToS3 } = require('../middleware/upload.middleware');
const logger = require('../config/logger');
const { v4: uuidv4 } = require('uuid');

class BulkService {
  // ===========================================================================
  // PRODUCT IMPORT/EXPORT
  // ===========================================================================

  /**
   * Export products to CSV
   */
  async exportProductsToCSV(businessId, filters = {}) {
    const products = await prisma.product.findMany({
      where: {
        businessId,
        ...filters,
      },
      include: {
        category: { select: { name: true } },
        variants: true,
      },
    });

    const flattenedProducts = products.flatMap((product) =>
      product.variants.map((variant) => ({
        productId: product.id,
        name: product.name,
        description: product.description,
        category: product.category.name,
        brand: product.brand,
        hsnCode: product.hsnCode,
        gstRate: product.gstRate,
        tags: product.tags?.join(', '),
        status: product.status,
        variantName: variant.variantName,
        sku: variant.sku,
        basePrice: variant.basePrice,
        salePrice: variant.salePrice,
        stockQuantity: variant.stockQuantity,
        lowStockThreshold: variant.lowStockThreshold,
        weight: variant.weight,
        dimensions: variant.dimensions ? JSON.stringify(variant.dimensions) : '',
      }))
    );

    const fields = [
      'productId', 'name', 'description', 'category', 'brand',
      'hsnCode', 'gstRate', 'tags', 'status', 'variantName',
      'sku', 'basePrice', 'salePrice', 'stockQuantity',
      'lowStockThreshold', 'weight', 'dimensions',
    ];

    const parser = new Parser({ fields });
    return parser.parse(flattenedProducts);
  }

  /**
   * Import products from CSV
   */
  async importProductsFromCSV(businessId, fileBuffer, options = {}) {
    const { updateExisting = false, dryRun = false } = options;
    const results = {
      total: 0,
      created: 0,
      updated: 0,
      failed: 0,
      errors: [],
    };

    const rows = await this.parseCSV(fileBuffer);
    results.total = rows.length;

    // Group by product name (for variants)
    const productGroups = {};
    for (const row of rows) {
      const key = row.name || row.productId;
      if (!productGroups[key]) {
        productGroups[key] = {
          product: row,
          variants: [],
        };
      }
      productGroups[key].variants.push(row);
    }

    for (const [key, group] of Object.entries(productGroups)) {
      try {
        const productData = group.product;

        // Find or create category
        let category = await prisma.category.findFirst({
          where: { name: productData.category },
        });

        if (!category) {
          results.errors.push({
            row: key,
            error: `Category not found: ${productData.category}`,
          });
          results.failed++;
          continue;
        }

        // Check if product exists
        const existingProduct = productData.productId
          ? await prisma.product.findUnique({ where: { id: productData.productId } })
          : await prisma.product.findFirst({
              where: { businessId, name: productData.name },
            });

        if (dryRun) {
          if (existingProduct && updateExisting) {
            results.updated++;
          } else if (!existingProduct) {
            results.created++;
          }
          continue;
        }

        const slug = require('slugify')(productData.name, { lower: true }) + '-' + Date.now();

        if (existingProduct && updateExisting) {
          // Update existing product
          await prisma.product.update({
            where: { id: existingProduct.id },
            data: {
              name: productData.name,
              description: productData.description,
              categoryId: category.id,
              brand: productData.brand,
              hsnCode: productData.hsnCode,
              gstRate: parseFloat(productData.gstRate) || null,
              tags: productData.tags?.split(',').map((t) => t.trim()),
              status: productData.status || 'ACTIVE',
            },
          });

          // Update/create variants
          for (const variantData of group.variants) {
            const existingVariant = await prisma.productVariant.findFirst({
              where: {
                productId: existingProduct.id,
                sku: variantData.sku,
              },
            });

            if (existingVariant) {
              await prisma.productVariant.update({
                where: { id: existingVariant.id },
                data: {
                  variantName: variantData.variantName,
                  basePrice: parseFloat(variantData.basePrice),
                  salePrice: variantData.salePrice ? parseFloat(variantData.salePrice) : null,
                  stockQuantity: parseInt(variantData.stockQuantity),
                  lowStockThreshold: parseInt(variantData.lowStockThreshold) || 10,
                },
              });
            } else {
              await prisma.productVariant.create({
                data: {
                  productId: existingProduct.id,
                  variantName: variantData.variantName || 'Default',
                  sku: variantData.sku || `SKU-${Date.now()}`,
                  basePrice: parseFloat(variantData.basePrice),
                  salePrice: variantData.salePrice ? parseFloat(variantData.salePrice) : null,
                  stockQuantity: parseInt(variantData.stockQuantity) || 0,
                  lowStockThreshold: parseInt(variantData.lowStockThreshold) || 10,
                  isDefault: group.variants.indexOf(variantData) === 0,
                  isActive: true,
                },
              });
            }
          }

          results.updated++;
        } else if (!existingProduct) {
          // Create new product
          const newProduct = await prisma.product.create({
            data: {
              businessId,
              name: productData.name,
              slug,
              description: productData.description,
              categoryId: category.id,
              brand: productData.brand,
              hsnCode: productData.hsnCode,
              gstRate: parseFloat(productData.gstRate) || null,
              tags: productData.tags?.split(',').map((t) => t.trim()),
              status: productData.status || 'DRAFT',
              images: [],
              variants: {
                create: group.variants.map((v, index) => ({
                  variantName: v.variantName || 'Default',
                  sku: v.sku || `SKU-${Date.now()}-${index}`,
                  basePrice: parseFloat(v.basePrice),
                  salePrice: v.salePrice ? parseFloat(v.salePrice) : null,
                  stockQuantity: parseInt(v.stockQuantity) || 0,
                  lowStockThreshold: parseInt(v.lowStockThreshold) || 10,
                  isDefault: index === 0,
                  isActive: true,
                })),
              },
            },
          });

          results.created++;
        }
      } catch (error) {
        results.errors.push({ row: key, error: error.message });
        results.failed++;
      }
    }

    return results;
  }

  /**
   * Get product import template
   */
  getProductImportTemplate() {
    const fields = [
      'name', 'description', 'category', 'brand', 'hsnCode', 'gstRate',
      'tags', 'variantName', 'sku', 'basePrice', 'salePrice',
      'stockQuantity', 'lowStockThreshold',
    ];

    const parser = new Parser({ fields });
    return parser.parse([{
      name: 'Example Product',
      description: 'Product description here',
      category: 'Electronics',
      brand: 'BrandName',
      hsnCode: '85171100',
      gstRate: '18',
      tags: 'tag1, tag2, tag3',
      variantName: 'Default',
      sku: 'SKU-001',
      basePrice: '1000',
      salePrice: '900',
      stockQuantity: '100',
      lowStockThreshold: '10',
    }]);
  }

  // ===========================================================================
  // ORDER EXPORT
  // ===========================================================================

  /**
   * Export orders to CSV
   */
  async exportOrdersToCSV(businessId, filters = {}) {
    const { startDate, endDate, status } = filters;

    const where = {
      OR: [{ buyerId: businessId }, { sellerId: businessId }],
    };

    if (startDate) where.createdAt = { gte: new Date(startDate) };
    if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };
    if (status) where.status = status;

    const orders = await prisma.order.findMany({
      where,
      include: {
        buyer: { select: { businessName: true } },
        seller: { select: { businessName: true } },
        items: {
          include: {
            product: { select: { name: true } },
            variant: { select: { variantName: true, sku: true } },
          },
        },
        shippingAddress: true,
      },
      orderBy: { createdAt: 'desc' },
    });

    const flattenedOrders = orders.flatMap((order) =>
      order.items.map((item) => ({
        orderNumber: order.orderNumber,
        orderDate: order.createdAt.toISOString(),
        status: order.status,
        paymentStatus: order.paymentStatus,
        buyer: order.buyer.businessName,
        seller: order.seller.businessName,
        productName: item.product.name,
        variant: item.variant.variantName,
        sku: item.variant.sku,
        quantity: item.quantity,
        unitPrice: item.unitPrice,
        totalPrice: item.totalPrice,
        subtotal: order.subtotal,
        tax: order.tax,
        shipping: order.shipping,
        discount: order.discount,
        totalAmount: order.totalAmount,
        shippingCity: order.shippingAddress?.city,
        shippingState: order.shippingAddress?.state,
      }))
    );

    const fields = [
      'orderNumber', 'orderDate', 'status', 'paymentStatus',
      'buyer', 'seller', 'productName', 'variant', 'sku',
      'quantity', 'unitPrice', 'totalPrice', 'subtotal',
      'tax', 'shipping', 'discount', 'totalAmount',
      'shippingCity', 'shippingState',
    ];

    const parser = new Parser({ fields });
    return parser.parse(flattenedOrders);
  }

  // ===========================================================================
  // INVENTORY IMPORT/EXPORT
  // ===========================================================================

  /**
   * Export inventory to CSV
   */
  async exportInventoryToCSV(businessId) {
    const variants = await prisma.productVariant.findMany({
      where: {
        product: { businessId },
        isActive: true,
      },
      include: {
        product: { select: { name: true } },
      },
    });

    const data = variants.map((v) => ({
      sku: v.sku,
      productName: v.product.name,
      variantName: v.variantName,
      currentStock: v.stockQuantity,
      lowStockThreshold: v.lowStockThreshold,
      reservedStock: v.reservedQuantity || 0,
      availableStock: v.stockQuantity - (v.reservedQuantity || 0),
    }));

    const parser = new Parser({
      fields: ['sku', 'productName', 'variantName', 'currentStock', 'lowStockThreshold', 'reservedStock', 'availableStock'],
    });
    return parser.parse(data);
  }

  /**
   * Bulk update inventory from CSV
   */
  async updateInventoryFromCSV(businessId, fileBuffer) {
    const results = { total: 0, updated: 0, failed: 0, errors: [] };
    const rows = await this.parseCSV(fileBuffer);
    results.total = rows.length;

    for (const row of rows) {
      try {
        const variant = await prisma.productVariant.findFirst({
          where: {
            sku: row.sku,
            product: { businessId },
          },
        });

        if (!variant) {
          results.errors.push({ sku: row.sku, error: 'SKU not found' });
          results.failed++;
          continue;
        }

        await prisma.productVariant.update({
          where: { id: variant.id },
          data: {
            stockQuantity: parseInt(row.currentStock || row.stockQuantity),
            lowStockThreshold: parseInt(row.lowStockThreshold) || variant.lowStockThreshold,
          },
        });

        results.updated++;
      } catch (error) {
        results.errors.push({ sku: row.sku, error: error.message });
        results.failed++;
      }
    }

    return results;
  }

  // ===========================================================================
  // CUSTOMER/BUSINESS EXPORT
  // ===========================================================================

  /**
   * Export customers (for sellers)
   */
  async exportCustomersToCSV(businessId) {
    // Get unique buyers from orders
    const orders = await prisma.order.findMany({
      where: { sellerId: businessId },
      include: {
        buyer: {
          include: {
            owner: { select: { email: true, phone: true } },
          },
        },
      },
      distinct: ['buyerId'],
    });

    const customers = orders.map((order) => ({
      businessName: order.buyer.businessName,
      email: order.buyer.owner.email,
      phone: order.buyer.phone || order.buyer.owner.phone,
      city: order.buyer.city,
      state: order.buyer.state,
      gstin: order.buyer.gstin,
      firstOrderDate: order.createdAt.toISOString(),
    }));

    const parser = new Parser({
      fields: ['businessName', 'email', 'phone', 'city', 'state', 'gstin', 'firstOrderDate'],
    });
    return parser.parse(customers);
  }

  // ===========================================================================
  // EXCEL EXPORT
  // ===========================================================================

  /**
   * Export to Excel with multiple sheets
   */
  async exportToExcel(businessId, includeSheets = ['products', 'orders', 'inventory']) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Airavat B2B Marketplace';
    workbook.created = new Date();

    if (includeSheets.includes('products')) {
      const productsSheet = workbook.addWorksheet('Products');
      const products = await this.getProductsForExcel(businessId);
      productsSheet.columns = [
        { header: 'Name', key: 'name', width: 30 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Brand', key: 'brand', width: 15 },
        { header: 'SKU', key: 'sku', width: 15 },
        { header: 'Price', key: 'price', width: 12 },
        { header: 'Stock', key: 'stock', width: 10 },
        { header: 'Status', key: 'status', width: 10 },
      ];
      productsSheet.addRows(products);
    }

    if (includeSheets.includes('orders')) {
      const ordersSheet = workbook.addWorksheet('Orders');
      const orders = await this.getOrdersForExcel(businessId);
      ordersSheet.columns = [
        { header: 'Order #', key: 'orderNumber', width: 15 },
        { header: 'Date', key: 'date', width: 15 },
        { header: 'Customer', key: 'customer', width: 25 },
        { header: 'Amount', key: 'amount', width: 12 },
        { header: 'Status', key: 'status', width: 12 },
      ];
      ordersSheet.addRows(orders);
    }

    if (includeSheets.includes('inventory')) {
      const inventorySheet = workbook.addWorksheet('Inventory');
      const inventory = await this.getInventoryForExcel(businessId);
      inventorySheet.columns = [
        { header: 'SKU', key: 'sku', width: 15 },
        { header: 'Product', key: 'product', width: 30 },
        { header: 'Variant', key: 'variant', width: 15 },
        { header: 'Stock', key: 'stock', width: 10 },
        { header: 'Low Stock Alert', key: 'lowStock', width: 15 },
      ];
      inventorySheet.addRows(inventory);
    }

    // Style headers
    workbook.worksheets.forEach((sheet) => {
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };
    });

    return workbook.xlsx.writeBuffer();
  }

  // ===========================================================================
  // HELPER METHODS
  // ===========================================================================

  /**
   * Parse CSV buffer
   */
  async parseCSV(buffer) {
    return new Promise((resolve, reject) => {
      const results = [];
      const stream = Readable.from(buffer.toString());

      stream
        .pipe(csv())
        .on('data', (data) => results.push(data))
        .on('end', () => resolve(results))
        .on('error', reject);
    });
  }

  async getProductsForExcel(businessId) {
    const products = await prisma.product.findMany({
      where: { businessId },
      include: {
        category: { select: { name: true } },
        variants: { where: { isDefault: true }, take: 1 },
      },
    });

    return products.map((p) => ({
      name: p.name,
      category: p.category.name,
      brand: p.brand,
      sku: p.variants[0]?.sku,
      price: p.variants[0]?.basePrice,
      stock: p.variants[0]?.stockQuantity,
      status: p.status,
    }));
  }

  async getOrdersForExcel(businessId) {
    const orders = await prisma.order.findMany({
      where: { OR: [{ buyerId: businessId }, { sellerId: businessId }] },
      include: { buyer: { select: { businessName: true } } },
      orderBy: { createdAt: 'desc' },
      take: 1000,
    });

    return orders.map((o) => ({
      orderNumber: o.orderNumber,
      date: o.createdAt.toISOString().split('T')[0],
      customer: o.buyer.businessName,
      amount: o.totalAmount,
      status: o.status,
    }));
  }

  async getInventoryForExcel(businessId) {
    const variants = await prisma.productVariant.findMany({
      where: { product: { businessId }, isActive: true },
      include: { product: { select: { name: true } } },
    });

    return variants.map((v) => ({
      sku: v.sku,
      product: v.product.name,
      variant: v.variantName,
      stock: v.stockQuantity,
      lowStock: v.lowStockThreshold,
    }));
  }
}

module.exports = new BulkService();
