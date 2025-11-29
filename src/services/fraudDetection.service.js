// =============================================================================
// AIRAVAT B2B MARKETPLACE - FRAUD DETECTION SERVICE
// Risk Assessment, IP Blacklisting & Transaction Monitoring
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');
const geoip = require('geoip-lite');
const { NotFoundError, BadRequestError } = require('../utils/errors');
const { emitToUser } = require('./socket.service');

// =============================================================================
// CONSTANTS
// =============================================================================

const RISK_LEVEL = { LOW: 'LOW', MEDIUM: 'MEDIUM', HIGH: 'HIGH', CRITICAL: 'CRITICAL' };
const RISK_ACTION = { ALLOW: 'ALLOW', CHALLENGE: 'CHALLENGE', REVIEW: 'REVIEW', BLOCK: 'BLOCK' };
const ALERT_TYPE = { SUSPICIOUS_LOGIN: 'SUSPICIOUS_LOGIN', MULTIPLE_FAILED_ATTEMPTS: 'MULTIPLE_FAILED_ATTEMPTS', UNUSUAL_LOCATION: 'UNUSUAL_LOCATION', HIGH_VALUE_TRANSACTION: 'HIGH_VALUE_TRANSACTION', VELOCITY_LIMIT: 'VELOCITY_LIMIT', BLACKLISTED_IP: 'BLACKLISTED_IP' };
const CACHE_TTL = { BLACKLIST: 3600, RISK_SCORE: 300 };

const RISK_WEIGHTS = { newAccount: 15, unverifiedEmail: 10, unverifiedPhone: 10, unverifiedBusiness: 20, newDevice: 15, newLocation: 20, vpnProxy: 25, blacklistedIp: 100, failedAttempts: 10, highValueTransaction: 15, velocityExceeded: 30 };
const THRESHOLDS = { riskScore: { low: 20, medium: 40, high: 60, critical: 80 }, velocity: { transactionsPerHour: 10, transactionsPerDay: 50, amountPerDay: 1000000 }, failedAttempts: { lockout: 5, resetMinutes: 30 } };

// =============================================================================
// RISK ASSESSMENT
// =============================================================================

