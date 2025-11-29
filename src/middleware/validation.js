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
        message: detail.message.replace(/['"]/g, ''),
      }));

      throw new BadRequestError('Validation failed', errors);
    }

    // Replace with validated/sanitized values
    req[property] = value;
    next();
  };
};

/**
 * Validate multiple parts of request
 */
const validateAll = (schemas) => {
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
            field: `${property}.${detail.path.join('.')}`,
            message: detail.message.replace(/['"]/g, ''),
          }))
        );
      } else {
        req[property] = value;
      }
    }

    if (errors.length > 0) {
      throw new BadRequestError('Validation failed', errors);
    }

    next();
  };
};

// =============================================================================
// COMMON VALIDATION SCHEMAS
// =============================================================================

const commonSchemas = {
  // Pagination
  pagination: Joi.object({
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
    sort: Joi.string(),
    order: Joi.string().valid('asc', 'desc').default('desc'),
  }),

  // UUID
  uuid: Joi.string().uuid({ version: 'uuidv4' }),

  // MongoDB ObjectId (if using)
  objectId: Joi.string().pattern(/^[0-9a-fA-F]{24}$/),

  // Email
  email: Joi.string().email().lowercase().trim(),

  // Phone (India/UAE)
  phone: Joi.string().pattern(/^(\+91|91|0)?[6-9]\d{9}$|^(\+971|971|0)?[0-9]{8,9}$/),

  // GSTIN
  gstin: Joi.string().pattern(/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/),

  // UAE TRN
  trn: Joi.string().pattern(/^[0-9]{15}$/),

  // PAN
  pan: Joi.string().pattern(/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/),

  // Pincode (India)
  pincode: Joi.string().pattern(/^[1-9][0-9]{5}$/),

  // Date range
  dateRange: Joi.object({
    from: Joi.date().iso(),
    to: Joi.date().iso().min(Joi.ref('from')),
  }),

  // Price
  price: Joi.number().precision(2).positive(),

  // Quantity
  quantity: Joi.number().integer().min(1),

  // Slug
  slug: Joi.string()
    .pattern(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .min(3)
    .max(100),

  // URL
  url: Joi.string().uri({ scheme: ['http', 'https'] }),

  // Image URL or path
  image: Joi.string().pattern(/^(https?:\/\/|\/uploads\/).+\.(jpg|jpeg|png|gif|webp)$/i),

  // Search query
  searchQuery: Joi.string().min(2).max(100).trim(),
};

// =============================================================================
// AUTH VALIDATION SCHEMAS
// =============================================================================

const authSchemas = {
  register: Joi.object({
    email: commonSchemas.email.required(),
    password: Joi.string()
      .min(8)
      .max(72)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
      .messages({
        'string.pattern.base':
          'Password must contain at least one uppercase letter, one lowercase letter, one number and one special character',
      }),
    firstName: Joi.string().min(2).max(50).trim().required(),
    lastName: Joi.string().min(2).max(50).trim().required(),
    phone: commonSchemas.phone,
    role: Joi.string().valid('BUYER', 'SELLER', 'BOTH').default('BUYER'),
  }),

  login: Joi.object({
    email: commonSchemas.email.required(),
    password: Joi.string().required(),
    rememberMe: Joi.boolean().default(false),
  }),

  forgotPassword: Joi.object({
    email: commonSchemas.email.required(),
  }),

  resetPassword: Joi.object({
    token: Joi.string().required(),
    password: Joi.string()
      .min(8)
      .max(72)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required(),
  }),

  changePassword: Joi.object({
    currentPassword: Joi.string().required(),
    newPassword: Joi.string()
      .min(8)
      .max(72)
      .pattern(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[@$!%*?&])[A-Za-z\d@$!%*?&]/)
      .required()
      .invalid(Joi.ref('currentPassword'))
      .messages({
        'any.invalid': 'New password must be different from current password',
      }),
  }),

  verifyOTP: Joi.object({
    email: commonSchemas.email,
    phone: commonSchemas.phone,
    otp: Joi.string().length(6).pattern(/^\d+$/).required(),
  }).xor('email', 'phone'),
};

// =============================================================================
// BUSINESS VALIDATION SCHEMAS
// =============================================================================

