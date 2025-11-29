// =============================================================================
// AIRAVAT B2B MARKETPLACE - FRAUD DETECTION SERVICE
// Real-time fraud detection, risk scoring, and prevention
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const config = require('../config');

class FraudDetectionService {
  // Risk levels
  static RISK_LEVELS = {
    LOW: { min: 0, max: 30 },
    MEDIUM: { min: 31, max: 60 },
    HIGH: { min: 61, max: 80 },
    CRITICAL: { min: 81, max: 100 },
  };
  
  // Risk weights
  static RISK_WEIGHTS = {
    velocityCheck: 0.20,
    amountAnomaly: 0.15,
    locationAnomaly: 0.15,
    deviceFingerprint: 0.10,
    accountAge: 0.10,
    orderPattern: 0.15,
    paymentPattern: 0.15,
  };
  
  // =============================================================================
  // REAL-TIME FRAUD CHECKS
  // =============================================================================
  
  /**
   * Perform comprehensive fraud check for an order
   */
  async checkOrder(order, context = {}) {
    const businessId = order.buyerId;
    const { ip, userAgent, deviceId, sessionId } = context;
    
    // Run all checks in parallel
    const [
      velocityRisk,
      amountRisk,
      locationRisk,
      deviceRisk,
      accountRisk,
      orderPatternRisk,
      paymentRisk,
    ] = await Promise.all([
      this.checkVelocity(businessId),
      this.checkAmountAnomaly(businessId, parseFloat(order.totalAmount)),
      this.checkLocationAnomaly(businessId, ip),
      this.checkDeviceFingerprint(businessId, deviceId, userAgent),
      this.checkAccountAge(businessId),
      this.checkOrderPattern(businessId, order),
      this.checkPaymentPattern(businessId, order.paymentMethod),
    ]);
    
    // Calculate weighted risk score
    const riskScore = Math.round(
      velocityRisk * FraudDetectionService.RISK_WEIGHTS.velocityCheck +
      amountRisk * FraudDetectionService.RISK_WEIGHTS.amountAnomaly +
      locationRisk * FraudDetectionService.RISK_WEIGHTS.locationAnomaly +
      deviceRisk * FraudDetectionService.RISK_WEIGHTS.deviceFingerprint +
      accountRisk * FraudDetectionService.RISK_WEIGHTS.accountAge +
      orderPatternRisk * FraudDetectionService.RISK_WEIGHTS.orderPattern +
      paymentRisk * FraudDetectionService.RISK_WEIGHTS.paymentPattern
    );
    
    const riskLevel = this.getRiskLevel(riskScore);
    const shouldBlock = riskScore >= 80;
    const requiresReview = riskScore >= 50 && riskScore < 80;
    
    // Create fraud check record
    const fraudCheck = await prisma.fraudCheck.create({
      data: {
        businessId,
        orderId: order.id,
        riskScore,
        riskLevel,
        checks: {
          velocity: velocityRisk,
          amount: amountRisk,
          location: locationRisk,
          device: deviceRisk,
          account: accountRisk,
          orderPattern: orderPatternRisk,
          payment: paymentRisk,
        },
        ip,
        userAgent,
        deviceId,
        decision: shouldBlock ? 'BLOCKED' : requiresReview ? 'REVIEW' : 'APPROVED',
      },
    });
    
    // Log high-risk checks
    if (riskScore >= 60) {
      logger.warn('High-risk order detected', {
        orderId: order.id,
        businessId,
        riskScore,
        riskLevel,
      });
    }
    
    return {
      riskScore,
      riskLevel,
      shouldBlock,
      requiresReview,
      checkId: fraudCheck.id,
      details: {
        velocity: velocityRisk,
        amount: amountRisk,
        location: locationRisk,
        device: deviceRisk,
        account: accountRisk,
        orderPattern: orderPatternRisk,
        payment: paymentRisk,
      },
    };
  }
  
