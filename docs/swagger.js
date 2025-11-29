// =============================================================================
// AIRAVAT B2B MARKETPLACE - SWAGGER API DOCUMENTATION
// OpenAPI 3.0 specification
// =============================================================================

const swaggerJsdoc = require('swagger-jsdoc');
const swaggerUi = require('swagger-ui-express');

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'Airavat B2B Marketplace API',
      version: '1.0.0',
      description: `
# Airavat B2B Marketplace API

A comprehensive API for the Airavat B2B e-commerce marketplace serving India and UAE markets.

## Features
- **Authentication**: JWT-based authentication with 2FA support
- **Business Management**: Complete business profile and verification
- **Product Catalog**: Product listing, variants, and inventory
- **Order Management**: Full order lifecycle with escrow payments
- **RFQ System**: Request for quotation with negotiation
- **Real-time Chat**: Business-to-business communication
- **Search**: Elasticsearch-powered product and business search
- **Payments**: Razorpay integration with refund support
- **Compliance**: GST/E-Invoice (India), VAT (UAE)

## Authentication
Most endpoints require authentication via Bearer token in the Authorization header:
\`\`\`
Authorization: Bearer <your_access_token>
\`\`\`

## Rate Limiting
- Standard API: 100 requests per minute
- Authentication: 10 requests per minute
- Search: 60 requests per minute

## Pagination
List endpoints support pagination with \`page\` and \`limit\` query parameters.
Default: page=1, limit=20, max limit=100

## Response Format
All responses follow this structure:
\`\`\`json
{
  "success": true,
  "message": "Operation successful",
  "data": { ... },
  "meta": { "pagination": { ... } }
}
\`\`\`
      `,
      contact: {
        name: 'Airavat Support',
        email: 'support@airavat.com',
        url: 'https://airavat.com/support',
      },
      license: {
        name: 'Proprietary',
        url: 'https://airavat.com/terms',
      },
    },
    servers: [
      {
        url: 'http://localhost:3000/api/v1',
        description: 'Development server',
      },
      {
        url: 'https://api.airavat.com/v1',
        description: 'Production server',
      },
      {
        url: 'https://staging-api.airavat.com/v1',
        description: 'Staging server',
      },
    ],
    tags: [
      { name: 'Auth', description: 'Authentication and authorization' },
      { name: 'Users', description: 'User profile and preferences' },
      { name: 'Businesses', description: 'Business management and verification' },
      { name: 'Products', description: 'Product catalog and inventory' },
      { name: 'Categories', description: 'Product categories' },
      { name: 'Orders', description: 'Order management' },
      { name: 'Cart', description: 'Shopping cart' },
      { name: 'RFQ', description: 'Request for quotation' },
      { name: 'Chat', description: 'Real-time messaging' },
      { name: 'Reviews', description: 'Product and seller reviews' },
      { name: 'Search', description: 'Search and recommendations' },
      { name: 'Payments', description: 'Payment processing' },
      { name: 'Subscriptions', description: 'Subscription plans and billing' },
      { name: 'Admin', description: 'Platform administration' },
      { name: 'Webhooks', description: 'Webhook endpoints' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'JWT authentication token',
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for external integrations',
        },
      },
      schemas: {
        // Error Response
        Error: {
          type: 'object',
          properties: {
            success: { type: 'boolean', example: false },
            message: { type: 'string' },
            errors: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  field: { type: 'string' },
                  message: { type: 'string' },
                },
              },
            },
          },
        },

        // Pagination
        Pagination: {
          type: 'object',
          properties: {
            page: { type: 'integer', example: 1 },
            limit: { type: 'integer', example: 20 },
            total: { type: 'integer', example: 100 },
            pages: { type: 'integer', example: 5 },
          },
        },

        // User
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            avatar: { type: 'string', format: 'uri' },
            role: { type: 'string', enum: ['BUYER', 'SELLER', 'BOTH', 'ADMIN'] },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
            isEmailVerified: { type: 'boolean' },
            isPhoneVerified: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // Business
        Business: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            businessName: { type: 'string' },
            slug: { type: 'string' },
            businessType: { type: 'string' },
            description: { type: 'string' },
            logo: { type: 'string', format: 'uri' },
            gstin: { type: 'string' },
            trn: { type: 'string' },
            verificationStatus: { type: 'string', enum: ['PENDING', 'VERIFIED', 'REJECTED'] },
            trustScore: { type: 'number' },
            averageRating: { type: 'number' },
            city: { type: 'string' },
            state: { type: 'string' },
            country: { type: 'string' },
          },
        },

        // Product
        Product: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string' },
            images: { type: 'array', items: { type: 'string', format: 'uri' } },
            categoryId: { type: 'string', format: 'uuid' },
            brand: { type: 'string' },
            minPrice: { type: 'number' },
            maxPrice: { type: 'number' },
            averageRating: { type: 'number' },
            reviewCount: { type: 'integer' },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'DRAFT'] },
            variants: {
              type: 'array',
              items: { $ref: '#/components/schemas/ProductVariant' },
            },
          },
        },

        ProductVariant: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            sku: { type: 'string' },
            variantName: { type: 'string' },
            basePrice: { type: 'number' },
            salePrice: { type: 'number' },
            stockQuantity: { type: 'integer' },
            attributes: { type: 'object' },
          },
        },

        // Order
        Order: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            orderNumber: { type: 'string' },
            status: {
              type: 'string',
              enum: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'],
            },
            paymentStatus: { type: 'string', enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'] },
            subtotal: { type: 'number' },
            taxAmount: { type: 'number' },
            shippingAmount: { type: 'number' },
            discountAmount: { type: 'number' },
            totalAmount: { type: 'number' },
            currency: { type: 'string' },
            items: { type: 'array', items: { $ref: '#/components/schemas/OrderItem' } },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        OrderItem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            productId: { type: 'string', format: 'uuid' },
            variantId: { type: 'string', format: 'uuid' },
            productName: { type: 'string' },
            quantity: { type: 'integer' },
            unitPrice: { type: 'number' },
            totalPrice: { type: 'number' },
          },
        },

        // Category
        Category: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string' },
            icon: { type: 'string' },
            image: { type: 'string', format: 'uri' },
            parentId: { type: 'string', format: 'uuid' },
            productCount: { type: 'integer' },
          },
        },

        // RFQ
        RFQ: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            rfqNumber: { type: 'string' },
            title: { type: 'string' },
            description: { type: 'string' },
            quantity: { type: 'integer' },
            status: { type: 'string', enum: ['OPEN', 'CLOSED', 'AWARDED', 'CANCELLED'] },
            budget: {
              type: 'object',
              properties: {
                min: { type: 'number' },
                max: { type: 'number' },
                currency: { type: 'string' },
              },
            },
            quotesCount: { type: 'integer' },
            deadline: { type: 'string', format: 'date-time' },
          },
        },

        // Review
        Review: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            rating: { type: 'integer', minimum: 1, maximum: 5 },
            title: { type: 'string' },
            comment: { type: 'string' },
            images: { type: 'array', items: { type: 'string', format: 'uri' } },
            isVerifiedPurchase: { type: 'boolean' },
            helpfulCount: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // Address
        Address: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            label: { type: 'string' },
            contactName: { type: 'string' },
            phone: { type: 'string' },
            addressLine1: { type: 'string' },
            addressLine2: { type: 'string' },
            city: { type: 'string' },
            state: { type: 'string' },
            country: { type: 'string' },
            pincode: { type: 'string' },
            isDefault: { type: 'boolean' },
          },
        },
      },
      responses: {
        BadRequest: {
          description: 'Bad Request - Invalid input',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        Unauthorized: {
          description: 'Unauthorized - Invalid or missing token',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        Forbidden: {
          description: 'Forbidden - Insufficient permissions',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        NotFound: {
          description: 'Not Found - Resource does not exist',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        RateLimitExceeded: {
          description: 'Too Many Requests - Rate limit exceeded',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./src/routes/*.js', './src/controllers/*.js'],
};

const specs = swaggerJsdoc(options);

const swaggerUiOptions = {
  explorer: true,
  customSiteTitle: 'Airavat API Documentation',
  customCss: `
    .swagger-ui .topbar { display: none }
    .swagger-ui .info .title { color: #1a365d }
  `,
  swaggerOptions: {
    persistAuthorization: true,
    displayRequestDuration: true,
    filter: true,
    showExtensions: true,
  },
};

module.exports = {
  specs,
  serve: swaggerUi.serve,
  setup: swaggerUi.setup(specs, swaggerUiOptions),
};
