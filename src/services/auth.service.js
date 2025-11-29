// =============================================================================
// AIRAVAT B2B MARKETPLACE - AUTHENTICATION SERVICE
// User authentication, registration, and session management
// =============================================================================

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');
const { cache, session } = require('../config/redis');
const config = require('../config');
const logger = require('../config/logger');
const {
  UnauthorizedError,
  BadRequestError,
  ConflictError,
  NotFoundError,
} = require('../utils/errors');
const {
  generateToken,
  generateOTP,
  maskEmail,
  maskPhone,
  generateSlug,
} = require('../utils/helpers');
const emailService = require('./email.service');
const smsService = require('./sms.service');

const SALT_ROUNDS = 12;
const OTP_EXPIRY_MINUTES = 10;
const MAX_LOGIN_ATTEMPTS = 5;
const LOCKOUT_DURATION_MINUTES = 30;

/**
 * Hash password
 */
const hashPassword = async (password) => {
  return bcrypt.hash(password, SALT_ROUNDS);
};

/**
 * Compare password with hash
 */
const comparePassword = async (password, hash) => {
  return bcrypt.compare(password, hash);
};

/**
 * Generate auth tokens
 */
const generateAuthTokens = async (user) => {
  const accessToken = jwt.sign(
    { userId: user.id, role: user.role },
    config.jwt.secret,
    { expiresIn: config.jwt.expiresIn }
  );

  const refreshToken = jwt.sign(
    { userId: user.id, type: 'refresh' },
    config.jwt.refreshSecret,
    { expiresIn: config.jwt.refreshExpiresIn }
  );

  // Store refresh token in database
  await prisma.userSession.create({
    data: {
      userId: user.id,
      token: accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
  });

  return { accessToken, refreshToken };
};

/**
 * Register new user
 */
const register = async (data) => {
  const { email, phone, password, firstName, lastName, role = 'BUYER' } = data;

  // Check if user already exists
  const existingUser = await prisma.user.findFirst({
    where: {
      OR: [
        { email: email.toLowerCase() },
        phone ? { phone } : {},
      ].filter(Boolean),
    },
  });

  if (existingUser) {
    if (existingUser.email === email.toLowerCase()) {
      throw new ConflictError('Email already registered');
    }
    if (existingUser.phone === phone) {
      throw new ConflictError('Phone number already registered');
    }
  }

  // Hash password
  const passwordHash = await hashPassword(password);

  // Create user
  const user = await prisma.user.create({
    data: {
      email: email.toLowerCase(),
      phone,
      passwordHash,
      firstName,
      lastName,
      role,
    },
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      role: true,
      createdAt: true,
    },
  });

  // Generate verification OTP
  const otp = generateOTP();
  await cache.set(`email_verification:${user.id}`, otp, OTP_EXPIRY_MINUTES * 60);

  // Send verification email
  await emailService.sendVerificationEmail(user.email, {
    name: user.firstName,
    otp,
  });

  // Generate tokens
  const tokens = await generateAuthTokens(user);

  logger.logAudit('USER_REGISTERED', user.id, { email: user.email, role });

  return {
    user,
    ...tokens,
    message: 'Registration successful. Please verify your email.',
  };
};

/**
 * Login with email/phone and password
 */
const login = async (data, deviceInfo = {}) => {
  const { email, phone, password } = data;

  // Find user by email or phone
  const user = await prisma.user.findFirst({
    where: {
      OR: [
        email ? { email: email.toLowerCase() } : {},
        phone ? { phone } : {},
      ].filter((o) => Object.keys(o).length > 0),
      deletedAt: null,
    },
    include: {
      business: {
        select: {
          id: true,
          businessName: true,
          slug: true,
          verificationStatus: true,
        },
      },
    },
  });

  if (!user) {
    throw new UnauthorizedError('Invalid credentials');
  }

  // Check if account is locked
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    const remainingMinutes = Math.ceil((user.lockedUntil - new Date()) / 60000);
    throw new UnauthorizedError(
      `Account locked. Try again in ${remainingMinutes} minutes.`
    );
  }

  // Check if account is banned
  if (user.isBanned) {
    throw new UnauthorizedError(`Account suspended: ${user.banReason || 'Contact support'}`);
  }

  // Check if account is active
  if (!user.isActive) {
    throw new UnauthorizedError('Account is deactivated');
  }

  // Verify password
  const isValidPassword = await comparePassword(password, user.passwordHash);

  if (!isValidPassword) {
    // Increment failed attempts
    const failedAttempts = user.failedLoginAttempts + 1;
    const updateData = { failedLoginAttempts: failedAttempts };

    // Lock account if max attempts exceeded
    if (failedAttempts >= MAX_LOGIN_ATTEMPTS) {
      updateData.lockedUntil = new Date(
        Date.now() + LOCKOUT_DURATION_MINUTES * 60 * 1000
      );
    }

    await prisma.user.update({
      where: { id: user.id },
      data: updateData,
    });

    throw new UnauthorizedError('Invalid credentials');
  }

  // Reset failed attempts on successful login
  await prisma.user.update({
    where: { id: user.id },
    data: {
      failedLoginAttempts: 0,
      lockedUntil: null,
      lastLoginAt: new Date(),
      lastLoginIp: deviceInfo.ip,
    },
  });

  // Generate tokens
  const tokens = await generateAuthTokens(user);

  // Store session with device info
  await prisma.userSession.updateMany({
    where: { token: tokens.accessToken },
    data: { deviceInfo },
  });

  logger.logAudit('USER_LOGIN', user.id, { ip: deviceInfo.ip });

  // Return user without sensitive data
  const { passwordHash, twoFactorSecret, ...safeUser } = user;

  return {
    user: safeUser,
    ...tokens,
  };
};