  /**
   * Check order velocity (too many orders in short time)
   */
  async checkVelocity(businessId) {
    const timeWindows = [
      { minutes: 5, maxOrders: 3 },
      { minutes: 60, maxOrders: 10 },
      { minutes: 1440, maxOrders: 50 }, // 24 hours
    ];
    
    let riskScore = 0;
    
    for (const window of timeWindows) {
      const since = new Date(Date.now() - window.minutes * 60 * 1000);
      const orderCount = await prisma.order.count({
        where: {
          buyerId: businessId,
          createdAt: { gte: since },
        },
      });
      
      if (orderCount >= window.maxOrders) {
        riskScore = Math.max(riskScore, 100);
      } else if (orderCount >= window.maxOrders * 0.8) {
        riskScore = Math.max(riskScore, 70);
      } else if (orderCount >= window.maxOrders * 0.5) {
        riskScore = Math.max(riskScore, 40);
      }
    }
    
    return riskScore;
  }
  
  /**
   * Check for unusual order amount
   */
  async checkAmountAnomaly(businessId, amount) {
    // Get historical order amounts
    const orders = await prisma.order.findMany({
      where: { buyerId: businessId },
      select: { totalAmount: true },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });
    
    if (orders.length < 5) {
      // Not enough history, use platform-wide average
      const platformStats = await prisma.order.aggregate({
        _avg: { totalAmount: true },
        _max: { totalAmount: true },
      });
      
      // High risk if significantly above platform average
      if (amount > parseFloat(platformStats._avg.totalAmount || 0) * 5) {
        return 80;
      }
      return 20;
    }
    
    // Calculate statistics
    const amounts = orders.map((o) => parseFloat(o.totalAmount));
    const mean = amounts.reduce((a, b) => a + b, 0) / amounts.length;
    const stdDev = Math.sqrt(
      amounts.reduce((sq, n) => sq + Math.pow(n - mean, 2), 0) / amounts.length
    );
    
    // Z-score
    const zScore = Math.abs((amount - mean) / (stdDev || 1));
    
    if (zScore > 4) return 100;
    if (zScore > 3) return 80;
    if (zScore > 2) return 50;
    if (zScore > 1.5) return 30;
    return 0;
  }
  
