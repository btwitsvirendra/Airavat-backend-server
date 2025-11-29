// =============================================================================
// AIRAVAT B2B MARKETPLACE - FRAUD DETECTION SERVICE UNIT TESTS
// Comprehensive tests for fraud detection and risk assessment
// =============================================================================

const FraudDetectionService = require('../../src/services/fraudDetection.service');
const { prisma, factories } = require('../setup');

// Mock dependencies
jest.mock('../../src/config/redis', () => ({
  redis: {
    get: jest.fn(),
    set: jest.fn(),
    del: jest.fn(),
    setex: jest.fn(),
    incr: jest.fn(),
    expire: jest.fn(),
  },
}));

jest.mock('../../src/config/logger', () => ({
  info: jest.fn(),
  error: jest.fn(),
  warn: jest.fn(),
  debug: jest.fn(),
}));

describe('FraudDetectionService', () => {
  let testUser;
  let testBusiness;

  beforeAll(async () => {
    testUser = await factories.createUser({ email: 'fraud-test@example.com' });
    testBusiness = await factories.createBusiness(testUser.id);
  });

  afterAll(async () => {
    // Cleanup
    await prisma.fraudAlert.deleteMany({});
    await prisma.riskAssessment.deleteMany({});
    await prisma.ipBlacklist.deleteMany({});
    await prisma.business.deleteMany({ where: { id: testBusiness.id } });
    await prisma.user.deleteMany({ where: { id: testUser.id } });
  });

  // ===========================================================================
  // RISK ASSESSMENT
  // ===========================================================================

  describe('Risk Assessment', () => {
    describe('assessUserRisk', () => {
      it('should assess risk for normal user', async () => {
        const result = await FraudDetectionService.assessUserRisk(testUser.id, {
          action: 'LOGIN',
          ip: '192.168.1.1',
          userAgent: 'Mozilla/5.0 Chrome/100.0',
        });

        expect(result).toBeDefined();
        expect(result.riskScore).toBeDefined();
        expect(result.riskLevel).toBeDefined();
        expect(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']).toContain(result.riskLevel);
      });

      it('should detect VPN/proxy usage', async () => {
        const result = await FraudDetectionService.assessUserRisk(testUser.id, {
          action: 'LOGIN',
          ip: '10.0.0.1', // Private IP - suspicious
          userAgent: 'Mozilla/5.0',
          headers: {
            'x-forwarded-for': '10.0.0.1, 203.0.113.1',
          },
        });

        expect(result.flags).toContain('PROXY_DETECTED');
      });

      it('should detect rapid location changes', async () => {
        // First login from one location
        await FraudDetectionService.assessUserRisk(testUser.id, {
          action: 'LOGIN',
          ip: '103.21.244.0', // India IP
          userAgent: 'Mozilla/5.0',
        });

        // Immediate login from different country
        const result = await FraudDetectionService.assessUserRisk(testUser.id, {
          action: 'LOGIN',
          ip: '216.58.214.0', // US IP
          userAgent: 'Mozilla/5.0',
        });

        expect(result.flags).toContain('IMPOSSIBLE_TRAVEL');
      });
    });

    describe('assessTransactionRisk', () => {
      it('should assess transaction risk', async () => {
        const result = await FraudDetectionService.assessTransactionRisk({
          userId: testUser.id,
          amount: 5000,
          type: 'PURCHASE',
          paymentMethod: 'CARD',
        });

        expect(result).toBeDefined();
        expect(result.riskScore).toBeDefined();
        expect(result.approved).toBeDefined();
      });

      it('should flag unusually large transaction', async () => {
        const result = await FraudDetectionService.assessTransactionRisk({
          userId: testUser.id,
          amount: 10000000, // 1 crore - very large
          type: 'PURCHASE',
          paymentMethod: 'CARD',
        });

        expect(result.riskLevel).toBe('HIGH');
        expect(result.flags).toContain('UNUSUALLY_LARGE_AMOUNT');
      });

      it('should flag rapid transactions', async () => {
        // Simulate multiple rapid transactions
        for (let i = 0; i < 5; i++) {
          await FraudDetectionService.assessTransactionRisk({
            userId: testUser.id,
            amount: 1000,
            type: 'PURCHASE',
            paymentMethod: 'WALLET',
          });
        }

        const result = await FraudDetectionService.assessTransactionRisk({
          userId: testUser.id,
          amount: 1000,
          type: 'PURCHASE',
          paymentMethod: 'WALLET',
        });

        expect(result.flags).toContain('RAPID_TRANSACTIONS');
      });

      it('should flag first-time large transaction', async () => {
        const newUser = await factories.createUser();

        const result = await FraudDetectionService.assessTransactionRisk({
          userId: newUser.id,
          amount: 100000,
          type: 'PURCHASE',
          paymentMethod: 'CARD',
        });

        expect(result.flags).toContain('NEW_USER_LARGE_TRANSACTION');

        // Cleanup
        await prisma.user.delete({ where: { id: newUser.id } });
      });
    });
  });

  // ===========================================================================
  // FRAUD ALERTS
  // ===========================================================================

  describe('Fraud Alerts', () => {
    describe('createAlert', () => {
      it('should create fraud alert', async () => {
        const alert = await FraudDetectionService.createAlert({
          userId: testUser.id,
          type: 'SUSPICIOUS_LOGIN',
          severity: 'HIGH',
          description: 'Multiple failed login attempts',
          metadata: {
            failedAttempts: 5,
            ip: '192.168.1.1',
          },
        });

        expect(alert).toBeDefined();
        expect(alert.type).toBe('SUSPICIOUS_LOGIN');
        expect(alert.status).toBe('OPEN');
      });

      it('should escalate critical alerts', async () => {
        const alert = await FraudDetectionService.createAlert({
          userId: testUser.id,
          type: 'ACCOUNT_TAKEOVER',
          severity: 'CRITICAL',
          description: 'Password changed from unknown device',
        });

        expect(alert.escalated).toBe(true);
      });
    });

    describe('getAlerts', () => {
      it('should get user alerts', async () => {
        const alerts = await FraudDetectionService.getUserAlerts(testUser.id);

        expect(Array.isArray(alerts)).toBe(true);
      });

      it('should get alerts by status', async () => {
        const alerts = await FraudDetectionService.getAlerts({
          status: 'OPEN',
        });

        alerts.forEach((alert) => {
          expect(alert.status).toBe('OPEN');
        });
      });
    });

    describe('resolveAlert', () => {
      let alertToResolve;

      beforeAll(async () => {
        alertToResolve = await FraudDetectionService.createAlert({
          userId: testUser.id,
          type: 'SUSPICIOUS_ACTIVITY',
          severity: 'MEDIUM',
          description: 'Test alert to resolve',
        });
      });

      it('should resolve alert', async () => {
        const result = await FraudDetectionService.resolveAlert(alertToResolve.id, {
          resolution: 'FALSE_POSITIVE',
          notes: 'User verified by phone',
          resolvedBy: 'admin-user-id',
        });

        expect(result.status).toBe('RESOLVED');
        expect(result.resolvedAt).toBeDefined();
      });
    });
  });

  // ===========================================================================
  // IP BLACKLISTING
  // ===========================================================================

  describe('IP Blacklisting', () => {
    describe('blacklistIP', () => {
      it('should blacklist IP address', async () => {
        const result = await FraudDetectionService.blacklistIP({
          ip: '192.168.100.1',
          reason: 'Multiple fraud attempts',
          expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000), // 30 days
        });

        expect(result).toBeDefined();
        expect(result.ip).toBe('192.168.100.1');
      });

      it('should check if IP is blacklisted', async () => {
        const isBlacklisted = await FraudDetectionService.isIPBlacklisted('192.168.100.1');

        expect(isBlacklisted).toBe(true);
      });

      it('should allow non-blacklisted IP', async () => {
        const isBlacklisted = await FraudDetectionService.isIPBlacklisted('10.0.0.1');

        expect(isBlacklisted).toBe(false);
      });

      it('should handle IP range blacklisting', async () => {
        await FraudDetectionService.blacklistIP({
          ip: '203.0.113.0/24', // CIDR range
          reason: 'Known malicious range',
        });

        const isBlacklisted = await FraudDetectionService.isIPBlacklisted('203.0.113.50');

        expect(isBlacklisted).toBe(true);
      });
    });

    describe('removeFromBlacklist', () => {
      it('should remove IP from blacklist', async () => {
        await FraudDetectionService.blacklistIP({
          ip: '192.168.200.1',
          reason: 'Temporary block',
        });

        const result = await FraudDetectionService.removeFromBlacklist('192.168.200.1');

        expect(result.success).toBe(true);

        const isBlacklisted = await FraudDetectionService.isIPBlacklisted('192.168.200.1');
        expect(isBlacklisted).toBe(false);
      });
    });
  });

  // ===========================================================================
  // DEVICE FINGERPRINTING
  // ===========================================================================

  describe('Device Fingerprinting', () => {
    describe('registerDevice', () => {
      it('should register new device', async () => {
        const result = await FraudDetectionService.registerDevice(testUser.id, {
          fingerprint: 'device-fingerprint-123',
          userAgent: 'Mozilla/5.0 Chrome/100.0',
          platform: 'Windows',
          screenResolution: '1920x1080',
        });

        expect(result).toBeDefined();
        expect(result.trusted).toBe(false); // New devices are not trusted
      });

      it('should trust verified device', async () => {
        const device = await FraudDetectionService.registerDevice(testUser.id, {
          fingerprint: 'trusted-device-456',
          userAgent: 'Mozilla/5.0 Safari/14.0',
        });

        const result = await FraudDetectionService.trustDevice(testUser.id, device.id);

        expect(result.trusted).toBe(true);
      });
    });

    describe('checkDeviceRisk', () => {
      it('should allow known device', async () => {
        await FraudDetectionService.registerDevice(testUser.id, {
          fingerprint: 'known-device-789',
          userAgent: 'Mozilla/5.0',
        });

        const result = await FraudDetectionService.checkDeviceRisk(testUser.id, {
          fingerprint: 'known-device-789',
        });

        expect(result.knownDevice).toBe(true);
        expect(result.riskScore).toBeLessThan(50);
      });

      it('should flag unknown device', async () => {
        const result = await FraudDetectionService.checkDeviceRisk(testUser.id, {
          fingerprint: 'unknown-device-000',
        });

        expect(result.knownDevice).toBe(false);
        expect(result.riskScore).toBeGreaterThan(0);
      });
    });
  });

  // ===========================================================================
  // VELOCITY CHECKS
  // ===========================================================================

  describe('Velocity Checks', () => {
    describe('checkVelocity', () => {
      it('should track action velocity', async () => {
        const result = await FraudDetectionService.checkVelocity(testUser.id, {
          action: 'PASSWORD_RESET',
          window: 3600, // 1 hour
          limit: 3,
        });

        expect(result).toBeDefined();
        expect(result.count).toBeDefined();
        expect(result.allowed).toBe(true);
      });

      it('should block when velocity exceeded', async () => {
        // Simulate multiple attempts
        for (let i = 0; i < 5; i++) {
          await FraudDetectionService.checkVelocity(testUser.id, {
            action: 'CARD_ADD',
            window: 3600,
            limit: 3,
          });
        }

        const result = await FraudDetectionService.checkVelocity(testUser.id, {
          action: 'CARD_ADD',
          window: 3600,
          limit: 3,
        });

        expect(result.allowed).toBe(false);
        expect(result.exceeded).toBe(true);
      });
    });
  });

  // ===========================================================================
  // PATTERN DETECTION
  // ===========================================================================

  describe('Pattern Detection', () => {
    describe('detectAnomalies', () => {
      it('should detect unusual spending pattern', async () => {
        // Create spending history
        const history = [
          { amount: 1000, date: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
          { amount: 1200, date: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000) },
          { amount: 800, date: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000) },
        ];

        const result = await FraudDetectionService.detectSpendingAnomaly(testUser.id, {
          currentAmount: 50000, // Much higher than usual
          history,
        });

        expect(result.isAnomaly).toBe(true);
        expect(result.deviation).toBeGreaterThan(3); // More than 3 std deviations
      });

      it('should detect unusual time of activity', async () => {
        const result = await FraudDetectionService.detectTimeAnomaly(testUser.id, {
          currentTime: new Date('2024-01-01T03:00:00'), // 3 AM
          typicalHours: [9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
        });

        expect(result.isUnusual).toBe(true);
      });
    });

    describe('detectAccountSharingPatterns', () => {
      it('should detect multiple simultaneous sessions', async () => {
        const result = await FraudDetectionService.detectAccountSharing(testUser.id, {
          sessions: [
            { ip: '192.168.1.1', location: 'Mumbai' },
            { ip: '203.0.113.1', location: 'New York' },
          ],
        });

        expect(result.suspicious).toBe(true);
        expect(result.reason).toContain('simultaneous');
      });
    });
  });

  // ===========================================================================
  // FRAUD STATISTICS
  // ===========================================================================

  describe('Fraud Statistics', () => {
    it('should get fraud statistics', async () => {
      const stats = await FraudDetectionService.getStats({
        startDate: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000),
        endDate: new Date(),
      });

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('totalAlerts');
      expect(stats).toHaveProperty('byType');
      expect(stats).toHaveProperty('bySeverity');
      expect(stats).toHaveProperty('resolutionRate');
    });

    it('should get user risk profile', async () => {
      const profile = await FraudDetectionService.getUserRiskProfile(testUser.id);

      expect(profile).toBeDefined();
      expect(profile).toHaveProperty('riskScore');
      expect(profile).toHaveProperty('riskLevel');
      expect(profile).toHaveProperty('factors');
    });
  });
});



