// =============================================================================
// AIRAVAT B2B MARKETPLACE - TALLY INTEGRATION SERVICE
// Integration with Tally ERP for accounting synchronization
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError, BadRequestError, NotFoundError } = require('../utils/errors');
const axios = require('axios');
const xml2js = require('xml2js');

// =============================================================================
// CONFIGURATION
// =============================================================================

/**
 * Tally XML request templates
 */
const TALLY_TEMPLATES = {
  LEDGER: `
    <ENVELOPE>
      <HEADER>
        <TALLYREQUEST>Import Data</TALLYREQUEST>
      </HEADER>
      <BODY>
        <IMPORTDATA>
          <REQUESTDESC>
            <REPORTNAME>All Masters</REPORTNAME>
          </REQUESTDESC>
          <REQUESTDATA>
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
              <LEDGER NAME="{{name}}" ACTION="Create">
                <NAME>{{name}}</NAME>
                <PARENT>{{parent}}</PARENT>
                <ISBILLWISEON>Yes</ISBILLWISEON>
                <AFFECTSSTOCK>No</AFFECTSSTOCK>
                <MAILINGNAME.LIST>
                  <MAILINGNAME>{{mailingName}}</MAILINGNAME>
                </MAILINGNAME.LIST>
                <ADDRESS.LIST>
                  <ADDRESS>{{address}}</ADDRESS>
                </ADDRESS.LIST>
                <LEDSTATENAME>{{state}}</LEDSTATENAME>
                <PINCODE>{{pincode}}</PINCODE>
                <LEDGERMOBILE>{{phone}}</LEDGERMOBILE>
                <EMAIL>{{email}}</EMAIL>
                <GSTIN>{{gstin}}</GSTIN>
                <GSTREGISTRATIONTYPE>{{gstType}}</GSTREGISTRATIONTYPE>
              </LEDGER>
            </TALLYMESSAGE>
          </REQUESTDATA>
        </IMPORTDATA>
      </BODY>
    </ENVELOPE>
  `,

  VOUCHER: `
    <ENVELOPE>
      <HEADER>
        <TALLYREQUEST>Import Data</TALLYREQUEST>
      </HEADER>
      <BODY>
        <IMPORTDATA>
          <REQUESTDESC>
            <REPORTNAME>Vouchers</REPORTNAME>
          </REQUESTDESC>
          <REQUESTDATA>
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
              <VOUCHER VCHTYPE="{{voucherType}}" ACTION="Create">
                <DATE>{{date}}</DATE>
                <VOUCHERTYPENAME>{{voucherType}}</VOUCHERTYPENAME>
                <VOUCHERNUMBER>{{voucherNumber}}</VOUCHERNUMBER>
                <PARTYLEDGERNAME>{{partyName}}</PARTYLEDGERNAME>
                <REFERENCE>{{reference}}</REFERENCE>
                <NARRATION>{{narration}}</NARRATION>
                {{#entries}}
                <ALLLEDGERENTRIES.LIST>
                  <LEDGERNAME>{{ledgerName}}</LEDGERNAME>
                  <ISDEEMEDPOSITIVE>{{isDebit}}</ISDEEMEDPOSITIVE>
                  <AMOUNT>{{amount}}</AMOUNT>
                </ALLLEDGERENTRIES.LIST>
                {{/entries}}
              </VOUCHER>
            </TALLYMESSAGE>
          </REQUESTDATA>
        </IMPORTDATA>
      </BODY>
    </ENVELOPE>
  `,

  STOCK_ITEM: `
    <ENVELOPE>
      <HEADER>
        <TALLYREQUEST>Import Data</TALLYREQUEST>
      </HEADER>
      <BODY>
        <IMPORTDATA>
          <REQUESTDESC>
            <REPORTNAME>All Masters</REPORTNAME>
          </REQUESTDESC>
          <REQUESTDATA>
            <TALLYMESSAGE xmlns:UDF="TallyUDF">
              <STOCKITEM NAME="{{name}}" ACTION="Create">
                <NAME>{{name}}</NAME>
                <PARENT>{{category}}</PARENT>
                <BASEUNITS>{{unit}}</BASEUNITS>
                <OPENINGBALANCE>{{quantity}} {{unit}}</OPENINGBALANCE>
                <OPENINGVALUE>{{value}}</OPENINGVALUE>
                <GSTAPPLICABLE>Applicable</GSTAPPLICABLE>
                <GSTTYPEOFSUPPLY>Goods</GSTTYPEOFSUPPLY>
                <HSNCODE>{{hsnCode}}</HSNCODE>
                <TAXABILITY>Taxable</TAXABILITY>
                <IGSTRATE>{{gstRate}}</IGSTRATE>
                <CGSTRATE>{{cgstRate}}</CGSTRATE>
                <SGSTRATE>{{sgstRate}}</SGSTRATE>
              </STOCKITEM>
            </TALLYMESSAGE>
          </REQUESTDATA>
        </IMPORTDATA>
      </BODY>
    </ENVELOPE>
  `,
};