  /**
   * Check for location anomalies (different IP/location than usual)
   */
  async checkLocationAnomaly(businessId, ip) {
    if (!ip) return 20;
    
    // Get location from IP
    const location = await this.getLocationFromIP(ip);
    
    // Get historical locations
    const recentLogins = await prisma.session.findMany({
      where: {
        business: { id: businessId },
        createdAt: { gte: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000) },
      },
      select: { ip: true, location: true },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
    
    if (recentLogins.length === 0) return 30; // New user, moderate risk
    
    // Check if current location matches any recent location
    const knownLocations = recentLogins.map((l) => l.location?.country).filter(Boolean);
    
    if (knownLocations.includes(location?.country)) {
      return 0; // Known location
    }
    
    // Check if IP is from a known high-risk region
    const highRiskCountries = ['NG', 'GH', 'PK', 'RU', 'UA', 'BY']; // Example list
    if (highRiskCountries.includes(location?.country)) {
      return 90;
    }
    
    return 50; // Unknown location
  }
  
  /**
   * Check device fingerprint
   */
  async checkDeviceFingerprint(businessId, deviceId, userAgent) {
    if (!deviceId) return 30;
    
    // Check if device is known
    const knownDevice = await prisma.deviceFingerprint.findFirst({
      where: {
        businessId,
        deviceId,
      },
    });
    
    if (knownDevice && knownDevice.trusted) {
      return 0;
    }
    
    // Check if device is flagged
    const flaggedDevice = await prisma.deviceFingerprint.findFirst({
      where: {
        deviceId,
        flagged: true,
      },
    });
    
    if (flaggedDevice) {
      return 100;
    }
    
    // Check if multiple accounts use this device
    const accountsUsingDevice = await prisma.deviceFingerprint.count({
      where: { deviceId },
    });
    
    if (accountsUsingDevice > 5) {
      return 80;
    }
    if (accountsUsingDevice > 2) {
      return 40;
    }
    
    // New device
    if (!knownDevice) {
      await prisma.deviceFingerprint.create({
        data: {
          businessId,
          deviceId,
          userAgent,
          firstSeen: new Date(),
          lastSeen: new Date(),
        },
      });
      return 20;
    }
    
    return 0;
  }
  
  /**
   * Check account age risk
   */
  async checkAccountAge(businessId) {
    const business = await prisma.business.findUnique({
      where: { id: businessId },
      select: { createdAt: true, verificationStatus: true },
    });
    
    if (!business) return 100;
    
    const ageInDays = (Date.now() - new Date(business.createdAt)) / (1000 * 60 * 60 * 24);
    
    // New accounts are higher risk
    if (ageInDays < 1) return 80;
    if (ageInDays < 7) return 60;
    if (ageInDays < 30) return 40;
    if (ageInDays < 90) return 20;
    
    // Verified accounts get lower risk
    if (business.verificationStatus === 'VERIFIED') {
      return 0;
    }
    
    return 10;
  }
  
  /**
   * Check order pattern anomalies
   */
  async checkOrderPattern(businessId, order) {
    let riskScore = 0;
    
    // Check for rush shipping on high-value orders
    if (order.shippingMethod === 'EXPRESS' && parseFloat(order.totalAmount) > 100000) {
      riskScore += 20;
    }
    
    // Check if shipping to a new address
    const previousAddresses = await prisma.order.findMany({
      where: { buyerId: businessId },
      select: { shippingAddressId: true },
      distinct: ['shippingAddressId'],
    });
    
    if (!previousAddresses.some((o) => o.shippingAddressId === order.shippingAddressId)) {
      riskScore += 30;
    }
    
    // Check if ordering from a new seller
    const previousSellers = await prisma.order.findMany({
      where: { buyerId: businessId },
      select: { sellerId: true },
      distinct: ['sellerId'],
    });
    
    if (!previousSellers.some((o) => o.sellerId === order.sellerId)) {
      riskScore += 20;
    }
    
    // Check for unusual product categories
    const usualCategories = await prisma.orderItem.findMany({
      where: { order: { buyerId: businessId } },
      select: { product: { select: { categoryId: true } } },
      take: 50,
    });
    
    const categoryIds = usualCategories.map((i) => i.product.categoryId);
    const orderCategories = order.items?.map((i) => i.product?.categoryId) || [];
    
    const newCategories = orderCategories.filter((c) => !categoryIds.includes(c));
    if (newCategories.length > 0 && categoryIds.length > 0) {
      riskScore += 15;
    }
    
    return Math.min(riskScore, 100);
  }
  
  /**
   * Check payment pattern risk
   */
  async checkPaymentPattern(businessId, paymentMethod) {
    let riskScore = 0;
    
    // Credit card fraud risk is higher for first-time use
    if (paymentMethod === 'CARD') {
      const previousCardPayments = await prisma.payment.count({
        where: {
          order: { buyerId: businessId },
          method: 'CARD',
          status: 'CAPTURED',
        },
      });
      
      if (previousCardPayments === 0) {
        riskScore += 30;
      }
    }
    
    // COD for high-value orders
    if (paymentMethod === 'COD') {
      riskScore += 20;
    }
    
    // Check for recent payment failures
    const recentFailures = await prisma.payment.count({
      where: {
        order: { buyerId: businessId },
        status: 'FAILED',
        createdAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) },
      },
    });
    
    if (recentFailures >= 3) {
      riskScore += 50;
    } else if (recentFailures >= 1) {
      riskScore += 20;
    }
    
