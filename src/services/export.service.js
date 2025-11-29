// =============================================================================
// AIRAVAT B2B MARKETPLACE - EXPORT SERVICE
// Generate exports in various formats (CSV, Excel, PDF)
// =============================================================================

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { createObjectCsvWriter } = require('csv-writer');
const fs = require('fs').promises;
const path = require('path');
const logger = require('../config/logger');

class ExportService {
  constructor() {
    this.exportDir = process.env.EXPORT_DIR || './exports';
    this.initDirectory();
  }

  async initDirectory() {
    try {
      await fs.mkdir(this.exportDir, { recursive: true });
    } catch (error) {
      // Directory exists
    }
  }

  /**
   * Generate unique export filename
   */
  generateFilename(prefix, extension) {
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    return `${prefix}-${timestamp}.${extension}`;
  }

  /**
   * Export data to CSV
   */
  async exportToCSV(data, columns, options = {}) {
    const filename = this.generateFilename(options.prefix || 'export', 'csv');
    const filepath = path.join(this.exportDir, filename);

    const csvWriter = createObjectCsvWriter({
      path: filepath,
      header: columns.map((col) => ({
        id: col.key || col.id,
        title: col.title || col.header || col.key,
      })),
    });

    await csvWriter.writeRecords(data);

    logger.info('CSV export generated', { filename, records: data.length });

    return {
      filename,
      filepath,
      records: data.length,
      format: 'csv',
    };
  }

  /**
   * Export data to Excel
   */
  async exportToExcel(data, columns, options = {}) {
    const filename = this.generateFilename(options.prefix || 'export', 'xlsx');
    const filepath = path.join(this.exportDir, filename);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Airavat B2B Marketplace';
    workbook.created = new Date();

    const worksheet = workbook.addWorksheet(options.sheetName || 'Data');

    // Add columns
    worksheet.columns = columns.map((col) => ({
      header: col.title || col.header || col.key,
      key: col.key || col.id,
      width: col.width || 15,
    }));

    // Style header row
    worksheet.getRow(1).font = { bold: true };
    worksheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };

    // Add data rows
    data.forEach((row) => {
      worksheet.addRow(row);
    });

    // Auto-fit columns (approximate)
    worksheet.columns.forEach((column) => {
      let maxLength = column.header?.length || 10;
      column.eachCell?.({ includeEmpty: true }, (cell) => {
        const cellLength = cell.value?.toString().length || 0;
        maxLength = Math.max(maxLength, cellLength);
      });
      column.width = Math.min(maxLength + 2, 50);
    });

    await workbook.xlsx.writeFile(filepath);

    logger.info('Excel export generated', { filename, records: data.length });