/**
 * Tally voucher types mapping
 */
const VOUCHER_TYPES = {
  SALES: 'Sales',
  PURCHASE: 'Purchase',
  RECEIPT: 'Receipt',
  PAYMENT: 'Payment',
  JOURNAL: 'Journal',
  CREDIT_NOTE: 'Credit Note',
  DEBIT_NOTE: 'Debit Note',
};

/**
 * Ledger groups
 */
const LEDGER_GROUPS = {
  SUNDRY_DEBTORS: 'Sundry Debtors',
  SUNDRY_CREDITORS: 'Sundry Creditors',
  SALES_ACCOUNTS: 'Sales Accounts',
  PURCHASE_ACCOUNTS: 'Purchase Accounts',
  DUTIES_AND_TAXES: 'Duties & Taxes',
  BANK_ACCOUNTS: 'Bank Accounts',
};

// =============================================================================
// CONNECTION MANAGEMENT
// =============================================================================

/**
 * Configure Tally connection for a business
 * @param {string} businessId - Business ID
 * @param {Object} config - Tally configuration
 * @returns {Promise<Object>} Connection status
 */
exports.configureConnection = async (businessId, config) => {
  try {
    const {
      serverUrl = 'http://localhost:9000',
      companyName,
      username,
      password,
      autoSync = false,
      syncInterval = 30, // minutes
    } = config;

    // Test connection
    const testResult = await testTallyConnection(serverUrl, companyName);
    if (!testResult.success) {
      throw new BadRequestError(`Cannot connect to Tally: ${testResult.error}`);
    }

    // Save configuration
    const integration = await prisma.tallyIntegration.upsert({
      where: { businessId },
      update: {
        serverUrl,
        companyName,
        credentials: encryptCredentials({ username, password }),
        autoSync,
        syncInterval,
        status: 'CONNECTED',
        lastConnectedAt: new Date(),
      },
      create: {
        businessId,
        serverUrl,
        companyName,
        credentials: encryptCredentials({ username, password }),
        autoSync,
        syncInterval,
        status: 'CONNECTED',
        lastConnectedAt: new Date(),
      },
    });

    logger.info('Tally connection configured', { businessId, companyName });

    return {
      connected: true,
      companyName: testResult.companyName,
      version: testResult.version,
      autoSync,
    };
  } catch (error) {
    logger.error('Configure Tally connection error', { error: error.message, businessId });
    throw error;
  }
};

/**
 * Test Tally connection
 * @param {string} serverUrl - Tally server URL
 * @param {string} companyName - Company name
 * @returns {Promise<Object>} Connection test result
 */
