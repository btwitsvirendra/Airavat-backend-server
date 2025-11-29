// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL DATA EXPORT SERVICE
// Service for exporting financial data in various formats
// =============================================================================

const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const { Parser } = require('json2csv');
const { prisma } = require('../config/database');
const logger = require('../config/logger');
const path = require('path');
const fs = require('fs').promises;

// =============================================================================
// CONFIGURATION
// =============================================================================

const EXPORT_CONFIG = {
  maxRows: 50000,
  tempDir: '/tmp/financial-exports',
  formats: ['xlsx', 'csv', 'pdf', 'json'],
  dateFormat: 'DD-MM-YYYY',
  currencySymbols: {
    INR: '₹',
    AED: 'د.إ',
    USD: '$',
    EUR: '€',
    GBP: '£',
  },
};

// =============================================================================
// EXCEL EXPORT
// =============================================================================

/**
 * Export wallet transactions to Excel
 */
exports.exportWalletTransactions = async (businessId, options = {}) => {
  const {
    startDate,
    endDate,
    type,
    status,
    format = 'xlsx',
  } = options;

  const where = {
    wallet: { businessId },
    createdAt: {
      gte: startDate ? new Date(startDate) : new Date(Date.now() - 90 * 24 * 60 * 60 * 1000),
      lte: endDate ? new Date(endDate) : new Date(),
    },
  };

  if (type) where.type = type;
  if (status) where.status = status;

  const transactions = await prisma.walletTransaction.findMany({
    where,
    include: {
      wallet: {
        include: {
          business: { select: { businessName: true } },
        },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: EXPORT_CONFIG.maxRows,
  });

  switch (format) {
    case 'xlsx':
      return await generateExcelTransactions(transactions, 'Wallet Transactions');
    case 'csv':
      return await generateCSVTransactions(transactions);
    case 'pdf':
      return await generatePDFTransactions(transactions, 'Wallet Transactions');
    case 'json':
      return { data: transactions, format: 'json' };
    default:
      throw new Error(`Unsupported format: ${format}`);
  }
};

/**
 * Export EMI data to Excel
 */
exports.exportEMIData = async (businessId, options = {}) => {
  const { startDate, endDate, status, format = 'xlsx' } = options;

  const where = businessId ? { user: { businessId } } : {};
  if (status) where.status = status;
  if (startDate || endDate) {
    where.createdAt = {};
    if (startDate) where.createdAt.gte = new Date(startDate);
    if (endDate) where.createdAt.lte = new Date(endDate);
  }

  const emiOrders = await prisma.eMIOrder.findMany({
    where,
    include: {
      user: { select: { name: true, email: true, phone: true } },
      emiPlan: { select: { name: true, bankName: true } },
      installments: {
        orderBy: { installmentNumber: 'asc' },
      },
    },
    orderBy: { createdAt: 'desc' },
    take: EXPORT_CONFIG.maxRows,
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Airavat B2B Marketplace';
  workbook.created = new Date();

  // EMI Orders Sheet
  const ordersSheet = workbook.addWorksheet('EMI Orders');
  ordersSheet.columns = [
    { header: 'Order ID', key: 'orderId', width: 15 },
    { header: 'Customer', key: 'customer', width: 25 },
    { header: 'Email', key: 'email', width: 25 },
    { header: 'Plan', key: 'plan', width: 20 },
    { header: 'Principal', key: 'principal', width: 15 },
    { header: 'Interest Rate', key: 'interestRate', width: 12 },
    { header: 'Tenure', key: 'tenure', width: 10 },
    { header: 'EMI Amount', key: 'emiAmount', width: 15 },
    { header: 'Total Amount', key: 'totalAmount', width: 15 },
    { header: 'Paid Amount', key: 'paidAmount', width: 15 },
    { header: 'Remaining', key: 'remaining', width: 15 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Created Date', key: 'createdAt', width: 15 },
  ];

  emiOrders.forEach(order => {
    ordersSheet.addRow({
      orderId: order.orderId,
      customer: order.user?.name,
      email: order.user?.email,
      plan: order.emiPlan?.name,
      principal: parseFloat(order.principalAmount),
      interestRate: `${order.interestRate}%`,
      tenure: `${order.tenureMonths} months`,
      emiAmount: parseFloat(order.emiAmount),
      totalAmount: parseFloat(order.totalAmount),
      paidAmount: parseFloat(order.paidAmount),
      remaining: parseFloat(order.remainingAmount),
      status: order.status,
      createdAt: order.createdAt,
    });
  });

  // Installments Sheet
  const installmentsSheet = workbook.addWorksheet('Installments');
  installmentsSheet.columns = [
    { header: 'EMI Order ID', key: 'emiOrderId', width: 15 },
    { header: 'Installment #', key: 'number', width: 12 },
    { header: 'Due Date', key: 'dueDate', width: 15 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Principal', key: 'principal', width: 15 },
    { header: 'Interest', key: 'interest', width: 15 },
    { header: 'Late Fee', key: 'lateFee', width: 12 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Paid Amount', key: 'paidAmount', width: 15 },
    { header: 'Paid Date', key: 'paidDate', width: 15 },
  ];

  emiOrders.forEach(order => {
    order.installments.forEach(inst => {
      installmentsSheet.addRow({
        emiOrderId: order.orderId,
        number: inst.installmentNumber,
        dueDate: inst.dueDate,
        amount: parseFloat(inst.amount),
        principal: parseFloat(inst.principalComponent),
        interest: parseFloat(inst.interestComponent),
        lateFee: parseFloat(inst.lateFee || 0),
        status: inst.status,
        paidAmount: inst.paidAmount ? parseFloat(inst.paidAmount) : null,
        paidDate: inst.paidDate,
      });
    });
  });

  // Style headers
  [ordersSheet, installmentsSheet].forEach(sheet => {
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };
  });

  return workbook;
};

/**
 * Export insurance data to Excel
 */
exports.exportInsuranceData = async (businessId, options = {}) => {
  const { format = 'xlsx' } = options;

  const where = businessId ? { businessId } : {};

  const [policies, claims] = await Promise.all([
    prisma.creditInsurancePolicy.findMany({
      where,
      include: {
        business: { select: { businessName: true } },
        insuredBuyers: true,
      },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.insuranceClaim.findMany({
      where: businessId ? { policy: { businessId } } : {},
      include: {
        policy: { select: { policyNumber: true } },
      },
      orderBy: { claimDate: 'desc' },
    }),
  ]);

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Airavat B2B Marketplace';

  // Policies Sheet
  const policiesSheet = workbook.addWorksheet('Policies');
  policiesSheet.columns = [
    { header: 'Policy Number', key: 'policyNumber', width: 18 },
    { header: 'Business', key: 'business', width: 25 },
    { header: 'Coverage Type', key: 'coverageType', width: 18 },
    { header: 'Coverage Limit', key: 'coverageLimit', width: 15 },
    { header: 'Used Coverage', key: 'usedCoverage', width: 15 },
    { header: 'Premium', key: 'premium', width: 12 },
    { header: 'Deductible %', key: 'deductible', width: 12 },
    { header: 'Start Date', key: 'startDate', width: 15 },
    { header: 'End Date', key: 'endDate', width: 15 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Insured Buyers', key: 'buyerCount', width: 12 },
  ];

  policies.forEach(policy => {
    policiesSheet.addRow({
      policyNumber: policy.policyNumber,
      business: policy.business?.businessName,
      coverageType: policy.coverageType,
      coverageLimit: parseFloat(policy.coverageLimit),
      usedCoverage: parseFloat(policy.usedCoverage),
      premium: parseFloat(policy.premiumAmount),
      deductible: `${policy.deductiblePercent}%`,
      startDate: policy.startDate,
      endDate: policy.endDate,
      status: policy.status,
      buyerCount: policy.insuredBuyers?.length || 0,
    });
  });

  // Claims Sheet
  const claimsSheet = workbook.addWorksheet('Claims');
  claimsSheet.columns = [
    { header: 'Claim Number', key: 'claimNumber', width: 18 },
    { header: 'Policy Number', key: 'policyNumber', width: 18 },
    { header: 'Invoice Number', key: 'invoiceNumber', width: 18 },
    { header: 'Invoice Amount', key: 'invoiceAmount', width: 15 },
    { header: 'Claim Amount', key: 'claimAmount', width: 15 },
    { header: 'Deductible', key: 'deductible', width: 12 },
    { header: 'Claim Date', key: 'claimDate', width: 15 },
    { header: 'Status', key: 'status', width: 15 },
    { header: 'Settlement', key: 'settlement', width: 15 },
    { header: 'Settled Date', key: 'settledAt', width: 15 },
  ];

  claims.forEach(claim => {
    claimsSheet.addRow({
      claimNumber: claim.claimNumber,
      policyNumber: claim.policy?.policyNumber,
      invoiceNumber: claim.invoiceNumber,
      invoiceAmount: parseFloat(claim.invoiceAmount),
      claimAmount: parseFloat(claim.claimAmount),
      deductible: parseFloat(claim.deductibleAmount),
      claimDate: claim.claimDate,
      status: claim.status,
      settlement: claim.settlementAmount ? parseFloat(claim.settlementAmount) : null,
      settledAt: claim.settledAt,
    });
  });

  // Style headers
  [policiesSheet, claimsSheet].forEach(sheet => {
    sheet.getRow(1).font = { bold: true };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FFE0E0E0' },
    };
  });

  return workbook;
};

/**
 * Export trade finance data
 */
exports.exportTradeFinanceData = async (businessId, options = {}) => {
  const where = businessId ? {
    OR: [
      { applicantId: businessId },
      { beneficiaryId: businessId },
    ],
  } : {};

  const lcs = await prisma.letterOfCredit.findMany({
    where,
    include: {
      applicant: { select: { businessName: true } },
      beneficiary: { select: { businessName: true } },
      amendments: true,
      presentations: true,
    },
    orderBy: { createdAt: 'desc' },
  });

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Airavat B2B Marketplace';

  // LCs Sheet
  const lcsSheet = workbook.addWorksheet('Letters of Credit');
  lcsSheet.columns = [
    { header: 'LC Number', key: 'lcNumber', width: 18 },
    { header: 'Type', key: 'type', width: 15 },
    { header: 'Applicant', key: 'applicant', width: 25 },
    { header: 'Beneficiary', key: 'beneficiary', width: 25 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Issuing Bank', key: 'issuingBank', width: 20 },
    { header: 'Payment Terms', key: 'paymentTerms', width: 15 },
    { header: 'Expiry Date', key: 'expiryDate', width: 15 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Issued Date', key: 'issuedAt', width: 15 },
    { header: 'Amendments', key: 'amendments', width: 12 },
    { header: 'Presentations', key: 'presentations', width: 12 },
  ];

  lcs.forEach(lc => {
    lcsSheet.addRow({
      lcNumber: lc.lcNumber,
      type: lc.type,
      applicant: lc.applicant?.businessName,
      beneficiary: lc.beneficiary?.businessName,
      amount: parseFloat(lc.amount),
      currency: lc.currency,
      issuingBank: lc.issuingBank,
      paymentTerms: lc.paymentTerms,
      expiryDate: lc.expiryDate,
      status: lc.status,
      issuedAt: lc.issuedAt,
      amendments: lc.amendments?.length || 0,
      presentations: lc.presentations?.length || 0,
    });
  });

  lcsSheet.getRow(1).font = { bold: true };
  lcsSheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FFE0E0E0' },
  };

  return workbook;
};

// =============================================================================
// CSV EXPORT
// =============================================================================

/**
 * Generate CSV from transactions
 */
async function generateCSVTransactions(transactions) {
  const fields = [
    { label: 'Date', value: 'createdAt' },
    { label: 'Type', value: 'type' },
    { label: 'Amount', value: 'amount' },
    { label: 'Currency', value: 'currency' },
    { label: 'Status', value: 'status' },
    { label: 'Reference', value: 'referenceId' },
    { label: 'Description', value: 'description' },
    { label: 'Balance Before', value: 'balanceBefore' },
    { label: 'Balance After', value: 'balanceAfter' },
  ];

  const parser = new Parser({ fields });
  const csv = parser.parse(transactions.map(t => ({
    createdAt: t.createdAt.toISOString(),
    type: t.type,
    amount: parseFloat(t.amount),
    currency: t.currency,
    status: t.status,
    referenceId: t.referenceId,
    description: t.description,
    balanceBefore: parseFloat(t.balanceBefore),
    balanceAfter: parseFloat(t.balanceAfter),
  })));

  return { data: csv, format: 'csv', mimeType: 'text/csv' };
}

// =============================================================================
// EXCEL HELPERS
// =============================================================================

/**
 * Generate Excel workbook from transactions
 */
async function generateExcelTransactions(transactions, title) {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Airavat B2B Marketplace';
  workbook.created = new Date();

  const sheet = workbook.addWorksheet(title);
  sheet.columns = [
    { header: 'Date', key: 'date', width: 20 },
    { header: 'Type', key: 'type', width: 15 },
    { header: 'Amount', key: 'amount', width: 15 },
    { header: 'Currency', key: 'currency', width: 10 },
    { header: 'Status', key: 'status', width: 12 },
    { header: 'Reference', key: 'reference', width: 20 },
    { header: 'Description', key: 'description', width: 30 },
    { header: 'Balance Before', key: 'balanceBefore', width: 15 },
    { header: 'Balance After', key: 'balanceAfter', width: 15 },
    { header: 'Business', key: 'business', width: 25 },
  ];

  transactions.forEach(txn => {
    sheet.addRow({
      date: txn.createdAt,
      type: txn.type,
      amount: parseFloat(txn.amount),
      currency: txn.currency,
      status: txn.status,
      reference: txn.referenceId,
      description: txn.description,
      balanceBefore: parseFloat(txn.balanceBefore),
      balanceAfter: parseFloat(txn.balanceAfter),
      business: txn.wallet?.business?.businessName,
    });
  });

  // Style header row
  sheet.getRow(1).font = { bold: true };
  sheet.getRow(1).fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: 'FF4472C4' },
  };
  sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };

  // Add number formatting
  sheet.getColumn('amount').numFmt = '#,##0.00';
  sheet.getColumn('balanceBefore').numFmt = '#,##0.00';
  sheet.getColumn('balanceAfter').numFmt = '#,##0.00';

  // Add summary at bottom
  const lastRow = sheet.lastRow.number + 2;
  sheet.getCell(`A${lastRow}`).value = 'Summary';
  sheet.getCell(`A${lastRow}`).font = { bold: true };

  const totalCredits = transactions
    .filter(t => t.type === 'CREDIT')
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);

  const totalDebits = transactions
    .filter(t => t.type === 'DEBIT')
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);

  sheet.getCell(`A${lastRow + 1}`).value = 'Total Credits:';
  sheet.getCell(`B${lastRow + 1}`).value = totalCredits;
  sheet.getCell(`B${lastRow + 1}`).numFmt = '#,##0.00';

  sheet.getCell(`A${lastRow + 2}`).value = 'Total Debits:';
  sheet.getCell(`B${lastRow + 2}`).value = totalDebits;
  sheet.getCell(`B${lastRow + 2}`).numFmt = '#,##0.00';

  sheet.getCell(`A${lastRow + 3}`).value = 'Net:';
  sheet.getCell(`B${lastRow + 3}`).value = totalCredits - totalDebits;
  sheet.getCell(`B${lastRow + 3}`).numFmt = '#,##0.00';
  sheet.getCell(`B${lastRow + 3}`).font = { bold: true };

  return workbook;
}

// =============================================================================
// PDF HELPERS
// =============================================================================

/**
 * Generate PDF from transactions
 */
async function generatePDFTransactions(transactions, title) {
  const doc = new PDFDocument({ margin: 50, size: 'A4' });

  // Header
  doc.fontSize(20).text('Airavat B2B Marketplace', { align: 'center' });
  doc.fontSize(16).text(title, { align: 'center' });
  doc.moveDown();
  doc.fontSize(10).text(`Generated: ${new Date().toLocaleString()}`, { align: 'right' });
  doc.moveDown(2);

  // Summary
  const totalCredits = transactions
    .filter(t => t.type === 'CREDIT')
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);

  const totalDebits = transactions
    .filter(t => t.type === 'DEBIT')
    .reduce((sum, t) => sum + parseFloat(t.amount), 0);

  doc.fontSize(12).text('Summary', { underline: true });
  doc.fontSize(10);
  doc.text(`Total Transactions: ${transactions.length}`);
  doc.text(`Total Credits: ₹${totalCredits.toLocaleString('en-IN')}`);
  doc.text(`Total Debits: ₹${totalDebits.toLocaleString('en-IN')}`);
  doc.text(`Net: ₹${(totalCredits - totalDebits).toLocaleString('en-IN')}`);
  doc.moveDown(2);

  // Table header
  const tableTop = doc.y;
  const columns = {
    date: { x: 50, width: 80 },
    type: { x: 130, width: 60 },
    amount: { x: 190, width: 80 },
    status: { x: 270, width: 70 },
    reference: { x: 340, width: 100 },
  };

  doc.fontSize(9).font('Helvetica-Bold');
  doc.text('Date', columns.date.x, tableTop);
  doc.text('Type', columns.type.x, tableTop);
  doc.text('Amount', columns.amount.x, tableTop);
  doc.text('Status', columns.status.x, tableTop);
  doc.text('Reference', columns.reference.x, tableTop);

  doc.moveTo(50, tableTop + 15).lineTo(550, tableTop + 15).stroke();

  // Table rows
  doc.font('Helvetica').fontSize(8);
  let y = tableTop + 20;

  transactions.slice(0, 50).forEach(txn => {
    if (y > 750) {
      doc.addPage();
      y = 50;
    }

    doc.text(txn.createdAt.toLocaleDateString(), columns.date.x, y);
    doc.text(txn.type, columns.type.x, y);
    doc.text(`₹${parseFloat(txn.amount).toLocaleString('en-IN')}`, columns.amount.x, y);
    doc.text(txn.status, columns.status.x, y);
    doc.text(txn.referenceId || '-', columns.reference.x, y, { width: 100 });

    y += 15;
  });

  if (transactions.length > 50) {
    doc.moveDown(2);
    doc.text(`... and ${transactions.length - 50} more transactions`, { align: 'center' });
  }

  return doc;
}

// =============================================================================
// BULK EXPORT
// =============================================================================

/**
 * Export all financial data for a business
 */
exports.exportAllFinancialData = async (businessId, options = {}) => {
  const { format = 'xlsx' } = options;

  const workbook = new ExcelJS.Workbook();
  workbook.creator = 'Airavat B2B Marketplace';
  workbook.created = new Date();

  // Wallet Data
  const walletData = await this.exportWalletTransactions(businessId, { format: 'xlsx' });
  if (walletData.worksheets) {
    walletData.worksheets.forEach(ws => {
      const newSheet = workbook.addWorksheet(ws.name);
      ws.eachRow((row, rowNumber) => {
        const newRow = newSheet.getRow(rowNumber);
        row.eachCell((cell, colNumber) => {
          newRow.getCell(colNumber).value = cell.value;
        });
      });
    });
  }

  // EMI Data
  const emiWorkbook = await this.exportEMIData(businessId, { format: 'xlsx' });
  emiWorkbook.worksheets.forEach(ws => {
    const newSheet = workbook.addWorksheet(ws.name);
    ws.eachRow((row, rowNumber) => {
      const newRow = newSheet.getRow(rowNumber);
      row.eachCell((cell, colNumber) => {
        newRow.getCell(colNumber).value = cell.value;
      });
    });
  });

  // Insurance Data
  const insuranceWorkbook = await this.exportInsuranceData(businessId, { format: 'xlsx' });
  insuranceWorkbook.worksheets.forEach(ws => {
    const newSheet = workbook.addWorksheet(ws.name);
    ws.eachRow((row, rowNumber) => {
      const newRow = newSheet.getRow(rowNumber);
      row.eachCell((cell, colNumber) => {
        newRow.getCell(colNumber).value = cell.value;
      });
    });
  });

  // Trade Finance Data
  const tradeWorkbook = await this.exportTradeFinanceData(businessId, { format: 'xlsx' });
  tradeWorkbook.worksheets.forEach(ws => {
    const newSheet = workbook.addWorksheet(ws.name);
    ws.eachRow((row, rowNumber) => {
      const newRow = newSheet.getRow(rowNumber);
      row.eachCell((cell, colNumber) => {
        newRow.getCell(colNumber).value = cell.value;
      });
    });
  });

  return workbook;
};

/**
 * Get export file path
 */
exports.saveExportFile = async (workbook, filename) => {
  await fs.mkdir(EXPORT_CONFIG.tempDir, { recursive: true });
  const filepath = path.join(EXPORT_CONFIG.tempDir, `${filename}_${Date.now()}.xlsx`);
  await workbook.xlsx.writeFile(filepath);
  return filepath;
};

module.exports = exports;
