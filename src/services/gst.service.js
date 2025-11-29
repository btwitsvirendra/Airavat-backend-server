// =============================================================================
// AIRAVAT B2B MARKETPLACE - GST SERVICE (INDIA)
// GST Verification, E-Invoice, E-Way Bill Integration
// =============================================================================

const axios = require('axios');
const crypto = require('crypto');
const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const config = require('../config');
const { BadRequestError, ExternalServiceError } = require('../utils/errors');

class GSTService {
  constructor() {
    // GST API endpoints (use sandbox for development)
    this.gstPortal = axios.create({
      baseURL: config.gst?.apiUrl || 'https://gstapi.charteredinfo.com',
      headers: {
        'Content-Type': 'application/json',
        'client-id': config.gst?.clientId,
        'client-secret': config.gst?.clientSecret,
      },
      timeout: 30000,
    });
    
    // E-Invoice API (NIC)
    this.eInvoiceApi = axios.create({
      baseURL: config.einvoice?.apiUrl || 'https://einv-apisandbox.nic.in',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
    
    // E-Way Bill API (NIC)
    this.eWayBillApi = axios.create({
      baseURL: config.ewayBill?.apiUrl || 'https://gsp.adaaborama.in',
      headers: {
        'Content-Type': 'application/json',
      },
      timeout: 30000,
    });
  }
  
  // =============================================================================
  // GSTIN VERIFICATION
  // =============================================================================
  
  /**
   * Verify GSTIN and fetch business details
   */
  async verifyGSTIN(gstin) {
    // Validate GSTIN format
    if (!this.isValidGSTINFormat(gstin)) {
      throw new BadRequestError('Invalid GSTIN format');
    }
    
    // Check cache first
    const cached = await cache.get(`gstin:${gstin}`);
    if (cached) {
      return cached;
    }
    
    try {
      const response = await this.gstPortal.get(`/commonapi/v1.1/search`, {
        params: { gstin },
      });
      
      if (response.data.error) {
        throw new BadRequestError(response.data.error.message || 'GSTIN verification failed');
      }
      
      const data = response.data.data || response.data;
      
      const result = {
        gstin,
        isValid: true,
        legalName: data.lgnm || data.tradeNam,
        tradeName: data.tradeNam,
        status: data.sts,
        stateCode: data.gstin?.substring(0, 2),
        registrationDate: data.rgdt,
        lastUpdateDate: data.lstupdt,
        businessType: data.ctb,
        constitution: data.ctj,
        address: {
          building: data.pradr?.addr?.bno,
          street: data.pradr?.addr?.st,
          locality: data.pradr?.addr?.loc,
          city: data.pradr?.addr?.dst,
          state: data.pradr?.addr?.stcd,
          pincode: data.pradr?.addr?.pncd,
          full: this.formatAddress(data.pradr?.addr),
        },
        natureOfBusiness: data.nba,
        isComposition: data.ctb === 'Composition',
        isCancelled: data.sts === 'Cancelled',
        cancellationDate: data.cxdt,
      };
      
      // Cache for 24 hours
      await cache.set(`gstin:${gstin}`, result, 86400);
      
      // Store verification log
      await prisma.gstVerificationLog.create({
        data: {
          gstin,
          status: 'SUCCESS',
          response: result,
        },
      });
      
      return result;
      
    } catch (error) {
      logger.error('GSTIN verification failed', { gstin, error: error.message });
      
      await prisma.gstVerificationLog.create({
        data: {
          gstin,
          status: 'FAILED',
          errorMessage: error.message,
        },
      });
      
      if (error instanceof BadRequestError) {
        throw error;
      }
      
      throw new ExternalServiceError('GST verification service unavailable');
    }
  }
  
  /**
   * Validate GSTIN format (15-digit alphanumeric)
   */
  isValidGSTINFormat(gstin) {
    if (!gstin || gstin.length !== 15) {
      return false;
    }
    
    // GSTIN format: 2 digits state code + 10 char PAN + 1 entity code + Z + checksum
    const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
    return gstinRegex.test(gstin);
  }
  
  /**
   * Validate GSTIN checksum
   */
  validateGSTINChecksum(gstin) {
    const factor = [1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1, 2, 1];
    const charMap = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    
    let sum = 0;
    for (let i = 0; i < 14; i++) {
      const char = gstin[i];
      const value = charMap.indexOf(char);
      const product = value * factor[i];
      sum += Math.floor(product / 36) + (product % 36);
    }
    
    const checksum = charMap[(36 - (sum % 36)) % 36];
    return gstin[14] === checksum;
  }
  
  /**
   * Get GST return filing status
   */
  async getFilingStatus(gstin, financialYear) {
    try {
      const response = await this.gstPortal.get(`/commonapi/v1.1/returns`, {
        params: { gstin, fy: financialYear },
      });
      
      return response.data.data?.EFiledlist || [];
    } catch (error) {
      logger.error('Failed to fetch filing status', { gstin, error: error.message });
      return [];
    }
  }
  
  /**
   * Calculate GST components
   */
  calculateGST(amount, gstRate, isSameState = true) {
    const gstAmount = (amount * gstRate) / 100;
    
    if (isSameState) {
      // Intra-state: CGST + SGST
      return {
        taxableAmount: amount,
        cgst: gstAmount / 2,
        sgst: gstAmount / 2,
        igst: 0,
        cess: 0,
        totalGst: gstAmount,
        totalAmount: amount + gstAmount,
      };
    } else {
      // Inter-state: IGST
      return {
        taxableAmount: amount,
        cgst: 0,
        sgst: 0,
        igst: gstAmount,
        cess: 0,
        totalGst: gstAmount,
        totalAmount: amount + gstAmount,
      };
    }
  }
  
  /**
   * Determine if transaction is inter-state
   */
  isInterState(sellerGstin, buyerGstin) {
    if (!sellerGstin || !buyerGstin) return true;
    return sellerGstin.substring(0, 2) !== buyerGstin.substring(0, 2);
  }
  
  // =============================================================================
  // E-INVOICE GENERATION (Mandatory for turnover > ₹5 Crore)
  // =============================================================================
  
  /**
   * Generate E-Invoice
   */
  async generateEInvoice(order) {
    try {
      // Get auth token
      const authToken = await this.getEInvoiceAuthToken();
      
      // Prepare invoice data as per E-Invoice schema
      const invoiceData = await this.prepareEInvoiceData(order);
      
      // Generate IRN
      const response = await this.eInvoiceApi.post('/eivital/v1.04/Invoice', invoiceData, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'gstin': order.seller.gstin,
        },
      });
      
      if (!response.data.Status || response.data.Status !== 1) {
        throw new Error(response.data.ErrorDetails?.[0]?.ErrorMessage || 'E-Invoice generation failed');
      }
      
      const result = {
        irn: response.data.Irn,
        ackNo: response.data.AckNo,
        ackDt: response.data.AckDt,
        signedInvoice: response.data.SignedInvoice,
        signedQRCode: response.data.SignedQRCode,
        qrCodeImage: response.data.QRCodeImage,
        status: 'GENERATED',
      };
      
      // Save E-Invoice details
      await prisma.eInvoice.create({
        data: {
          orderId: order.id,
          irn: result.irn,
          ackNo: result.ackNo,
          ackDt: new Date(result.ackDt),
          signedInvoice: result.signedInvoice,
          signedQRCode: result.signedQRCode,
          qrCodeImage: result.qrCodeImage,
          status: 'ACTIVE',
        },
      });
      
      // Update order
      await prisma.order.update({
        where: { id: order.id },
        data: {
          eInvoiceIrn: result.irn,
          eInvoiceGenerated: true,
          eInvoiceGeneratedAt: new Date(),
        },
      });
      
      logger.info('E-Invoice generated', { orderId: order.id, irn: result.irn });
      
      return result;
      
    } catch (error) {
      logger.error('E-Invoice generation failed', { orderId: order.id, error: error.message });
      
      await prisma.eInvoiceLog.create({
        data: {
          orderId: order.id,
          action: 'GENERATE',
          status: 'FAILED',
          errorMessage: error.message,
        },
      });
      
      throw new ExternalServiceError(`E-Invoice generation failed: ${error.message}`);
    }
  }
  
