// =============================================================================
// AIRAVAT B2B MARKETPLACE - VALIDATION SCHEMAS
// Joi validation schemas for request validation
// =============================================================================

const Joi = require('joi');

// =============================================================================
// COMMON SCHEMAS
// =============================================================================

const common = {
  id: Joi.string().min(1).max(50),
  cuid: Joi.string().pattern(/^c[a-z0-9]{24}$/),
  email: Joi.string().email().lowercase().trim(),
  phone: Joi.string().pattern(/^(\+91|91|0)?[6-9]\d{9}$/).message('Invalid Indian phone number'),
  password: Joi.string().min(8).max(128)
    .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/)
    .message('Password must contain at least one uppercase letter, one lowercase letter, and one number'),
  otp: Joi.string().length(6).pattern(/^\d+$/),
  pincode: Joi.string().pattern(/^[1-9][0-9]{5}$/).message('Invalid pincode'),
  gstin: Joi.string().pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/).message('Invalid GSTIN'),
  pan: Joi.string().pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/).message('Invalid PAN'),
  ifsc: Joi.string().pattern(/^[A-Z]{4}0[A-Z0-9]{6}$/).message('Invalid IFSC code'),
  url: Joi.string().uri(),
  slug: Joi.string().pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/).min(2).max(100),
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sortBy: Joi.string(),
    sortOrder: Joi.string().valid('asc', 'desc').default('desc'),
  }),
};

// =============================================================================
// AUTH SCHEMAS
// =============================================================================

const auth = {
  register: Joi.object({
    email: common.email.required(),
    phone: common.phone.required(),
    password: common.password.required(),
    firstName: Joi.string().min(2).max(50).trim().required(),
    lastName: Joi.string().min(1).max(50).trim().required(),
    role: Joi.string().valid('SELLER', 'BUYER').default('BUYER'),
  }),

  login: Joi.object({
    email: common.email,
    phone: common.phone,
    password: Joi.string().required(),
  }).xor('email', 'phone'), // Either email or phone required

  sendOTP: Joi.object({
    phone: common.phone,
    email: common.email,
    type: Joi.string().valid('login', 'register', 'reset', 'verify').default('login'),
  }).xor('email', 'phone'),

  verifyOTP: Joi.object({
    phone: common.phone,
    email: common.email,
    otp: common.otp.required(),
  }).xor('email', 'phone'),

  resetPassword: Joi.object({
    token: Joi.string().required(),
    password: common.password.required(),
    confirmPassword: Joi.string().valid(Joi.ref('password')).required()
      .messages({ 'any.only': 'Passwords must match' }),
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: common.password.required(),
    confirmPassword: Joi.string().valid(Joi.ref('newPassword')).required(),
  }),

  refreshToken: Joi.object({
    refreshToken: Joi.string().required(),
  }),
};

// =============================================================================
// USER SCHEMAS
// =============================================================================

const user = {
  update: Joi.object({
    firstName: Joi.string().min(2).max(50).trim(),
    lastName: Joi.string().min(1).max(50).trim(),
    avatar: common.url,
    language: Joi.string().valid('en', 'hi').default('en'),
    timezone: Joi.string().default('Asia/Kolkata'),
  }),
};

// =============================================================================
// BUSINESS SCHEMAS
// =============================================================================