async function testTallyConnection(serverUrl, companyName) {
  try {
    const testXml = `
      <ENVELOPE>
        <HEADER>
          <TALLYREQUEST>Export Data</TALLYREQUEST>
        </HEADER>
        <BODY>
          <EXPORTDATA>
            <REQUESTDESC>
              <REPORTNAME>List of Companies</REPORTNAME>
            </REQUESTDESC>
          </EXPORTDATA>
        </BODY>
      </ENVELOPE>
    `;

    const response = await axios.post(serverUrl, testXml, {
      headers: { 'Content-Type': 'application/xml' },
      timeout: 10000,
    });

    const result = await parseXmlResponse(response.data);

    return {
      success: true,
      companyName: result.ENVELOPE?.BODY?.DATA?.COLLECTION?.COMPANY?.NAME || companyName,
      version: result.ENVELOPE?.HEADER?.VERSION || 'Unknown',
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

/**
 * Get connection status
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Connection status
 */
exports.getConnectionStatus = async (businessId) => {
  const integration = await prisma.tallyIntegration.findUnique({
    where: { businessId },
  });

  if (!integration) {
    return { connected: false, configured: false };
  }

  // Test current connection
  const testResult = await testTallyConnection(
    integration.serverUrl,
    integration.companyName
  );

  return {
    connected: testResult.success,
    configured: true,
    companyName: integration.companyName,
    serverUrl: integration.serverUrl,
    autoSync: integration.autoSync,
    lastSync: integration.lastSyncAt,
    status: integration.status,
  };
};

// =============================================================================
// DATA SYNCHRONIZATION
// =============================================================================

/**
 * Sync all data to Tally
 * @param {string} businessId - Business ID
 * @param {Object} options - Sync options
 * @returns {Promise<Object>} Sync result
 */
exports.syncAllData = async (businessId, options = {}) => {
  try {
    const { syncType = 'full', since = null } = options;

    const integration = await prisma.tallyIntegration.findUnique({
      where: { businessId },
    });

    if (!integration || integration.status !== 'CONNECTED') {
      throw new BadRequestError('Tally not connected');
    }

    const results = {
      customers: { synced: 0, failed: 0 },
      suppliers: { synced: 0, failed: 0 },
      products: { synced: 0, failed: 0 },
      orders: { synced: 0, failed: 0 },
    };

    // Sync customers (as Sundry Debtors)
    const customers = await getUnsyncedCustomers(businessId, since);
    for (const customer of customers) {
      try {
        await exports.syncCustomer(businessId, customer.id);
        results.customers.synced++;
      } catch (error) {
        results.customers.failed++;
        logger.error('Sync customer error', { customerId: customer.id, error: error.message });
      }
    }

    // Sync suppliers (as Sundry Creditors)
    const suppliers = await getUnsyncedSuppliers(businessId, since);
    for (const supplier of suppliers) {
      try {
        await exports.syncSupplier(businessId, supplier.id);
        results.suppliers.synced++;
      } catch (error) {
        results.suppliers.failed++;
      }
    }

    // Sync products (as Stock Items)
    const products = await getUnsyncedProducts(businessId, since);
    for (const product of products) {
      try {
        await exports.syncProduct(businessId, product.id);
        results.products.synced++;
      } catch (error) {
        results.products.failed++;
      }
    }

    // Sync orders (as Vouchers)
    const orders = await getUnsyncedOrders(businessId, since);
    for (const order of orders) {
      try {
        await exports.syncOrder(businessId, order.id);
        results.orders.synced++;
      } catch (error) {
        results.orders.failed++;
      }
    }

    // Update last sync time
    await prisma.tallyIntegration.update({
      where: { businessId },
      data: { lastSyncAt: new Date() },
    });

    logger.info('Tally sync completed', { businessId, results });

    return {
      success: true,
      results,
      syncedAt: new Date().toISOString(),
    };
  } catch (error) {
    logger.error('Sync all data error', { error: error.message, businessId });
    throw error;
  }
};

/**
 * Sync a single customer to Tally
 * @param {string} businessId - Business ID
 * @param {string} customerId - Customer ID
 * @returns {Promise<Object>} Sync result
 */
exports.syncCustomer = async (businessId, customerId) => {
  const integration = await getTallyIntegration(businessId);
  
  const customer = await prisma.business.findUnique({
    where: { id: customerId },
    include: { addresses: { where: { isDefault: true } } },
  });

  if (!customer) {
    throw new NotFoundError('Customer not found');
  }

  const address = customer.addresses[0];
  
  const xml = buildXmlFromTemplate(TALLY_TEMPLATES.LEDGER, {
    name: customer.businessName,
    parent: LEDGER_GROUPS.SUNDRY_DEBTORS,
    mailingName: customer.businessName,
    address: address ? `${address.addressLine1}, ${address.city}` : '',
    state: address?.state || '',
    pincode: address?.pincode || '',
    phone: customer.phone || '',
    email: customer.email || '',
    gstin: customer.gstin || '',
    gstType: customer.gstin ? 'Regular' : 'Unregistered',
  });

  const response = await sendToTally(integration.serverUrl, xml);

  // Mark as synced
  await prisma.tallySyncLog.create({
    data: {
      businessId,
      entityType: 'CUSTOMER',
      entityId: customerId,
      action: 'CREATE',
      status: response.success ? 'SUCCESS' : 'FAILED',
      response: response,
    },
  });

  return response;
};

/**
 * Sync a single order to Tally as voucher
 * @param {string} businessId - Business ID
 * @param {string} orderId - Order ID
 * @returns {Promise<Object>} Sync result
 */
exports.syncOrder = async (businessId, orderId) => {
  const integration = await getTallyIntegration(businessId);

  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      buyer: { include: { business: true } },
      seller: true,
      items: { include: { product: true } },
    },
  });

  if (!order) {
    throw new NotFoundError('Order not found');
  }

  // Build voucher entries
  const entries = [];

  // Debit: Customer account
  entries.push({
    ledgerName: order.buyer?.business?.businessName || 'Cash',
    isDebit: 'Yes',
    amount: `-${order.total}`, // Negative for debit
  });

  // Credit: Sales account
  entries.push({
    ledgerName: 'Sales Account',
    isDebit: 'No',
    amount: order.subtotal,
  });

  // Credit: GST accounts
  if (order.cgstAmount > 0) {
    entries.push({
      ledgerName: 'CGST Payable',
      isDebit: 'No',
      amount: order.cgstAmount,
    });
  }

  if (order.sgstAmount > 0) {
    entries.push({
      ledgerName: 'SGST Payable',
      isDebit: 'No',
      amount: order.sgstAmount,
    });
  }

  if (order.igstAmount > 0) {
    entries.push({
      ledgerName: 'IGST Payable',
      isDebit: 'No',
      amount: order.igstAmount,
    });
  }

  const xml = buildXmlFromTemplate(TALLY_TEMPLATES.VOUCHER, {
    voucherType: VOUCHER_TYPES.SALES,
    date: formatTallyDate(order.createdAt),
    voucherNumber: order.orderNumber,
    partyName: order.buyer?.business?.businessName || 'Cash',
    reference: order.orderNumber,
    narration: `Sales invoice for order ${order.orderNumber}`,
    entries,
  });

  const response = await sendToTally(integration.serverUrl, xml);

  // Mark as synced
  await prisma.tallySyncLog.create({
    data: {
      businessId,
      entityType: 'ORDER',
      entityId: orderId,
      action: 'CREATE',
      status: response.success ? 'SUCCESS' : 'FAILED',
      tallyVoucherNumber: response.voucherNumber,
      response: response,
    },
  });

  return response;
};