  /**
   * Prepare E-Invoice data as per NIC schema
   */
  async prepareEInvoiceData(order) {
    const seller = order.seller;
    const buyer = order.buyer;
    const items = order.items;
    
    // Transaction details
    const tranDtls = {
      TaxSch: 'GST',
      SupTyp: this.isInterState(seller.gstin, buyer.gstin) ? 'B2B' : 'SEZWP',
      RegRev: 'N',
      EcmGstin: null,
      IgstOnIntra: 'N',
    };
    
    // Document details
    const docDtls = {
      Typ: 'INV',
      No: order.invoiceNumber,
      Dt: this.formatDateForEInvoice(order.invoiceDate || new Date()),
    };
    
    // Seller details
    const sellerDtls = {
      Gstin: seller.gstin,
      LglNm: seller.legalName || seller.businessName,
      TrdNm: seller.businessName,
      Addr1: seller.addresses?.[0]?.addressLine1 || '',
      Addr2: seller.addresses?.[0]?.addressLine2 || '',
      Loc: seller.city,
      Pin: parseInt(seller.pincode),
      Stcd: seller.stateCode || seller.gstin?.substring(0, 2),
      Ph: seller.phone,
      Em: seller.email,
    };
    
    // Buyer details
    const buyerDtls = {
      Gstin: buyer.gstin,
      LglNm: buyer.legalName || buyer.businessName,
      TrdNm: buyer.businessName,
      Pos: buyer.stateCode || buyer.gstin?.substring(0, 2),
      Addr1: order.shippingAddress?.addressLine1 || '',
      Addr2: order.shippingAddress?.addressLine2 || '',
      Loc: order.shippingAddress?.city || buyer.city,
      Pin: parseInt(order.shippingAddress?.pincode || buyer.pincode),
      Stcd: buyer.stateCode || buyer.gstin?.substring(0, 2),
      Ph: buyer.phone,
      Em: buyer.email,
    };
    
    // Item list
    const itemList = items.map((item, index) => ({
      SlNo: String(index + 1),
      PrdDesc: item.product.name,
      IsServc: 'N',
      HsnCd: item.product.hsnCode || '84719000',
      Barcde: item.variant?.sku,
      Qty: item.quantity,
      FreeQty: 0,
      Unit: item.product.unit || 'NOS',
      UnitPrice: parseFloat(item.unitPrice),
      TotAmt: parseFloat(item.unitPrice) * item.quantity,
      Discount: parseFloat(item.discount || 0),
      PreTaxVal: parseFloat(item.totalPrice) - parseFloat(item.taxAmount || 0),
      AssAmt: parseFloat(item.totalPrice) - parseFloat(item.taxAmount || 0),
      GstRt: item.gstRate || 18,
      IgstAmt: this.isInterState(seller.gstin, buyer.gstin) ? parseFloat(item.taxAmount || 0) : 0,
      CgstAmt: !this.isInterState(seller.gstin, buyer.gstin) ? parseFloat(item.taxAmount || 0) / 2 : 0,
      SgstAmt: !this.isInterState(seller.gstin, buyer.gstin) ? parseFloat(item.taxAmount || 0) / 2 : 0,
      CesRt: 0,
      CesAmt: 0,
      CesNonAdvlAmt: 0,
      StateCesRt: 0,
      StateCesAmt: 0,
      StateCesNonAdvlAmt: 0,
      OthChrg: 0,
      TotItemVal: parseFloat(item.totalPrice),
    }));
    
    // Value details
    const valDtls = {
      AssVal: parseFloat(order.subtotal),
      CgstVal: !this.isInterState(seller.gstin, buyer.gstin) ? parseFloat(order.taxAmount || 0) / 2 : 0,
      SgstVal: !this.isInterState(seller.gstin, buyer.gstin) ? parseFloat(order.taxAmount || 0) / 2 : 0,
      IgstVal: this.isInterState(seller.gstin, buyer.gstin) ? parseFloat(order.taxAmount || 0) : 0,
      CesVal: 0,
      StCesVal: 0,
      Discount: parseFloat(order.discountAmount || 0),
      OthChrg: parseFloat(order.shippingAmount || 0),
      RndOffAmt: 0,
      TotInvVal: parseFloat(order.totalAmount),
    };
    
    return {
      Version: '1.1',
      TranDtls: tranDtls,
      DocDtls: docDtls,
      SellerDtls: sellerDtls,
      BuyerDtls: buyerDtls,
      ItemList: itemList,
      ValDtls: valDtls,
    };
  }
  
