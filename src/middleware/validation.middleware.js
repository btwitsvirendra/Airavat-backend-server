// =============================================================================
// AIRAVAT B2B MARKETPLACE - VALIDATION MIDDLEWARE
// Request validation using Joi schemas
// =============================================================================

const Joi = require('joi');
const { BadRequestError } = require('../utils/errors');

/**
 * Validate request against Joi schema
 */
const validate = (schema, property = 'body') => {
  return (req, res, next) => {
    const { error, value } = schema.validate(req[property], {
      abortEarly: false,
      stripUnknown: true,
      convert: true,
    });

    if (error) {
      const errors = error.details.map((detail) => ({
        field: detail.path.join('.'),
        message: detail.message.replace(/"/g, ''),
      }));

      return next(new BadRequestError('Validation failed', errors));
    }

    req[property] = value;
    next();
  };
};

/**
 * Validate multiple parts of request
 */
const validateRequest = (schemas) => {
  return (req, res, next) => {
    const errors = [];

    for (const [property, schema] of Object.entries(schemas)) {
      const { error, value } = schema.validate(req[property], {
        abortEarly: false,
        stripUnknown: true,
        convert: true,
      });

      if (error) {
        errors.push(
          ...error.details.map((detail) => ({
            location: property,
            field: detail.path.join('.'),
            message: detail.message.replace(/"/g, ''),
          }))
        );
      } else {
        req[property] = value;
      }
    }

    if (errors.length > 0) {
      return next(new BadRequestError('Validation failed', errors));
    }

    next();
  };
};

// =============================================================================
// COMMON VALIDATION SCHEMAS
// =============================================================================

const schemas = {
  // Pagination
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string(),
    order: Joi.string().valid('asc', 'desc').default('desc'),
  }),

  // ID parameter
  id: Joi.object({
    id: Joi.string().uuid().required(),
  }),

  // Auth
  register: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().min(8).max(128).required()
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .message('Password must contain uppercase, lowercase, number and special character'),
    firstName: Joi.string().min(2).max(50).required(),
    lastName: Joi.string().min(2).max(50).required(),
    phone: Joi.string().pattern(/^[+]?[\d\s-]{10,15}$/).required(),
    role: Joi.string().valid('BUYER', 'SELLER').default('BUYER'),
  }),

  login: Joi.object({
    email: Joi.string().email().required(),
    password: Joi.string().required(),
    deviceInfo: Joi.object({
      type: Joi.string(),
      os: Joi.string(),
      browser: Joi.string(),
    }),
  }),

  forgotPassword: Joi.object({
    email: Joi.string().email().required(),
  }),

  resetPassword: Joi.object({
    token: Joi.string().required(),
    password: Joi.string().min(8).max(128).required(),
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string().min(8).max(128).required()
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/),
  }),

  // Business
  createBusiness: Joi.object({
    businessName: Joi.string().min(3).max(200).required(),
    businessType: Joi.string().valid(
      'MANUFACTURER', 'WHOLESALER', 'DISTRIBUTOR', 'RETAILER', 
      'TRADER', 'EXPORTER', 'IMPORTER', 'SERVICE_PROVIDER'
    ).required(),
    description: Joi.string().max(2000),
    gstin: Joi.string().pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/),
    pan: Joi.string().pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/),
    trn: Joi.string().pattern(/^\d{15}$/),
    phone: Joi.string().pattern(/^[+]?[\d\s-]{10,15}$/),
    email: Joi.string().email(),
    website: Joi.string().uri(),
    addressLine1: Joi.string().max(200).required(),
    addressLine2: Joi.string().max(200),
    city: Joi.string().max(100).required(),
    state: Joi.string().max(100).required(),
    country: Joi.string().max(100).default('India'),
    pincode: Joi.string().max(20).required(),
    establishedYear: Joi.number().integer().min(1800).max(new Date().getFullYear()),
    employeeCount: Joi.string().valid('1-10', '11-50', '51-200', '201-500', '500+'),
    annualTurnover: Joi.string(),
    categories: Joi.array().items(Joi.string().uuid()),
  }),

  updateBusiness: Joi.object({
    businessName: Joi.string().min(3).max(200),
    description: Joi.string().max(2000),
    logo: Joi.string().uri(),
    banner: Joi.string().uri(),
    phone: Joi.string().pattern(/^[+]?[\d\s-]{10,15}$/),
    email: Joi.string().email(),
    website: Joi.string().uri(),
    addressLine1: Joi.string().max(200),
    addressLine2: Joi.string().max(200),
    city: Joi.string().max(100),
    state: Joi.string().max(100),
    pincode: Joi.string().max(20),
    socialLinks: Joi.object({
      facebook: Joi.string().uri().allow(''),
      twitter: Joi.string().uri().allow(''),
      linkedin: Joi.string().uri().allow(''),
      instagram: Joi.string().uri().allow(''),
    }),
  }),

  // Product
  createProduct: Joi.object({
    name: Joi.string().min(3).max(200).required(),
    description: Joi.string().max(5000).required(),
    shortDescription: Joi.string().max(500),
    categoryId: Joi.string().uuid().required(),
    brand: Joi.string().max(100),
    model: Joi.string().max(100),
    sku: Joi.string().max(100),
    hsnCode: Joi.string().max(20),
    gstRate: Joi.number().valid(0, 5, 12, 18, 28),
    images: Joi.array().items(Joi.string().uri()).min(1).max(10).required(),
    videos: Joi.array().items(Joi.string().uri()).max(3),
    specifications: Joi.array().items(
      Joi.object({
        name: Joi.string().required(),
        value: Joi.string().required(),
      })
    ),
    tags: Joi.array().items(Joi.string().max(50)).max(20),
    minOrderQuantity: Joi.number().integer().min(1).default(1),
    maxOrderQuantity: Joi.number().integer().min(1),
    variants: Joi.array().items(
      Joi.object({
        variantName: Joi.string().required(),
        sku: Joi.string(),
        basePrice: Joi.number().positive().required(),
        salePrice: Joi.number().positive(),
        stockQuantity: Joi.number().integer().min(0).required(),
        attributes: Joi.object(),
        images: Joi.array().items(Joi.string().uri()),
        isDefault: Joi.boolean().default(false),
      })
    ).min(1).required(),
    bulkPricing: Joi.array().items(
      Joi.object({
        minQuantity: Joi.number().integer().min(1).required(),
        maxQuantity: Joi.number().integer(),
        price: Joi.number().positive().required(),
      })
    ),
    isCustomizable: Joi.boolean().default(false),
    leadTime: Joi.number().integer().min(0),
    warranty: Joi.string().max(200),
    returnPolicy: Joi.string().max(500),
  }),

  updateProduct: Joi.object({
    name: Joi.string().min(3).max(200),
    description: Joi.string().max(5000),
    shortDescription: Joi.string().max(500),
    categoryId: Joi.string().uuid(),
    brand: Joi.string().max(100),
    images: Joi.array().items(Joi.string().uri()).max(10),
    specifications: Joi.array().items(
      Joi.object({
        name: Joi.string().required(),
        value: Joi.string().required(),
      })
    ),
    tags: Joi.array().items(Joi.string().max(50)).max(20),
    minOrderQuantity: Joi.number().integer().min(1),
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'DRAFT'),
  }),

  // Order
  createOrder: Joi.object({
    items: Joi.array().items(
      Joi.object({
        productId: Joi.string().uuid().required(),
        variantId: Joi.string().uuid().required(),
        quantity: Joi.number().integer().min(1).required(),
      })
    ).min(1).required(),
    shippingAddressId: Joi.string().uuid().required(),
    billingAddressId: Joi.string().uuid(),
    notes: Joi.string().max(500),
    couponCode: Joi.string().max(50),
    paymentMethod: Joi.string().valid('RAZORPAY', 'BANK_TRANSFER', 'CREDIT', 'COD').default('RAZORPAY'),
  }),

  // Cart
  addToCart: Joi.object({
    productId: Joi.string().uuid().required(),
    variantId: Joi.string().uuid(),
    quantity: Joi.number().integer().min(1).default(1),
  }),

  updateCartItem: Joi.object({
    quantity: Joi.number().integer().min(1).required(),
  }),

  // Review
  createReview: Joi.object({
    rating: Joi.number().integer().min(1).max(5).required(),
    title: Joi.string().max(200),
    comment: Joi.string().max(2000).required(),
    images: Joi.array().items(Joi.string().uri()).max(5),
    pros: Joi.array().items(Joi.string().max(100)).max(5),
    cons: Joi.array().items(Joi.string().max(100)).max(5),
  }),

  // RFQ
  createRFQ: Joi.object({
    title: Joi.string().max(200).required(),
    description: Joi.string().max(2000).required(),
    categoryId: Joi.string().uuid().required(),
    quantity: Joi.number().integer().min(1).required(),
    unit: Joi.string().max(20).default('pieces'),
    targetPrice: Joi.number().positive(),
    currency: Joi.string().max(3).default('INR'),
    deliveryLocation: Joi.string().max(200).required(),
    deliveryDate: Joi.date().min('now'),
    attachments: Joi.array().items(Joi.string().uri()).max(5),
    specifications: Joi.object(),
    expiresAt: Joi.date().min('now'),
  }),

  submitQuote: Joi.object({
    price: Joi.number().positive().required(),
    quantity: Joi.number().integer().min(1).required(),
    deliveryDays: Joi.number().integer().min(1).required(),
    validUntil: Joi.date().min('now').required(),
    notes: Joi.string().max(1000),
    terms: Joi.string().max(2000),
  }),

  // Address
  createAddress: Joi.object({
    label: Joi.string().max(50).default('Default'),
    contactName: Joi.string().max(100).required(),
    phone: Joi.string().pattern(/^[+]?[\d\s-]{10,15}$/).required(),
    addressLine1: Joi.string().max(200).required(),
    addressLine2: Joi.string().max(200),
    city: Joi.string().max(100).required(),
    state: Joi.string().max(100).required(),
    country: Joi.string().max(100).default('India'),
    pincode: Joi.string().max(20).required(),
    landmark: Joi.string().max(200),
    isDefault: Joi.boolean().default(false),
    type: Joi.string().valid('SHIPPING', 'BILLING', 'BOTH').default('SHIPPING'),
  }),

  // Search
  searchProducts: Joi.object({
    q: Joi.string().max(200),
    category: Joi.string().uuid(),
    brand: Joi.string().max(500),
    minPrice: Joi.number().min(0),
    maxPrice: Joi.number().min(0),
    rating: Joi.number().min(1).max(5),
    verified: Joi.boolean(),
    inStock: Joi.boolean(),
    city: Joi.string().max(100),
    state: Joi.string().max(100),
    country: Joi.string().max(100),
    sort: Joi.string().valid('relevance', 'price_low', 'price_high', 'newest', 'rating', 'popular'),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),

  // Chat
  sendMessage: Joi.object({
    content: Joi.string().max(5000).required(),
    attachments: Joi.array().items(
      Joi.object({
        type: Joi.string().valid('image', 'document', 'video').required(),
        url: Joi.string().uri().required(),
        name: Joi.string().max(200),
        size: Joi.number().integer(),
      })
    ).max(5),
    replyTo: Joi.string().uuid(),
  }),

  // Subscription
  subscribe: Joi.object({
    planId: Joi.string().uuid().required(),
    billingCycle: Joi.string().valid('monthly', 'annual').default('monthly'),
    paymentMethodId: Joi.string(),
  }),
};

module.exports = {
  validate,
  validateRequest,
  schemas,
};