/**
 * Logout - invalidate session
 */
const logout = async (token, userId) => {
  await prisma.userSession.deleteMany({
    where: { token, userId },
  });

  logger.logAudit('USER_LOGOUT', userId);

  return { message: 'Logged out successfully' };
};

/**
 * Logout from all devices
 */
const logoutAll = async (userId) => {
  await prisma.userSession.deleteMany({
    where: { userId },
  });

  logger.logAudit('USER_LOGOUT_ALL', userId);

  return { message: 'Logged out from all devices' };
};

/**
 * Refresh access token
 */
const refreshTokens = async (refreshToken) => {
  try {
    // Verify refresh token
    const decoded = jwt.verify(refreshToken, config.jwt.refreshSecret);

    if (decoded.type !== 'refresh') {
      throw new UnauthorizedError('Invalid refresh token');
    }

    // Find session
    const session = await prisma.userSession.findFirst({
      where: { refreshToken, userId: decoded.userId },
      include: { user: true },
    });

    if (!session) {
      throw new UnauthorizedError('Session not found');
    }

    if (session.user.isBanned || !session.user.isActive) {
      throw new UnauthorizedError('Account is not active');
    }

    // Delete old session
    await prisma.userSession.delete({ where: { id: session.id } });

    // Generate new tokens
    const tokens = await generateAuthTokens(session.user);

    return tokens;
  } catch (error) {
    if (error.name === 'TokenExpiredError') {
      throw new UnauthorizedError('Refresh token expired');
    }
    throw error;
  }
};

/**
 * Send email verification OTP
 */
const sendEmailVerification = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new NotFoundError('User');
  }

  if (user.emailVerified) {
    throw new BadRequestError('Email already verified');
  }

  // Generate OTP
  const otp = generateOTP();
  await cache.set(`email_verification:${userId}`, otp, OTP_EXPIRY_MINUTES * 60);

  // Send email
  await emailService.sendVerificationEmail(user.email, {
    name: user.firstName,
    otp,
  });

  return { message: `Verification code sent to ${maskEmail(user.email)}` };
};

/**
 * Verify email with OTP
 */
const verifyEmail = async (userId, otp) => {
  const storedOTP = await cache.get(`email_verification:${userId}`);

  if (!storedOTP) {
    throw new BadRequestError('OTP expired. Please request a new one.');
  }

  if (storedOTP !== otp) {
    throw new BadRequestError('Invalid OTP');
  }

  // Update user
  await prisma.user.update({
    where: { id: userId },
    data: { emailVerified: true },
  });

  // Clear OTP
  await cache.del(`email_verification:${userId}`);

  logger.logAudit('EMAIL_VERIFIED', userId);

  return { message: 'Email verified successfully' };
};

/**
 * Send phone verification OTP
 */
const sendPhoneVerification = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user || !user.phone) {
    throw new BadRequestError('Phone number not found');
  }

  if (user.phoneVerified) {
    throw new BadRequestError('Phone already verified');
  }

  // Generate OTP
  const otp = generateOTP();
  await cache.set(`phone_verification:${userId}`, otp, OTP_EXPIRY_MINUTES * 60);

  // Send SMS
  await smsService.sendOTP(user.phone, otp);

  return { message: `Verification code sent to ${maskPhone(user.phone)}` };
};

/**
 * Verify phone with OTP
 */
const verifyPhone = async (userId, otp) => {
  const storedOTP = await cache.get(`phone_verification:${userId}`);

  if (!storedOTP) {
    throw new BadRequestError('OTP expired. Please request a new one.');
  }

  if (storedOTP !== otp) {
    throw new BadRequestError('Invalid OTP');
  }

  // Update user
  await prisma.user.update({
    where: { id: userId },
    data: { phoneVerified: true },
  });

  // Clear OTP
  await cache.del(`phone_verification:${userId}`);

  logger.logAudit('PHONE_VERIFIED', userId);

  return { message: 'Phone verified successfully' };
};