  /**
   * Cancel E-Invoice
   */
  async cancelEInvoice(irn, reason, remark) {
    try {
      const authToken = await this.getEInvoiceAuthToken();
      
      const response = await this.eInvoiceApi.post('/eivital/v1.04/Invoice/Cancel', {
        Irn: irn,
        CnlRsn: reason, // 1: Duplicate, 2: Data Entry Mistake, 3: Order Cancelled, 4: Others
        CnlRem: remark,
      }, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      
      if (response.data.Status !== 1) {
        throw new Error(response.data.ErrorDetails?.[0]?.ErrorMessage || 'Cancellation failed');
      }
      
      await prisma.eInvoice.update({
        where: { irn },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: remark,
        },
      });
      
      return response.data;
      
    } catch (error) {
      logger.error('E-Invoice cancellation failed', { irn, error: error.message });
      throw new ExternalServiceError(`E-Invoice cancellation failed: ${error.message}`);
    }
  }
  
  /**
   * Get E-Invoice auth token
   */
  async getEInvoiceAuthToken() {
    const cached = await cache.get('einvoice:auth_token');
    if (cached) return cached;
    
    try {
      const response = await this.eInvoiceApi.post('/eivital/v1.04/auth', {
        UserName: config.einvoice?.username,
        Password: config.einvoice?.password,
        AppKey: config.einvoice?.appKey,
        ForceRefreshAccessToken: false,
      });
      
      const token = response.data.AuthToken;
      
      // Cache for 5 hours (token valid for 6 hours)
      await cache.set('einvoice:auth_token', token, 18000);
      
      return token;
    } catch (error) {
      logger.error('E-Invoice auth failed', { error: error.message });
      throw new ExternalServiceError('E-Invoice authentication failed');
    }
  }
  
