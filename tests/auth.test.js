// =============================================================================
// AIRAVAT B2B MARKETPLACE - AUTH TESTS
// Tests for authentication endpoints
// =============================================================================

const request = require('supertest');
const app = require('../src/app');
const {
  prisma,
  resetDatabase,
  closeDatabase,
  factories,
  generateTestToken,
  expectSuccess,
  expectError,
} = require('./setup');

describe('Auth API', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await closeDatabase();
  });

  // ===========================================================================
  // REGISTRATION
  // ===========================================================================

  describe('POST /api/v1/auth/register', () => {
    const validUser = {
      email: 'newuser@example.com',
      password: 'Test@123456',
      firstName: 'John',
      lastName: 'Doe',
      phone: '+919876543210',
    };

    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(validUser);

      expectSuccess(response, 201);
      expect(response.body.data.user.email).toBe(validUser.email);
      expect(response.body.data.tokens.accessToken).toBeDefined();
      expect(response.body.data.tokens.refreshToken).toBeDefined();
    });

    it('should return error for duplicate email', async () => {
      // Create existing user
      await factories.createUser({ email: validUser.email });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(validUser);

      expectError(response, 400, 'already exists');
    });

    it('should return error for invalid email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...validUser, email: 'invalid-email' });

      expectError(response, 400);
    });

    it('should return error for weak password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...validUser, password: '123456' });

      expectError(response, 400);
    });

    it('should return error for missing required fields', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: validUser.email });

      expectError(response, 400);
    });
  });

  // ===========================================================================
  // LOGIN
  // ===========================================================================

  describe('POST /api/v1/auth/login', () => {
    let testUser;

    beforeEach(async () => {
      testUser = await factories.createUser({
        email: 'testuser@example.com',
      });
    });

    it('should login successfully with valid credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: 'Test@123',
        });

      expectSuccess(response);
      expect(response.body.data.user.email).toBe(testUser.email);
      expect(response.body.data.tokens.accessToken).toBeDefined();
    });

    it('should return error for invalid password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: 'WrongPassword',
        });

      expectError(response, 401, 'Invalid');
    });

    it('should return error for non-existent user', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@example.com',
          password: 'Test@123',
        });

      expectError(response, 401);
    });

    it('should return error for suspended user', async () => {
      await prisma.user.update({
        where: { id: testUser.id },
        data: { status: 'SUSPENDED' },
      });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: testUser.email,
          password: 'Test@123',
        });

      expectError(response, 403, 'suspended');
    });
  });

  // ===========================================================================
  // TOKEN REFRESH
  // ===========================================================================

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh tokens successfully', async () => {
      const user = await factories.createUser();
      const refreshToken = generateTestToken(user, '7d');

      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken });

      expectSuccess(response);
      expect(response.body.data.accessToken).toBeDefined();
    });

    it('should return error for invalid refresh token', async () => {
      const response = await request(app)
        .post('/api/v1/auth/refresh')
        .send({ refreshToken: 'invalid-token' });

      expectError(response, 401);
    });
  });

  // ===========================================================================
  // LOGOUT
  // ===========================================================================

  describe('POST /api/v1/auth/logout', () => {
    it('should logout successfully', async () => {
      const user = await factories.createUser();
      const token = generateTestToken(user);

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expectSuccess(response);
    });

    it('should return error without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout');

      expectError(response, 401);
    });
  });

  // ===========================================================================
  // PASSWORD RESET
  // ===========================================================================

  describe('POST /api/v1/auth/forgot-password', () => {
    it('should send reset email for existing user', async () => {
      const user = await factories.createUser();

      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: user.email });

      expectSuccess(response);
    });

    it('should return success even for non-existent email (security)', async () => {
      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nonexistent@example.com' });

      expectSuccess(response);
    });
  });

  // ===========================================================================
  // CURRENT USER
  // ===========================================================================

  describe('GET /api/v1/auth/me', () => {
    it('should return current user details', async () => {
      const user = await factories.createUser();
      const token = generateTestToken(user);

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expectSuccess(response);
      expect(response.body.data.email).toBe(user.email);
    });

    it('should return error for invalid token', async () => {
      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', 'Bearer invalid-token');

      expectError(response, 401);
    });

    it('should return error for expired token', async () => {
      const user = await factories.createUser();
      const expiredToken = generateTestToken(user, '-1h');

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${expiredToken}`);

      expectError(response, 401);
    });
  });
});