const businessSchemas = {
  create: Joi.object({
    businessName: Joi.string().min(3).max(200).trim().required(),
    businessType: Joi.string()
      .valid('MANUFACTURER', 'WHOLESALER', 'DISTRIBUTOR', 'RETAILER', 'SERVICE_PROVIDER', 'TRADER')
      .required(),
    gstin: commonSchemas.gstin,
    trn: commonSchemas.trn,
    pan: commonSchemas.pan,
    email: commonSchemas.email.required(),
    phone: commonSchemas.phone.required(),
    website: commonSchemas.url,
    description: Joi.string().max(2000),
    addressLine1: Joi.string().max(200).required(),
    addressLine2: Joi.string().max(200),
    city: Joi.string().max(100).required(),
    state: Joi.string().max(100).required(),
    country: Joi.string().valid('IN', 'AE').required(),
    pincode: Joi.string().max(10).required(),
    establishedYear: Joi.number().integer().min(1900).max(new Date().getFullYear()),
    employeeCount: Joi.string().valid('1-10', '11-50', '51-200', '201-500', '500+'),
    annualTurnover: Joi.string(),
    categories: Joi.array().items(Joi.string().uuid()).min(1),
  }),

  update: Joi.object({
    businessName: Joi.string().min(3).max(200).trim(),
    description: Joi.string().max(2000),
    logo: commonSchemas.image,
    banner: commonSchemas.image,
    website: commonSchemas.url,
    socialLinks: Joi.object({
      facebook: commonSchemas.url,
      linkedin: commonSchemas.url,
      twitter: commonSchemas.url,
      instagram: commonSchemas.url,
    }),
    email: commonSchemas.email,
    phone: commonSchemas.phone,
    whatsapp: commonSchemas.phone,
    addressLine1: Joi.string().max(200),
    addressLine2: Joi.string().max(200),
    city: Joi.string().max(100),
    state: Joi.string().max(100),
    pincode: Joi.string().max(10),
  }),
};

// =============================================================================
// PRODUCT VALIDATION SCHEMAS
// =============================================================================

const productSchemas = {
  create: Joi.object({
    name: Joi.string().min(3).max(200).trim().required(),
    description: Joi.string().min(20).max(10000).required(),
    shortDescription: Joi.string().max(500),
    categoryId: Joi.string().uuid().required(),
    brand: Joi.string().max(100),
    hsnCode: Joi.string().pattern(/^\d{4,8}$/),
    tags: Joi.array().items(Joi.string().max(50)).max(20),
    images: Joi.array().items(commonSchemas.image).min(1).max(10).required(),
    videos: Joi.array().items(commonSchemas.url).max(3),
    specifications: Joi.object().pattern(Joi.string(), Joi.string()),
    minOrderQuantity: Joi.number().integer().min(1).default(1),
    maxOrderQuantity: Joi.number().integer().min(Joi.ref('minOrderQuantity')),
    unitType: Joi.string().valid('piece', 'kg', 'g', 'l', 'ml', 'm', 'cm', 'ft', 'box', 'pack', 'set').default('piece'),
    variants: Joi.array()
      .items(
        Joi.object({
          variantName: Joi.string().max(100),
          sku: Joi.string().max(50).required(),
          basePrice: commonSchemas.price.required(),
          salePrice: commonSchemas.price,
          stockQuantity: Joi.number().integer().min(0).default(0),
          attributes: Joi.object().pattern(Joi.string(), Joi.string()),
          images: Joi.array().items(commonSchemas.image),
          isDefault: Joi.boolean().default(false),
        })
      )
      .min(1)
      .required(),
    seoTitle: Joi.string().max(70),
    seoDescription: Joi.string().max(160),
    seoKeywords: Joi.array().items(Joi.string()).max(10),
  }),

  update: Joi.object({
    name: Joi.string().min(3).max(200).trim(),
    description: Joi.string().min(20).max(10000),
    shortDescription: Joi.string().max(500),
    categoryId: Joi.string().uuid(),
    brand: Joi.string().max(100),
    hsnCode: Joi.string().pattern(/^\d{4,8}$/),
    tags: Joi.array().items(Joi.string().max(50)).max(20),
    images: Joi.array().items(commonSchemas.image).min(1).max(10),
    videos: Joi.array().items(commonSchemas.url).max(3),
    specifications: Joi.object().pattern(Joi.string(), Joi.string()),
    minOrderQuantity: Joi.number().integer().min(1),
    status: Joi.string().valid('ACTIVE', 'INACTIVE', 'DRAFT'),
  }),

  search: Joi.object({
    q: Joi.string().max(100),
    category: Joi.string().uuid(),
    brand: Joi.string(),
    minPrice: Joi.number().min(0),
    maxPrice: Joi.number().min(Joi.ref('minPrice')),
    rating: Joi.number().min(1).max(5),
    verified: Joi.boolean(),
    inStock: Joi.boolean(),
    city: Joi.string(),
    state: Joi.string(),
    country: Joi.string().valid('IN', 'AE'),
    sort: Joi.string().valid('relevance', 'price_low', 'price_high', 'newest', 'rating', 'popular'),
    page: Joi.number().integer().min(1).default(1),
    limit: Joi.number().integer().min(1).max(100).default(20),
  }),
};

// =============================================================================
// ORDER VALIDATION SCHEMAS
// =============================================================================