const business = {
  create: Joi.object({
    businessName: Joi.string().min(2).max(200).trim().required(),
    legalName: Joi.string().max(200).trim(),
    businessType: Joi.string().valid(
      'MANUFACTURER', 'WHOLESALER', 'DISTRIBUTOR', 'RETAILER',
      'TRADER', 'EXPORTER', 'IMPORTER', 'SERVICE_PROVIDER'
    ).required(),
    description: Joi.string().max(5000),
    shortDescription: Joi.string().max(500),
    
    // Contact
    email: common.email.required(),
    phone: common.phone.required(),
    alternatePhone: common.phone,
    website: common.url,
    
    // Address
    addressLine1: Joi.string().max(500).required(),
    addressLine2: Joi.string().max(500),
    city: Joi.string().max(100).required(),
    state: Joi.string().max(100).required(),
    pincode: common.pincode.required(),
    
    // Legal
    gstin: common.gstin,
    pan: common.pan,
    
    // Branding
    logo: common.url,
    banner: common.url,
    
    establishedYear: Joi.number().integer().min(1800).max(new Date().getFullYear()),
  }),

  update: Joi.object({
    businessName: Joi.string().min(2).max(200).trim(),
    description: Joi.string().max(5000),
    shortDescription: Joi.string().max(500),
    email: common.email,
    phone: common.phone,
    alternatePhone: common.phone,
    website: common.url,
    addressLine1: Joi.string().max(500),
    addressLine2: Joi.string().max(500),
    city: Joi.string().max(100),
    state: Joi.string().max(100),
    pincode: common.pincode,
    logo: common.url,
    banner: common.url,
  }),

  addDocument: Joi.object({
    type: Joi.string().valid(
      'gst_certificate', 'pan_card', 'incorporation_certificate',
      'bank_proof', 'address_proof', 'identity_proof', 'other'
    ).required(),
    name: Joi.string().max(200).required(),
    fileUrl: common.url.required(),
    expiryDate: Joi.date(),
  }),

  addAddress: Joi.object({
    type: Joi.string().valid('billing', 'shipping', 'warehouse', 'office').required(),
    label: Joi.string().max(100),
    contactPerson: Joi.string().max(100),
    contactPhone: common.phone,
    addressLine1: Joi.string().max(500).required(),
    addressLine2: Joi.string().max(500),
    landmark: Joi.string().max(200),
    city: Joi.string().max(100).required(),
    state: Joi.string().max(100).required(),
    pincode: common.pincode.required(),
    isDefault: Joi.boolean().default(false),
  }),

  updateSettings: Joi.object({
    minOrderValue: Joi.number().min(0),
    maxOrderValue: Joi.number().min(0),
    acceptPartialOrders: Joi.boolean(),
    autoConfirmOrders: Joi.boolean(),
    orderConfirmationTime: Joi.number().integer().min(1).max(168), // Max 1 week
    acceptedPaymentMethods: Joi.array().items(Joi.string()),
    paymentTerms: Joi.string().max(500),
    creditDays: Joi.number().integer().min(0).max(90),
    returnPolicy: Joi.string().max(2000),
    returnDays: Joi.number().integer().min(0).max(30),
    autoReplyEnabled: Joi.boolean(),
    autoReplyMessage: Joi.string().max(1000),
    businessHours: Joi.object(),
    holidayMode: Joi.boolean(),
    holidayMessage: Joi.string().max(500),
  }),

  addBankDetails: Joi.object({
    bankAccountName: Joi.string().max(200).required(),
    bankAccountNumber: Joi.string().pattern(/^\d{9,18}$/).required(),
    bankIfsc: common.ifsc.required(),
    bankName: Joi.string().max(200).required(),
    bankBranch: Joi.string().max(200),
  }),
};

// =============================================================================
// CATEGORY SCHEMAS
// =============================================================================

const category = {
  create: Joi.object({
    parentId: common.id,
    name: Joi.string().min(2).max(200).trim().required(),
    description: Joi.string().max(2000),
    icon: common.url,
    image: common.url,
    banner: common.url,
    metaTitle: Joi.string().max(200),
    metaDescription: Joi.string().max(500),
    metaKeywords: Joi.array().items(Joi.string()),
    displayOrder: Joi.number().integer().min(0),
    commissionRate: Joi.number().min(0).max(50),
    attributeSchema: Joi.object(),
  }),

  update: Joi.object({
    name: Joi.string().min(2).max(200).trim(),
    description: Joi.string().max(2000),
    icon: common.url,
    image: common.url,
    banner: common.url,
    metaTitle: Joi.string().max(200),
    metaDescription: Joi.string().max(500),
    metaKeywords: Joi.array().items(Joi.string()),
    displayOrder: Joi.number().integer().min(0),
    isActive: Joi.boolean(),
    isFeatured: Joi.boolean(),
    commissionRate: Joi.number().min(0).max(50),
    attributeSchema: Joi.object(),
  }),
};

