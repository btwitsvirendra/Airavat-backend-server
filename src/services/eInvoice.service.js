// =============================================================================
// AIRAVAT B2B MARKETPLACE - E-INVOICE SERVICE
// GST Compliant E-Invoicing with IRN Generation
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const { NotFoundError, BadRequestError, ExternalServiceError } = require('../utils/errors');
const { generateId, formatCurrency } = require('../utils/helpers');
const { emitToBusiness } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const INVOICE_STATUS = { PENDING: 'PENDING', GENERATED: 'GENERATED', CANCELLED: 'CANCELLED', FAILED: 'FAILED' };
const SUPPLY_TYPE = { B2B: 'B2B', B2C: 'B2C', SEZWP: 'SEZWP', EXPWP: 'EXPWP' };
const DOC_TYPE = { INV: 'INV', CRN: 'CRN', DBN: 'DBN' };

const STATE_CODES = {
  'Andhra Pradesh': '37', 'Bihar': '10', 'Delhi': '07', 'Gujarat': '24', 'Karnataka': '29',
  'Kerala': '32', 'Maharashtra': '27', 'Rajasthan': '08', 'Tamil Nadu': '33', 'Telangana': '36',
  'Uttar Pradesh': '09', 'West Bengal': '19',
};

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

const getStateCode = (state) => STATE_CODES[state] || '27';
const generateInvoiceNumber = (order) => {
  const date = new Date();
  const fy = date.getMonth() >= 3 ? `${date.getFullYear()}-${(date.getFullYear() + 1).toString().slice(-2)}` : `${date.getFullYear() - 1}-${date.getFullYear().toString().slice(-2)}`;
  return `INV/${fy}/${order.orderNumber}`;
};
const isInterstate = (sellerState, buyerState) => getStateCode(sellerState) !== getStateCode(buyerState);

// =============================================================================
// E-INVOICE GENERATION
// =============================================================================

const generateEInvoice = async (orderId) => {
  const order = await prisma.order.findUnique({
    where: { id: orderId },
    include: {
      items: { include: { product: { select: { name: true, hsnCode: true, gstRate: true } } } },
      buyer: { include: { addresses: { where: { isDefault: true }, take: 1 } } },
      seller: { include: { addresses: { where: { isDefault: true }, take: 1 } } },
    },
  });

  if (!order) throw new NotFoundError('Order');

  const existingInvoice = await prisma.eInvoice.findUnique({ where: { orderId } });
  if (existingInvoice && existingInvoice.irn) return existingInvoice;

  if (!order.seller.gstNumber) throw new BadRequestError('Seller GST number is required for e-invoicing');

  const invoicePayload = buildInvoicePayload(order);
  const irnResponse = await generateIRN(invoicePayload);
  const taxBreakdown = calculateTaxBreakdown(order);

  const eInvoice = await prisma.eInvoice.upsert({
    where: { orderId },
    create: {
      orderId, invoiceNumber: generateInvoiceNumber(order), invoiceDate: new Date(),
      irn: irnResponse.irn, ackNumber: irnResponse.ackNo, ackDate: new Date(irnResponse.ackDt || Date.now()),
      signedInvoice: irnResponse.signedInvoice, signedQRCode: irnResponse.signedQRCode,
      status: INVOICE_STATUS.GENERATED, invoiceData: invoicePayload,
      sellerGstin: order.seller.gstNumber, buyerGstin: order.buyer.gstNumber,
      totalValue: order.totalAmount, taxableValue: order.subtotal,
      cgstAmount: taxBreakdown.cgst, sgstAmount: taxBreakdown.sgst, igstAmount: taxBreakdown.igst,
    },
    update: { irn: irnResponse.irn, ackNumber: irnResponse.ackNo, status: INVOICE_STATUS.GENERATED },
  });

  logger.info('E-Invoice generated', { invoiceId: eInvoice.id, orderId, irn: eInvoice.irn });
  emitToBusiness(order.sellerId, 'einvoice:generated', { orderId, invoiceNumber: eInvoice.invoiceNumber, irn: eInvoice.irn });

  return eInvoice;
};

