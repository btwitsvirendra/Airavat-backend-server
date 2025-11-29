// =============================================================================
// AIRAVAT B2B MARKETPLACE - API DOCUMENTATION
// OpenAPI/Swagger specification
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
# Airavat B2B Marketplace API Documentation

A comprehensive B2B e-commerce platform API for Indian and UAE businesses.

## Features
- User authentication with JWT
- Business management and verification
- Product catalog with variants
- Order management with escrow
- RFQ (Request for Quote) system
- Real-time chat
- Payment integration (Razorpay)
- GST/VAT compliance
- Elasticsearch-powered search

## Authentication
Most endpoints require authentication via JWT token in the Authorization header:
\`\`\`
Authorization: Bearer <token>
\`\`\`

## Rate Limiting
- General: 100 requests per 15 minutes
- Auth endpoints: 10 requests per 15 minutes
- Search: 30 requests per minute

## Response Format
All responses follow this format:
\`\`\`json
{
  "success": true,
  "message": "Success message",
  "data": { ... }
}
\`\`\`

## Error Responses
\`\`\`json
{
  "success": false,
  "message": "Error message",
  "errors": [{ "field": "email", "message": "Invalid email" }]
}
\`\`\`
      `,
      contact: {
        name: 'Airavat Support',
        email: 'api-support@airavat.com',
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
      { name: 'Auth', description: 'Authentication endpoints' },
      { name: 'Users', description: 'User management' },
      { name: 'Businesses', description: 'Business management' },
      { name: 'Products', description: 'Product catalog' },
      { name: 'Categories', description: 'Category management' },
      { name: 'Cart', description: 'Shopping cart' },
      { name: 'Orders', description: 'Order management' },
      { name: 'RFQ', description: 'Request for Quote' },
      { name: 'Chat', description: 'Real-time messaging' },
      { name: 'Reviews', description: 'Product reviews' },
      { name: 'Search', description: 'Search and discovery' },
      { name: 'Payments', description: 'Payment processing' },
      { name: 'Subscriptions', description: 'Subscription management' },
      { name: 'Admin', description: 'Admin operations' },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          description: 'Enter your JWT token',
        },
        apiKey: {
          type: 'apiKey',
          in: 'header',
          name: 'X-API-Key',
          description: 'API key for server-to-server communication',
        },
      },
      schemas: {
        // Error Schemas
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

        // User Schemas
        User: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            avatar: { type: 'string', format: 'uri' },
            role: { type: 'string', enum: ['BUYER', 'SELLER', 'ADMIN'] },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED'] },
            isEmailVerified: { type: 'boolean' },
            isPhoneVerified: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // Business Schemas
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
            pan: { type: 'string' },
            trn: { type: 'string' },
            verificationStatus: { type: 'string', enum: ['PENDING', 'VERIFIED', 'REJECTED'] },
            trustScore: { type: 'integer' },
            averageRating: { type: 'number' },
            city: { type: 'string' },
            state: { type: 'string' },
            country: { type: 'string' },
          },
        },

        // Product Schemas
        Product: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            slug: { type: 'string' },
            description: { type: 'string' },
            categoryId: { type: 'string', format: 'uuid' },
            businessId: { type: 'string', format: 'uuid' },
            brand: { type: 'string' },
            images: { type: 'array', items: { type: 'string', format: 'uri' } },
            minPrice: { type: 'number' },
            maxPrice: { type: 'number' },
            averageRating: { type: 'number' },
            reviewCount: { type: 'integer' },
            status: { type: 'string', enum: ['ACTIVE', 'INACTIVE', 'DRAFT'] },
          },
        },

        ProductVariant: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            variantName: { type: 'string' },
            sku: { type: 'string' },
            basePrice: { type: 'number' },
            salePrice: { type: 'number' },
            stockQuantity: { type: 'integer' },
            attributes: { type: 'object' },
          },
        },

        // Order Schemas
        Order: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            orderNumber: { type: 'string' },
            buyerId: { type: 'string', format: 'uuid' },
            sellerId: { type: 'string', format: 'uuid' },
            status: { type: 'string', enum: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED', 'DELIVERED', 'CANCELLED'] },
            paymentStatus: { type: 'string', enum: ['PENDING', 'PAID', 'FAILED', 'REFUNDED'] },
            subtotal: { type: 'number' },
            tax: { type: 'number' },
            shipping: { type: 'number' },
            discount: { type: 'number' },
            totalAmount: { type: 'number' },
            currency: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // Category Schema
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

        // Cart Schema
        Cart: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            items: {
              type: 'array',
              items: { $ref: '#/components/schemas/CartItem' },
            },
            itemCount: { type: 'integer' },
            subtotal: { type: 'number' },
            discount: { type: 'number' },
            total: { type: 'number' },
          },
        },

        CartItem: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            productId: { type: 'string', format: 'uuid' },
            variantId: { type: 'string', format: 'uuid' },
            quantity: { type: 'integer' },
            price: { type: 'number' },
          },
        },

        // Review Schema
        Review: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            productId: { type: 'string', format: 'uuid' },
            reviewerId: { type: 'string', format: 'uuid' },
            rating: { type: 'integer', minimum: 1, maximum: 5 },
            title: { type: 'string' },
            comment: { type: 'string' },
            images: { type: 'array', items: { type: 'string', format: 'uri' } },
            isVerifiedPurchase: { type: 'boolean' },
            helpfulCount: { type: 'integer' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // RFQ Schema
        RFQ: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            description: { type: 'string' },
            categoryId: { type: 'string', format: 'uuid' },
            quantity: { type: 'integer' },
            unit: { type: 'string' },
            targetPrice: { type: 'number' },
            status: { type: 'string', enum: ['OPEN', 'CLOSED', 'EXPIRED', 'AWARDED'] },
            quotesCount: { type: 'integer' },
            expiresAt: { type: 'string', format: 'date-time' },
          },
        },

        // Address Schema
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
        UnauthorizedError: {
          description: 'Authentication required',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        ForbiddenError: {
          description: 'Access denied',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        NotFoundError: {
          description: 'Resource not found',
          content: {
            'application/json': {
              schema: { $ref: '#/components/schemas/Error' },
            },
          },
        },
        ValidationError: {
          description: 'Validation failed',
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

const setupSwagger = (app) => {
  // Swagger UI
  app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(specs, {
    explorer: true,
    customCss: '.swagger-ui .topbar { display: none }',
    customSiteTitle: 'Airavat API Docs',
  }));

  // JSON spec endpoint
  app.get('/api-docs.json', (req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.send(specs);
  });
};

module.exports = { setupSwagger, specs };