// =============================================================================
// PRODUCT SCHEMAS
// =============================================================================

const product = {
  create: Joi.object({
    categoryId: common.id.required(),
    name: Joi.string().min(2).max(500).trim().required(),
    brand: Joi.string().max(200),
    manufacturer: Joi.string().max(200),
    description: Joi.string().max(10000),
    shortDescription: Joi.string().max(500),
    hsnCode: Joi.string().pattern(/^\d{4,8}$/),
    gstRate: Joi.number().valid(0, 5, 12, 18, 28).default(18),
    specifications: Joi.object(),
    highlights: Joi.array().items(Joi.string().max(200)).max(10),
    images: Joi.array().items(common.url).min(1).max(20).required(),
    videos: Joi.array().items(common.url).max(5),
    documents: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      url: common.url.required(),
    })).max(10),
    metaTitle: Joi.string().max(200),
    metaDescription: Joi.string().max(500),
    metaKeywords: Joi.array().items(Joi.string()),
    minOrderQuantity: Joi.number().integer().min(1).default(1),
    orderMultiple: Joi.number().integer().min(1).default(1),
    leadTimeDays: Joi.number().integer().min(0).max(365).default(1),
    weight: Joi.number().positive(),
    length: Joi.number().positive(),
    width: Joi.number().positive(),
    height: Joi.number().positive(),
    countryOfOrigin: Joi.string().default('India'),
    manufactureState: Joi.string(),
    tags: Joi.array().items(Joi.string().max(50)).max(20),
    
    // Initial variant
    variants: Joi.array().items(Joi.object({
      sku: Joi.string().max(50),
      variantName: Joi.string().max(200),
      attributes: Joi.object().required(),
      basePrice: Joi.number().positive().required(),
      comparePrice: Joi.number().positive(),
      costPrice: Joi.number().positive(),
      stockQuantity: Joi.number().integer().min(0).default(0),
      lowStockThreshold: Joi.number().integer().min(0).default(10),
      trackInventory: Joi.boolean().default(true),
      allowBackorder: Joi.boolean().default(false),
      images: Joi.array().items(common.url),
      weight: Joi.number().positive(),
      pricingTiers: Joi.array().items(Joi.object({
        minQuantity: Joi.number().integer().min(1).required(),
        maxQuantity: Joi.number().integer().min(1),
        unitPrice: Joi.number().positive().required(),
      })),
    })).min(1).required(),
  }),

  update: Joi.object({
    categoryId: common.id,
    name: Joi.string().min(2).max(500).trim(),
    brand: Joi.string().max(200),
    manufacturer: Joi.string().max(200),
    description: Joi.string().max(10000),
    shortDescription: Joi.string().max(500),
    hsnCode: Joi.string().pattern(/^\d{4,8}$/),
    gstRate: Joi.number().valid(0, 5, 12, 18, 28),
    specifications: Joi.object(),
    highlights: Joi.array().items(Joi.string().max(200)).max(10),
    images: Joi.array().items(common.url).min(1).max(20),
    videos: Joi.array().items(common.url).max(5),
    documents: Joi.array().items(Joi.object({
      name: Joi.string().required(),
      url: common.url.required(),
    })).max(10),
    metaTitle: Joi.string().max(200),
    metaDescription: Joi.string().max(500),
    metaKeywords: Joi.array().items(Joi.string()),
    minOrderQuantity: Joi.number().integer().min(1),
    orderMultiple: Joi.number().integer().min(1),
    leadTimeDays: Joi.number().integer().min(0).max(365),
    weight: Joi.number().positive(),
    length: Joi.number().positive(),
    width: Joi.number().positive(),
    height: Joi.number().positive(),
    countryOfOrigin: Joi.string(),
    manufactureState: Joi.string(),
    tags: Joi.array().items(Joi.string().max(50)).max(20),
    status: Joi.string().valid('DRAFT', 'ACTIVE', 'INACTIVE'),
  }),

  addVariant: Joi.object({
    sku: Joi.string().max(50),
    variantName: Joi.string().max(200),
    attributes: Joi.object().required(),
    basePrice: Joi.number().positive().required(),
    comparePrice: Joi.number().positive(),
    costPrice: Joi.number().positive(),
    stockQuantity: Joi.number().integer().min(0).default(0),
    lowStockThreshold: Joi.number().integer().min(0).default(10),
    trackInventory: Joi.boolean().default(true),
    allowBackorder: Joi.boolean().default(false),
    images: Joi.array().items(common.url),
    weight: Joi.number().positive(),
  }),

  updateVariant: Joi.object({
    variantName: Joi.string().max(200),
    attributes: Joi.object(),
    basePrice: Joi.number().positive(),
    comparePrice: Joi.number().positive(),
    costPrice: Joi.number().positive(),
    stockQuantity: Joi.number().integer().min(0),
    lowStockThreshold: Joi.number().integer().min(0),
    trackInventory: Joi.boolean(),
    allowBackorder: Joi.boolean(),
    images: Joi.array().items(common.url),
    isActive: Joi.boolean(),
  }),

  updateInventory: Joi.object({
    variantId: common.id.required(),
    quantity: Joi.number().integer().required(),
    type: Joi.string().valid('set', 'add', 'subtract').required(),
    reason: Joi.string().max(500),
  }),

  bulkUpdateInventory: Joi.array().items(Joi.object({
    variantId: common.id.required(),
    quantity: Joi.number().integer().required(),
    type: Joi.string().valid('set', 'add', 'subtract').required(),
    reason: Joi.string().max(500),
  })).min(1).max(100),
};

