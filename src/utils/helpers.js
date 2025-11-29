// =============================================================================
// AIRAVAT B2B MARKETPLACE - HELPER UTILITIES
// General purpose helper functions
// =============================================================================

const crypto = require('crypto');
const slugify = require('slugify');
const { nanoid } = require('nanoid');
const dayjs = require('dayjs');
const utc = require('dayjs/plugin/utc');
const timezone = require('dayjs/plugin/timezone');

dayjs.extend(utc);
dayjs.extend(timezone);

// =============================================================================
// STRING UTILITIES
// =============================================================================

/**
 * Generate URL-friendly slug
 */
const generateSlug = (text, options = {}) => {
  const slug = slugify(text, {
    lower: true,
    strict: true,
    locale: 'en',
    ...options,
  });
  
  // Add random suffix to ensure uniqueness
  if (options.unique !== false) {
    return `${slug}-${nanoid(6).toLowerCase()}`;
  }
  
  return slug;
};

/**
 * Generate unique ID with optional prefix
 */
const generateId = (prefix = '') => {
  const id = nanoid(16);
  return prefix ? `${prefix}_${id}` : id;
};

/**
 * Generate order number: AIR-2024-000001
 */
const generateOrderNumber = async (prisma) => {
  const year = new Date().getFullYear();
  const count = await prisma.order.count({
    where: {
      createdAt: {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${year + 1}-01-01`),
      },
    },
  });
  
  return `AIR-${year}-${String(count + 1).padStart(6, '0')}`;
};

/**
 * Generate RFQ number: RFQ-2024-000001
 */
const generateRFQNumber = async (prisma) => {
  const year = new Date().getFullYear();
  const count = await prisma.rFQ.count({
    where: {
      createdAt: {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${year + 1}-01-01`),
      },
    },
  });
  
  return `RFQ-${year}-${String(count + 1).padStart(6, '0')}`;
};

/**
 * Generate quotation number: QT-2024-000001
 */
