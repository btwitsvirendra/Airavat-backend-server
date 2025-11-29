// =============================================================================
// AIRAVAT B2B MARKETPLACE - TWO-FACTOR AUTHENTICATION SERVICE
// OTP, Authenticator App & Backup Codes
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const crypto = require('crypto');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const { NotFoundError, BadRequestError, UnauthorizedError } = require('../utils/errors');
const { generateId } = require('../utils/helpers');

// =============================================================================
// CONSTANTS
// =============================================================================

const TFA_METHOD = { SMS: 'SMS', EMAIL: 'EMAIL', AUTHENTICATOR: 'AUTHENTICATOR' };
const OTP_PURPOSE = { LOGIN: 'LOGIN', TRANSACTION: 'TRANSACTION', CHANGE_PASSWORD: 'CHANGE_PASSWORD', ENABLE_2FA: 'ENABLE_2FA', RESET_2FA: 'RESET_2FA' };
const OTP_EXPIRY_MINUTES = 5;
const MAX_OTP_ATTEMPTS = 5;
const BACKUP_CODE_COUNT = 10;
const OTP_LENGTH = 6;
const RATE_LIMIT = { OTP_SEND: { max: 5, windowSeconds: 300 }, OTP_VERIFY: { max: 10, windowSeconds: 300 } };

// =============================================================================
// OTP GENERATION & VERIFICATION
// =============================================================================

const generateOTP = async (userId, purpose, method = TFA_METHOD.SMS) => {
  const rateKey = `otp:rate:${userId}`;
  const attempts = await cache.get(rateKey) || 0;
  if (attempts >= RATE_LIMIT.OTP_SEND.max) throw new BadRequestError('Too many OTP requests. Please try again later.');

  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, email: true, phone: true } });
  if (!user) throw new NotFoundError('User');

  if (method === TFA_METHOD.SMS && !user.phone) throw new BadRequestError('Phone number not registered');
  if (method === TFA_METHOD.EMAIL && !user.email) throw new BadRequestError('Email not registered');

  const otp = generateNumericOTP(OTP_LENGTH);
  const expiresAt = new Date(Date.now() + OTP_EXPIRY_MINUTES * 60 * 1000);
  const hashedOtp = hashOTP(otp);

  await prisma.otpCode.create({ data: { userId, code: hashedOtp, purpose, method, expiresAt, attempts: 0 } });
  await cache.set(rateKey, attempts + 1, RATE_LIMIT.OTP_SEND.windowSeconds);

  const destination = method === TFA_METHOD.SMS ? user.phone : user.email;
  await queueOTPDelivery(destination, otp, method, purpose);

  logger.info('OTP generated', { userId, purpose, method, destination: maskDestination(destination, method) });

  return { sent: true, method, destination: maskDestination(destination, method), expiresAt, expiresInSeconds: OTP_EXPIRY_MINUTES * 60 };
};

const verifyOTP = async (userId, otp, purpose) => {
  const rateKey = `otp:verify:${userId}`;
  const attempts = await cache.get(rateKey) || 0;
  if (attempts >= RATE_LIMIT.OTP_VERIFY.max) throw new BadRequestError('Too many verification attempts. Please try again later.');

  const otpRecord = await prisma.otpCode.findFirst({ where: { userId, purpose, verified: false, expiresAt: { gt: new Date() } }, orderBy: { createdAt: 'desc' } });
  if (!otpRecord) throw new BadRequestError('Invalid or expired OTP');

  if (otpRecord.attempts >= MAX_OTP_ATTEMPTS) {
    await prisma.otpCode.update({ where: { id: otpRecord.id }, data: { verified: false } });
    throw new BadRequestError('Maximum attempts exceeded. Please request a new OTP.');
  }

  const hashedInput = hashOTP(otp);
  const isValid = hashedInput === otpRecord.code;

  if (!isValid) {
    await prisma.otpCode.update({ where: { id: otpRecord.id }, data: { attempts: { increment: 1 } } });
    await cache.set(rateKey, attempts + 1, RATE_LIMIT.OTP_VERIFY.windowSeconds);
    const remainingAttempts = MAX_OTP_ATTEMPTS - otpRecord.attempts - 1;
    throw new BadRequestError(`Invalid OTP. ${remainingAttempts} attempts remaining.`);
  }

  await prisma.otpCode.update({ where: { id: otpRecord.id }, data: { verified: true, verifiedAt: new Date() } });

  const verificationToken = generateVerificationToken(userId, purpose);
  logger.info('OTP verified', { userId, purpose });

  return { verified: true, verificationToken, expiresIn: 300 };
};