// =============================================================================
// CART SCHEMAS
// =============================================================================

const cart = {
  addItem: Joi.object({
    variantId: common.id.required(),
    quantity: Joi.number().integer().min(1).required(),
    note: Joi.string().max(500),
  }),

  updateItem: Joi.object({
    quantity: Joi.number().integer().min(1).required(),
    note: Joi.string().max(500),
  }),
};

// =============================================================================
// ORDER SCHEMAS
// =============================================================================

const order = {
  create: Joi.object({
    sellerId: common.id.required(),
    items: Joi.array().items(Joi.object({
      variantId: common.id.required(),
      quantity: Joi.number().integer().min(1).required(),
    })).min(1).required(),
    shippingAddressId: common.id.required(),
    billingAddressId: common.id,
    paymentMethod: Joi.string().valid(
      'UPI', 'NETBANKING', 'CREDIT_CARD', 'DEBIT_CARD',
      'WALLET', 'NEFT', 'RTGS', 'CREDIT_LINE', 'ESCROW'
    ).required(),
    buyerNote: Joi.string().max(1000),
    discountCode: Joi.string().max(50),
  }),

  createFromQuotation: Joi.object({
    quotationId: common.id.required(),
    shippingAddressId: common.id.required(),
    billingAddressId: common.id,
    paymentMethod: Joi.string().valid(
      'UPI', 'NETBANKING', 'CREDIT_CARD', 'DEBIT_CARD',
      'WALLET', 'NEFT', 'RTGS', 'CREDIT_LINE', 'ESCROW'
    ).required(),
    buyerNote: Joi.string().max(1000),
  }),

  updateStatus: Joi.object({
    status: Joi.string().valid(
      'CONFIRMED', 'PROCESSING', 'READY_TO_SHIP', 'SHIPPED',
      'DELIVERED', 'CANCELLED'
    ).required(),
    note: Joi.string().max(1000),
  }),

  cancel: Joi.object({
    reason: Joi.string().max(1000).required(),
  }),

  requestRefund: Joi.object({
    reason: Joi.string().max(1000).required(),
    items: Joi.array().items(Joi.object({
      orderItemId: common.id.required(),
      quantity: Joi.number().integer().min(1).required(),
    })),
  }),
};

