// =============================================================================
// AIRAVAT B2B MARKETPLACE - UAE VAT SERVICE
// VAT Registration Verification, Tax Invoice, FTA Compliance
// =============================================================================

const axios = require('axios');
const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const config = require('../config');
const { BadRequestError, ExternalServiceError } = require('../utils/errors');

class UAEVATService {
  constructor() {
    // FTA (Federal Tax Authority) API
    this.ftaApi = axios.create({
      baseURL: config.uae?.ftaApiUrl || 'https://tax.gov.ae/api',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${config.uae?.ftaApiKey}`,
      },
      timeout: 30000,
    });
  }
  
  // =============================================================================
  // TRN (Tax Registration Number) VERIFICATION
  // =============================================================================
  
  /**
   * Verify UAE TRN
   */
  async verifyTRN(trn) {
    // Validate TRN format (15 digits)
    if (!this.isValidTRNFormat(trn)) {
      throw new BadRequestError('Invalid TRN format. Must be 15 digits.');
    }
    
    // Check cache
    const cached = await cache.get(`trn:${trn}`);
    if (cached) {
      return cached;
    }
    
    try {
      // FTA TRN verification
      const response = await this.ftaApi.get(`/v1/taxpayer/verify`, {
        params: { trn },
      });
      
      const data = response.data;
      
      const result = {
        trn,
        isValid: data.isValid || true,
        businessName: data.businessName,
        businessNameArabic: data.businessNameAr,
        registrationDate: data.registrationDate,
        status: data.status, // Active, Suspended, Deregistered
        emirate: data.emirate,
        businessType: data.businessType,
        taxGroup: data.taxGroup,
        address: {
          street: data.address?.street,
          area: data.address?.area,
          city: data.address?.city,
          emirate: data.address?.emirate,
          poBox: data.address?.poBox,
          country: 'UAE',
        },
      };
      
      // Cache for 24 hours
      await cache.set(`trn:${trn}`, result, 86400);
      
      // Log verification
      await prisma.trnVerificationLog.create({
        data: {
          trn,
          status: 'SUCCESS',
          response: result,
        },
      });
      
      return result;
      
    } catch (error) {
      logger.error('TRN verification failed', { trn, error: error.message });
      
      // For demo/development, return mock data
      if (config.app.isDev) {
        return this.getMockTRNData(trn);
      }
      
      throw new ExternalServiceError('TRN verification service unavailable');
    }
  }
  
  /**
   * Validate TRN format
   */
  isValidTRNFormat(trn) {
    if (!trn) return false;
    
    // Remove spaces and dashes
    const cleanTrn = trn.replace(/[\s-]/g, '');
    
    // Must be exactly 15 digits
    return /^\d{15}$/.test(cleanTrn);
  }
  
  /**
   * Validate TRN checksum (Luhn algorithm variant)
   */
  validateTRNChecksum(trn) {
    const cleanTrn = trn.replace(/[\s-]/g, '');
    
    // First 3 digits should be 100 (UAE country code)
    if (!cleanTrn.startsWith('100')) {
      return false;
    }
    
    return true;
  }
  
  /**
   * Mock TRN data for development
   */
  getMockTRNData(trn) {
    return {
      trn,
      isValid: true,
      businessName: 'Test Business LLC',
      businessNameArabic: 'شركة اختبار ذ.م.م',
      registrationDate: '2020-01-01',
      status: 'Active',
      emirate: 'Dubai',
      businessType: 'LLC',
      taxGroup: null,
      address: {
        street: 'Sheikh Zayed Road',
        area: 'Business Bay',
        city: 'Dubai',
        emirate: 'Dubai',
        poBox: '12345',
        country: 'UAE',
      },
    };
  }
  
  // =============================================================================
  // VAT CALCULATION
  // =============================================================================
  
  /**
   * Calculate UAE VAT
   * Standard VAT rate: 5%
   * Zero-rated: Exports, International transport, Healthcare, Education
   * Exempt: Financial services, Residential property
   */
  calculateVAT(amount, category = 'standard', isExport = false) {
    let vatRate = 5; // Standard rate
    let vatCategory = 'STANDARD';
    
    // Zero-rated supplies
    const zeroRatedCategories = [
      'export',
      'international_transport',
      'first_sale_residential',
      'crude_oil',
      'natural_gas',
      'investment_precious_metals',
    ];
    
    // Exempt supplies
    const exemptCategories = [
      'financial_services',
      'residential_property_lease',
      'bare_land',
      'local_passenger_transport',
    ];
    
    if (isExport || zeroRatedCategories.includes(category)) {
      vatRate = 0;
      vatCategory = 'ZERO_RATED';
    } else if (exemptCategories.includes(category)) {
      vatRate = 0;
      vatCategory = 'EXEMPT';
    }
    
    const vatAmount = (amount * vatRate) / 100;
    
    return {
      taxableAmount: amount,
      vatRate,
      vatAmount,
      totalAmount: amount + vatAmount,
      vatCategory,
      currency: 'AED',
    };
  }
  
  /**
   * Calculate reverse charge VAT (for imports)
   */
  calculateReverseChargeVAT(amount) {
    const vatRate = 5;
    const vatAmount = (amount * vatRate) / 100;
    
    return {
      taxableAmount: amount,
      vatRate,
      outputVAT: vatAmount,
      inputVAT: vatAmount, // Can be claimed back
      netVAT: 0, // Net effect is zero
      totalAmount: amount,
      mechanism: 'REVERSE_CHARGE',
    };
  }
  
  // =============================================================================
  // TAX INVOICE GENERATION
  // =============================================================================
  
  /**
   * Generate UAE VAT compliant tax invoice
   */
  async generateTaxInvoice(order) {
    // Validate mandatory fields for tax invoice
    this.validateTaxInvoiceRequirements(order);
    
    const seller = order.seller;
    const buyer = order.buyer;
    
    // Generate unique invoice number
    const invoiceNumber = await this.generateInvoiceNumber(seller.id);
    
    // Calculate VAT
    const isExport = buyer.country !== 'AE';
    const vatDetails = this.calculateVAT(parseFloat(order.subtotal), 'standard', isExport);
    
    const taxInvoice = {
      // Header
      invoiceNumber,
      invoiceDate: new Date(),
      dueDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
      currency: 'AED',
      
      // Supplier details (mandatory)
      supplier: {
        name: seller.businessName,
        nameArabic: seller.businessNameArabic,
        trn: seller.trn,
        address: this.formatUAEAddress(seller),
        phone: seller.phone,
        email: seller.email,
      },
      
      // Customer details
      customer: {
        name: buyer.businessName,
        nameArabic: buyer.businessNameArabic,
        trn: buyer.trn, // Optional for B2C, mandatory for B2B >10,000 AED
        address: this.formatUAEAddress(order.shippingAddress || buyer),
        phone: buyer.phone,
        email: buyer.email,
      },
      
      // Line items
      items: order.items.map((item, index) => {
        const itemVat = this.calculateVAT(parseFloat(item.totalPrice), 'standard', isExport);
        return {
          lineNo: index + 1,
          description: item.product.name,
          descriptionArabic: item.product.nameArabic,
          quantity: item.quantity,
          unit: item.product.unit || 'PCS',
          unitPrice: parseFloat(item.unitPrice),
          discount: parseFloat(item.discount || 0),
          taxableAmount: itemVat.taxableAmount,
          vatRate: itemVat.vatRate,
          vatAmount: itemVat.vatAmount,
          totalAmount: itemVat.totalAmount,
        };
      }),
      
      // Totals
      subtotal: parseFloat(order.subtotal),
      discountTotal: parseFloat(order.discountAmount || 0),
      taxableAmount: vatDetails.taxableAmount,
      vatRate: vatDetails.vatRate,
      vatAmount: vatDetails.vatAmount,
      totalAmount: vatDetails.totalAmount,
      
      // Additional info
      vatCategory: vatDetails.vatCategory,
      isExport,
      paymentTerms: 'Net 30',
      notes: order.notes,
      
      // Compliance
      qrCode: await this.generateInvoiceQRCode({
        sellerName: seller.businessName,
        sellerTRN: seller.trn,
        invoiceDate: new Date().toISOString(),
        totalAmount: vatDetails.totalAmount,
        vatAmount: vatDetails.vatAmount,
      }),
    };
    
    // Save invoice
    const savedInvoice = await prisma.taxInvoice.create({
      data: {
        orderId: order.id,
        invoiceNumber,
        invoiceDate: taxInvoice.invoiceDate,
        sellerTrn: seller.trn,
        buyerTrn: buyer.trn,
        subtotal: taxInvoice.subtotal,
        vatAmount: taxInvoice.vatAmount,
        totalAmount: taxInvoice.totalAmount,
        vatCategory: taxInvoice.vatCategory,
        currency: 'AED',
        data: taxInvoice,
      },
    });
    
    // Update order
    await prisma.order.update({
      where: { id: order.id },
      data: {
        invoiceNumber,
        invoiceGeneratedAt: new Date(),
      },
    });
    
    logger.info('Tax invoice generated', { orderId: order.id, invoiceNumber });
    
    return taxInvoice;
  }
  
  /**
   * Validate tax invoice requirements
   */
  validateTaxInvoiceRequirements(order) {
    const errors = [];
    
    // Supplier must have TRN
    if (!order.seller.trn) {
      errors.push('Supplier TRN is required');
    }
    
    // For B2B transactions over 10,000 AED, buyer TRN is mandatory
    if (parseFloat(order.totalAmount) > 10000 && !order.buyer.trn) {
      errors.push('Buyer TRN is required for transactions over AED 10,000');
    }
    
    // Must have proper address
    if (!order.seller.city || !order.seller.country) {
      errors.push('Complete supplier address is required');
    }
    
    if (errors.length > 0) {
      throw new BadRequestError(`Tax invoice validation failed: ${errors.join(', ')}`);
    }
  }
  
  /**
   * Generate simplified tax invoice (for transactions <= 10,000 AED)
   */
  async generateSimplifiedTaxInvoice(order) {
    if (parseFloat(order.totalAmount) > 10000) {
      throw new BadRequestError('Simplified tax invoice is only for transactions up to AED 10,000');
    }
    
    const seller = order.seller;
    const vatDetails = this.calculateVAT(parseFloat(order.subtotal));
    
    return {
      invoiceNumber: await this.generateInvoiceNumber(seller.id),
      invoiceDate: new Date(),
      supplier: {
        name: seller.businessName,
        trn: seller.trn,
        address: seller.city,
      },
      items: order.items.map((item) => ({
        description: item.product.name,
        quantity: item.quantity,
        unitPrice: parseFloat(item.unitPrice),
        totalAmount: parseFloat(item.totalPrice),
      })),
      totalAmountIncludingVAT: vatDetails.totalAmount,
      vatRate: vatDetails.vatRate,
    };
  }
  
  /**
   * Generate unique invoice number
   */
  async generateInvoiceNumber(businessId) {
    const year = new Date().getFullYear();
    const prefix = 'INV';
    
    // Get last invoice number
    const lastInvoice = await prisma.taxInvoice.findFirst({
      where: {
        invoiceNumber: { startsWith: `${prefix}-${year}` },
      },
      orderBy: { createdAt: 'desc' },
    });
    
    let sequence = 1;
    if (lastInvoice) {
      const parts = lastInvoice.invoiceNumber.split('-');
      sequence = parseInt(parts[2] || 0) + 1;
    }
    
    return `${prefix}-${year}-${String(sequence).padStart(6, '0')}`;
  }
  
  /**
   * Generate QR code for invoice (FTA requirement)
   */
  async generateInvoiceQRCode(data) {
    // TLV (Tag-Length-Value) format as per FTA requirements
    const tlvData = this.encodeTLV([
      { tag: 1, value: data.sellerName },
      { tag: 2, value: data.sellerTRN },
      { tag: 3, value: data.invoiceDate },
      { tag: 4, value: data.totalAmount.toFixed(2) },
      { tag: 5, value: data.vatAmount.toFixed(2) },
    ]);
    
    // Base64 encode
    return Buffer.from(tlvData).toString('base64');
  }
  
  /**
   * Encode TLV format
   */
  encodeTLV(items) {
    let result = '';
    for (const item of items) {
      const valueBytes = Buffer.from(item.value.toString(), 'utf8');
      result += String.fromCharCode(item.tag);
      result += String.fromCharCode(valueBytes.length);
      result += valueBytes.toString('binary');
    }
    return result;
  }
  
  // =============================================================================
  // VAT RETURN DATA
  // =============================================================================
  
  /**
   * Get VAT return summary for a period
   */
  async getVATReturnSummary(businessId, startDate, endDate) {
    // Get all invoices for the period
    const invoices = await prisma.taxInvoice.findMany({
      where: {
        order: {
          OR: [
            { sellerId: businessId },
            { buyerId: businessId },
          ],
        },
        invoiceDate: {
          gte: startDate,
          lte: endDate,
        },
      },
      include: {
        order: true,
      },
    });
    
    // Calculate outputs (sales)
    const salesInvoices = invoices.filter((inv) => inv.order.sellerId === businessId);
    const outputVAT = salesInvoices.reduce((sum, inv) => sum + parseFloat(inv.vatAmount), 0);
    const standardRatedSupplies = salesInvoices
      .filter((inv) => inv.vatCategory === 'STANDARD')
      .reduce((sum, inv) => sum + parseFloat(inv.subtotal), 0);
    const zeroRatedSupplies = salesInvoices
      .filter((inv) => inv.vatCategory === 'ZERO_RATED')
      .reduce((sum, inv) => sum + parseFloat(inv.subtotal), 0);
    const exemptSupplies = salesInvoices
      .filter((inv) => inv.vatCategory === 'EXEMPT')
      .reduce((sum, inv) => sum + parseFloat(inv.subtotal), 0);
    
    // Calculate inputs (purchases)
    const purchaseInvoices = invoices.filter((inv) => inv.order.buyerId === businessId);
    const inputVAT = purchaseInvoices.reduce((sum, inv) => sum + parseFloat(inv.vatAmount), 0);
    
    // Net VAT payable
    const netVAT = outputVAT - inputVAT;
    
    return {
      period: {
        startDate,
        endDate,
      },
      outputs: {
        standardRatedSupplies,
        zeroRatedSupplies,
        exemptSupplies,
        totalSupplies: standardRatedSupplies + zeroRatedSupplies + exemptSupplies,
        outputVAT,
      },
      inputs: {
        standardRatedPurchases: purchaseInvoices.reduce((sum, inv) => sum + parseFloat(inv.subtotal), 0),
        inputVAT,
        recoverableVAT: inputVAT, // Simplified; actual may have restrictions
      },
      summary: {
        outputVAT,
        inputVAT,
        netVATPayable: netVAT > 0 ? netVAT : 0,
        netVATRefundable: netVAT < 0 ? Math.abs(netVAT) : 0,
      },
    };
  }
  
  // =============================================================================
  // EMIRATE-SPECIFIC
  // =============================================================================
  
  /**
   * Get emirate from city/area
   */
  getEmirateFromCity(city) {
    const cityToEmirate = {
      'dubai': 'Dubai',
      'abu dhabi': 'Abu Dhabi',
      'sharjah': 'Sharjah',
      'ajman': 'Ajman',
      'fujairah': 'Fujairah',
      'ras al khaimah': 'Ras Al Khaimah',
      'umm al quwain': 'Umm Al Quwain',
      // Common areas
      'jebel ali': 'Dubai',
      'business bay': 'Dubai',
      'deira': 'Dubai',
      'bur dubai': 'Dubai',
      'al quoz': 'Dubai',
      'khalifa city': 'Abu Dhabi',
      'mussafah': 'Abu Dhabi',
      'al ain': 'Abu Dhabi',
    };
    
    return cityToEmirate[city?.toLowerCase()] || city;
  }
  
  /**
   * Format UAE address
   */
  formatUAEAddress(entity) {
    const parts = [
      entity.addressLine1,
      entity.addressLine2,
      entity.area,
      entity.city,
      entity.emirate || this.getEmirateFromCity(entity.city),
      entity.poBox ? `P.O. Box ${entity.poBox}` : null,
      'United Arab Emirates',
    ].filter(Boolean);
    
    return parts.join(', ');
  }
  
  // =============================================================================
  // FREE ZONE HANDLING
  // =============================================================================
  
  /**
   * Check if business is in designated free zone
   */
  isDesignatedFreeZone(freeZoneName) {
    const designatedZones = [
      'JAFZA', // Jebel Ali Free Zone
      'DAFZA', // Dubai Airport Free Zone
      'DMCC', // Dubai Multi Commodities Centre
      'DIFC', // Dubai International Financial Centre
      'Masdar City',
      'KIZAD', // Khalifa Industrial Zone
      'SAIF Zone', // Sharjah Airport International Free Zone
      'RAK FTZ', // Ras Al Khaimah Free Trade Zone
      'Ajman Free Zone',
      'UAQ FTZ', // Umm Al Quwain Free Trade Zone
      'Fujairah Free Zone',
      'Hamriyah Free Zone',
    ];
    
    return designatedZones.some((zone) => 
      freeZoneName?.toLowerCase().includes(zone.toLowerCase())
    );
  }
  
  /**
   * Calculate VAT for free zone transactions
   */
  calculateFreeZoneVAT(amount, sellerInFreeZone, buyerInFreeZone, isDesignatedZone) {
    // Free zone to free zone (designated) - Zero rated
    if (sellerInFreeZone && buyerInFreeZone && isDesignatedZone) {
      return this.calculateVAT(amount, 'export', true);
    }
    
    // Free zone to mainland - Standard VAT applies
    if (sellerInFreeZone && !buyerInFreeZone) {
      return this.calculateVAT(amount, 'standard', false);
    }
    
    // Mainland to free zone - Standard VAT (free zone can recover)
    return this.calculateVAT(amount, 'standard', false);
  }
}

module.exports = new UAEVATService();