  // =============================================================================
  // E-WAY BILL GENERATION (Mandatory for goods > ₹50,000)
  // =============================================================================
  
  /**
   * Generate E-Way Bill
   */
  async generateEWayBill(order, transportDetails) {
    try {
      const authToken = await this.getEWayBillAuthToken();
      
      const eWayBillData = await this.prepareEWayBillData(order, transportDetails);
      
      const response = await this.eWayBillApi.post('/ewayapi/v1.03/ewayBill', eWayBillData, {
        headers: {
          'Authorization': `Bearer ${authToken}`,
          'gstin': order.seller.gstin,
        },
      });
      
      if (!response.data.ewayBillNo) {
        throw new Error(response.data.error?.message || 'E-Way Bill generation failed');
      }
      
      const result = {
        ewbNo: response.data.ewayBillNo,
        ewbDt: response.data.ewayBillDate,
        validUpto: response.data.validUpto,
        status: 'GENERATED',
      };
      
      // Save E-Way Bill
      await prisma.eWayBill.create({
        data: {
          orderId: order.id,
          ewbNo: result.ewbNo,
          ewbDt: new Date(result.ewbDt),
          validUpto: new Date(result.validUpto),
          fromGstin: order.seller.gstin,
          toGstin: order.buyer.gstin,
          transporterId: transportDetails.transporterId,
          transporterName: transportDetails.transporterName,
          vehicleNo: transportDetails.vehicleNo,
          transportMode: transportDetails.transportMode,
          distance: transportDetails.distance,
          status: 'ACTIVE',
        },
      });
      
      // Update order
      await prisma.order.update({
        where: { id: order.id },
        data: {
          eWayBillNo: result.ewbNo,
          eWayBillGenerated: true,
          eWayBillGeneratedAt: new Date(),
        },
      });
      
      logger.info('E-Way Bill generated', { orderId: order.id, ewbNo: result.ewbNo });
      
      return result;
      
    } catch (error) {
      logger.error('E-Way Bill generation failed', { orderId: order.id, error: error.message });
      throw new ExternalServiceError(`E-Way Bill generation failed: ${error.message}`);
    }
  }
  