// =============================================================================
// RFQ SCHEMAS
// =============================================================================

const rfq = {
  create: Joi.object({
    title: Joi.string().min(5).max(500).trim().required(),
    description: Joi.string().max(5000),
    categoryIds: Joi.array().items(common.id).min(1).required(),
    targetSellerIds: Joi.array().items(common.id),
    isOpenRFQ: Joi.boolean().default(true),
    deliveryPincode: common.pincode,
    deliveryState: Joi.string().max(100),
    deliveryCity: Joi.string().max(100),
    requiredByDate: Joi.date().greater('now'),
    paymentTerms: Joi.string().max(500),
    deadline: Joi.date().greater('now').required(),
    attachments: Joi.array().items(common.url).max(10),
    items: Joi.array().items(Joi.object({
      productId: common.id,
      name: Joi.string().max(500).required(),
      description: Joi.string().max(2000),
      specifications: Joi.object(),
      quantity: Joi.number().integer().min(1).required(),
      unit: Joi.string().default('pieces'),
      targetPrice: Joi.number().positive(),
      maxPrice: Joi.number().positive(),
      attachments: Joi.array().items(common.url).max(5),
    })).min(1).required(),
  }),

  update: Joi.object({
    title: Joi.string().min(5).max(500).trim(),
    description: Joi.string().max(5000),
    deliveryPincode: common.pincode,
    deliveryState: Joi.string().max(100),
    deliveryCity: Joi.string().max(100),
    requiredByDate: Joi.date().greater('now'),
    paymentTerms: Joi.string().max(500),
    deadline: Joi.date().greater('now'),
    attachments: Joi.array().items(common.url).max(10),
  }),

  addItem: Joi.object({
    productId: common.id,
    name: Joi.string().max(500).required(),
    description: Joi.string().max(2000),
    specifications: Joi.object(),
    quantity: Joi.number().integer().min(1).required(),
    unit: Joi.string().default('pieces'),
    targetPrice: Joi.number().positive(),
    maxPrice: Joi.number().positive(),
    attachments: Joi.array().items(common.url).max(5),
  }),
};

// =============================================================================
// QUOTATION SCHEMAS
// =============================================================================

const quotation = {
  create: Joi.object({
    rfqId: common.id.required(),
    validityDays: Joi.number().integer().min(1).max(90).default(7),
    paymentTerms: Joi.string().max(500),
    deliveryTerms: Joi.string().max(500),
    estimatedDelivery: Joi.date().greater('now'),
    sellerNote: Joi.string().max(2000),
    termsAndConditions: Joi.string().max(5000),
    shippingAmount: Joi.number().min(0).default(0),
    discountAmount: Joi.number().min(0).default(0),
    attachments: Joi.array().items(common.url).max(10),
    items: Joi.array().items(Joi.object({
      rfqItemId: common.id.required(),
      name: Joi.string().max(500).required(),
      description: Joi.string().max(2000),
      specifications: Joi.object(),
      quantity: Joi.number().integer().min(1).required(),
      unit: Joi.string().default('pieces'),
      unitPrice: Joi.number().positive().required(),
      taxRate: Joi.number().min(0).max(28).default(18),
      leadTimeDays: Joi.number().integer().min(0),
    })).min(1).required(),
  }),

  revise: Joi.object({
    validityDays: Joi.number().integer().min(1).max(90),
    paymentTerms: Joi.string().max(500),
    deliveryTerms: Joi.string().max(500),
    estimatedDelivery: Joi.date().greater('now'),
    sellerNote: Joi.string().max(2000),
    shippingAmount: Joi.number().min(0),
    discountAmount: Joi.number().min(0),
    items: Joi.array().items(Joi.object({
      rfqItemId: common.id.required(),
      quantity: Joi.number().integer().min(1).required(),
      unitPrice: Joi.number().positive().required(),
      leadTimeDays: Joi.number().integer().min(0),
    })).min(1),
  }),

  counterOffer: Joi.object({
    buyerNote: Joi.string().max(2000),
    items: Joi.array().items(Joi.object({
      quotationItemId: common.id.required(),
      proposedPrice: Joi.number().positive().required(),
      proposedQuantity: Joi.number().integer().min(1),
    })).min(1).required(),
  }),
};

