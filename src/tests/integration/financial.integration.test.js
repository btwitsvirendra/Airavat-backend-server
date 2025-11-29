// =============================================================================
// AIRAVAT B2B MARKETPLACE - FINANCIAL INTEGRATION TESTS
// End-to-end tests for financial service workflows
// =============================================================================

const request = require('supertest');
const app = require('../../app');
const { prisma } = require('../../config/database');

// Test data
let testUser;
let testBusiness;
let testWallet;
let authToken;

// =============================================================================
// SETUP AND TEARDOWN
// =============================================================================

beforeAll(async () => {
  // Create test user
  testUser = await prisma.user.create({
    data: {
      email: 'financial-test@example.com',
      password: '$2b$10$hashedpassword',
      name: 'Financial Test User',
      phone: '+919999999999',
      role: 'BUSINESS_OWNER',
      isVerified: true,
    },
  });

  // Create test business
  testBusiness = await prisma.business.create({
    data: {
      userId: testUser.id,
      businessName: 'Test Financial Business',
      businessType: 'MANUFACTURER',
      gstNumber: '22AAAAA0000A1Z5',
      country: 'IN',
      state: 'Maharashtra',
      city: 'Mumbai',
      isVerified: true,
      trustScore: 75,
    },
  });

  // Create test wallet
  testWallet = await prisma.wallet.create({
    data: {
      userId: testUser.id,
      businessId: testBusiness.id,
      balance: 100000,
      currency: 'INR',
      status: 'ACTIVE',
    },
  });

  // Generate auth token
  const jwt = require('jsonwebtoken');
  authToken = jwt.sign(
    { id: testUser.id, role: testUser.role },
    process.env.JWT_SECRET || 'test-secret',
    { expiresIn: '1d' }
  );
});

afterAll(async () => {
  // Cleanup test data
  await prisma.walletTransaction.deleteMany({ where: { walletId: testWallet.id } });
  await prisma.wallet.delete({ where: { id: testWallet.id } });
  await prisma.business.delete({ where: { id: testBusiness.id } });
  await prisma.user.delete({ where: { id: testUser.id } });
  await prisma.$disconnect();
});

// =============================================================================
// WALLET WORKFLOW TESTS
// =============================================================================

describe('Wallet Workflow', () => {
  describe('Complete wallet transaction flow', () => {
    it('should credit wallet and verify balance', async () => {
      const creditAmount = 5000;
      const initialBalance = 100000;

      const response = await request(app)
        .post('/api/v1/financial/wallet/credit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: creditAmount,
          currency: 'INR',
          referenceType: 'TEST_CREDIT',
          referenceId: 'test_ref_001',
          description: 'Test credit',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);
      expect(parseFloat(response.body.data.newBalance)).toBe(initialBalance + creditAmount);

      // Verify balance through GET endpoint
      const balanceResponse = await request(app)
        .get('/api/v1/financial/wallet/balance')
        .set('Authorization', `Bearer ${authToken}`);

      expect(balanceResponse.status).toBe(200);
      expect(parseFloat(balanceResponse.body.data.balance)).toBe(initialBalance + creditAmount);
    });

    it('should debit wallet and track transaction', async () => {
      const debitAmount = 2000;

      const response = await request(app)
        .post('/api/v1/financial/wallet/debit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: debitAmount,
          currency: 'INR',
          referenceType: 'TEST_DEBIT',
          referenceId: 'test_ref_002',
          description: 'Test debit',
        });

      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify transaction in history
      const historyResponse = await request(app)
        .get('/api/v1/financial/wallet/transactions')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ type: 'DEBIT' });

      expect(historyResponse.status).toBe(200);
      expect(historyResponse.body.data.transactions.length).toBeGreaterThan(0);
    });

    it('should prevent debit exceeding balance', async () => {
      const response = await request(app)
        .post('/api/v1/financial/wallet/debit')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: 999999999, // More than balance
          currency: 'INR',
          referenceType: 'TEST',
          referenceId: 'test_ref_003',
        });

      expect(response.status).toBe(400);
      expect(response.body.success).toBe(false);
      expect(response.body.error).toContain('Insufficient');
    });
  });

  describe('Wallet hold and release flow', () => {
    it('should hold amount and release', async () => {
      const holdAmount = 1000;

      // Hold amount
      const holdResponse = await request(app)
        .post('/api/v1/financial/wallet/hold')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: holdAmount,
          reason: 'Test hold',
        });

      expect(holdResponse.status).toBe(200);

      // Verify available balance reduced
      const balanceResponse = await request(app)
        .get('/api/v1/financial/wallet/balance')
        .set('Authorization', `Bearer ${authToken}`);

      expect(balanceResponse.body.data.lockedBalance).toBeGreaterThan(0);

      // Release hold
      const releaseResponse = await request(app)
        .post('/api/v1/financial/wallet/release')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          amount: holdAmount,
          holdId: holdResponse.body.data.holdId,
        });

      expect(releaseResponse.status).toBe(200);
    });
  });
});

