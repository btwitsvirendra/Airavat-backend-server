// =============================================================================
// AIRAVAT B2B MARKETPLACE - LOYALTY SERVICE UNIT TESTS
// Comprehensive tests for loyalty and gamification functionality
// =============================================================================

const LoyaltyService = require('../../src/services/loyalty.service');
const { prisma, factories } = require('../setup');

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

describe('LoyaltyService', () => {
  let testUser;
  let testBusiness;

  beforeAll(async () => {
    testUser = await factories.createUser({ email: 'loyalty-test@example.com' });
    testBusiness = await factories.createBusiness(testUser.id);
    await prisma.user.update({
      where: { id: testUser.id },
      data: { businessId: testBusiness.id },
    });
  });

  afterAll(async () => {
    // Cleanup
    await prisma.gamificationEvent.deleteMany({});
    await prisma.userLoyalty.deleteMany({});
    await prisma.loyaltyProgram.deleteMany({});
    await prisma.business.deleteMany({ where: { id: testBusiness.id } });
    await prisma.user.deleteMany({ where: { id: testUser.id } });
  });

  // ===========================================================================
  // LOYALTY PROGRAM SETUP
  // ===========================================================================

  describe('Loyalty Program Setup', () => {
    describe('createProgram', () => {
      it('should create a loyalty program', async () => {
        const program = await LoyaltyService.createProgram({
          name: 'Airavat Rewards',
          description: 'Earn points on every purchase',
          pointsPerRupee: 1,
          minimumRedemption: 100,
          pointValue: 0.25, // 1 point = 0.25 INR
          tiers: [
            { name: 'Bronze', minPoints: 0, multiplier: 1 },
            { name: 'Silver', minPoints: 1000, multiplier: 1.25 },
            { name: 'Gold', minPoints: 5000, multiplier: 1.5 },
            { name: 'Platinum', minPoints: 10000, multiplier: 2 },
          ],
          isActive: true,
        });

        expect(program).toBeDefined();
        expect(program.name).toBe('Airavat Rewards');
        expect(program.tiers.length).toBe(4);
      });

      it('should reject duplicate program names', async () => {
        await expect(
          LoyaltyService.createProgram({
            name: 'Airavat Rewards', // Same name
            pointsPerRupee: 1,
            minimumRedemption: 50,
          })
        ).rejects.toThrow(/already exists|duplicate/i);
      });
    });

    describe('getActiveProgram', () => {
      it('should return active loyalty program', async () => {
        const program = await LoyaltyService.getActiveProgram();

        expect(program).toBeDefined();
        expect(program.isActive).toBe(true);
      });
    });
  });

  // ===========================================================================
  // USER ENROLLMENT
  // ===========================================================================

  describe('User Enrollment', () => {
    describe('enrollUser', () => {
      it('should enroll user in loyalty program', async () => {
        const enrollment = await LoyaltyService.enrollUser(testUser.id);

        expect(enrollment).toBeDefined();
        expect(enrollment.userId).toBe(testUser.id);
        expect(enrollment.points).toBe(0);
        expect(enrollment.tier).toBe('Bronze');
      });

      it('should not enroll already enrolled user', async () => {
        await expect(LoyaltyService.enrollUser(testUser.id)).rejects.toThrow(
          /already enrolled/i
        );
      });

      it('should enroll with welcome bonus', async () => {
        const newUser = await factories.createUser();

        const enrollment = await LoyaltyService.enrollUser(newUser.id, {
          welcomeBonus: 100,
        });

        expect(enrollment.points).toBe(100);

        // Cleanup
        await prisma.userLoyalty.deleteMany({ where: { userId: newUser.id } });
        await prisma.user.deleteMany({ where: { id: newUser.id } });
      });
    });

    describe('getUserLoyalty', () => {
      it('should get user loyalty status', async () => {
        const loyalty = await LoyaltyService.getUserLoyalty(testUser.id);

        expect(loyalty).toBeDefined();
        expect(loyalty).toHaveProperty('points');
        expect(loyalty).toHaveProperty('tier');
        expect(loyalty).toHaveProperty('lifetimePoints');
      });
    });
  });

  // ===========================================================================
  // EARNING POINTS
  // ===========================================================================

  describe('Earning Points', () => {
    describe('earnPoints', () => {
      it('should earn points from purchase', async () => {
        const result = await LoyaltyService.earnPoints(testUser.id, {
          type: 'PURCHASE',
          amount: 5000, // Rs 5000 purchase
          orderId: 'test-order-123',
        });

        expect(result.pointsEarned).toBeGreaterThan(0);
        expect(result.newBalance).toBeGreaterThan(0);
      });

      it('should apply tier multiplier', async () => {
        // First, give user enough points for Silver tier
        await prisma.userLoyalty.update({
          where: { userId: testUser.id },
          data: { points: 1500, lifetimePoints: 1500, tier: 'Silver' },
        });

        const result = await LoyaltyService.earnPoints(testUser.id, {
          type: 'PURCHASE',
          amount: 1000,
        });

        // Silver tier has 1.25x multiplier
        expect(result.multiplier).toBe(1.25);
      });

      it('should upgrade tier automatically', async () => {
        // Set points just below Gold threshold
        await prisma.userLoyalty.update({
          where: { userId: testUser.id },
          data: { points: 4900, lifetimePoints: 4900, tier: 'Silver' },
        });

        const result = await LoyaltyService.earnPoints(testUser.id, {
          type: 'PURCHASE',
          amount: 500, // Should push to Gold
        });

        expect(result.tierUpgrade).toBeDefined();
        expect(result.tierUpgrade.newTier).toBe('Gold');
      });

      it('should earn bonus points for special actions', async () => {
        const result = await LoyaltyService.earnPoints(testUser.id, {
          type: 'REFERRAL',
          description: 'Referred a new user',
          bonusPoints: 500,
        });

        expect(result.pointsEarned).toBe(500);
      });
    });

    describe('earnPointsForReview', () => {
      it('should earn points for product review', async () => {
        const result = await LoyaltyService.earnPointsForAction(testUser.id, 'REVIEW', {
          productId: 'test-product',
          rating: 5,
        });

        expect(result.pointsEarned).toBeGreaterThan(0);
      });
    });
  });

  // ===========================================================================
  // REDEEMING POINTS
  // ===========================================================================

  describe('Redeeming Points', () => {
    beforeEach(async () => {
      // Ensure user has sufficient points
      await prisma.userLoyalty.update({
        where: { userId: testUser.id },
        data: { points: 5000, lifetimePoints: 10000, tier: 'Gold' },
      });
    });

    describe('redeemPoints', () => {
      it('should redeem points for discount', async () => {
        const result = await LoyaltyService.redeemPoints(testUser.id, {
          points: 400,
          type: 'DISCOUNT',
          orderId: 'discount-order-123',
        });

        expect(result.success).toBe(true);
        expect(result.discountAmount).toBe(100); // 400 * 0.25 = 100
        expect(result.remainingPoints).toBe(4600);
      });

      it('should reject insufficient points', async () => {
        await expect(
          LoyaltyService.redeemPoints(testUser.id, {
            points: 10000, // More than available
            type: 'DISCOUNT',
          })
        ).rejects.toThrow(/insufficient/i);
      });

      it('should reject below minimum redemption', async () => {
        await expect(
          LoyaltyService.redeemPoints(testUser.id, {
            points: 50, // Below minimum
            type: 'DISCOUNT',
          })
        ).rejects.toThrow(/minimum/i);
      });

      it('should redeem points for reward', async () => {
        const result = await LoyaltyService.redeemPoints(testUser.id, {
          points: 500,
          type: 'REWARD',
          rewardId: 'free-shipping',
        });

        expect(result.success).toBe(true);
        expect(result.reward).toBeDefined();
      });
    });

    describe('getRedemptionHistory', () => {
      it('should get redemption history', async () => {
        // Make a redemption first
        await LoyaltyService.redeemPoints(testUser.id, {
          points: 200,
          type: 'DISCOUNT',
        });

        const history = await LoyaltyService.getRedemptionHistory(testUser.id);

        expect(Array.isArray(history)).toBe(true);
        expect(history.length).toBeGreaterThan(0);
      });
    });
  });

  // ===========================================================================
  // GAMIFICATION
  // ===========================================================================

  describe('Gamification', () => {
    describe('Achievements', () => {
      it('should award achievement badge', async () => {
        const result = await LoyaltyService.awardAchievement(testUser.id, {
          type: 'FIRST_PURCHASE',
          name: 'First Purchase',
          description: 'Made your first purchase',
          bonusPoints: 50,
        });

        expect(result.achievement).toBeDefined();
        expect(result.pointsAwarded).toBe(50);
      });

      it('should not award duplicate achievement', async () => {
        await expect(
          LoyaltyService.awardAchievement(testUser.id, {
            type: 'FIRST_PURCHASE',
            name: 'First Purchase',
          })
        ).rejects.toThrow(/already awarded|exists/i);
      });

      it('should get user achievements', async () => {
        const achievements = await LoyaltyService.getUserAchievements(testUser.id);

        expect(Array.isArray(achievements)).toBe(true);
        expect(achievements.length).toBeGreaterThan(0);
      });
    });

    describe('Streaks', () => {
      it('should track login streak', async () => {
        const result = await LoyaltyService.trackStreak(testUser.id, 'DAILY_LOGIN');

        expect(result.currentStreak).toBeGreaterThanOrEqual(1);
      });

      it('should award streak bonus', async () => {
        // Simulate 7-day streak
        for (let i = 0; i < 7; i++) {
          await LoyaltyService.trackStreak(testUser.id, 'DAILY_LOGIN', {
            date: new Date(Date.now() - i * 24 * 60 * 60 * 1000),
          });
        }

        const loyalty = await LoyaltyService.getUserLoyalty(testUser.id);
        expect(loyalty.streaks).toBeDefined();
      });
    });

    describe('Challenges', () => {
      it('should create challenge', async () => {
        const challenge = await LoyaltyService.createChallenge({
          name: 'Big Spender',
          description: 'Spend ₹50,000 in one month',
          type: 'SPENDING',
          target: 50000,
          startDate: new Date(),
          endDate: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
          rewardPoints: 1000,
        });

        expect(challenge).toBeDefined();
        expect(challenge.name).toBe('Big Spender');
      });

      it('should get active challenges', async () => {
        const challenges = await LoyaltyService.getActiveChallenges();

        expect(Array.isArray(challenges)).toBe(true);
      });

      it('should track challenge progress', async () => {
        const challenges = await LoyaltyService.getActiveChallenges();
        
        if (challenges.length > 0) {
          const result = await LoyaltyService.updateChallengeProgress(
            testUser.id,
            challenges[0].id,
            10000
          );

          expect(result.progress).toBeDefined();
        }
      });
    });
  });

  // ===========================================================================
  // LEADERBOARD
  // ===========================================================================

  describe('Leaderboard', () => {
    beforeAll(async () => {
      // Create multiple users with different point levels
      for (let i = 0; i < 10; i++) {
        const user = await factories.createUser();
        await LoyaltyService.enrollUser(user.id);
        await prisma.userLoyalty.update({
          where: { userId: user.id },
          data: { points: 1000 * (i + 1), lifetimePoints: 1000 * (i + 1) },
        });
      }
    });

    it('should get points leaderboard', async () => {
      const leaderboard = await LoyaltyService.getLeaderboard({
        type: 'POINTS',
        limit: 10,
      });

      expect(Array.isArray(leaderboard)).toBe(true);
      expect(leaderboard.length).toBeLessThanOrEqual(10);

      // Should be sorted by points descending
      for (let i = 0; i < leaderboard.length - 1; i++) {
        expect(leaderboard[i].points).toBeGreaterThanOrEqual(leaderboard[i + 1].points);
      }
    });

    it('should get user rank', async () => {
      const rank = await LoyaltyService.getUserRank(testUser.id);

      expect(rank).toBeDefined();
      expect(rank.position).toBeGreaterThan(0);
    });
  });

  // ===========================================================================
  // POINTS EXPIRY
  // ===========================================================================

  describe('Points Expiry', () => {
    it('should get expiring points', async () => {
      const expiringPoints = await LoyaltyService.getExpiringPoints(testUser.id, 30);

      expect(expiringPoints).toBeDefined();
      expect(expiringPoints).toHaveProperty('amount');
      expect(expiringPoints).toHaveProperty('expiryDate');
    });

    it('should send expiry notification', async () => {
      const result = await LoyaltyService.notifyExpiringPoints(testUser.id);

      expect(result.notified).toBe(true);
    });
  });

  // ===========================================================================
  // LOYALTY STATISTICS
  // ===========================================================================

  describe('Loyalty Statistics', () => {
    it('should get program statistics', async () => {
      const stats = await LoyaltyService.getProgramStats();

      expect(stats).toBeDefined();
      expect(stats).toHaveProperty('totalMembers');
      expect(stats).toHaveProperty('totalPointsIssued');
      expect(stats).toHaveProperty('totalPointsRedeemed');
      expect(stats).toHaveProperty('membersByTier');
    });

    it('should get user loyalty summary', async () => {
      const summary = await LoyaltyService.getUserLoyaltySummary(testUser.id);

      expect(summary).toBeDefined();
      expect(summary).toHaveProperty('currentPoints');
      expect(summary).toHaveProperty('tier');
      expect(summary).toHaveProperty('lifetimePoints');
      expect(summary).toHaveProperty('totalRedeemed');
    });
  });
});