    return {
      filename,
      filepath,
      records: data.length,
      format: 'xlsx',
    };
  }

  /**
   * Export data to PDF
   */
  async exportToPDF(data, columns, options = {}) {
    const filename = this.generateFilename(options.prefix || 'export', 'pdf');
    const filepath = path.join(this.exportDir, filename);

    return new Promise((resolve, reject) => {
      const doc = new PDFDocument({
        size: options.pageSize || 'A4',
        layout: options.layout || 'landscape',
        margin: 30,
      });

      const stream = require('fs').createWriteStream(filepath);
      doc.pipe(stream);

      // Title
      doc.fontSize(20).text(options.title || 'Export Report', { align: 'center' });
      doc.moveDown();

      // Subtitle with date
      doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'center' });
      doc.moveDown(2);

      // Table
      const tableTop = doc.y;
      const columnWidth = (doc.page.width - 60) / columns.length;
      let currentY = tableTop;

      // Header row
      doc.fontSize(10).font('Helvetica-Bold');
      columns.forEach((col, i) => {
        doc.text(
          col.title || col.header || col.key,
          30 + i * columnWidth,
          currentY,
          { width: columnWidth, align: 'left' }
        );
      });

      // Header line
      currentY += 20;
      doc.moveTo(30, currentY).lineTo(doc.page.width - 30, currentY).stroke();
      currentY += 5;

      // Data rows
      doc.font('Helvetica').fontSize(9);
      data.forEach((row, rowIndex) => {
        if (currentY > doc.page.height - 50) {
          doc.addPage();
          currentY = 30;
        }

        columns.forEach((col, colIndex) => {
          const value = row[col.key || col.id] ?? '';
          doc.text(
            String(value).substring(0, 30),
            30 + colIndex * columnWidth,
            currentY,
            { width: columnWidth, align: 'left' }
          );
        });

        currentY += 15;
      });

      // Footer
      doc.fontSize(8).text(
        `Total Records: ${data.length}`,
        30,
        doc.page.height - 30,
        { align: 'center' }
      );

      doc.end();

      stream.on('finish', () => {
        logger.info('PDF export generated', { filename, records: data.length });
        resolve({
          filename,
          filepath,
          records: data.length,
          format: 'pdf',
        });
      });

      stream.on('error', reject);
    });
  }

  /**
   * Export with multiple sheets (Excel only)
   */
  async exportMultiSheet(sheets, options = {}) {
    const filename = this.generateFilename(options.prefix || 'export', 'xlsx');
    const filepath = path.join(this.exportDir, filename);

    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Airavat B2B Marketplace';
    workbook.created = new Date();

    for (const sheet of sheets) {
      const worksheet = workbook.addWorksheet(sheet.name);

      worksheet.columns = sheet.columns.map((col) => ({
        header: col.title || col.header || col.key,
        key: col.key || col.id,
        width: col.width || 15,
      }));

      worksheet.getRow(1).font = { bold: true };
      worksheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FFE0E0E0' },
      };

      sheet.data.forEach((row) => {
        worksheet.addRow(row);
      });
    }

    await workbook.xlsx.writeFile(filepath);

    logger.info('Multi-sheet Excel export generated', {
      filename,
      sheets: sheets.length,
    });

    return {
      filename,
      filepath,
      sheets: sheets.map((s) => ({ name: s.name, records: s.data.length })),
      format: 'xlsx',
    };
  }

  // ===========================================================================
  // SPECIFIC REPORT GENERATORS
  // ===========================================================================

  /**
   * Generate orders report
   */
  async generateOrdersReport(orders, options = {}) {
    const columns = [
      { key: 'orderNumber', title: 'Order Number', width: 15 },
      { key: 'createdAt', title: 'Date', width: 12 },
      { key: 'buyerName', title: 'Buyer', width: 20 },
      { key: 'sellerName', title: 'Seller', width: 20 },
      { key: 'totalAmount', title: 'Amount', width: 12 },
      { key: 'status', title: 'Status', width: 12 },
      { key: 'paymentStatus', title: 'Payment', width: 12 },
    ];

    const data = orders.map((order) => ({
      orderNumber: order.orderNumber,
      createdAt: new Date(order.createdAt).toLocaleDateString(),
      buyerName: order.buyer?.businessName || order.buyer?.user?.name || 'N/A',
      sellerName: order.seller?.businessName || 'N/A',
      totalAmount: `${order.currency} ${order.totalAmount.toFixed(2)}`,
      status: order.status,
      paymentStatus: order.paymentStatus,
    }));

    return this.exportToExcel(data, columns, {
      prefix: 'orders-report',
      sheetName: 'Orders',
      ...options,
    });
  }

  /**
   * Generate products report
   */
  async generateProductsReport(products, options = {}) {
    const columns = [
      { key: 'sku', title: 'SKU', width: 15 },
      { key: 'name', title: 'Product Name', width: 30 },
      { key: 'category', title: 'Category', width: 20 },
      { key: 'price', title: 'Price', width: 12 },
      { key: 'stock', title: 'Stock', width: 10 },
      { key: 'status', title: 'Status', width: 10 },
      { key: 'seller', title: 'Seller', width: 20 },
    ];

    const data = products.map((product) => ({
      sku: product.variants?.[0]?.sku || 'N/A',
      name: product.name,
      category: product.category?.name || 'N/A',
      price: `${product.currency || 'INR'} ${product.variants?.[0]?.basePrice || 0}`,
      stock: product.variants?.[0]?.stockQuantity || 0,
      status: product.status,
      seller: product.business?.businessName || 'N/A',
    }));

    return this.exportToExcel(data, columns, {
      prefix: 'products-report',
      sheetName: 'Products',
      ...options,
    });
  }

  /**
   * Generate financial report
   */
  async generateFinancialReport(transactions, options = {}) {
    const columns = [
      { key: 'date', title: 'Date', width: 12 },
      { key: 'transactionId', title: 'Transaction ID', width: 20 },
      { key: 'type', title: 'Type', width: 12 },
      { key: 'description', title: 'Description', width: 30 },
      { key: 'amount', title: 'Amount', width: 15 },
      { key: 'status', title: 'Status', width: 12 },
    ];

    const data = transactions.map((tx) => ({
      date: new Date(tx.createdAt).toLocaleDateString(),
      transactionId: tx.id,
      type: tx.type,
      description: tx.description || tx.orderId || 'N/A',
      amount: `${tx.currency} ${tx.amount.toFixed(2)}`,
      status: tx.status,
    }));

    // Calculate totals
    const totals = transactions.reduce(
      (acc, tx) => {
        if (tx.type === 'CREDIT') acc.credits += tx.amount;
        else acc.debits += tx.amount;
        return acc;
      },
      { credits: 0, debits: 0 }
    );

    // Add summary row
    data.push({
      date: '',
      transactionId: '',
      type: 'TOTAL',
      description: `Credits: ${totals.credits.toFixed(2)} | Debits: ${totals.debits.toFixed(2)}`,
      amount: `Net: ${(totals.credits - totals.debits).toFixed(2)}`,
      status: '',
    });

    return this.exportToExcel(data, columns, {
      prefix: 'financial-report',
      sheetName: 'Transactions',
      ...options,
    });
  }

  /**
   * Generate inventory report
   */
  async generateInventoryReport(inventory, options = {}) {
    const columns = [
      { key: 'sku', title: 'SKU', width: 15 },
      { key: 'productName', title: 'Product', width: 30 },
      { key: 'variantName', title: 'Variant', width: 20 },
      { key: 'currentStock', title: 'Current Stock', width: 12 },
      { key: 'lowStockThreshold', title: 'Low Stock Alert', width: 15 },
      { key: 'status', title: 'Status', width: 12 },
      { key: 'warehouseLocation', title: 'Location', width: 15 },
    ];

    const data = inventory.map((item) => ({
      sku: item.sku,
      productName: item.product?.name || 'N/A',
      variantName: item.variantName || 'Default',
      currentStock: item.stockQuantity,
      lowStockThreshold: item.lowStockThreshold,
      status:
        item.stockQuantity === 0
          ? 'OUT OF STOCK'
          : item.stockQuantity <= item.lowStockThreshold
          ? 'LOW STOCK'
          : 'IN STOCK',
      warehouseLocation: item.warehouseLocation || 'N/A',
    }));

    return this.exportToExcel(data, columns, {
      prefix: 'inventory-report',
      sheetName: 'Inventory',
      ...options,
    });
  }

  /**
   * Cleanup old export files
   */
  async cleanupOldExports(maxAge = 7 * 24 * 60 * 60 * 1000) {
    try {
      const files = await fs.readdir(this.exportDir);
      const now = Date.now();
      let cleaned = 0;

      for (const file of files) {
        const filepath = path.join(this.exportDir, file);
        const stat = await fs.stat(filepath);

        if (now - stat.mtimeMs > maxAge) {
          await fs.unlink(filepath);
          cleaned++;
        }
      }

      logger.info(`Cleaned up ${cleaned} old export files`);
      return cleaned;
    } catch (error) {
      logger.error('Export cleanup failed', { error: error.message });
      return 0;
    }
  }
}

module.exports = new ExportService();