/**
 * Sync a product to Tally as stock item
 * @param {string} businessId - Business ID
 * @param {string} productId - Product ID
 * @returns {Promise<Object>} Sync result
 */
exports.syncProduct = async (businessId, productId) => {
  const integration = await getTallyIntegration(businessId);

  const product = await prisma.product.findUnique({
    where: { id: productId },
    include: { category: true, variants: { where: { isDefault: true } } },
  });

  if (!product) {
    throw new NotFoundError('Product not found');
  }

  const variant = product.variants[0];
  const gstRate = product.gstRate || 18;

  const xml = buildXmlFromTemplate(TALLY_TEMPLATES.STOCK_ITEM, {
    name: product.name,
    category: product.category?.name || 'Primary',
    unit: product.unit || 'Nos',
    quantity: variant?.stock || 0,
    value: (variant?.stock || 0) * parseFloat(product.basePrice || 0),
    hsnCode: product.hsnCode || '',
    gstRate,
    cgstRate: gstRate / 2,
    sgstRate: gstRate / 2,
  });

  const response = await sendToTally(integration.serverUrl, xml);

  await prisma.tallySyncLog.create({
    data: {
      businessId,
      entityType: 'PRODUCT',
      entityId: productId,
      action: 'CREATE',
      status: response.success ? 'SUCCESS' : 'FAILED',
      response: response,
    },
  });

  return response;
};

// =============================================================================
// IMPORT FROM TALLY
// =============================================================================

/**
 * Import ledgers from Tally
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Import result
 */
exports.importLedgers = async (businessId) => {
  const integration = await getTallyIntegration(businessId);

  const exportXml = `
    <ENVELOPE>
      <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
      </HEADER>
      <BODY>
        <EXPORTDATA>
          <REQUESTDESC>
            <REPORTNAME>List of Ledgers</REPORTNAME>
            <STATICVARIABLES>
              <SVCURRENTCOMPANY>${integration.companyName}</SVCURRENTCOMPANY>
            </STATICVARIABLES>
          </REQUESTDESC>
        </EXPORTDATA>
      </BODY>
    </ENVELOPE>
  `;

  const response = await axios.post(integration.serverUrl, exportXml, {
    headers: { 'Content-Type': 'application/xml' },
  });

  const parsed = await parseXmlResponse(response.data);
  const ledgers = parsed.ENVELOPE?.BODY?.DATA?.COLLECTION?.LEDGER || [];

  // Process and store ledgers
  const imported = [];
  for (const ledger of Array.isArray(ledgers) ? ledgers : [ledgers]) {
    if (ledger && ledger.NAME) {
      imported.push({
        name: ledger.NAME,
        parent: ledger.PARENT,
        email: ledger.EMAIL,
        gstin: ledger.GSTIN,
      });
    }
  }

  return { imported: imported.length, ledgers: imported };
};