const buildInvoicePayload = (order) => {
  const sellerAddr = order.seller.addresses[0] || {};
  const buyerAddr = order.shippingAddress || order.buyer.addresses[0] || {};
  const isInterstateSupply = isInterstate(sellerAddr.state, buyerAddr.state);

  return {
    Version: '1.1',
    TranDtls: { TaxSch: 'GST', SupTyp: order.buyer.gstNumber ? SUPPLY_TYPE.B2B : SUPPLY_TYPE.B2C },
    DocDtls: { Typ: DOC_TYPE.INV, No: generateInvoiceNumber(order), Dt: new Date().toLocaleDateString('en-GB') },
    SellerDtls: {
      Gstin: order.seller.gstNumber, LglNm: order.seller.legalName || order.seller.businessName,
      Addr1: sellerAddr.addressLine1 || '', Loc: sellerAddr.city || '', Pin: parseInt(sellerAddr.pincode) || 0, Stcd: getStateCode(sellerAddr.state),
    },
    BuyerDtls: {
      Gstin: order.buyer.gstNumber || 'URP', LglNm: order.buyer.legalName || order.buyer.businessName,
      Addr1: buyerAddr.addressLine1 || '', Loc: buyerAddr.city || '', Pin: parseInt(buyerAddr.pincode) || 0, Stcd: getStateCode(buyerAddr.state),
    },
    ItemList: order.items.map((item, index) => {
      const taxRate = item.product?.gstRate || 18;
      const taxableAmount = parseFloat(item.unitPrice) * item.quantity;
      const taxAmount = (taxableAmount * taxRate) / 100;
      return {
        SlNo: String(index + 1), PrdDesc: item.productName || item.product?.name, HsnCd: item.product?.hsnCode || '99999999',
        Qty: item.quantity, UnitPrice: parseFloat(item.unitPrice), TotAmt: taxableAmount, AssAmt: taxableAmount, GstRt: taxRate,
        IgstAmt: isInterstateSupply ? taxAmount : 0, CgstAmt: isInterstateSupply ? 0 : taxAmount / 2, SgstAmt: isInterstateSupply ? 0 : taxAmount / 2,
        TotItemVal: parseFloat(item.totalPrice),
      };
    }),
    ValDtls: { AssVal: parseFloat(order.subtotal), TotInvVal: parseFloat(order.totalAmount) },
  };
};

const calculateTaxBreakdown = (order) => {
  const sellerAddr = order.seller.addresses?.[0];
  const buyerAddr = order.shippingAddress || order.buyer.addresses?.[0];
  const isInterstateSupply = isInterstate(sellerAddr?.state, buyerAddr?.state);

  let cgst = 0, sgst = 0, igst = 0;
  order.items.forEach((item) => {
    const taxRate = item.product?.gstRate || 18;
    const taxableAmount = parseFloat(item.unitPrice) * item.quantity;
    const taxAmount = (taxableAmount * taxRate) / 100;
    if (isInterstateSupply) { igst += taxAmount; } else { cgst += taxAmount / 2; sgst += taxAmount / 2; }
  });

  return { cgst, sgst, igst, cess: 0 };
};

const generateIRN = async (payload) => {
  const mockIrn = generateId().toUpperCase();
  return { irn: mockIrn, ackNo: Date.now().toString(), ackDt: new Date().toISOString(), signedInvoice: `SIGNED_${mockIrn}`, signedQRCode: `QR_${mockIrn}` };
};

// =============================================================================
// E-INVOICE MANAGEMENT
// =============================================================================

const cancelEInvoice = async (orderId, reason) => {
  const eInvoice = await prisma.eInvoice.findUnique({ where: { orderId } });
  if (!eInvoice) throw new NotFoundError('E-Invoice');
  if (eInvoice.status === INVOICE_STATUS.CANCELLED) throw new BadRequestError('E-Invoice already cancelled');

  const hoursSinceGeneration = (Date.now() - new Date(eInvoice.ackDate).getTime()) / (1000 * 60 * 60);
  if (hoursSinceGeneration > 24) throw new BadRequestError('E-Invoice can only be cancelled within 24 hours');

  await prisma.eInvoice.update({
    where: { id: eInvoice.id }, data: { status: INVOICE_STATUS.CANCELLED, cancelledAt: new Date(), cancelReason: reason },
  });

  logger.info('E-Invoice cancelled', { invoiceId: eInvoice.id, irn: eInvoice.irn, reason });
  return { success: true };
};

const getEInvoice = async (orderId) => {
  const eInvoice = await prisma.eInvoice.findUnique({ where: { orderId } });
  if (!eInvoice) throw new NotFoundError('E-Invoice');
  return { ...eInvoice, formattedTotalValue: formatCurrency(eInvoice.totalValue) };
};

const getEInvoices = async (businessId, options = {}) => {
  const { page = 1, limit = 20, status } = options;
  const skip = (page - 1) * limit;
  const where = { order: { OR: [{ buyerId: businessId }, { sellerId: businessId }] } };
  if (status) where.status = status;

  const [invoices, total] = await Promise.all([
    prisma.eInvoice.findMany({ where, skip, take: limit, orderBy: { invoiceDate: 'desc' }, include: { order: { select: { orderNumber: true } } } }),
    prisma.eInvoice.count({ where }),
  ]);

  return {
    invoices: invoices.map((inv) => ({ ...inv, formattedTotalValue: formatCurrency(inv.totalValue) })),
    pagination: { page, limit, total, totalPages: Math.ceil(total / limit) },
  };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  INVOICE_STATUS, SUPPLY_TYPE, DOC_TYPE, STATE_CODES,
  getStateCode, generateInvoiceNumber, isInterstate,
  generateEInvoice, buildInvoicePayload, cancelEInvoice, getEInvoice, getEInvoices,
};