const generateNumericOTP = (length) => {
  const digits = '0123456789';
  let otp = '';
  const bytes = crypto.randomBytes(length);
  for (let i = 0; i < length; i++) otp += digits[bytes[i] % 10];
  return otp;
};

const hashOTP = (otp) => crypto.createHash('sha256').update(otp).digest('hex');

const generateVerificationToken = (userId, purpose) => {
  const payload = `${userId}:${purpose}:${Date.now()}`;
  const token = crypto.createHmac('sha256', config.jwt.secret).update(payload).digest('hex');
  cache.set(`verify:${token}`, { userId, purpose }, 300);
  return token;
};

const validateVerificationToken = async (token, userId, purpose) => {
  const cached = await cache.get(`verify:${token}`);
  if (!cached) return false;
  if (cached.userId !== userId || cached.purpose !== purpose) return false;
  await cache.del(`verify:${token}`);
  return true;
};

const maskDestination = (destination, method) => {
  if (method === TFA_METHOD.SMS) return destination.replace(/(\d{2})\d+(\d{2})/, '$1****$2');
  const [name, domain] = destination.split('@');
  return `${name.substring(0, 2)}***@${domain}`;
};

const queueOTPDelivery = async (destination, otp, method, purpose) => {
  if (config.app.isDev) logger.debug(`[DEV] OTP for ${purpose}: ${otp} -> ${destination}`);
};

// =============================================================================
// AUTHENTICATOR APP (TOTP)
// =============================================================================

const setupAuthenticator = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true, firstName: true } });
  if (!user) throw new NotFoundError('User');

  const secret = speakeasy.generateSecret({ name: `Airavat (${user.email})`, issuer: 'Airavat B2B', length: 32 });
  const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

  await prisma.twoFactorSetup.upsert({
    where: { userId },
    create: { userId, method: TFA_METHOD.AUTHENTICATOR, secret: secret.base32, verified: false },
    update: { secret: secret.base32, verified: false },
  });

  return { secret: secret.base32, qrCode: qrCodeUrl, manualEntryKey: secret.base32, issuer: 'Airavat B2B', account: user.email };
};

const verifyAuthenticatorSetup = async (userId, token) => {
  const setup = await prisma.twoFactorSetup.findFirst({ where: { userId, method: TFA_METHOD.AUTHENTICATOR, verified: false } });
  if (!setup) throw new BadRequestError('No pending authenticator setup');

  const verified = speakeasy.totp.verify({ secret: setup.secret, encoding: 'base32', token, window: 1 });
  if (!verified) throw new BadRequestError('Invalid verification code');

  const backupCodes = generateBackupCodes();
  const hashedBackupCodes = backupCodes.map((code) => hashOTP(code));

  await prisma.$transaction([
    prisma.twoFactorSetup.update({ where: { id: setup.id }, data: { verified: true, verifiedAt: new Date(), backupCodes: hashedBackupCodes } }),
    prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true, twoFactorMethod: TFA_METHOD.AUTHENTICATOR } }),
  ]);

  logger.info('Authenticator setup verified', { userId });
  return { enabled: true, backupCodes, message: 'Two-factor authentication enabled. Save your backup codes!' };
};

const verifyTOTP = async (userId, token) => {
  const setup = await prisma.twoFactorSetup.findFirst({ where: { userId, method: TFA_METHOD.AUTHENTICATOR, verified: true } });
  if (!setup) throw new BadRequestError('Authenticator not setup');
  return speakeasy.totp.verify({ secret: setup.secret, encoding: 'base32', token, window: 1 });
};

const generateBackupCodes = () => {
  const codes = [];
  for (let i = 0; i < BACKUP_CODE_COUNT; i++) codes.push(crypto.randomBytes(4).toString('hex').toUpperCase());
  return codes;
};

const verifyBackupCode = async (userId, code) => {
  const setup = await prisma.twoFactorSetup.findFirst({ where: { userId, verified: true } });
  if (!setup || !setup.backupCodes?.length) return false;

  const hashedCode = hashOTP(code.toUpperCase());
  const codeIndex = setup.backupCodes.indexOf(hashedCode);
  if (codeIndex === -1) return false;

  const updatedCodes = setup.backupCodes.filter((_, i) => i !== codeIndex);
  await prisma.twoFactorSetup.update({ where: { id: setup.id }, data: { backupCodes: updatedCodes } });

  logger.info('Backup code used', { userId, remainingCodes: updatedCodes.length });
  return true;
};

