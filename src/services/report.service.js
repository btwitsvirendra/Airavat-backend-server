// =============================================================================
// AIRAVAT B2B MARKETPLACE - REPORT GENERATION SERVICE
// Generate PDF and Excel reports for analytics, invoices, statements
// =============================================================================

const PDFDocument = require('pdfkit');
const ExcelJS = require('exceljs');
const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { formatCurrency, formatDate } = require('../utils/helpers');

class ReportService {
  // ===========================================================================
  // SALES REPORTS
  // ===========================================================================

  /**
   * Generate sales report PDF
   */
  async generateSalesReportPDF(businessId, startDate, endDate) {
    const doc = new PDFDocument({ margin: 50 });
    const buffers = [];

    doc.on('data', buffers.push.bind(buffers));

    // Get business info
    const business = await prisma.business.findUnique({
      where: { id: businessId },
    });

    // Get sales data
    const orders = await prisma.order.findMany({
      where: {
        sellerId: businessId,
        createdAt: { gte: new Date(startDate), lte: new Date(endDate) },
        status: { in: ['DELIVERED', 'SHIPPED', 'CONFIRMED'] },
      },
      include: {
        buyer: { select: { businessName: true } },
        items: { include: { product: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Calculate totals
    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const totalOrders = orders.length;
    const totalItems = orders.reduce((sum, o) => sum + o.items.length, 0);

    // Header
    doc.fontSize(20).text('Sales Report', { align: 'center' });
    doc.moveDown();
    doc.fontSize(12).text(business.businessName, { align: 'center' });
    doc.fontSize(10).text(`Period: ${formatDate(startDate)} - ${formatDate(endDate)}`, { align: 'center' });
    doc.moveDown(2);

    // Summary box
    doc.rect(50, doc.y, 500, 80).stroke();
    const summaryY = doc.y + 10;
    doc.fontSize(10);
    doc.text(`Total Orders: ${totalOrders}`, 60, summaryY);
    doc.text(`Total Items Sold: ${totalItems}`, 60, summaryY + 20);
    doc.text(`Total Revenue: ${formatCurrency(totalRevenue)}`, 60, summaryY + 40);
    doc.text(`Average Order Value: ${formatCurrency(totalRevenue / totalOrders || 0)}`, 300, summaryY);
    doc.moveDown(5);

    // Orders table
    doc.fontSize(14).text('Order Details', 50, doc.y + 20);
    doc.moveDown();

    // Table header
    const tableTop = doc.y;
    doc.fontSize(9).font('Helvetica-Bold');
    doc.text('Order #', 50, tableTop);
    doc.text('Date', 130, tableTop);
    doc.text('Customer', 200, tableTop);
    doc.text('Items', 350, tableTop);
    doc.text('Amount', 400, tableTop);
    doc.text('Status', 470, tableTop);

    doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

    // Table rows
    doc.font('Helvetica').fontSize(8);
    let y = tableTop + 25;

    for (const order of orders.slice(0, 30)) { // Limit to 30 rows per page
      if (y > 700) {
        doc.addPage();
        y = 50;
      }

      doc.text(order.orderNumber, 50, y);
      doc.text(formatDate(order.createdAt), 130, y);
      doc.text(order.buyer.businessName.substring(0, 20), 200, y);
      doc.text(order.items.length.toString(), 350, y);
      doc.text(formatCurrency(order.totalAmount), 400, y);
      doc.text(order.status, 470, y);
      y += 18;
    }

    // Footer
    doc.fontSize(8).text(
      `Generated on ${new Date().toISOString()}`,
      50,
      750,
      { align: 'center' }
    );

    doc.end();

    return new Promise((resolve) => {
      doc.on('end', () => {
        resolve(Buffer.concat(buffers));
      });
    });
  }

  /**
   * Generate sales report Excel
   */
  async generateSalesReportExcel(businessId, startDate, endDate) {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'Airavat B2B';
    workbook.created = new Date();

    // Summary sheet
    const summarySheet = workbook.addWorksheet('Summary');
    
    const orders = await prisma.order.findMany({
      where: {
        sellerId: businessId,
        createdAt: { gte: new Date(startDate), lte: new Date(endDate) },
      },
      include: {
        buyer: { select: { businessName: true } },
        items: { include: { product: true, variant: true } },
      },
    });

    const totalRevenue = orders.reduce((sum, o) => sum + Number(o.totalAmount), 0);
    const deliveredOrders = orders.filter(o => o.status === 'DELIVERED');
    const pendingOrders = orders.filter(o => ['PENDING', 'CONFIRMED'].includes(o.status));

    summarySheet.columns = [
      { header: 'Metric', key: 'metric', width: 30 },
      { header: 'Value', key: 'value', width: 20 },
    ];

    summarySheet.addRows([
      { metric: 'Report Period', value: `${startDate} to ${endDate}` },
      { metric: 'Total Orders', value: orders.length },
      { metric: 'Delivered Orders', value: deliveredOrders.length },
      { metric: 'Pending Orders', value: pendingOrders.length },
      { metric: 'Total Revenue', value: totalRevenue },
      { metric: 'Average Order Value', value: totalRevenue / orders.length || 0 },
    ]);

    // Orders sheet
    const ordersSheet = workbook.addWorksheet('Orders');
    ordersSheet.columns = [
      { header: 'Order #', key: 'orderNumber', width: 15 },
      { header: 'Date', key: 'date', width: 12 },
      { header: 'Customer', key: 'customer', width: 25 },
      { header: 'Items', key: 'items', width: 8 },
      { header: 'Subtotal', key: 'subtotal', width: 12 },
      { header: 'Tax', key: 'tax', width: 10 },
      { header: 'Shipping', key: 'shipping', width: 10 },
      { header: 'Total', key: 'total', width: 12 },
      { header: 'Status', key: 'status', width: 12 },
      { header: 'Payment', key: 'payment', width: 12 },
    ];

    orders.forEach(order => {
      ordersSheet.addRow({
        orderNumber: order.orderNumber,
        date: order.createdAt.toISOString().split('T')[0],
        customer: order.buyer.businessName,
        items: order.items.length,
        subtotal: Number(order.subtotal),
        tax: Number(order.tax),
        shipping: Number(order.shipping),
        total: Number(order.totalAmount),
        status: order.status,
        payment: order.paymentStatus,
      });
    });

    // Items sheet
    const itemsSheet = workbook.addWorksheet('Line Items');
    itemsSheet.columns = [
      { header: 'Order #', key: 'orderNumber', width: 15 },
      { header: 'Product', key: 'product', width: 30 },
      { header: 'SKU', key: 'sku', width: 15 },
      { header: 'Quantity', key: 'quantity', width: 10 },
      { header: 'Unit Price', key: 'unitPrice', width: 12 },
      { header: 'Total', key: 'total', width: 12 },
    ];

    orders.forEach(order => {
      order.items.forEach(item => {
        itemsSheet.addRow({
          orderNumber: order.orderNumber,
          product: item.product.name,
          sku: item.variant?.sku || '-',
          quantity: item.quantity,
          unitPrice: Number(item.unitPrice),
          total: Number(item.totalPrice),
        });
      });
    });

    // Style headers
    workbook.worksheets.forEach(sheet => {
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF4472C4' },
      };
      sheet.getRow(1).font = { color: { argb: 'FFFFFFFF' }, bold: true };
    });

    return workbook.xlsx.writeBuffer();
  }

  // ===========================================================================
  // INVENTORY REPORTS
  // ===========================================================================

  /**
   * Generate inventory report
   */
  async generateInventoryReport(businessId, format = 'excel') {
    const variants = await prisma.productVariant.findMany({
      where: {
        product: { businessId, status: 'ACTIVE' },
        isActive: true,
      },
      include: {
        product: {
          include: { category: true },
        },
      },
      orderBy: { stockQuantity: 'asc' },
    });

    const lowStock = variants.filter(v => v.stockQuantity <= v.lowStockThreshold);
    const outOfStock = variants.filter(v => v.stockQuantity === 0);
    const totalValue = variants.reduce(
      (sum, v) => sum + (v.stockQuantity * Number(v.basePrice)),
      0
    );

    if (format === 'excel') {
      const workbook = new ExcelJS.Workbook();

      // Summary
      const summary = workbook.addWorksheet('Summary');
      summary.addRows([
        ['Inventory Report', ''],
        ['Generated', new Date().toISOString()],
        ['', ''],
        ['Total SKUs', variants.length],
        ['Low Stock Items', lowStock.length],
        ['Out of Stock Items', outOfStock.length],
        ['Total Inventory Value', totalValue],
      ]);

      // All items
      const allItems = workbook.addWorksheet('All Items');
      allItems.columns = [
        { header: 'SKU', key: 'sku', width: 15 },
        { header: 'Product', key: 'product', width: 30 },
        { header: 'Variant', key: 'variant', width: 15 },
        { header: 'Category', key: 'category', width: 20 },
        { header: 'Stock', key: 'stock', width: 10 },
        { header: 'Reserved', key: 'reserved', width: 10 },
        { header: 'Available', key: 'available', width: 10 },
        { header: 'Threshold', key: 'threshold', width: 10 },
        { header: 'Unit Price', key: 'price', width: 12 },
        { header: 'Stock Value', key: 'value', width: 12 },
        { header: 'Status', key: 'status', width: 12 },
      ];

      variants.forEach(v => {
        const status = v.stockQuantity === 0 ? 'OUT OF STOCK' :
          v.stockQuantity <= v.lowStockThreshold ? 'LOW STOCK' : 'OK';
        
        allItems.addRow({
          sku: v.sku,
          product: v.product.name,
          variant: v.variantName,
          category: v.product.category.name,
          stock: v.stockQuantity,
          reserved: v.reservedQuantity || 0,
          available: v.stockQuantity - (v.reservedQuantity || 0),
          threshold: v.lowStockThreshold,
          price: Number(v.basePrice),
          value: v.stockQuantity * Number(v.basePrice),
          status,
        });
      });

      // Low stock sheet
      const lowStockSheet = workbook.addWorksheet('Low Stock Alert');
      lowStockSheet.columns = allItems.columns;
      lowStock.forEach(v => {
        lowStockSheet.addRow({
          sku: v.sku,
          product: v.product.name,
          variant: v.variantName,
          category: v.product.category.name,
          stock: v.stockQuantity,
          reserved: v.reservedQuantity || 0,
          available: v.stockQuantity - (v.reservedQuantity || 0),
          threshold: v.lowStockThreshold,
          price: Number(v.basePrice),
          value: v.stockQuantity * Number(v.basePrice),
          status: v.stockQuantity === 0 ? 'OUT OF STOCK' : 'LOW STOCK',
        });
      });

      // Style
      workbook.worksheets.forEach(sheet => {
        if (sheet.getRow(1).getCell(1).value && sheet.columns) {
          sheet.getRow(1).font = { bold: true };
        }
      });

      return workbook.xlsx.writeBuffer();
    }

    return { variants, lowStock, outOfStock, totalValue };
  }

  // ===========================================================================
  // FINANCIAL REPORTS
  // ===========================================================================

  /**
   * Generate GST report for India
   */
  async generateGSTReport(businessId, month, year) {
    const startDate = new Date(year, month - 1, 1);
    const endDate = new Date(year, month, 0, 23, 59, 59);

    const invoices = await prisma.invoice.findMany({
      where: {
        businessId,
        createdAt: { gte: startDate, lte: endDate },
        status: { not: 'CANCELLED' },
      },
      include: {
        order: {
          include: {
            buyer: { select: { businessName: true, gstin: true, state: true } },
          },
        },
        items: true,
      },
    });

    // Group by GST rate
    const gstBreakdown = {};
    let totalTaxableValue = 0;
    let totalCGST = 0;
    let totalSGST = 0;
    let totalIGST = 0;

    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { state: true },
    });

    invoices.forEach(invoice => {
      const isInterState = invoice.order.buyer.state !== business.state;

      invoice.items.forEach(item => {
        const gstRate = item.gstRate || 18;
        if (!gstBreakdown[gstRate]) {
          gstBreakdown[gstRate] = { taxableValue: 0, cgst: 0, sgst: 0, igst: 0 };
        }

        const taxableValue = Number(item.totalPrice) / (1 + gstRate / 100);
        const taxAmount = Number(item.totalPrice) - taxableValue;

        gstBreakdown[gstRate].taxableValue += taxableValue;
        totalTaxableValue += taxableValue;

        if (isInterState) {
          gstBreakdown[gstRate].igst += taxAmount;
          totalIGST += taxAmount;
        } else {
          gstBreakdown[gstRate].cgst += taxAmount / 2;
          gstBreakdown[gstRate].sgst += taxAmount / 2;
          totalCGST += taxAmount / 2;
          totalSGST += taxAmount / 2;
        }
      });
    });

    const workbook = new ExcelJS.Workbook();

    // GSTR-1 Summary
    const gstr1 = workbook.addWorksheet('GSTR-1 Summary');
    gstr1.columns = [
      { header: 'GST Rate', key: 'rate', width: 12 },
      { header: 'Taxable Value', key: 'taxable', width: 15 },
      { header: 'CGST', key: 'cgst', width: 12 },
      { header: 'SGST', key: 'sgst', width: 12 },
      { header: 'IGST', key: 'igst', width: 12 },
      { header: 'Total Tax', key: 'total', width: 12 },
    ];

    Object.entries(gstBreakdown).forEach(([rate, data]) => {
      gstr1.addRow({
        rate: `${rate}%`,
        taxable: data.taxableValue.toFixed(2),
        cgst: data.cgst.toFixed(2),
        sgst: data.sgst.toFixed(2),
        igst: data.igst.toFixed(2),
        total: (data.cgst + data.sgst + data.igst).toFixed(2),
      });
    });

    gstr1.addRow({
      rate: 'TOTAL',
      taxable: totalTaxableValue.toFixed(2),
      cgst: totalCGST.toFixed(2),
      sgst: totalSGST.toFixed(2),
      igst: totalIGST.toFixed(2),
      total: (totalCGST + totalSGST + totalIGST).toFixed(2),
    });

    // B2B Invoices
    const b2b = workbook.addWorksheet('B2B Invoices');
    b2b.columns = [
      { header: 'GSTIN', key: 'gstin', width: 18 },
      { header: 'Receiver Name', key: 'name', width: 25 },
      { header: 'Invoice No', key: 'invoice', width: 15 },
      { header: 'Invoice Date', key: 'date', width: 12 },
      { header: 'Invoice Value', key: 'value', width: 12 },
      { header: 'Place of Supply', key: 'pos', width: 15 },
      { header: 'Rate', key: 'rate', width: 8 },
      { header: 'Taxable Value', key: 'taxable', width: 12 },
      { header: 'IGST', key: 'igst', width: 10 },
      { header: 'CGST', key: 'cgst', width: 10 },
      { header: 'SGST', key: 'sgst', width: 10 },
    ];

    invoices.forEach(invoice => {
      if (invoice.order.buyer.gstin) {
        b2b.addRow({
          gstin: invoice.order.buyer.gstin,
          name: invoice.order.buyer.businessName,
          invoice: invoice.invoiceNumber,
          date: invoice.createdAt.toISOString().split('T')[0],
          value: Number(invoice.totalAmount),
          pos: invoice.order.buyer.state,
          rate: '18%',
          taxable: Number(invoice.subtotal),
          igst: invoice.order.buyer.state !== business.state ? Number(invoice.taxAmount) : 0,
          cgst: invoice.order.buyer.state === business.state ? Number(invoice.taxAmount) / 2 : 0,
          sgst: invoice.order.buyer.state === business.state ? Number(invoice.taxAmount) / 2 : 0,
        });
      }
    });

    return workbook.xlsx.writeBuffer();
  }

  /**
   * Generate profit & loss statement
   */
  async generateProfitLossReport(businessId, startDate, endDate) {
    const [sales, refunds, commissions] = await Promise.all([
      prisma.order.aggregate({
        where: {
          sellerId: businessId,
          status: 'DELIVERED',
          createdAt: { gte: new Date(startDate), lte: new Date(endDate) },
        },
        _sum: { totalAmount: true, tax: true, shipping: true },
      }),
      prisma.payment.aggregate({
        where: {
          order: { sellerId: businessId },
          type: 'REFUND',
          createdAt: { gte: new Date(startDate), lte: new Date(endDate) },
        },
        _sum: { amount: true },
      }),
      prisma.transaction.aggregate({
        where: {
          businessId,
          type: 'COMMISSION',
          createdAt: { gte: new Date(startDate), lte: new Date(endDate) },
        },
        _sum: { amount: true },
      }),
    ]);

    const grossSales = Number(sales._sum.totalAmount) || 0;
    const totalRefunds = Number(refunds._sum.amount) || 0;
    const totalCommission = Number(commissions._sum.amount) || 0;
    const netSales = grossSales - totalRefunds;
    const netProfit = netSales - totalCommission;

    return {
      period: { startDate, endDate },
      revenue: {
        grossSales,
        refunds: totalRefunds,
        netSales,
      },
      expenses: {
        platformCommission: totalCommission,
        shipping: Number(sales._sum.shipping) || 0,
      },
      profit: {
        grossProfit: netSales,
        netProfit,
        profitMargin: netSales > 0 ? ((netProfit / netSales) * 100).toFixed(2) : 0,
      },
    };
  }

  // ===========================================================================
  // CUSTOMER REPORTS
  // ===========================================================================

  /**
   * Generate customer analysis report
   */
  async generateCustomerReport(businessId) {
    const orders = await prisma.order.findMany({
      where: { sellerId: businessId },
      include: {
        buyer: { select: { id: true, businessName: true, city: true, state: true } },
      },
    });

    // Group by customer
    const customerStats = {};
    orders.forEach(order => {
      const customerId = order.buyer.id;
      if (!customerStats[customerId]) {
        customerStats[customerId] = {
          name: order.buyer.businessName,
          city: order.buyer.city,
          state: order.buyer.state,
          orderCount: 0,
          totalSpent: 0,
          firstOrder: order.createdAt,
          lastOrder: order.createdAt,
        };
      }
      customerStats[customerId].orderCount++;
      customerStats[customerId].totalSpent += Number(order.totalAmount);
      if (order.createdAt < customerStats[customerId].firstOrder) {
        customerStats[customerId].firstOrder = order.createdAt;
      }
      if (order.createdAt > customerStats[customerId].lastOrder) {
        customerStats[customerId].lastOrder = order.createdAt;
      }
    });

    // Convert to array and sort by total spent
    const customers = Object.entries(customerStats)
      .map(([id, stats]) => ({ id, ...stats }))
      .sort((a, b) => b.totalSpent - a.totalSpent);

    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet('Customer Analysis');

    sheet.columns = [
      { header: 'Customer', key: 'name', width: 30 },
      { header: 'City', key: 'city', width: 15 },
      { header: 'State', key: 'state', width: 15 },
      { header: 'Orders', key: 'orders', width: 10 },
      { header: 'Total Spent', key: 'spent', width: 15 },
      { header: 'Avg Order', key: 'avg', width: 12 },
      { header: 'First Order', key: 'first', width: 12 },
      { header: 'Last Order', key: 'last', width: 12 },
    ];

    customers.forEach(c => {
      sheet.addRow({
        name: c.name,
        city: c.city,
        state: c.state,
        orders: c.orderCount,
        spent: c.totalSpent,
        avg: (c.totalSpent / c.orderCount).toFixed(2),
        first: c.firstOrder.toISOString().split('T')[0],
        last: c.lastOrder.toISOString().split('T')[0],
      });
    });

    sheet.getRow(1).font = { bold: true };

    return workbook.xlsx.writeBuffer();
  }
}

module.exports = new ReportService();
