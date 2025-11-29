# Airavat B2B Marketplace - Backend API

[![Node.js](https://img.shields.io/badge/Node.js-18%2B-green.svg)](https://nodejs.org/)
[![Express.js](https://img.shields.io/badge/Express.js-4.18-blue.svg)](https://expressjs.com/)
[![PostgreSQL](https://img.shields.io/badge/PostgreSQL-15-blue.svg)](https://www.postgresql.org/)
[![Redis](https://img.shields.io/badge/Redis-7-red.svg)](https://redis.io/)
[![Elasticsearch](https://img.shields.io/badge/Elasticsearch-8.11-yellow.svg)](https://www.elastic.co/)

A comprehensive B2B e-commerce marketplace platform designed for Indian and UAE businesses. Think of it as "Alibaba for India" - connecting manufacturers, wholesalers, distributors, and retailers.

## 🚀 Features

### Core Features
- **User Authentication** - JWT-based auth with 2FA support
- **Business Management** - Multi-role business profiles with verification
- **Product Catalog** - Variants, bulk pricing, specifications
- **Order Management** - Complete order lifecycle with escrow
- **RFQ System** - Request for Quote with bidding
- **Real-time Chat** - Socket.IO powered messaging
- **Search** - Elasticsearch with autocomplete and filters
- **Recommendations** - Personalized product suggestions

### India-Specific
- **GST Compliance** - GSTIN verification, GST calculations (CGST/SGST/IGST)
- **E-Invoice** - IRN generation via NIC API
- **E-Way Bill** - Automated e-way bill generation
- **HSN Codes** - Complete HSN code mapping

### UAE-Specific
- **VAT Compliance** - TRN verification, VAT calculations
- **Tax Invoices** - FTA-compliant invoice generation
- **Free Zone** - Special handling for free zone businesses

### Advanced Features
- **Credit Scoring** - Business credit assessment with BNPL
- **Fraud Detection** - Real-time fraud risk analysis
- **Analytics** - Business intelligence and reporting
- **Subscriptions** - Tiered seller subscription plans

## 🏗️ Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Load Balancer                             │
└─────────────────────────────────────────────────────────────────┘
                                │
┌─────────────────────────────────────────────────────────────────┐
│                     Express.js API Server                        │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │  Routes  │ │Controller│ │ Services │ │  Models  │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
         │              │              │              │
    ┌────┴────┐    ┌────┴────┐   ┌────┴────┐   ┌────┴────┐
    │PostgreSQL│    │  Redis  │   │Elastic  │   │   S3   │
    │ (Prisma) │    │(Cache)  │   │ search  │   │(Files) │
    └──────────┘    └─────────┘   └─────────┘   └────────┘
```

## 📁 Project Structure

```
airavat-backend/
├── prisma/
│   ├── schema.prisma      # Database schema (40+ models)
│   └── seed.js            # Seed data
├── src/
│   ├── config/            # Configuration files
│   │   ├── database.js    # Prisma client
│   │   ├── redis.js       # Redis client
│   │   ├── logger.js      # Winston logger
│   │   └── index.js       # Config exports
│   ├── controllers/       # Request handlers
│   │   ├── auth.controller.js
│   │   ├── business.controller.js
│   │   ├── product.controller.js
│   │   ├── order.controller.js
│   │   └── ...
│   ├── middleware/        # Express middleware
│   │   ├── auth.middleware.js
│   │   ├── validation.middleware.js
│   │   ├── security.middleware.js
│   │   └── ...
│   ├── routes/            # API routes
│   │   ├── auth.routes.js
│   │   ├── product.routes.js
│   │   └── ...
│   ├── services/          # Business logic
│   │   ├── gst.service.js
│   │   ├── uae-vat.service.js
│   │   ├── elasticsearch.service.js
│   │   ├── recommendation.service.js
│   │   ├── credit.service.js
│   │   ├── fraud.service.js
│   │   └── ...
│   ├── jobs/              # Background jobs
│   │   ├── queue.js
│   │   └── processors.js
│   ├── utils/             # Utility functions
│   │   ├── helpers.js
│   │   ├── errors.js
│   │   └── response.js
│   ├── socket/            # WebSocket handlers
│   ├── docs/              # API documentation
│   ├── app.js             # Express app setup
│   └── server.js          # Server entry point
├── tests/                 # Test files
├── scripts/               # Utility scripts
├── docker-compose.yml     # Docker configuration
├── Dockerfile             # Docker build
└── package.json
```

## 🛠️ Installation

### Prerequisites
- Node.js 18+
- PostgreSQL 15+
- Redis 7+
- Elasticsearch 8+ (optional)

### Quick Start

```bash
# Clone the repository
git clone https://github.com/airavat/airavat-backend.git
cd airavat-backend

# Install dependencies
npm install

# Setup environment
cp .env.example .env
# Edit .env with your configuration

# Run database migrations
npm run db:migrate

# Seed the database
npm run db:seed

# Start development server
npm run dev
```

### Using Docker

```bash
# Start all services
docker-compose up -d

# Run migrations
docker-compose exec api npm run db:migrate

# Seed database
docker-compose exec api npm run db:seed
```

## ⚙️ Configuration

Create a `.env` file based on `.env.example`:

```env
# App
NODE_ENV=development
PORT=3000

# Database
DATABASE_URL=postgresql://user:password@localhost:5432/airavat_db

# Redis
REDIS_URL=redis://localhost:6379

# JWT
JWT_SECRET=your-secret-key
JWT_REFRESH_SECRET=your-refresh-secret

# AWS
AWS_ACCESS_KEY_ID=your-access-key
AWS_SECRET_ACCESS_KEY=your-secret-key
AWS_REGION=ap-south-1
S3_BUCKET=airavat-uploads

# Razorpay
RAZORPAY_KEY_ID=your-key-id
RAZORPAY_KEY_SECRET=your-key-secret

# Elasticsearch (optional)
ELASTICSEARCH_URL=http://localhost:9200
```

## 📚 API Documentation

API documentation is available at `/api-docs` when running the server.

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| POST | `/api/v1/auth/register` | Register new user |
| POST | `/api/v1/auth/login` | User login |
| GET | `/api/v1/products` | List products |
| POST | `/api/v1/products` | Create product (Seller) |
| GET | `/api/v1/orders` | List orders |
| POST | `/api/v1/orders` | Create order |
| GET | `/api/v1/rfq` | List RFQs |
| POST | `/api/v1/rfq` | Create RFQ |
| GET | `/api/v1/search` | Search products |

## 🧪 Testing

```bash
# Run all tests
npm test

# Run tests in watch mode
npm run test:watch

# Run specific test file
npm test -- tests/unit/auth.test.js

# Generate coverage report
npm run test:coverage
```

## 🚀 Deployment

### Production Build

```bash
# Build for production
npm run build

# Start production server
npm start
```

### Docker Deployment

```bash
# Build image
docker build -t airavat-api .

# Push to registry
docker push your-registry/airavat-api

# Deploy
./scripts/deploy.sh deploy
```

### Environment Variables for Production

```env
NODE_ENV=production
PORT=3000
DATABASE_URL=postgresql://...
REDIS_URL=redis://...
JWT_SECRET=strong-secret
```

## 📊 Monitoring

- **Health Check**: `GET /health`
- **Metrics**: `GET /metrics` (Prometheus format)
- **Logs**: Winston with daily rotation in `logs/`

## 🔒 Security

- JWT authentication with refresh tokens
- Rate limiting (100 req/15min)
- Helmet security headers
- CORS configuration
- Input validation (Joi)
- SQL injection prevention (Prisma)
- XSS protection

## 📄 License

Proprietary - All rights reserved

## 🤝 Contributing

1. Fork the repository
2. Create feature branch (`git checkout -b feature/amazing-feature`)
3. Commit changes (`git commit -m 'Add amazing feature'`)
4. Push to branch (`git push origin feature/amazing-feature`)
5. Open Pull Request

## 📞 Support

- Email: support@airavat.com
- Documentation: https://docs.airavat.com

---

Built with ❤️ by Virendra