  /**
   * Prepare E-Way Bill data
   */
  async prepareEWayBillData(order, transportDetails) {
    const seller = order.seller;
    const buyer = order.buyer;
    
    return {
      supplyType: 'O', // Outward
      subSupplyType: 1, // Supply
      docType: 'INV',
      docNo: order.invoiceNumber,
      docDate: this.formatDateForEWayBill(order.invoiceDate || new Date()),
      fromGstin: seller.gstin,
      fromTrdName: seller.businessName,
      fromAddr1: seller.addresses?.[0]?.addressLine1,
      fromAddr2: seller.addresses?.[0]?.addressLine2,
      fromPlace: seller.city,
      fromPincode: parseInt(seller.pincode),
      fromStateCode: parseInt(seller.gstin?.substring(0, 2)),
      toGstin: buyer.gstin,
      toTrdName: buyer.businessName,
      toAddr1: order.shippingAddress?.addressLine1,
      toAddr2: order.shippingAddress?.addressLine2,
      toPlace: order.shippingAddress?.city,
      toPincode: parseInt(order.shippingAddress?.pincode),
      toStateCode: parseInt(buyer.gstin?.substring(0, 2)),
      totalValue: parseFloat(order.subtotal),
      cgstValue: parseFloat(order.cgstAmount || 0),
      sgstValue: parseFloat(order.sgstAmount || 0),
      igstValue: parseFloat(order.igstAmount || 0),
      cessValue: 0,
      totInvValue: parseFloat(order.totalAmount),
      transporterId: transportDetails.transporterId || '',
      transporterName: transportDetails.transporterName || '',
      transMode: transportDetails.transportMode || '1', // 1: Road, 2: Rail, 3: Air, 4: Ship
      transDistance: transportDetails.distance || 0,
      vehicleNo: transportDetails.vehicleNo || '',
      vehicleType: transportDetails.vehicleType || 'R', // R: Regular, O: Over Dimensional
      itemList: order.items.map((item, index) => ({
        productName: item.product.name,
        productDesc: item.product.description?.substring(0, 100),
        hsnCode: parseInt(item.product.hsnCode || '84719000'),
        quantity: item.quantity,
        qtyUnit: item.product.unit || 'NOS',
        cgstRate: !this.isInterState(seller.gstin, buyer.gstin) ? (item.gstRate || 18) / 2 : 0,
        sgstRate: !this.isInterState(seller.gstin, buyer.gstin) ? (item.gstRate || 18) / 2 : 0,
        igstRate: this.isInterState(seller.gstin, buyer.gstin) ? (item.gstRate || 18) : 0,
        cessRate: 0,
        taxableAmount: parseFloat(item.totalPrice) - parseFloat(item.taxAmount || 0),
      })),
    };
  }
  