const assessRisk = async (context) => {
  const { userId, businessId, action, amount, ip, userAgent, deviceFingerprint } = context;

  let riskScore = 0;
  const riskFactors = [];

  const isBlacklisted = await isIPBlacklisted(ip);
  if (isBlacklisted) { riskScore += RISK_WEIGHTS.blacklistedIp; riskFactors.push({ factor: 'BLACKLISTED_IP', weight: RISK_WEIGHTS.blacklistedIp }); }

  const user = await prisma.user.findUnique({ where: { id: userId }, include: { business: true } });
  if (!user) return { riskLevel: RISK_LEVEL.CRITICAL, action: RISK_ACTION.BLOCK };

  const accountAge = (Date.now() - new Date(user.createdAt).getTime()) / (1000 * 60 * 60 * 24);
  if (accountAge < 7) { riskScore += RISK_WEIGHTS.newAccount; riskFactors.push({ factor: 'NEW_ACCOUNT', weight: RISK_WEIGHTS.newAccount }); }

  if (!user.emailVerified) { riskScore += RISK_WEIGHTS.unverifiedEmail; riskFactors.push({ factor: 'UNVERIFIED_EMAIL', weight: RISK_WEIGHTS.unverifiedEmail }); }
  if (!user.phoneVerified) { riskScore += RISK_WEIGHTS.unverifiedPhone; riskFactors.push({ factor: 'UNVERIFIED_PHONE', weight: RISK_WEIGHTS.unverifiedPhone }); }
  if (user.business?.verificationStatus !== 'VERIFIED') { riskScore += RISK_WEIGHTS.unverifiedBusiness; riskFactors.push({ factor: 'UNVERIFIED_BUSINESS', weight: RISK_WEIGHTS.unverifiedBusiness }); }

  const deviceAnalysis = await analyzeDevice(userId, deviceFingerprint, userAgent, ip);
  if (deviceAnalysis.isNew) { riskScore += RISK_WEIGHTS.newDevice; riskFactors.push({ factor: 'NEW_DEVICE', weight: RISK_WEIGHTS.newDevice }); }

  const locationAnalysis = await analyzeLocation(userId, ip);
  if (locationAnalysis.isNew) { riskScore += RISK_WEIGHTS.newLocation; riskFactors.push({ factor: 'NEW_LOCATION', weight: RISK_WEIGHTS.newLocation }); }
  if (locationAnalysis.isVpnProxy) { riskScore += RISK_WEIGHTS.vpnProxy; riskFactors.push({ factor: 'VPN_PROXY', weight: RISK_WEIGHTS.vpnProxy }); }

  const failedAttempts = await getRecentFailedAttempts(userId);
  if (failedAttempts > 0) { const failedScore = failedAttempts * RISK_WEIGHTS.failedAttempts; riskScore += failedScore; riskFactors.push({ factor: 'FAILED_ATTEMPTS', weight: failedScore }); }

  if (amount) {
    if (amount >= 100000) { riskScore += RISK_WEIGHTS.highValueTransaction; riskFactors.push({ factor: 'HIGH_VALUE', weight: RISK_WEIGHTS.highValueTransaction }); }
    const velocityResult = await checkVelocity(userId, businessId, amount);
    if (velocityResult.exceeded) { riskScore += RISK_WEIGHTS.velocityExceeded; riskFactors.push({ factor: 'VELOCITY_EXCEEDED', weight: RISK_WEIGHTS.velocityExceeded }); }
  }

  const riskLevel = getRiskLevel(riskScore);
  const recommendedAction = getRecommendedAction(riskLevel);

  const assessment = await prisma.riskAssessment.create({
    data: { userId, businessId, action, ip, userAgent, deviceFingerprint, riskScore, riskLevel, riskFactors, recommendedAction, transactionAmount: amount },
  });

  if (riskLevel === RISK_LEVEL.HIGH || riskLevel === RISK_LEVEL.CRITICAL) {
    await createFraudAlert({ userId, businessId, type: ALERT_TYPE.HIGH_VALUE_TRANSACTION, riskLevel, details: { riskScore, riskFactors, action, amount }, assessmentId: assessment.id });
  }

  logger.info('Risk assessment completed', { assessmentId: assessment.id, userId, action, riskScore, riskLevel, recommendedAction });

  return { assessmentId: assessment.id, riskScore, riskLevel, action: recommendedAction, riskFactors, requiresVerification: recommendedAction === RISK_ACTION.CHALLENGE, blocked: recommendedAction === RISK_ACTION.BLOCK };
};

const getRiskLevel = (score) => {
  if (score >= THRESHOLDS.riskScore.critical) return RISK_LEVEL.CRITICAL;
  if (score >= THRESHOLDS.riskScore.high) return RISK_LEVEL.HIGH;
  if (score >= THRESHOLDS.riskScore.medium) return RISK_LEVEL.MEDIUM;
  return RISK_LEVEL.LOW;
};

const getRecommendedAction = (riskLevel) => {
  const actions = { [RISK_LEVEL.LOW]: RISK_ACTION.ALLOW, [RISK_LEVEL.MEDIUM]: RISK_ACTION.ALLOW, [RISK_LEVEL.HIGH]: RISK_ACTION.CHALLENGE, [RISK_LEVEL.CRITICAL]: RISK_ACTION.BLOCK };
  return actions[riskLevel] || RISK_ACTION.REVIEW;
};

// =============================================================================
// IP BLACKLIST MANAGEMENT
// =============================================================================