// =============================================================================
// EMI WORKFLOW TESTS
// =============================================================================

describe('EMI Workflow', () => {
  let testEMIPlan;
  let testEMIOrder;

  beforeAll(async () => {
    // Create test EMI plan
    testEMIPlan = await prisma.eMIPlan.create({
      data: {
        name: 'Test 6 Month Plan',
        tenureMonths: 6,
        interestRate: 12,
        processingFee: 1,
        minAmount: 1000,
        maxAmount: 1000000,
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    if (testEMIOrder) {
      await prisma.eMIInstallment.deleteMany({ where: { emiOrderId: testEMIOrder.id } });
      await prisma.eMIOrder.delete({ where: { id: testEMIOrder.id } });
    }
    await prisma.eMIPlan.delete({ where: { id: testEMIPlan.id } });
  });

  describe('EMI creation and payment flow', () => {
    it('should calculate EMI correctly', async () => {
      const response = await request(app)
        .post('/api/v1/financial/emi/calculate')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          principal: 50000,
          tenure: 6,
          interestRate: 12,
          processingFee: 1,
        });

      expect(response.status).toBe(200);
      expect(response.body.data.emiAmount).toBeDefined();
      expect(response.body.data.totalInterest).toBeDefined();
      expect(response.body.data.totalAmount).toBeDefined();
    });

    it('should get available EMI plans', async () => {
      const response = await request(app)
        .get('/api/v1/financial/emi/plans')
        .set('Authorization', `Bearer ${authToken}`)
        .query({ amount: 50000 });

      expect(response.status).toBe(200);
      expect(response.body.data.length).toBeGreaterThan(0);
    });

    it('should create EMI order', async () => {
      // First create a test order
      const testOrder = await prisma.order.create({
        data: {
          orderNumber: `ORD-EMI-TEST-${Date.now()}`,
          buyerId: testUser.id,
          sellerId: testUser.id,
          totalAmount: 50000,
          status: 'CONFIRMED',
        },
      });

      const response = await request(app)
        .post('/api/v1/financial/emi/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          orderId: testOrder.id,
          emiPlanId: testEMIPlan.id,
          bankName: 'Test Bank',
          accountLast4: '1234',
        });

      expect(response.status).toBe(201);
      expect(response.body.data.status).toBe('PENDING_APPROVAL');
      testEMIOrder = response.body.data;

      // Cleanup
      await prisma.order.delete({ where: { id: testOrder.id } });
    });

    it('should list user EMI orders', async () => {
      const response = await request(app)
        .get('/api/v1/financial/emi/orders')
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(Array.isArray(response.body.data)).toBe(true);
    });
  });
});

// =============================================================================
// VIRTUAL CARD WORKFLOW TESTS
// =============================================================================

describe('Virtual Card Workflow', () => {
  let testCard;

  describe('Card creation and usage flow', () => {
    it('should create virtual card', async () => {
      const response = await request(app)
        .post('/api/v1/financial/cards/create')
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          cardholderName: 'Test Cardholder',
          cardLimit: 50000,
          currency: 'INR',
          validityDays: 365,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.last4).toBeDefined();
      expect(response.body.data.status).toBe('ACTIVE');
      testCard = response.body.data;
    });

    it('should get card details', async () => {
      const response = await request(app)
        .get(`/api/v1/financial/cards/${testCard.id}`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.cardNumber).toContain('XXXX'); // Should be masked
    });

    it('should update card limits', async () => {
      const response = await request(app)
        .put(`/api/v1/financial/cards/${testCard.id}`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({
          cardLimit: 75000,
          dailyLimit: 25000,
        });

      expect(response.status).toBe(200);
      expect(parseFloat(response.body.data.cardLimit)).toBe(75000);
    });

    it('should lock and unlock card', async () => {
      // Lock
      const lockResponse = await request(app)
        .post(`/api/v1/financial/cards/${testCard.id}/lock`)
        .set('Authorization', `Bearer ${authToken}`)
        .send({ reason: 'Test lock' });

      expect(lockResponse.status).toBe(200);
      expect(lockResponse.body.data.status).toBe('LOCKED');

      // Unlock
      const unlockResponse = await request(app)
        .post(`/api/v1/financial/cards/${testCard.id}/unlock`)
        .set('Authorization', `Bearer ${authToken}`);

      expect(unlockResponse.status).toBe(200);
      expect(unlockResponse.body.data.status).toBe('ACTIVE');
    });

    it('should get spending summary', async () => {
      const response = await request(app)
        .get(`/api/v1/financial/cards/${testCard.id}/spending`)
        .set('Authorization', `Bearer ${authToken}`)
        .query({
          startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          endDate: new Date().toISOString(),
        });

      expect(response.status).toBe(200);
      expect(response.body.data.totalSpent).toBeDefined();
    });
  });

  afterAll(async () => {
    if (testCard) {
      await prisma.cardTransaction.deleteMany({ where: { cardId: testCard.id } });
      await prisma.virtualCard.delete({ where: { id: testCard.id } });
    }
  });
});