  /**
   * Update E-Way Bill Part B (Vehicle details)
   */
  async updateEWayBillPartB(ewbNo, vehicleDetails) {
    try {
      const authToken = await this.getEWayBillAuthToken();
      
      const response = await this.eWayBillApi.post('/ewayapi/v1.03/ewayBill/updatePartB', {
        ewbNo,
        vehicleNo: vehicleDetails.vehicleNo,
        fromPlace: vehicleDetails.fromPlace,
        fromState: vehicleDetails.fromState,
        reasonCode: vehicleDetails.reasonCode || '1', // 1: Due to breakdown, 2: Transshipment, 3: Others
        reasonRem: vehicleDetails.remark,
        transDocNo: vehicleDetails.transDocNo,
        transDocDate: vehicleDetails.transDocDate,
        transMode: vehicleDetails.transMode,
      }, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      
      return response.data;
      
    } catch (error) {
      logger.error('E-Way Bill Part B update failed', { ewbNo, error: error.message });
      throw new ExternalServiceError(`E-Way Bill update failed: ${error.message}`);
    }
  }
  
  /**
   * Extend E-Way Bill validity
   */
  async extendEWayBillValidity(ewbNo, details) {
    try {
      const authToken = await this.getEWayBillAuthToken();
      
      const response = await this.eWayBillApi.post('/ewayapi/v1.03/ewayBill/extendValidity', {
        ewbNo,
        vehicleNo: details.vehicleNo,
        fromPlace: details.fromPlace,
        fromState: details.fromState,
        remainingDistance: details.remainingDistance,
        transDocNo: details.transDocNo,
        transDocDate: details.transDocDate,
        transMode: details.transMode,
        extnRsnCode: details.reasonCode, // 1: Natural calamity, 2: Law and order, 99: Others
        extnRemarks: details.remarks,
        fromPincode: details.fromPincode,
        consignmentStatus: details.consignmentStatus || 'M', // M: In Movement, T: In Transit
      }, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      
      return response.data;
      
    } catch (error) {
      logger.error('E-Way Bill extension failed', { ewbNo, error: error.message });
      throw new ExternalServiceError(`E-Way Bill extension failed: ${error.message}`);
    }
  }
  
  /**
   * Cancel E-Way Bill
   */
  async cancelEWayBill(ewbNo, reason) {
    try {
      const authToken = await this.getEWayBillAuthToken();
      
      const response = await this.eWayBillApi.post('/ewayapi/v1.03/ewayBill/cancel', {
        ewbNo,
        cancelRsnCode: reason.code, // 1: Duplicate, 2: Data Entry Mistake, 3: Order Cancelled, 4: Others
        cancelRmrk: reason.remarks,
      }, {
        headers: { 'Authorization': `Bearer ${authToken}` },
      });
      
      await prisma.eWayBill.update({
        where: { ewbNo },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: reason.remarks,
        },
      });
      
      return response.data;
      
    } catch (error) {
      logger.error('E-Way Bill cancellation failed', { ewbNo, error: error.message });
      throw new ExternalServiceError(`E-Way Bill cancellation failed: ${error.message}`);
    }
  }
  
  /**
   * Get E-Way Bill auth token
   */
  async getEWayBillAuthToken() {
    const cached = await cache.get('ewaybill:auth_token');
    if (cached) return cached;
    
    try {
      const response = await this.eWayBillApi.post('/ewayapi/v1.03/authenticate', {
        username: config.ewayBill?.username,
        password: config.ewayBill?.password,
        gstin: config.ewayBill?.gstin,
      });
      
      const token = response.data.authToken;
      
      // Cache for 5 hours
      await cache.set('ewaybill:auth_token', token, 18000);
      
      return token;
    } catch (error) {
      logger.error('E-Way Bill auth failed', { error: error.message });
      throw new ExternalServiceError('E-Way Bill authentication failed');
    }
  }
  
  // =============================================================================
  // HSN CODE LOOKUP
  // =============================================================================
  
  /**
   * Search HSN codes
   */
  async searchHSNCode(query) {
    const cached = await cache.get(`hsn:search:${query}`);
    if (cached) return cached;
    
    const hsnCodes = await prisma.hsnCode.findMany({
      where: {
        OR: [
          { code: { contains: query } },
          { description: { contains: query, mode: 'insensitive' } },
        ],
      },
      take: 20,
    });
    
    await cache.set(`hsn:search:${query}`, hsnCodes, 3600);
    
    return hsnCodes;
  }
  
  /**
   * Get GST rate by HSN code
   */
  async getGSTRateByHSN(hsnCode) {
    const hsn = await prisma.hsnCode.findUnique({
      where: { code: hsnCode },
    });
    
    return hsn?.gstRate || 18; // Default 18%
  }
  
  // =============================================================================
  // HELPER METHODS
  // =============================================================================
  
  formatAddress(addr) {
    if (!addr) return '';
    const parts = [
      addr.bno,
      addr.flno,
      addr.bnm,
      addr.st,
      addr.loc,
      addr.dst,
      addr.stcd,
      addr.pncd,
    ].filter(Boolean);
    return parts.join(', ');
  }
  
  formatDateForEInvoice(date) {
    const d = new Date(date);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
  
  formatDateForEWayBill(date) {
    const d = new Date(date);
    return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()}`;
  }
  
  /**
   * Get state code from state name
   */
  getStateCode(stateName) {
    const stateCodes = {
      'ANDHRA PRADESH': '37',
      'ARUNACHAL PRADESH': '12',
      'ASSAM': '18',
      'BIHAR': '10',
      'CHHATTISGARH': '22',
      'GOA': '30',
      'GUJARAT': '24',
      'HARYANA': '06',
      'HIMACHAL PRADESH': '02',
      'JHARKHAND': '20',
      'KARNATAKA': '29',
      'KERALA': '32',
      'MADHYA PRADESH': '23',
      'MAHARASHTRA': '27',
      'MANIPUR': '14',
      'MEGHALAYA': '17',
      'MIZORAM': '15',
      'NAGALAND': '13',
      'ODISHA': '21',
      'PUNJAB': '03',
      'RAJASTHAN': '08',
      'SIKKIM': '11',
      'TAMIL NADU': '33',
      'TELANGANA': '36',
      'TRIPURA': '16',
      'UTTAR PRADESH': '09',
      'UTTARAKHAND': '05',
      'WEST BENGAL': '19',
      'DELHI': '07',
      'JAMMU AND KASHMIR': '01',
      'LADAKH': '38',
      'CHANDIGARH': '04',
      'PUDUCHERRY': '34',
      'ANDAMAN AND NICOBAR': '35',
      'DADRA AND NAGAR HAVELI': '26',
      'DAMAN AND DIU': '25',
      'LAKSHADWEEP': '31',
    };
    
    return stateCodes[stateName?.toUpperCase()] || null;
  }
}

module.exports = new GSTService();