// =============================================================================
// CHAT SCHEMAS
// =============================================================================

const chat = {
  create: Joi.object({
    type: Joi.string().valid('INQUIRY', 'NEGOTIATION', 'ORDER', 'SUPPORT', 'RFQ').default('INQUIRY'),
    participantId: common.id.required(), // Business ID to chat with
    productId: common.id,
    rfqId: common.id,
    orderId: common.id,
    initialMessage: Joi.string().max(5000).required(),
  }),

  sendMessage: Joi.object({
    type: Joi.string().valid('TEXT', 'IMAGE', 'FILE', 'PRODUCT', 'QUOTATION', 'LOCATION').default('TEXT'),
    content: Joi.string().max(5000),
    attachments: Joi.array().items(Joi.object({
      type: Joi.string().required(),
      url: common.url.required(),
      name: Joi.string(),
      size: Joi.number(),
    })).max(10),
    metadata: Joi.object(),
  }).or('content', 'attachments'),
};

// =============================================================================
// REVIEW SCHEMAS
// =============================================================================

const review = {
  create: Joi.object({
    businessId: common.id.required(),
    productId: common.id,
    orderId: common.id,
    rating: Joi.number().integer().min(1).max(5).required(),
    qualityRating: Joi.number().integer().min(1).max(5),
    communicationRating: Joi.number().integer().min(1).max(5),
    deliveryRating: Joi.number().integer().min(1).max(5),
    valueRating: Joi.number().integer().min(1).max(5),
    title: Joi.string().max(200),
    content: Joi.string().max(5000),
    images: Joi.array().items(common.url).max(10),
    videos: Joi.array().items(common.url).max(3),
  }),

  respond: Joi.object({
    response: Joi.string().max(2000).required(),
  }),
};

// =============================================================================
// PAYMENT SCHEMAS
// =============================================================================

const payment = {
  createOrder: Joi.object({
    orderId: common.id.required(),
    method: Joi.string().valid(
      'UPI', 'NETBANKING', 'CREDIT_CARD', 'DEBIT_CARD', 'WALLET'
    ).required(),
  }),

  verify: Joi.object({
    razorpayOrderId: Joi.string().required(),
    razorpayPaymentId: Joi.string().required(),
    razorpaySignature: Joi.string().required(),
  }),

  refund: Joi.object({
    paymentId: common.id.required(),
    amount: Joi.number().positive(),
    reason: Joi.string().max(500).required(),
  }),
};

// =============================================================================
// SUBSCRIPTION SCHEMAS
// =============================================================================

const subscription = {
  create: Joi.object({
    planId: common.id.required(),
    billingCycle: Joi.string().valid('monthly', 'annual').default('monthly'),
  }),

  cancel: Joi.object({
    reason: Joi.string().max(1000).required(),
    cancelAtPeriodEnd: Joi.boolean().default(true),
  }),
};

// =============================================================================
// PROMOTION SCHEMAS
// =============================================================================