// =============================================================================
// 2FA MANAGEMENT
// =============================================================================

const get2FAStatus = async (userId) => {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { twoFactorEnabled: true, twoFactorMethod: true } });
  if (!user) throw new NotFoundError('User');

  let setup = null;
  if (user.twoFactorEnabled) {
    setup = await prisma.twoFactorSetup.findFirst({ where: { userId, verified: true }, select: { method: true, verifiedAt: true, backupCodes: true } });
  }

  return { enabled: user.twoFactorEnabled, method: user.twoFactorMethod, setupAt: setup?.verifiedAt, backupCodesRemaining: setup?.backupCodes?.length || 0 };
};

const disable2FA = async (userId, verificationToken) => {
  const isValid = await validateVerificationToken(verificationToken, userId, OTP_PURPOSE.RESET_2FA);
  if (!isValid) throw new UnauthorizedError('Invalid verification');

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: false, twoFactorMethod: null } }),
    prisma.twoFactorSetup.deleteMany({ where: { userId } }),
  ]);

  logger.info('2FA disabled', { userId });
  return { disabled: true };
};

const regenerateBackupCodes = async (userId, verificationToken) => {
  const isValid = await validateVerificationToken(verificationToken, userId, OTP_PURPOSE.RESET_2FA);
  if (!isValid) throw new UnauthorizedError('Invalid verification');

  const setup = await prisma.twoFactorSetup.findFirst({ where: { userId, verified: true } });
  if (!setup) throw new BadRequestError('2FA not enabled');

  const backupCodes = generateBackupCodes();
  const hashedBackupCodes = backupCodes.map((code) => hashOTP(code));

  await prisma.twoFactorSetup.update({ where: { id: setup.id }, data: { backupCodes: hashedBackupCodes } });
  logger.info('Backup codes regenerated', { userId });

  return { backupCodes };
};

// =============================================================================
// DEVICE MANAGEMENT
// =============================================================================

const registerDevice = async (userId, deviceInfo) => {
  const deviceId = crypto.createHash('sha256').update(`${userId}:${deviceInfo.userAgent}:${deviceInfo.ip}`).digest('hex').substring(0, 32);

  const device = await prisma.userDevice.upsert({
    where: { id: deviceId },
    create: { id: deviceId, userId, deviceName: deviceInfo.deviceName || 'Unknown Device', deviceType: deviceInfo.deviceType || 'unknown', browser: deviceInfo.browser, os: deviceInfo.os, ip: deviceInfo.ip, lastUsed: new Date(), trusted: false },
    update: { lastUsed: new Date(), ip: deviceInfo.ip },
  });

  return device;
};

const trustDevice = async (userId, deviceId) => {
  const device = await prisma.userDevice.findFirst({ where: { id: deviceId, userId } });
  if (!device) throw new NotFoundError('Device');

  await prisma.userDevice.update({ where: { id: deviceId }, data: { trusted: true, trustedAt: new Date() } });
  return { trusted: true };
};

const isDeviceTrusted = async (userId, deviceInfo) => {
  const deviceId = crypto.createHash('sha256').update(`${userId}:${deviceInfo.userAgent}:${deviceInfo.ip}`).digest('hex').substring(0, 32);
  const device = await prisma.userDevice.findFirst({ where: { id: deviceId, userId, trusted: true } });
  return !!device;
};

const getUserDevices = async (userId) => prisma.userDevice.findMany({ where: { userId }, orderBy: { lastUsed: 'desc' } });

const removeDevice = async (userId, deviceId) => {
  const device = await prisma.userDevice.findFirst({ where: { id: deviceId, userId } });
  if (!device) throw new NotFoundError('Device');
  await prisma.userDevice.delete({ where: { id: deviceId } });
  return { removed: true };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  TFA_METHOD, OTP_PURPOSE,
  generateOTP, verifyOTP, generateNumericOTP, validateVerificationToken,
  setupAuthenticator, verifyAuthenticatorSetup, verifyTOTP, verifyBackupCode,
  get2FAStatus, disable2FA, regenerateBackupCodes,
  registerDevice, trustDevice, isDeviceTrusted, getUserDevices, removeDevice,
};