const orderSchemas = {
  create: Joi.object({
    items: Joi.array()
      .items(
        Joi.object({
          productId: Joi.string().uuid().required(),
          variantId: Joi.string().uuid().required(),
          quantity: commonSchemas.quantity.required(),
        })
      )
      .min(1)
      .required(),
    shippingAddressId: Joi.string().uuid().required(),
    billingAddressId: Joi.string().uuid(),
    paymentMethod: Joi.string().valid('RAZORPAY', 'CREDIT', 'COD', 'BANK_TRANSFER').required(),
    notes: Joi.string().max(500),
    couponCode: Joi.string().max(50),
  }),

  updateStatus: Joi.object({
    status: Joi.string()
      .valid('CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED')
      .required(),
    reason: Joi.string().max(500).when('status', {
      is: 'CANCELLED',
      then: Joi.required(),
    }),
    trackingNumber: Joi.string().when('status', {
      is: 'SHIPPED',
      then: Joi.required(),
    }),
    carrier: Joi.string().when('status', {
      is: 'SHIPPED',
      then: Joi.required(),
    }),
  }),
};

// =============================================================================
// RFQ VALIDATION SCHEMAS
// =============================================================================

const rfqSchemas = {
  create: Joi.object({
    title: Joi.string().min(10).max(200).required(),
    description: Joi.string().min(50).max(5000).required(),
    categoryId: Joi.string().uuid().required(),
    quantity: commonSchemas.quantity.required(),
    unitType: Joi.string().required(),
    budget: Joi.object({
      min: commonSchemas.price,
      max: commonSchemas.price.min(Joi.ref('min')),
      currency: Joi.string().valid('INR', 'AED', 'USD').default('INR'),
    }),
    deliveryLocation: Joi.object({
      city: Joi.string().required(),
      state: Joi.string().required(),
      country: Joi.string().valid('IN', 'AE').required(),
      pincode: Joi.string(),
    }).required(),
    deliveryDate: Joi.date().iso().min('now'),
    attachments: Joi.array().items(commonSchemas.url).max(5),
    specifications: Joi.object().pattern(Joi.string(), Joi.string()),
    isPublic: Joi.boolean().default(true),
    targetSellers: Joi.array().items(Joi.string().uuid()).max(10),
  }),

  quote: Joi.object({
    price: commonSchemas.price.required(),
    quantity: commonSchemas.quantity.required(),
    unitPrice: commonSchemas.price.required(),
    currency: Joi.string().valid('INR', 'AED', 'USD').default('INR'),
    deliveryDays: Joi.number().integer().min(1).required(),
    validUntil: Joi.date().iso().min('now').required(),
    terms: Joi.string().max(2000),
    notes: Joi.string().max(1000),
    attachments: Joi.array().items(commonSchemas.url).max(5),
  }),
};

// =============================================================================
// REVIEW VALIDATION SCHEMAS
// =============================================================================

const reviewSchemas = {
  create: Joi.object({
    rating: Joi.number().integer().min(1).max(5).required(),
    title: Joi.string().min(5).max(100).required(),
    comment: Joi.string().min(20).max(2000).required(),
    images: Joi.array().items(commonSchemas.image).max(5),
    pros: Joi.array().items(Joi.string().max(100)).max(5),
    cons: Joi.array().items(Joi.string().max(100)).max(5),
  }),

  update: Joi.object({
    rating: Joi.number().integer().min(1).max(5),
    title: Joi.string().min(5).max(100),
    comment: Joi.string().min(20).max(2000),
    images: Joi.array().items(commonSchemas.image).max(5),
    pros: Joi.array().items(Joi.string().max(100)).max(5),
    cons: Joi.array().items(Joi.string().max(100)).max(5),
  }),
};

// =============================================================================
// ADDRESS VALIDATION SCHEMAS
// =============================================================================

const addressSchemas = {
  create: Joi.object({
    label: Joi.string().max(50),
    contactName: Joi.string().max(100).required(),
    phone: commonSchemas.phone.required(),
    addressLine1: Joi.string().max(200).required(),
    addressLine2: Joi.string().max(200),
    city: Joi.string().max(100).required(),
    state: Joi.string().max(100).required(),
    country: Joi.string().valid('IN', 'AE').required(),
    pincode: Joi.string().max(10).required(),
    landmark: Joi.string().max(200),
    isDefault: Joi.boolean().default(false),
    type: Joi.string().valid('SHIPPING', 'BILLING', 'BOTH').default('SHIPPING'),
  }),
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  validate,
  validateAll,
  schemas: {
    common: commonSchemas,
    auth: authSchemas,
    business: businessSchemas,
    product: productSchemas,
    order: orderSchemas,
    rfq: rfqSchemas,
    review: reviewSchemas,
    address: addressSchemas,
  },
};