/**
 * Request password reset
 */
const forgotPassword = async (email) => {
  const user = await prisma.user.findUnique({
    where: { email: email.toLowerCase() },
  });

  // Don't reveal if email exists
  if (!user) {
    return { message: 'If this email exists, a reset link has been sent.' };
  }

  // Generate reset token
  const resetToken = generateToken();
  const resetExpiry = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

  // Store reset token
  await cache.set(
    `password_reset:${resetToken}`,
    { userId: user.id },
    60 * 60 // 1 hour
  );

  // Send reset email
  const resetUrl = `${config.app.frontendUrl}/reset-password?token=${resetToken}`;
  await emailService.sendPasswordResetEmail(user.email, {
    name: user.firstName,
    resetUrl,
  });

  logger.logAudit('PASSWORD_RESET_REQUESTED', user.id);

  return { message: 'If this email exists, a reset link has been sent.' };
};

/**
 * Reset password with token
 */
const resetPassword = async (token, newPassword) => {
  const data = await cache.get(`password_reset:${token}`);

  if (!data) {
    throw new BadRequestError('Invalid or expired reset token');
  }

  // Hash new password
  const passwordHash = await hashPassword(newPassword);

  // Update user password
  await prisma.user.update({
    where: { id: data.userId },
    data: { passwordHash },
  });

  // Invalidate all sessions (force re-login)
  await prisma.userSession.deleteMany({
    where: { userId: data.userId },
  });

  // Clear reset token
  await cache.del(`password_reset:${token}`);

  logger.logAudit('PASSWORD_RESET_COMPLETED', data.userId);

  return { message: 'Password reset successful. Please login with your new password.' };
};

/**
 * Change password (authenticated)
 */
const changePassword = async (userId, currentPassword, newPassword) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
  });

  if (!user) {
    throw new NotFoundError('User');
  }

  // Verify current password
  const isValid = await comparePassword(currentPassword, user.passwordHash);
  if (!isValid) {
    throw new BadRequestError('Current password is incorrect');
  }

  // Hash new password
  const passwordHash = await hashPassword(newPassword);

  // Update password
  await prisma.user.update({
    where: { id: userId },
    data: { passwordHash },
  });

  // Invalidate other sessions (keep current)
  await prisma.userSession.deleteMany({
    where: {
      userId,
      NOT: { lastActiveAt: { gte: new Date(Date.now() - 5000) } },
    },
  });

  logger.logAudit('PASSWORD_CHANGED', userId);

  return { message: 'Password changed successfully' };
};

/**
 * Get current user profile
 */
const getProfile = async (userId) => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      emailVerified: true,
      phone: true,
      phoneVerified: true,
      firstName: true,
      lastName: true,
      avatar: true,
      role: true,
      language: true,
      currency: true,
      timezone: true,
      twoFactorEnabled: true,
      createdAt: true,
      business: {
        select: {
          id: true,
          businessName: true,
          slug: true,
          businessType: true,
          verificationStatus: true,
          logo: true,
          subscriptionId: true,
        },
      },
    },
  });

  if (!user) {
    throw new NotFoundError('User');
  }

  return user;
};

/**
 * Update user profile
 */
const updateProfile = async (userId, data) => {
  const { firstName, lastName, avatar, language, currency, timezone } = data;

  const user = await prisma.user.update({
    where: { id: userId },
    data: {
      ...(firstName && { firstName }),
      ...(lastName && { lastName }),
      ...(avatar && { avatar }),
      ...(language && { language }),
      ...(currency && { currency }),
      ...(timezone && { timezone }),
    },
    select: {
      id: true,
      email: true,
      phone: true,
      firstName: true,
      lastName: true,
      avatar: true,
      language: true,
      currency: true,
      timezone: true,
    },
  });

  logger.logAudit('PROFILE_UPDATED', userId);

  return user;
};

/**
 * Get active sessions
 */
const getSessions = async (userId) => {
  const sessions = await prisma.userSession.findMany({
    where: { userId },
    select: {
      id: true,
      deviceInfo: true,
      createdAt: true,
      lastActiveAt: true,
    },
    orderBy: { lastActiveAt: 'desc' },
  });

  return sessions;
};

/**
 * Revoke specific session
 */
const revokeSession = async (userId, sessionId) => {
  await prisma.userSession.deleteMany({
    where: { id: sessionId, userId },
  });

  return { message: 'Session revoked' };
};

module.exports = {
  register,
  login,
  logout,
  logoutAll,
  refreshTokens,
  sendEmailVerification,
  verifyEmail,
  sendPhoneVerification,
  verifyPhone,
  forgotPassword,
  resetPassword,
  changePassword,
  getProfile,
  updateProfile,
  getSessions,
  revokeSession,
  hashPassword,
  comparePassword,
};