    return Math.min(riskScore, 100);
  }
  
  // =============================================================================
  // ACCOUNT-LEVEL CHECKS
  // =============================================================================
  
  /**
   * Check for multiple accounts from same device/IP
   */
  async checkMultipleAccounts(ip, deviceId) {
    const accounts = await prisma.business.findMany({
      where: {
        OR: [
          { registrationIp: ip },
          { devices: { some: { deviceId } } },
        ],
      },
      select: { id: true, createdAt: true, verificationStatus: true },
    });
    
    if (accounts.length > 3) {
      return {
        risk: 'HIGH',
        accountCount: accounts.length,
        recommendation: 'Block registration',
      };
    }
    
    if (accounts.length > 1) {
      return {
        risk: 'MEDIUM',
        accountCount: accounts.length,
        recommendation: 'Review manually',
      };
    }
    
    return { risk: 'LOW', accountCount: accounts.length };
  }
  
  /**
   * Check for suspicious registration
   */
  async checkRegistration(data) {
    const { email, phone, ip, deviceId, gstin } = data;
    let riskScore = 0;
    const flags = [];
    
    // Check for disposable email
    if (this.isDisposableEmail(email)) {
      riskScore += 40;
      flags.push('Disposable email');
    }
    
    // Check for VPN/proxy
    const ipRisk = await this.checkIPRisk(ip);
    if (ipRisk.isProxy || ipRisk.isVPN) {
      riskScore += 30;
      flags.push('VPN/Proxy detected');
    }
    
    // Check for multiple accounts
    const multiAccountCheck = await this.checkMultipleAccounts(ip, deviceId);
    if (multiAccountCheck.risk === 'HIGH') {
      riskScore += 50;
      flags.push('Multiple accounts detected');
    }
    
    // Verify GSTIN (for India)
    if (gstin) {
      const gstValid = await this.verifyGSTIN(gstin);
      if (!gstValid) {
        riskScore += 40;
        flags.push('Invalid GSTIN');
      }
    }
    
    return {
      riskScore: Math.min(riskScore, 100),
      riskLevel: this.getRiskLevel(riskScore),
      flags,
      shouldBlock: riskScore >= 70,
      requiresReview: riskScore >= 40,
    };
  }
  
  // =============================================================================
  // HELPER METHODS
  // =============================================================================
  
  getRiskLevel(score) {
    if (score >= FraudDetectionService.RISK_LEVELS.CRITICAL.min) return 'CRITICAL';
    if (score >= FraudDetectionService.RISK_LEVELS.HIGH.min) return 'HIGH';
    if (score >= FraudDetectionService.RISK_LEVELS.MEDIUM.min) return 'MEDIUM';
    return 'LOW';
  }
  
  async getLocationFromIP(ip) {
    // In production, use MaxMind GeoIP2 or similar
    // This is a placeholder
    try {
      const cached = await cache.get(`geoip:${ip}`);
      if (cached) return cached;
      
      // Mock response
      const location = {
        country: 'IN',
        region: 'Maharashtra',
        city: 'Mumbai',
      };
      
      await cache.set(`geoip:${ip}`, location, 86400);
      return location;
    } catch (error) {
      return null;
    }
  }
  
  async checkIPRisk(ip) {
    // In production, use IP reputation service
    return {
      isProxy: false,
      isVPN: false,
      isTor: false,
      riskScore: 0,
    };
  }
  
  isDisposableEmail(email) {
    const disposableDomains = [
      'tempmail.com',
      'throwaway.email',
      'guerrillamail.com',
      'mailinator.com',
      '10minutemail.com',
      'yopmail.com',
      'temp-mail.org',
    ];
    
    const domain = email.split('@')[1]?.toLowerCase();
    return disposableDomains.includes(domain);
  }
  
  async verifyGSTIN(gstin) {
    // Delegate to GST service
    try {
      const gstService = require('./gst.service');
      const result = await gstService.verifyGSTIN(gstin);
      return result.isValid && !result.isCancelled;
    } catch {
      return true; // Don't block on verification failure
    }
  }
  
  // =============================================================================
  // REPORTING
  // =============================================================================
  
  /**
   * Get fraud statistics
   */
  async getFraudStats(period = 30) {
    const since = new Date(Date.now() - period * 24 * 60 * 60 * 1000);
    
    const stats = await prisma.fraudCheck.groupBy({
      by: ['decision'],
      where: { createdAt: { gte: since } },
      _count: true,
    });
    
    const totalChecks = stats.reduce((sum, s) => sum + s._count, 0);
    
    return {
      period,
      totalChecks,
      blocked: stats.find((s) => s.decision === 'BLOCKED')?._count || 0,
      reviewed: stats.find((s) => s.decision === 'REVIEW')?._count || 0,
      approved: stats.find((s) => s.decision === 'APPROVED')?._count || 0,
    };
  }
}

module.exports = new FraudDetectionService();