const promotion = {
  create: Joi.object({
    type: Joi.string().valid('promoted_listing', 'featured_banner', 'homepage_spotlight', 'category_boost').required(),
    name: Joi.string().max(200).required(),
    description: Joi.string().max(1000),
    productIds: Joi.array().items(common.id).min(1).required(),
    categoryIds: Joi.array().items(common.id),
    budgetType: Joi.string().valid('daily', 'total').required(),
    budgetAmount: Joi.number().positive().required(),
    bidType: Joi.string().valid('cpc', 'cpm'),
    bidAmount: Joi.number().positive(),
    startsAt: Joi.date().required(),
    endsAt: Joi.date().greater(Joi.ref('startsAt')),
    creativeUrl: common.url,
    creativeAlt: Joi.string().max(200),
    targetUrl: common.url,
  }),

  update: Joi.object({
    name: Joi.string().max(200),
    description: Joi.string().max(1000),
    budgetAmount: Joi.number().positive(),
    bidAmount: Joi.number().positive(),
    endsAt: Joi.date(),
    status: Joi.string().valid('active', 'paused'),
    creativeUrl: common.url,
    creativeAlt: Joi.string().max(200),
  }),
};

// =============================================================================
// SEARCH SCHEMAS
// =============================================================================

const search = {
  products: Joi.object({
    q: Joi.string().max(500),
    category: common.id,
    categories: Joi.array().items(common.id),
    minPrice: Joi.number().min(0),
    maxPrice: Joi.number().min(0),
    brands: Joi.array().items(Joi.string()),
    businessType: Joi.string(),
    state: Joi.string(),
    city: Joi.string(),
    minRating: Joi.number().min(1).max(5),
    verifiedOnly: Joi.boolean(),
    inStock: Joi.boolean(),
    sortBy: Joi.string().valid('relevance', 'price_asc', 'price_desc', 'rating', 'newest', 'popularity'),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),

  businesses: Joi.object({
    q: Joi.string().max(500),
    businessType: Joi.string(),
    categories: Joi.array().items(common.id),
    state: Joi.string(),
    city: Joi.string(),
    verifiedOnly: Joi.boolean(),
    minRating: Joi.number().min(1).max(5),
    sortBy: Joi.string().valid('relevance', 'rating', 'orders', 'newest'),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

// =============================================================================
// DISPUTE SCHEMAS
// =============================================================================

const dispute = {
  create: Joi.object({
    orderId: common.id.required(),
    type: Joi.string().valid('quality', 'delivery', 'payment', 'fraud', 'other').required(),
    reason: Joi.string().max(200).required(),
    description: Joi.string().max(5000).required(),
    evidence: Joi.array().items(Joi.object({
      type: Joi.string().required(),
      url: common.url.required(),
      description: Joi.string().max(500),
    })).max(10),
  }),

  respond: Joi.object({
    content: Joi.string().max(5000).required(),
    attachments: Joi.array().items(Joi.object({
      type: Joi.string().required(),
      url: common.url.required(),
    })).max(10),
  }),
};

// =============================================================================
// ADMIN SCHEMAS
// =============================================================================

const admin = {
  verifyBusiness: Joi.object({
    status: Joi.string().valid('VERIFIED', 'REJECTED').required(),
    notes: Joi.string().max(1000),
  }),

  approveProduct: Joi.object({
    status: Joi.string().valid('ACTIVE', 'REJECTED').required(),
    rejectionReason: Joi.string().max(500),
  }),

  resolveDispute: Joi.object({
    status: Joi.string().valid('RESOLVED_BUYER', 'RESOLVED_SELLER', 'RESOLVED_PARTIAL').required(),
    resolution: Joi.string().max(2000).required(),
    resolutionType: Joi.string().valid('refund', 'replacement', 'partial_refund', 'none').required(),
    refundAmount: Joi.number().min(0),
  }),

  updatePlatformSettings: Joi.object({
    key: Joi.string().required(),
    value: Joi.any().required(),
    description: Joi.string(),
  }),
};

module.exports = {
  common,
  auth,
  user,
  business,
  category,
  product,
  cart,
  order,
  rfq,
  quotation,
  chat,
  review,
  payment,
  subscription,
  promotion,
  search,
  dispute,
  admin,
};
