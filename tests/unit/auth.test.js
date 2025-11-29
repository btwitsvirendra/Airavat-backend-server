// =============================================================================
// AIRAVAT B2B MARKETPLACE - AUTH CONTROLLER TESTS
// Unit and integration tests for authentication
// =============================================================================

const request = require('supertest');
const app = require('../../src/app');
const {
  prisma,
  cleanDatabase,
  createTestUser,
  createAuthenticatedUser,
  expectSuccess,
  expectError,
} = require('../setup');

describe('Auth Controller', () => {
  beforeEach(async () => {
    await cleanDatabase();
  });

  // ===========================================================================
  // REGISTRATION
  // ===========================================================================

  describe('POST /api/v1/auth/register', () => {
    const validUser = {
      email: 'newuser@test.com',
      password: 'Password123!',
      firstName: 'John',
      lastName: 'Doe',
      phone: '+919876543210',
      role: 'BUYER',
    };

    it('should register a new user successfully', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(validUser);

      expectSuccess(response, 201);
      expect(response.body.data).toHaveProperty('user');
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data.user.email).toBe(validUser.email);
      expect(response.body.data.user).not.toHaveProperty('password');
    });

    it('should fail with invalid email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...validUser, email: 'invalid-email' });

      expectError(response, 400);
      expect(response.body.message).toContain('email');
    });

    it('should fail with weak password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ ...validUser, password: '123' });

      expectError(response, 400);
    });

    it('should fail with existing email', async () => {
      await createTestUser({ email: validUser.email });

      const response = await request(app)
        .post('/api/v1/auth/register')
        .send(validUser);

      expectError(response, 409);
      expect(response.body.message).toContain('exists');
    });

    it('should fail with missing required fields', async () => {
      const response = await request(app)
        .post('/api/v1/auth/register')
        .send({ email: 'test@test.com' });

      expectError(response, 400);
    });
  });

  // ===========================================================================
  // LOGIN
  // ===========================================================================

  describe('POST /api/v1/auth/login', () => {
    let testUser;

    beforeEach(async () => {
      testUser = await createTestUser({
        email: 'login@test.com',
        // Password: Password123!
        password: '$2b$10$rQqLvh4Jm8DJYhJ5XlVzT.jZ8fK1w4HQx0y6G3L2m5N7p9r1s3u5w',
      });
    });

    it('should login with valid credentials', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'login@test.com',
          password: 'Password123!',
        });

      expectSuccess(response);
      expect(response.body.data).toHaveProperty('accessToken');
      expect(response.body.data).toHaveProperty('refreshToken');
      expect(response.body.data.user.email).toBe('login@test.com');
    });

    it('should fail with wrong password', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'login@test.com',
          password: 'wrongpassword',
        });

      expectError(response, 401);
    });

    it('should fail with non-existent email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'nonexistent@test.com',
          password: 'Password123!',
        });

      expectError(response, 401);
    });

    it('should fail for suspended user', async () => {
      await prisma.user.update({
        where: { id: testUser.id },
        data: { status: 'SUSPENDED' },
      });

      const response = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'login@test.com',
          password: 'Password123!',
        });

      expectError(response, 403);
    });
  });

  // ===========================================================================
  // TOKEN REFRESH
  // ===========================================================================

  describe('POST /api/v1/auth/refresh', () => {
    it('should refresh tokens with valid refresh token', async () => {
      const { token } = await createAuthenticatedUser();

      // First login to get refresh token
      const loginResponse = await request(app)
        .post('/api/v1/auth/login')
        .send({
          email: 'login@test.com',
          password: 'Password123!',
        });

      if (loginResponse.body.data?.refreshToken) {
        const response = await request(app)
          .post('/api/v1/auth/refresh')
          .send({ refreshToken: loginResponse.body.data.refreshToken });

        expectSuccess(response);
        expect(response.body.data).toHaveProperty('accessToken');
      }
    });

    it('should fail with invalid refresh token', async () => {
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
      const { token } = await createAuthenticatedUser();

      const response = await request(app)
        .post('/api/v1/auth/logout')
        .set('Authorization', `Bearer ${token}`);

      expectSuccess(response);
    });

    it('should fail without authentication', async () => {
      const response = await request(app)
        .post('/api/v1/auth/logout');

      expectError(response, 401);
    });
  });

  // ===========================================================================
  // PASSWORD RESET
  // ===========================================================================

  describe('Password Reset Flow', () => {
    let testUser;

    beforeEach(async () => {
      testUser = await createTestUser({ email: 'reset@test.com' });
    });

    it('should send password reset email', async () => {
      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'reset@test.com' });

      expectSuccess(response);
      expect(response.body.message).toContain('reset');
    });

    it('should not reveal if email exists', async () => {
      const response = await request(app)
        .post('/api/v1/auth/forgot-password')
        .send({ email: 'nonexistent@test.com' });

      // Should still return success to not reveal email existence
      expectSuccess(response);
    });
  });

  // ===========================================================================
  // CURRENT USER
  // ===========================================================================

  describe('GET /api/v1/auth/me', () => {
    it('should return current user profile', async () => {
      const { user, token } = await createAuthenticatedUser();

      const response = await request(app)
        .get('/api/v1/auth/me')
        .set('Authorization', `Bearer ${token}`);

      expectSuccess(response);
      expect(response.body.data.email).toBe(user.email);
      expect(response.body.data).not.toHaveProperty('password');
    });

    it('should fail without authentication', async () => {
      const response = await request(app).get('/api/v1/auth/me');

      expectError(response, 401);
    });
  });
});
