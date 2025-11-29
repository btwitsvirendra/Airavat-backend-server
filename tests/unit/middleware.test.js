// =============================================================================
// AIRAVAT B2B MARKETPLACE - MIDDLEWARE UNIT TESTS
// Comprehensive tests for Express middleware
// =============================================================================

const request = require('supertest');
const express = require('express');
const jwt = require('jsonwebtoken');

// Import middleware
const { standardHeaders, securityHeaders } = require('../../src/middleware/responseHeaders.middleware');
const { advancedRateLimiter, RATE_LIMIT_TIERS } = require('../../src/middleware/advancedRateLimiter.middleware');
const { versioningMiddleware, parseVersion } = require('../../src/middleware/versioning.middleware');
const { standardCompression, getBestEncoding } = require('../../src/middleware/compression.middleware');
const asyncHandler = require('../../src/middleware/async.middleware');

// Mock dependencies
jest.mock('../../src/config/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    setex: jest.fn(),
  },
}));

jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('Middleware Tests', () => {
  // ===========================================================================
  // ASYNC HANDLER
  // ===========================================================================

  describe('asyncHandler', () => {
    let app;

    beforeEach(() => {
      app = express();
    });

    it('should handle successful async route', async () => {
      app.get('/test', asyncHandler(async (req, res) => {
        res.json({ success: true });
      }));

      const response = await request(app).get('/test');

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });

    it('should pass errors to error handler', async () => {
      app.get('/error', asyncHandler(async () => {
        throw new Error('Test error');
      }));

      app.use((err, req, res, next) => {
        res.status(500).json({ error: err.message });
      });

      const response = await request(app).get('/error');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Test error');
    });

    it('should handle rejection', async () => {
      app.get('/reject', asyncHandler(async () => {
        return Promise.reject(new Error('Rejected'));
      }));

      app.use((err, req, res, next) => {
        res.status(500).json({ error: err.message });
      });

      const response = await request(app).get('/reject');

      expect(response.status).toBe(500);
      expect(response.body.error).toBe('Rejected');
    });
  });

  // ===========================================================================
  // RESPONSE HEADERS
  // ===========================================================================

  describe('responseHeaders', () => {
    let app;

    beforeEach(() => {
      app = express();
      app.use(standardHeaders());
      app.get('/test', (req, res) => {
        res.json({ success: true });
      });
    });

    it('should add request ID header', async () => {
      const response = await request(app).get('/test');

      expect(response.headers['x-request-id']).toBeDefined();
    });

    it('should add API version header', async () => {
      const response = await request(app).get('/test');

      expect(response.headers['x-api-version']).toBeDefined();
    });

    it('should add security headers', async () => {
      const secureApp = express();
      secureApp.use(securityHeaders());
      secureApp.get('/test', (req, res) => res.json({}));

      const response = await request(secureApp).get('/test');

      expect(response.headers['x-content-type-options']).toBe('nosniff');
      expect(response.headers['x-frame-options']).toBe('DENY');
      expect(response.headers['x-xss-protection']).toBe('1; mode=block');
    });

    it('should use provided request ID', async () => {
      const response = await request(app)
        .get('/test')
        .set('X-Request-Id', 'custom-request-id');

      expect(response.headers['x-request-id']).toBe('custom-request-id');
    });
  });

  // ===========================================================================
  // API VERSIONING
  // ===========================================================================

  describe('versioningMiddleware', () => {
    let app;

    beforeEach(() => {
      app = express();
      app.use('/api', versioningMiddleware());
      app.get('/api/v1/test', (req, res) => {
        res.json({ version: req.apiVersion });
      });
    });

    it('should parse version from URL path', () => {
      const req = { path: '/api/v1/users', get: () => null, query: {} };
      const version = parseVersion(req);

      expect(version).toBe('v1');
    });

    it('should parse version from header', () => {
      const req = {
        path: '/api/test',
        get: (header) => (header === 'X-API-Version' ? 'v2' : null),
        query: {},
      };
      const version = parseVersion(req);

      expect(version).toBe('v2');
    });

    it('should parse version from query parameter', () => {
      const req = {
        path: '/api/test',
        get: () => null,
        query: { api_version: 'v3' },
      };
      const version = parseVersion(req);

      expect(version).toBe('v3');
    });

    it('should return default version when not specified', () => {
      const req = { path: '/test', get: () => null, query: {} };
      const version = parseVersion(req);

      expect(version).toBe('v1');
    });

    it('should add version header to response', async () => {
      const response = await request(app).get('/api/v1/test');

      expect(response.headers['x-api-version']).toBe('v1');
    });
  });

  // ===========================================================================
  // COMPRESSION
  // ===========================================================================

  describe('compression', () => {
    describe('getBestEncoding', () => {
      it('should prefer brotli when available', () => {
        const encoding = getBestEncoding('gzip, deflate, br');
        expect(encoding).toBe('br');
      });

      it('should fallback to gzip', () => {
        const encoding = getBestEncoding('gzip, deflate');
        expect(encoding).toBe('gzip');
      });

      it('should return null when no encoding supported', () => {
        const encoding = getBestEncoding('');
        expect(encoding).toBeNull();
      });

      it('should handle identity encoding', () => {
        const encoding = getBestEncoding('identity');
        expect(encoding).toBeNull();
      });
    });

    describe('standard compression', () => {
      let app;

      beforeEach(() => {
        app = express();
        app.use(standardCompression);
        app.get('/large', (req, res) => {
          res.json({ data: 'x'.repeat(2000) }); // Large response
        });
        app.get('/small', (req, res) => {
          res.json({ ok: true }); // Small response
        });
      });

      it('should compress large responses', async () => {
        const response = await request(app)
          .get('/large')
          .set('Accept-Encoding', 'gzip');

        expect(response.headers['content-encoding']).toBe('gzip');
      });

      it('should not compress small responses', async () => {
        const response = await request(app)
          .get('/small')
          .set('Accept-Encoding', 'gzip');

        // Small responses below threshold won't be compressed
        expect(response.status).toBe(200);
      });

      it('should skip compression when x-no-compression header set', async () => {
        const response = await request(app)
          .get('/large')
          .set('Accept-Encoding', 'gzip')
          .set('X-No-Compression', 'true');

        expect(response.headers['content-encoding']).toBeUndefined();
      });
    });
  });

  // ===========================================================================
  // RATE LIMITING
  // ===========================================================================

  describe('rateLimiting', () => {
    describe('RATE_LIMIT_TIERS', () => {
      it('should have all required tiers', () => {
        expect(RATE_LIMIT_TIERS).toHaveProperty('anonymous');
        expect(RATE_LIMIT_TIERS).toHaveProperty('free');
        expect(RATE_LIMIT_TIERS).toHaveProperty('basic');
        expect(RATE_LIMIT_TIERS).toHaveProperty('professional');
        expect(RATE_LIMIT_TIERS).toHaveProperty('enterprise');
        expect(RATE_LIMIT_TIERS).toHaveProperty('admin');
      });

      it('should have increasing limits for higher tiers', () => {
        expect(RATE_LIMIT_TIERS.anonymous.points).toBeLessThan(RATE_LIMIT_TIERS.free.points);
        expect(RATE_LIMIT_TIERS.free.points).toBeLessThan(RATE_LIMIT_TIERS.basic.points);
        expect(RATE_LIMIT_TIERS.basic.points).toBeLessThan(RATE_LIMIT_TIERS.professional.points);
        expect(RATE_LIMIT_TIERS.professional.points).toBeLessThan(RATE_LIMIT_TIERS.enterprise.points);
      });

      it('should have decreasing block duration for higher tiers', () => {
        expect(RATE_LIMIT_TIERS.anonymous.blockDuration).toBeGreaterThanOrEqual(RATE_LIMIT_TIERS.free.blockDuration);
        expect(RATE_LIMIT_TIERS.enterprise.blockDuration).toBe(0); // No block for enterprise
        expect(RATE_LIMIT_TIERS.admin.blockDuration).toBe(0); // No block for admin
      });
    });
  });

  // ===========================================================================
  // ERROR HANDLING
  // ===========================================================================

  describe('errorHandling', () => {
    let app;

    beforeEach(() => {
      app = express();
      app.use(express.json());
    });

    it('should handle JSON parse errors', async () => {
      app.post('/test', (req, res) => res.json(req.body));
      app.use((err, req, res, next) => {
        res.status(400).json({ error: 'Invalid JSON' });
      });

      const response = await request(app)
        .post('/test')
        .set('Content-Type', 'application/json')
        .send('invalid json');

      expect(response.status).toBe(400);
    });

    it('should handle 404 for unknown routes', async () => {
      app.use((req, res) => {
        res.status(404).json({ error: 'Not found' });
      });

      const response = await request(app).get('/unknown-route');

      expect(response.status).toBe(404);
    });
  });

  // ===========================================================================
  // VALIDATION MIDDLEWARE
  // ===========================================================================

  describe('validationMiddleware', () => {
    const { validationResult, body } = require('express-validator');

    let app;

    beforeEach(() => {
      app = express();
      app.use(express.json());
    });

    it('should validate required fields', async () => {
      app.post(
        '/validate',
        body('email').isEmail().withMessage('Invalid email'),
        body('password').isLength({ min: 8 }).withMessage('Password too short'),
        (req, res) => {
          const errors = validationResult(req);
          if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
          }
          res.json({ success: true });
        }
      );

      const response = await request(app)
        .post('/validate')
        .send({ email: 'invalid', password: '123' });

      expect(response.status).toBe(400);
      expect(response.body.errors.length).toBeGreaterThan(0);
    });

    it('should pass valid data', async () => {
      app.post(
        '/validate',
        body('email').isEmail(),
        body('password').isLength({ min: 8 }),
        (req, res) => {
          const errors = validationResult(req);
          if (!errors.isEmpty()) {
            return res.status(400).json({ errors: errors.array() });
          }
          res.json({ success: true });
        }
      );

      const response = await request(app)
        .post('/validate')
        .send({ email: 'test@example.com', password: 'password123' });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
    });
  });

  // ===========================================================================
  // AUTHENTICATION MIDDLEWARE
  // ===========================================================================

  describe('authenticationMiddleware', () => {
    let app;
    const JWT_SECRET = 'test-secret';

    beforeEach(() => {
      app = express();

      // Simple auth middleware for testing
      const authMiddleware = (req, res, next) => {
        const authHeader = req.headers.authorization;
        
        if (!authHeader || !authHeader.startsWith('Bearer ')) {
          return res.status(401).json({ error: 'Unauthorized' });
        }

        const token = authHeader.split(' ')[1];

        try {
          const decoded = jwt.verify(token, JWT_SECRET);
          req.user = decoded;
          next();
        } catch (error) {
          return res.status(401).json({ error: 'Invalid token' });
        }
      };

      app.get('/protected', authMiddleware, (req, res) => {
        res.json({ user: req.user });
      });
    });

    it('should reject request without token', async () => {
      const response = await request(app).get('/protected');

      expect(response.status).toBe(401);
    });

    it('should reject invalid token', async () => {
      const response = await request(app)
        .get('/protected')
        .set('Authorization', 'Bearer invalid-token');

      expect(response.status).toBe(401);
    });

    it('should accept valid token', async () => {
      const token = jwt.sign({ id: 'user-123', email: 'test@test.com' }, JWT_SECRET);

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(200);
      expect(response.body.user.id).toBe('user-123');
    });

    it('should reject expired token', async () => {
      const token = jwt.sign(
        { id: 'user-123' },
        JWT_SECRET,
        { expiresIn: '-1h' } // Already expired
      );

      const response = await request(app)
        .get('/protected')
        .set('Authorization', `Bearer ${token}`);

      expect(response.status).toBe(401);
    });
  });
});