const generateQuotationNumber = async (prisma) => {
  const year = new Date().getFullYear();
  const count = await prisma.quotation.count({
    where: {
      createdAt: {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${year + 1}-01-01`),
      },
    },
  });
  
  return `QT-${year}-${String(count + 1).padStart(6, '0')}`;
};

/**
 * Generate invoice number: INV-2024-000001
 */
const generateInvoiceNumber = async (prisma) => {
  const year = new Date().getFullYear();
  const count = await prisma.order.count({
    where: {
      invoiceNumber: { not: null },
      createdAt: {
        gte: new Date(`${year}-01-01`),
        lt: new Date(`${year + 1}-01-01`),
      },
    },
  });
  
  return `INV-${year}-${String(count + 1).padStart(6, '0')}`;
};

/**
 * Generate SKU code
 */
const generateSKU = (businessPrefix, categoryCode, productId) => {
  const prefix = businessPrefix.substring(0, 3).toUpperCase();
  const category = categoryCode.substring(0, 3).toUpperCase();
  const random = nanoid(6).toUpperCase();
  return `${prefix}-${category}-${random}`;
};

/**
 * Mask sensitive data (email, phone, etc.)
 */
const maskEmail = (email) => {
  if (!email) return '';
  const [name, domain] = email.split('@');
  const maskedName = name.charAt(0) + '*'.repeat(Math.max(1, name.length - 2)) + name.charAt(name.length - 1);
  return `${maskedName}@${domain}`;
};

const maskPhone = (phone) => {
  if (!phone) return '';
  return phone.slice(0, 4) + '*'.repeat(Math.max(1, phone.length - 6)) + phone.slice(-2);
};

const maskPAN = (pan) => {
  if (!pan) return '';
  return pan.slice(0, 2) + '****' + pan.slice(-2);
};

const maskGSTIN = (gstin) => {
  if (!gstin) return '';
  return gstin.slice(0, 2) + '****' + gstin.slice(-3);
};

// =============================================================================
// CRYPTO UTILITIES
// =============================================================================

/**
 * Generate random OTP
 */
const generateOTP = (length = 6) => {
  const digits = '0123456789';
  let otp = '';
  for (let i = 0; i < length; i++) {
    otp += digits[Math.floor(Math.random() * 10)];
  }
  return otp;
};

/**
 * Generate secure random token
 */
const generateToken = (length = 32) => {
  return crypto.randomBytes(length).toString('hex');
};

/**
 * Hash data with SHA256
 */
const hashSHA256 = (data) => {
  return crypto.createHash('sha256').update(data).digest('hex');
};

/**
 * Create HMAC signature
 */
const createHMAC = (data, secret) => {
  return crypto.createHmac('sha256', secret).update(data).digest('hex');
};

/**
 * Verify Razorpay signature
 */
const verifyRazorpaySignature = (orderId, paymentId, signature, secret) => {
  const generatedSignature = createHMAC(`${orderId}|${paymentId}`, secret);
  return generatedSignature === signature;
};

// =============================================================================
// DATE UTILITIES
// =============================================================================

/**
 * Format date for display
 */
const formatDate = (date, format = 'DD MMM YYYY') => {
  return dayjs(date).format(format);
};

/**
 * Format date with time
 */
const formatDateTime = (date, format = 'DD MMM YYYY, hh:mm A') => {
  return dayjs(date).format(format);
};

/**
 * Get IST (Indian Standard Time)
 */
const toIST = (date) => {
  return dayjs(date).tz('Asia/Kolkata');
};

/**
 * Calculate date range
 */
const getDateRange = (period) => {
  const now = dayjs();
  
  switch (period) {
    case 'today':
      return { start: now.startOf('day'), end: now.endOf('day') };
    case 'yesterday':
      return { start: now.subtract(1, 'day').startOf('day'), end: now.subtract(1, 'day').endOf('day') };
    case 'week':
      return { start: now.startOf('week'), end: now.endOf('week') };
    case 'month':
      return { start: now.startOf('month'), end: now.endOf('month') };
    case 'quarter':
      return { start: now.startOf('quarter'), end: now.endOf('quarter') };
    case 'year':
      return { start: now.startOf('year'), end: now.endOf('year') };
    case 'last7days':
      return { start: now.subtract(7, 'day').startOf('day'), end: now.endOf('day') };
    case 'last30days':
      return { start: now.subtract(30, 'day').startOf('day'), end: now.endOf('day') };
    case 'last90days':
      return { start: now.subtract(90, 'day').startOf('day'), end: now.endOf('day') };
    default:
      return { start: now.startOf('day'), end: now.endOf('day') };
  }
};

/**
 * Check if date is past
 */
const isPast = (date) => {
  return dayjs(date).isBefore(dayjs());
};

/**
 * Check if date is future
 */
const isFuture = (date) => {
  return dayjs(date).isAfter(dayjs());
};

/**
 * Add business days (excluding weekends)
 */
const addBusinessDays = (date, days) => {
  let result = dayjs(date);
  let remaining = days;
  
  while (remaining > 0) {
    result = result.add(1, 'day');
    if (result.day() !== 0 && result.day() !== 6) {
      remaining--;
    }
  }
  
  return result.toDate();
};

// =============================================================================
// NUMBER UTILITIES
// =============================================================================

/**
 * Format currency (INR)
 */
const formatCurrency = (amount, currency = 'INR') => {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
};

/**
 * Format large numbers (1K, 1M, 1Cr, etc.)
 */
const formatNumber = (num) => {
  if (num >= 10000000) return (num / 10000000).toFixed(1) + ' Cr';
  if (num >= 100000) return (num / 100000).toFixed(1) + ' L';
  if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
  return num.toString();
};

/**
 * Calculate percentage
 */
const calculatePercentage = (value, total) => {
  if (total === 0) return 0;
  return ((value / total) * 100).toFixed(2);
};

/**
 * Round to decimal places
 */
const roundTo = (num, decimals = 2) => {
  return Math.round(num * Math.pow(10, decimals)) / Math.pow(10, decimals);
};

// =============================================================================
// VALIDATION UTILITIES
// =============================================================================

/**
 * Validate GSTIN format
 */
const isValidGSTIN = (gstin) => {
  const gstinRegex = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/;
  return gstinRegex.test(gstin);
};

/**
 * Validate PAN format
 */
const isValidPAN = (pan) => {
  const panRegex = /^[A-Z]{5}[0-9]{4}[A-Z]{1}$/;
  return panRegex.test(pan);
};

/**
 * Validate Indian phone number
 */
const isValidIndianPhone = (phone) => {
  const phoneRegex = /^(\+91|91|0)?[6-9]\d{9}$/;
  return phoneRegex.test(phone.replace(/\s/g, ''));
};

/**
 * Validate pincode
 */
const isValidPincode = (pincode) => {
  const pincodeRegex = /^[1-9][0-9]{5}$/;
  return pincodeRegex.test(pincode);
};

/**
 * Validate IFSC code
 */
const isValidIFSC = (ifsc) => {
  const ifscRegex = /^[A-Z]{4}0[A-Z0-9]{6}$/;
  return ifscRegex.test(ifsc);
};

/**
 * Validate HSN code
 */
const isValidHSN = (hsn) => {
  const hsnRegex = /^\d{4,8}$/;
  return hsnRegex.test(hsn);
};

// =============================================================================
// OBJECT UTILITIES
// =============================================================================

/**
 * Pick specific keys from object
 */
const pick = (obj, keys) => {
  return keys.reduce((acc, key) => {
    if (obj && Object.prototype.hasOwnProperty.call(obj, key)) {
      acc[key] = obj[key];
    }
    return acc;
  }, {});
};

/**
 * Omit specific keys from object
 */
const omit = (obj, keys) => {
  const result = { ...obj };
  keys.forEach((key) => delete result[key]);
  return result;
};

/**
 * Deep clone object
 */
const deepClone = (obj) => {
  return JSON.parse(JSON.stringify(obj));
};

/**
 * Check if object is empty
 */
const isEmpty = (obj) => {
  if (!obj) return true;
  if (Array.isArray(obj)) return obj.length === 0;
  return Object.keys(obj).length === 0;
};

/**
 * Flatten nested object
 */
const flattenObject = (obj, prefix = '') => {
  return Object.keys(obj).reduce((acc, key) => {
    const pre = prefix.length ? `${prefix}.` : '';
    if (typeof obj[key] === 'object' && obj[key] !== null && !Array.isArray(obj[key])) {
      Object.assign(acc, flattenObject(obj[key], pre + key));
    } else {
      acc[pre + key] = obj[key];
    }
    return acc;
  }, {});
};

// =============================================================================
// ARRAY UTILITIES
// =============================================================================

/**
 * Remove duplicates from array
 */
const unique = (arr) => [...new Set(arr)];

/**
 * Chunk array into smaller arrays
 */
const chunk = (arr, size) => {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
};

/**
 * Group array by key
 */
const groupBy = (arr, key) => {
  return arr.reduce((acc, item) => {
    const group = item[key];
    acc[group] = acc[group] || [];
    acc[group].push(item);
    return acc;
  }, {});
};

// =============================================================================
// PAGINATION UTILITIES
// =============================================================================

/**
 * Parse pagination params
 */
const parsePagination = (query) => {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  const skip = (page - 1) * limit;
  
  return { page, limit, skip };
};

/**
 * Build pagination meta
 */
const buildPaginationMeta = (page, limit, total) => {
  const totalPages = Math.ceil(total / limit);
  
  return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
  };
};

// =============================================================================
// GST CALCULATION UTILITIES
// =============================================================================

/**
 * Calculate GST components
 */
const calculateGST = (amount, gstRate, isInterstate = false) => {
  const gstAmount = roundTo((amount * gstRate) / 100);
  
  if (isInterstate) {
    return {
      cgst: 0,
      sgst: 0,
      igst: gstAmount,
      total: gstAmount,
    };
  }
  
  const halfGst = roundTo(gstAmount / 2);
  return {
    cgst: halfGst,
    sgst: halfGst,
    igst: 0,
    total: gstAmount,
  };
};

/**
 * Check if transaction is interstate (different states)
 */
const isInterstate = (sellerState, buyerState) => {
  return sellerState?.toLowerCase() !== buyerState?.toLowerCase();
};

module.exports = {
  // String
  generateSlug,
  generateId,
  generateOrderNumber,
  generateRFQNumber,
  generateQuotationNumber,
  generateInvoiceNumber,
  generateSKU,
  maskEmail,
  maskPhone,
  maskPAN,
  maskGSTIN,
  
  // Crypto
  generateOTP,
  generateToken,
  hashSHA256,
  createHMAC,
  verifyRazorpaySignature,
  
  // Date
  formatDate,
  formatDateTime,
  toIST,
  getDateRange,
  isPast,
  isFuture,
  addBusinessDays,
  
  // Number
  formatCurrency,
  formatNumber,
  calculatePercentage,
  roundTo,
  
  // Validation
  isValidGSTIN,
  isValidPAN,
  isValidIndianPhone,
  isValidPincode,
  isValidIFSC,
  isValidHSN,
  
  // Object
  pick,
  omit,
  deepClone,
  isEmpty,
  flattenObject,
  
  // Array
  unique,
  chunk,
  groupBy,
  
  // Pagination
  parsePagination,
  buildPaginationMeta,
  
  // GST
  calculateGST,
  isInterstate,
};
