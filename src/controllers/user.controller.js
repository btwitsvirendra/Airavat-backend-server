// =============================================================================
// AIRAVAT B2B MARKETPLACE - USER CONTROLLER
// User profile, preferences, and account management
// =============================================================================

const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const { hashPassword, comparePassword } = require('../utils/helpers');
const { successResponse, errorResponse } = require('../utils/response');
const { BadRequestError, NotFoundError, UnauthorizedError } = require('../utils/errors');
const logger = require('../config/logger');

class UserController {
  // =============================================================================
  // PROFILE MANAGEMENT
  // =============================================================================

  /**
   * Get current user profile
   */
  async getProfile(req, res, next) {
    try {
      const userId = req.user.id;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          avatar: true,
          role: true,
          status: true,
          isEmailVerified: true,
          isPhoneVerified: true,
          twoFactorEnabled: true,
          lastLoginAt: true,
          createdAt: true,
          preferences: true,
          businesses: {
            select: {
              id: true,
              businessName: true,
              slug: true,
              logo: true,
              verificationStatus: true,
              role: true,
            },
          },
        },
      });

      if (!user) {
        throw new NotFoundError('User not found');
      }

      return successResponse(res, user, 'Profile retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update user profile
   */
  async updateProfile(req, res, next) {
    try {
      const userId = req.user.id;
      const { firstName, lastName, avatar, phone } = req.body;

      // Check if phone is being changed and already exists
      if (phone) {
        const existingPhone = await prisma.user.findFirst({
          where: { phone, id: { not: userId } },
        });
        if (existingPhone) {
          throw new BadRequestError('Phone number already in use');
        }
      }

      const updatedUser = await prisma.user.update({
        where: { id: userId },
        data: {
          firstName,
          lastName,
          avatar,
          phone,
          isPhoneVerified: phone ? false : undefined, // Reset verification if phone changed
        },
        select: {
          id: true,
          email: true,
          phone: true,
          firstName: true,
          lastName: true,
          avatar: true,
          isPhoneVerified: true,
        },
      });

      // Clear cache
      await cache.del(`user:${userId}`);

      logger.info('User profile updated', { userId });

      return successResponse(res, updatedUser, 'Profile updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Change password
   */
  async changePassword(req, res, next) {
    try {
      const userId = req.user.id;
      const { currentPassword, newPassword } = req.body;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { password: true },
      });

      if (!user) {
        throw new NotFoundError('User not found');
      }

      // Verify current password
      const isValid = await comparePassword(currentPassword, user.password);
      if (!isValid) {
        throw new UnauthorizedError('Current password is incorrect');
      }

      // Hash new password
      const hashedPassword = await hashPassword(newPassword);

      await prisma.user.update({
        where: { id: userId },
        data: { password: hashedPassword },
      });

      // Invalidate all sessions except current
      await prisma.session.deleteMany({
        where: {
          userId,
          id: { not: req.sessionId },
        },
      });

      logger.info('Password changed', { userId });

      return successResponse(res, null, 'Password changed successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update user preferences
   */
  async updatePreferences(req, res, next) {
    try {
      const userId = req.user.id;
      const { notifications, language, currency, timezone } = req.body;

      const preferences = await prisma.userPreferences.upsert({
        where: { userId },
        update: {
          emailNotifications: notifications?.email,
          smsNotifications: notifications?.sms,
          pushNotifications: notifications?.push,
          orderUpdates: notifications?.orderUpdates,
          promotionalEmails: notifications?.promotional,
          language,
          currency,
          timezone,
        },
        create: {
          userId,
          emailNotifications: notifications?.email ?? true,
          smsNotifications: notifications?.sms ?? true,
          pushNotifications: notifications?.push ?? true,
          orderUpdates: notifications?.orderUpdates ?? true,
          promotionalEmails: notifications?.promotional ?? false,
          language: language || 'en',
          currency: currency || 'INR',
          timezone: timezone || 'Asia/Kolkata',
        },
      });

      return successResponse(res, preferences, 'Preferences updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Get user preferences
   */
  async getPreferences(req, res, next) {
    try {
      const userId = req.user.id;

      let preferences = await prisma.userPreferences.findUnique({
        where: { userId },
      });

      if (!preferences) {
        // Create default preferences
        preferences = await prisma.userPreferences.create({
          data: {
            userId,
            emailNotifications: true,
            smsNotifications: true,
            pushNotifications: true,
            orderUpdates: true,
            promotionalEmails: false,
            language: 'en',
            currency: 'INR',
            timezone: 'Asia/Kolkata',
          },
        });
      }

      return successResponse(res, preferences, 'Preferences retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // TWO-FACTOR AUTHENTICATION
  // =============================================================================

  /**
   * Enable 2FA
   */
  async enable2FA(req, res, next) {
    try {
      const userId = req.user.id;
      const speakeasy = require('speakeasy');
      const QRCode = require('qrcode');

      // Generate secret
      const secret = speakeasy.generateSecret({
        name: `Airavat (${req.user.email})`,
        length: 20,
      });

      // Store secret temporarily (not enabled yet)
      await prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorSecret: secret.base32,
          twoFactorEnabled: false,
        },
      });

      // Generate QR code
      const qrCodeUrl = await QRCode.toDataURL(secret.otpauth_url);

      return successResponse(res, {
        secret: secret.base32,
        qrCode: qrCodeUrl,
      }, 'Scan QR code with authenticator app, then verify');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Verify and activate 2FA
   */
  async verify2FA(req, res, next) {
    try {
      const userId = req.user.id;
      const { token } = req.body;
      const speakeasy = require('speakeasy');

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { twoFactorSecret: true },
      });

      if (!user?.twoFactorSecret) {
        throw new BadRequestError('2FA setup not initiated');
      }

      // Verify token
      const verified = speakeasy.totp.verify({
        secret: user.twoFactorSecret,
        encoding: 'base32',
        token,
        window: 2,
      });

      if (!verified) {
        throw new BadRequestError('Invalid verification code');
      }

      // Enable 2FA
      await prisma.user.update({
        where: { id: userId },
        data: { twoFactorEnabled: true },
      });

      // Generate backup codes
      const backupCodes = Array.from({ length: 10 }, () =>
        require('crypto').randomBytes(4).toString('hex').toUpperCase()
      );

      await prisma.backupCode.createMany({
        data: backupCodes.map((code) => ({
          userId,
          code: require('crypto').createHash('sha256').update(code).digest('hex'),
        })),
      });

      logger.info('2FA enabled', { userId });

      return successResponse(res, {
        enabled: true,
        backupCodes,
      }, '2FA enabled successfully. Save your backup codes!');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Disable 2FA
   */
  async disable2FA(req, res, next) {
    try {
      const userId = req.user.id;
      const { password, token } = req.body;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { password: true, twoFactorSecret: true, twoFactorEnabled: true },
      });

      // Verify password
      const isValid = await comparePassword(password, user.password);
      if (!isValid) {
        throw new UnauthorizedError('Invalid password');
      }

      // Verify 2FA token if enabled
      if (user.twoFactorEnabled && user.twoFactorSecret) {
        const speakeasy = require('speakeasy');
        const verified = speakeasy.totp.verify({
          secret: user.twoFactorSecret,
          encoding: 'base32',
          token,
          window: 2,
        });

        if (!verified) {
          throw new BadRequestError('Invalid 2FA code');
        }
      }

      // Disable 2FA
      await prisma.user.update({
        where: { id: userId },
        data: {
          twoFactorEnabled: false,
          twoFactorSecret: null,
        },
      });

      // Delete backup codes
      await prisma.backupCode.deleteMany({
        where: { userId },
      });

      logger.info('2FA disabled', { userId });

      return successResponse(res, null, '2FA disabled successfully');
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // ADDRESSES
  // =============================================================================

  /**
   * Get user addresses
   */
  async getAddresses(req, res, next) {
    try {
      const userId = req.user.id;

      const addresses = await prisma.address.findMany({
        where: { userId },
        orderBy: [{ isDefault: 'desc' }, { createdAt: 'desc' }],
      });

      return successResponse(res, addresses, 'Addresses retrieved successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Add new address
   */
  async addAddress(req, res, next) {
    try {
      const userId = req.user.id;
      const {
        label,
        contactName,
        phone,
        addressLine1,
        addressLine2,
        city,
        state,
        country,
        pincode,
        landmark,
        isDefault,
        type,
      } = req.body;

      // If setting as default, unset others
      if (isDefault) {
        await prisma.address.updateMany({
          where: { userId },
          data: { isDefault: false },
        });
      }

      const address = await prisma.address.create({
        data: {
          userId,
          label,
          contactName,
          phone,
          addressLine1,
          addressLine2,
          city,
          state,
          country,
          pincode,
          landmark,
          isDefault: isDefault || false,
          type: type || 'SHIPPING',
        },
      });

      return successResponse(res, address, 'Address added successfully', 201);
    } catch (error) {
      next(error);
    }
  }

  /**
   * Update address
   */
  async updateAddress(req, res, next) {
    try {
      const userId = req.user.id;
      const { addressId } = req.params;
      const updateData = req.body;

      // Verify ownership
      const existing = await prisma.address.findFirst({
        where: { id: addressId, userId },
      });

      if (!existing) {
        throw new NotFoundError('Address not found');
      }

      // If setting as default, unset others
      if (updateData.isDefault) {
        await prisma.address.updateMany({
          where: { userId, id: { not: addressId } },
          data: { isDefault: false },
        });
      }

      const address = await prisma.address.update({
        where: { id: addressId },
        data: updateData,
      });

      return successResponse(res, address, 'Address updated successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Delete address
   */
  async deleteAddress(req, res, next) {
    try {
      const userId = req.user.id;
      const { addressId } = req.params;

      // Verify ownership
      const existing = await prisma.address.findFirst({
        where: { id: addressId, userId },
      });

      if (!existing) {
        throw new NotFoundError('Address not found');
      }

      await prisma.address.delete({
        where: { id: addressId },
      });

      return successResponse(res, null, 'Address deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // NOTIFICATIONS
  // =============================================================================

  /**
   * Get user notifications
   */
  async getNotifications(req, res, next) {
    try {
      const userId = req.user.id;
      const { page = 1, limit = 20, unreadOnly = false } = req.query;
      const skip = (page - 1) * limit;

      const where = {
        userId,
        ...(unreadOnly === 'true' && { isRead: false }),
      };

      const [notifications, total] = await Promise.all([
        prisma.notification.findMany({
          where,
          orderBy: { createdAt: 'desc' },
          skip,
          take: parseInt(limit),
        }),
        prisma.notification.count({ where }),
      ]);

      const unreadCount = await prisma.notification.count({
        where: { userId, isRead: false },
      });

      return successResponse(res, {
        notifications,
        unreadCount,
        pagination: {
          page: parseInt(page),
          limit: parseInt(limit),
          total,
          pages: Math.ceil(total / limit),
        },
      });
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark notification as read
   */
  async markNotificationRead(req, res, next) {
    try {
      const userId = req.user.id;
      const { notificationId } = req.params;

      await prisma.notification.updateMany({
        where: { id: notificationId, userId },
        data: { isRead: true, readAt: new Date() },
      });

      return successResponse(res, null, 'Notification marked as read');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllNotificationsRead(req, res, next) {
    try {
      const userId = req.user.id;

      await prisma.notification.updateMany({
        where: { userId, isRead: false },
        data: { isRead: true, readAt: new Date() },
      });

      return successResponse(res, null, 'All notifications marked as read');
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // SESSIONS
  // =============================================================================

  /**
   * Get active sessions
   */
  async getSessions(req, res, next) {
    try {
      const userId = req.user.id;

      const sessions = await prisma.session.findMany({
        where: {
          userId,
          expiresAt: { gt: new Date() },
        },
        select: {
          id: true,
          deviceInfo: true,
          ip: true,
          location: true,
          createdAt: true,
          lastActivityAt: true,
        },
        orderBy: { lastActivityAt: 'desc' },
      });

      // Mark current session
      const sessionsWithCurrent = sessions.map((session) => ({
        ...session,
        isCurrent: session.id === req.sessionId,
      }));

      return successResponse(res, sessionsWithCurrent, 'Sessions retrieved');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Revoke session
   */
  async revokeSession(req, res, next) {
    try {
      const userId = req.user.id;
      const { sessionId } = req.params;

      // Can't revoke current session
      if (sessionId === req.sessionId) {
        throw new BadRequestError('Cannot revoke current session. Use logout instead.');
      }

      await prisma.session.deleteMany({
        where: { id: sessionId, userId },
      });

      // Invalidate Redis cache
      await cache.del(`session:${sessionId}`);

      return successResponse(res, null, 'Session revoked');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Revoke all other sessions
   */
  async revokeAllSessions(req, res, next) {
    try {
      const userId = req.user.id;

      const sessions = await prisma.session.findMany({
        where: {
          userId,
          id: { not: req.sessionId },
        },
        select: { id: true },
      });

      await prisma.session.deleteMany({
        where: {
          userId,
          id: { not: req.sessionId },
        },
      });

      // Clear Redis cache for all sessions
      await Promise.all(
        sessions.map((s) => cache.del(`session:${s.id}`))
      );

      return successResponse(res, null, 'All other sessions revoked');
    } catch (error) {
      next(error);
    }
  }

  // =============================================================================
  // ACCOUNT MANAGEMENT
  // =============================================================================

  /**
   * Delete account
   */
  async deleteAccount(req, res, next) {
    try {
      const userId = req.user.id;
      const { password, reason } = req.body;

      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { password: true },
      });

      // Verify password
      const isValid = await comparePassword(password, user.password);
      if (!isValid) {
        throw new UnauthorizedError('Invalid password');
      }

      // Check for pending orders
      const pendingOrders = await prisma.order.count({
        where: {
          OR: [
            { buyerId: userId },
            { seller: { ownerId: userId } },
          ],
          status: {
            in: ['PENDING', 'CONFIRMED', 'PROCESSING', 'SHIPPED'],
          },
        },
      });

      if (pendingOrders > 0) {
        throw new BadRequestError(
          'Cannot delete account with pending orders. Please complete or cancel all orders first.'
        );
      }

      // Log deletion request
      await prisma.accountDeletionRequest.create({
        data: {
          userId,
          reason,
          status: 'PENDING',
        },
      });

      // Soft delete - anonymize data
      await prisma.user.update({
        where: { id: userId },
        data: {
          email: `deleted_${userId}@deleted.com`,
          phone: null,
          firstName: 'Deleted',
          lastName: 'User',
          password: '',
          status: 'DELETED',
          deletedAt: new Date(),
        },
      });

      // Invalidate all sessions
      await prisma.session.deleteMany({ where: { userId } });

      logger.info('Account deleted', { userId, reason });

      return successResponse(res, null, 'Account deleted successfully');
    } catch (error) {
      next(error);
    }
  }

  /**
   * Export user data (GDPR compliance)
   */
  async exportData(req, res, next) {
    try {
      const userId = req.user.id;

      const userData = await prisma.user.findUnique({
        where: { id: userId },
        include: {
          businesses: {
            include: {
              addresses: true,
              products: {
                take: 100,
              },
            },
          },
          addresses: true,
          orders: {
            include: {
              items: true,
              payments: true,
            },
            take: 100,
          },
          reviews: true,
          notifications: {
            take: 100,
          },
        },
      });

      // Remove sensitive data
      delete userData.password;
      delete userData.twoFactorSecret;

      return successResponse(res, userData, 'Data exported successfully');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = new UserController();