// =============================================================================
// CASHBACK WORKFLOW TESTS
// =============================================================================

describe('Cashback Workflow', () => {
  let testProgram;

  beforeAll(async () => {
    // Create test cashback program
    testProgram = await prisma.cashbackProgram.create({
      data: {
        name: 'Test Cashback Program',
        type: 'PERCENTAGE',
        value: 5,
        maxCashback: 500,
        minPurchase: 1000,
        startDate: new Date(),
        endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        isActive: true,
      },
    });
  });

  afterAll(async () => {
    await prisma.cashbackReward.deleteMany({ where: { programId: testProgram.id } });
    await prisma.cashbackProgram.delete({ where: { id: testProgram.id } });
  });

  it('should calculate cashback', async () => {
    const response = await request(app)
      .post('/api/v1/financial/cashback/calculate')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        orderAmount: 10000,
      });

    expect(response.status).toBe(200);
    expect(response.body.data.cashbackAmount).toBeDefined();
  });

  it('should get active programs', async () => {
    const response = await request(app)
      .get('/api/v1/financial/cashback/programs')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(Array.isArray(response.body.data)).toBe(true);
  });

  it('should get user cashback summary', async () => {
    const response = await request(app)
      .get('/api/v1/financial/cashback/summary')
      .set('Authorization', `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data.totalEarned).toBeDefined();
    expect(response.body.data.totalCredited).toBeDefined();
  });
});

// =============================================================================
// REPORT WORKFLOW TESTS
// =============================================================================

describe('Financial Reports Workflow', () => {
  it('should get dashboard overview', async () => {
    const response = await request(app)
      .get('/api/v1/reports/financial/dashboard')
      .set('Authorization', `Bearer ${authToken}`)
      .query({ period: 30 });

    expect(response.status).toBe(200);
    expect(response.body.data.wallet).toBeDefined();
    expect(response.body.data.transactions).toBeDefined();
  });

  it('should get transaction report', async () => {
    const response = await request(app)
      .get('/api/v1/reports/financial/transactions')
      .set('Authorization', `Bearer ${authToken}`)
      .query({
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        endDate: new Date().toISOString(),
      });

    expect(response.status).toBe(200);
    expect(response.body.data.transactions).toBeDefined();
    expect(response.body.data.summary).toBeDefined();
  });

  it('should get trend analysis', async () => {
    const response = await request(app)
      .get('/api/v1/reports/financial/trends/wallet_volume')
      .set('Authorization', `Bearer ${authToken}`)
      .query({ period: 30, granularity: 'day' });

    expect(response.status).toBe(200);
    expect(response.body.data.data).toBeDefined();
  });
});

// =============================================================================
// ERROR HANDLING TESTS
// =============================================================================

describe('Error Handling', () => {
  it('should handle invalid wallet operation', async () => {
    const response = await request(app)
      .post('/api/v1/financial/wallet/credit')
      .set('Authorization', `Bearer ${authToken}`)
      .send({
        amount: -100, // Invalid negative amount
        currency: 'INR',
      });

    expect(response.status).toBe(400);
  });

  it('should handle unauthorized access', async () => {
    const response = await request(app)
      .get('/api/v1/financial/wallet/balance');

    expect(response.status).toBe(401);
  });

  it('should handle rate limiting', async () => {
    // Make many requests quickly
    const requests = [];
    for (let i = 0; i < 150; i++) {
      requests.push(
        request(app)
          .get('/api/v1/financial/wallet/balance')
          .set('Authorization', `Bearer ${authToken}`)
      );
    }

    const responses = await Promise.all(requests);
    const rateLimited = responses.some(r => r.status === 429);

    // Rate limiting should kick in
    expect(rateLimited).toBe(true);
  });
});

// =============================================================================
// CONCURRENT OPERATION TESTS
// =============================================================================

describe('Concurrent Operations', () => {
  it('should handle concurrent credits correctly', async () => {
    const initialBalance = await prisma.wallet.findUnique({
      where: { id: testWallet.id },
      select: { balance: true },
    });

    const creditAmount = 100;
    const numCredits = 5;

    // Make concurrent credits
    const promises = [];
    for (let i = 0; i < numCredits; i++) {
      promises.push(
        request(app)
          .post('/api/v1/financial/wallet/credit')
          .set('Authorization', `Bearer ${authToken}`)
          .send({
            amount: creditAmount,
            currency: 'INR',
            referenceType: 'CONCURRENT_TEST',
            referenceId: `concurrent_${i}`,
          })
      );
    }

    await Promise.all(promises);

    // Verify final balance
    const finalBalance = await prisma.wallet.findUnique({
      where: { id: testWallet.id },
      select: { balance: true },
    });

    expect(parseFloat(finalBalance.balance)).toBe(
      parseFloat(initialBalance.balance) + (creditAmount * numCredits)
    );
  });
});