const isIPBlacklisted = async (ip) => {
  const cacheKey = `blacklist:${ip}`;
  const cached = await cache.get(cacheKey);
  if (cached !== null) return cached;

  const blacklisted = await prisma.ipBlacklist.findFirst({ where: { ip, expiresAt: { gt: new Date() } } });
  const result = !!blacklisted;
  await cache.set(cacheKey, result, CACHE_TTL.BLACKLIST);
  return result;
};

const blacklistIP = async (ip, reason, durationHours = 24) => {
  const expiresAt = durationHours > 0 ? new Date(Date.now() + durationHours * 60 * 60 * 1000) : new Date('2099-12-31');
  const record = await prisma.ipBlacklist.upsert({ where: { ip }, create: { ip, reason, expiresAt }, update: { reason, expiresAt } });
  await cache.del(`blacklist:${ip}`);
  logger.warn('IP blacklisted', { ip, reason, expiresAt });
  return record;
};

const removeFromBlacklist = async (ip) => {
  await prisma.ipBlacklist.delete({ where: { ip } });
  await cache.del(`blacklist:${ip}`);
  logger.info('IP removed from blacklist', { ip });
  return { success: true };
};

const getBlacklist = async (options = {}) => {
  const { page = 1, limit = 50, active = true } = options;
  const skip = (page - 1) * limit;
  const where = {};
  if (active) where.expiresAt = { gt: new Date() };

  const [records, total] = await Promise.all([
    prisma.ipBlacklist.findMany({ where, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.ipBlacklist.count({ where }),
  ]);

  return { records, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

// =============================================================================
// DEVICE & LOCATION ANALYSIS
// =============================================================================

const analyzeDevice = async (userId, fingerprint, userAgent, ip) => {
  if (!fingerprint) return { isNew: true, trusted: false };

  const knownDevice = await prisma.userDevice.findFirst({ where: { userId, id: fingerprint } });
  if (knownDevice) {
    await prisma.userDevice.update({ where: { id: knownDevice.id }, data: { lastUsed: new Date(), ip } });
    return { isNew: false, trusted: knownDevice.trusted, deviceId: knownDevice.id };
  }

  return { isNew: true, trusted: false };
};

const analyzeLocation = async (userId, ip) => {
  const geo = geoip.lookup(ip);
  const location = geo ? `${geo.city || 'Unknown'}, ${geo.country}` : 'Unknown';

  const recentLogins = await prisma.riskAssessment.findMany({ where: { userId, ip: { not: ip } }, select: { ip: true }, orderBy: { createdAt: 'desc' }, take: 10 });
  const knownCountries = new Set();
  recentLogins.forEach((login) => { const loginGeo = geoip.lookup(login.ip); if (loginGeo) knownCountries.add(loginGeo.country); });

  const isNew = geo && !knownCountries.has(geo.country);
  const isVpnProxy = await checkVpnProxy(ip);

  return { location, country: geo?.country, city: geo?.city, isNew, isVpnProxy, knownCountries: Array.from(knownCountries) };
};

const checkVpnProxy = async (ip) => {
  const geo = geoip.lookup(ip);
  if (geo?.org && /cloud|hosting|datacenter|vps/i.test(geo.org)) return true;
  return false;
};

// =============================================================================
// VELOCITY CHECKS
// =============================================================================

const checkVelocity = async (userId, businessId, amount) => {
  const now = new Date();
  const hourAgo = new Date(now - 60 * 60 * 1000);
  const dayAgo = new Date(now - 24 * 60 * 60 * 1000);

  const hourlyCount = await prisma.order.count({ where: { buyerId: businessId, createdAt: { gte: hourAgo } } });
  if (hourlyCount >= THRESHOLDS.velocity.transactionsPerHour) return { exceeded: true, reason: `Hourly transaction limit exceeded` };

  const dailyCount = await prisma.order.count({ where: { buyerId: businessId, createdAt: { gte: dayAgo } } });
  if (dailyCount >= THRESHOLDS.velocity.transactionsPerDay) return { exceeded: true, reason: `Daily transaction limit exceeded` };

  const dailyAmount = await prisma.order.aggregate({ where: { buyerId: businessId, createdAt: { gte: dayAgo } }, _sum: { totalAmount: true } });
  const totalDaily = (parseFloat(dailyAmount._sum.totalAmount) || 0) + amount;
  if (totalDaily >= THRESHOLDS.velocity.amountPerDay) return { exceeded: true, reason: `Daily amount limit exceeded` };

  return { exceeded: false };
};

// =============================================================================
// FAILED ATTEMPTS
// =============================================================================

const getRecentFailedAttempts = async (userId) => {
  const cacheKey = `failed:${userId}`;
  return await cache.get(cacheKey) || 0;
};

const recordFailedAttempt = async (userId, ip, reason) => {
  const cacheKey = `failed:${userId}`;
  const attempts = (await cache.get(cacheKey) || 0) + 1;
  await cache.set(cacheKey, attempts, THRESHOLDS.failedAttempts.resetMinutes * 60);

  if (attempts >= THRESHOLDS.failedAttempts.lockout) {
    await createFraudAlert({ userId, type: ALERT_TYPE.MULTIPLE_FAILED_ATTEMPTS, riskLevel: RISK_LEVEL.HIGH, details: { attempts, ip, reason } });
    await blacklistIP(ip, `Multiple failed attempts for user ${userId}`, 1);
  }

  return { attempts, locked: attempts >= THRESHOLDS.failedAttempts.lockout };
};

const clearFailedAttempts = async (userId) => {
  await cache.del(`failed:${userId}`);
  return { success: true };
};

// =============================================================================
// FRAUD ALERTS
// =============================================================================

const createFraudAlert = async (alertData) => {
  const alert = await prisma.fraudAlert.create({
    data: { userId: alertData.userId, businessId: alertData.businessId, type: alertData.type, riskLevel: alertData.riskLevel, details: alertData.details, assessmentId: alertData.assessmentId, status: 'OPEN' },
  });

  logger.warn('Fraud alert created', { alertId: alert.id, type: alertData.type, riskLevel: alertData.riskLevel });
  emitToUser('admin', 'fraud:alert', { alertId: alert.id, type: alertData.type, riskLevel: alertData.riskLevel, userId: alertData.userId });

  return alert;
};

const getFraudAlerts = async (options = {}) => {
  const { page = 1, limit = 20, status, riskLevel, type } = options;
  const skip = (page - 1) * limit;
  const where = {};
  if (status) where.status = status;
  if (riskLevel) where.riskLevel = riskLevel;
  if (type) where.type = type;

  const [alerts, total] = await Promise.all([
    prisma.fraudAlert.findMany({ where, include: { user: { select: { email: true, firstName: true, lastName: true } }, business: { select: { businessName: true } } }, skip, take: limit, orderBy: { createdAt: 'desc' } }),
    prisma.fraudAlert.count({ where }),
  ]);

  return { alerts, pagination: { page, limit, total, totalPages: Math.ceil(total / limit) } };
};

const resolveFraudAlert = async (alertId, resolution, notes) => {
  const alert = await prisma.fraudAlert.findUnique({ where: { id: alertId } });
  if (!alert) throw new NotFoundError('Alert');

  const updated = await prisma.fraudAlert.update({ where: { id: alertId }, data: { status: resolution, resolvedAt: new Date(), resolutionNotes: notes } });
  logger.info('Fraud alert resolved', { alertId, resolution });
  return updated;
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  RISK_LEVEL, RISK_ACTION, ALERT_TYPE,
  assessRisk, getRiskLevel, getRecommendedAction,
  isIPBlacklisted, blacklistIP, removeFromBlacklist, getBlacklist,
  analyzeDevice, analyzeLocation, checkVelocity,
  getRecentFailedAttempts, recordFailedAttempt, clearFailedAttempts,
  createFraudAlert, getFraudAlerts, resolveFraudAlert,
};