/**
 * Import stock items from Tally
 * @param {string} businessId - Business ID
 * @returns {Promise<Object>} Import result
 */
exports.importStockItems = async (businessId) => {
  const integration = await getTallyIntegration(businessId);

  const exportXml = `
    <ENVELOPE>
      <HEADER>
        <TALLYREQUEST>Export Data</TALLYREQUEST>
      </HEADER>
      <BODY>
        <EXPORTDATA>
          <REQUESTDESC>
            <REPORTNAME>Stock Summary</REPORTNAME>
            <STATICVARIABLES>
              <SVCURRENTCOMPANY>${integration.companyName}</SVCURRENTCOMPANY>
            </STATICVARIABLES>
          </REQUESTDESC>
        </EXPORTDATA>
      </BODY>
    </ENVELOPE>
  `;

  const response = await axios.post(integration.serverUrl, exportXml, {
    headers: { 'Content-Type': 'application/xml' },
  });

  const parsed = await parseXmlResponse(response.data);
  const items = parsed.ENVELOPE?.BODY?.DATA?.COLLECTION?.STOCKITEM || [];

  return {
    imported: Array.isArray(items) ? items.length : 1,
    items: Array.isArray(items) ? items : [items],
  };
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function getTallyIntegration(businessId) {
  const integration = await prisma.tallyIntegration.findUnique({
    where: { businessId },
  });

  if (!integration) {
    throw new BadRequestError('Tally integration not configured');
  }

  if (integration.status !== 'CONNECTED') {
    throw new BadRequestError('Tally not connected');
  }

  return integration;
}

function buildXmlFromTemplate(template, data) {
  let xml = template;
  
  // Handle simple replacements
  for (const [key, value] of Object.entries(data)) {
    if (!Array.isArray(value)) {
      xml = xml.replace(new RegExp(`{{${key}}}`, 'g'), value || '');
    }
  }

  // Handle array entries (like voucher entries)
  if (data.entries && Array.isArray(data.entries)) {
    const entriesSection = data.entries.map((entry) => {
      let entryXml = `
        <ALLLEDGERENTRIES.LIST>
          <LEDGERNAME>${entry.ledgerName}</LEDGERNAME>
          <ISDEEMEDPOSITIVE>${entry.isDebit}</ISDEEMEDPOSITIVE>
          <AMOUNT>${entry.amount}</AMOUNT>
        </ALLLEDGERENTRIES.LIST>
      `;
      return entryXml;
    }).join('');

    xml = xml.replace(/{{#entries}}[\s\S]*?{{\/entries}}/g, entriesSection);
  }

  return xml.trim();
}

async function sendToTally(serverUrl, xml) {
  try {
    const response = await axios.post(serverUrl, xml, {
      headers: { 'Content-Type': 'application/xml' },
      timeout: 30000,
    });

    const parsed = await parseXmlResponse(response.data);
    const success = !parsed.ENVELOPE?.BODY?.DATA?.IMPORTRESULT?.ERRORS;

    return {
      success,
      response: parsed,
      voucherNumber: parsed.ENVELOPE?.BODY?.DATA?.IMPORTRESULT?.CREATED,
    };
  } catch (error) {
    return {
      success: false,
      error: error.message,
    };
  }
}

async function parseXmlResponse(xml) {
  const parser = new xml2js.Parser({
    explicitArray: false,
    ignoreAttrs: true,
  });
  return parser.parseStringPromise(xml);
}

function formatTallyDate(date) {
  const d = new Date(date);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}

function encryptCredentials(credentials) {
  // In production, use proper encryption
  return Buffer.from(JSON.stringify(credentials)).toString('base64');
}

async function getUnsyncedCustomers(businessId, since) {
  const where = {
    orders: { some: { sellerId: businessId } },
    tallySynced: false,
  };
  if (since) where.updatedAt = { gte: new Date(since) };
  return prisma.business.findMany({ where, take: 100 });
}

async function getUnsyncedSuppliers(businessId, since) {
  return [];
}

async function getUnsyncedProducts(businessId, since) {
  const where = { businessId, tallySynced: false };
  if (since) where.updatedAt = { gte: new Date(since) };
  return prisma.product.findMany({ where, take: 100 });
}

async function getUnsyncedOrders(businessId, since) {
  const where = {
    sellerId: businessId,
    status: { in: ['DELIVERED', 'COMPLETED'] },
    tallySynced: false,
  };
  if (since) where.updatedAt = { gte: new Date(since) };
  return prisma.order.findMany({ where, take: 100 });
}

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  VOUCHER_TYPES,
  LEDGER_GROUPS,
};



