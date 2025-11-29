// =============================================================================
// AIRAVAT B2B MARKETPLACE - USER ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const { authenticate, adminOnly } = require('../middleware/auth');
const { prisma } = require('../config/database');
const { success, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { asyncHandler } = require('../middleware/errorHandler');

// Get user by ID (admin only)
router.get(
  '/:userId',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.findUnique({
      where: { id: req.params.userId },
      include: {
        business: true,
      },
    });
    success(res, { user });
  })
);

// Update user (admin only)
router.patch(
  '/:userId',
  authenticate,
  adminOnly,
  asyncHandler(async (req, res) => {
    const user = await prisma.user.update({
      where: { id: req.params.userId },
      data: req.body,
    });
    success(res, { user });
  })
);

// Get user notifications
router.get(
  '/me/notifications',
  authenticate,
  asyncHandler(async (req, res) => {
    const { page, limit, skip } = parsePagination(req.query);
    const { unreadOnly } = req.query;
    
    const where = {
      userId: req.user.id,
      ...(unreadOnly === 'true' && { isRead: false }),
    };
    
    const [notifications, total] = await Promise.all([
      prisma.notification.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.notification.count({ where }),
    ]);
    
    paginated(res, notifications, { page, limit, total });
  })
);

// Mark notification as read
router.patch(
  '/me/notifications/:notificationId/read',
  authenticate,
  asyncHandler(async (req, res) => {
    await prisma.notification.update({
      where: { 
        id: req.params.notificationId,
        userId: req.user.id,
      },
      data: { 
        isRead: true,
        readAt: new Date(),
      },
    });
    success(res, null, 'Notification marked as read');
  })
);

// Mark all notifications as read
router.post(
  '/me/notifications/read-all',
  authenticate,
  asyncHandler(async (req, res) => {
    await prisma.notification.updateMany({
      where: { 
        userId: req.user.id,
        isRead: false,
      },
      data: { 
        isRead: true,
        readAt: new Date(),
      },
    });
    success(res, null, 'All notifications marked as read');
  })
);

// Get notification preferences
router.get(
  '/me/notification-preferences',
  authenticate,
  asyncHandler(async (req, res) => {
    const settings = await prisma.businessSettings.findUnique({
      where: { businessId: req.business?.id },
      select: {
        emailNotifications: true,
        smsNotifications: true,
        pushNotifications: true,
      },
    });
    success(res, { preferences: settings || {} });
  })
);

// Update notification preferences
router.patch(
  '/me/notification-preferences',
  authenticate,
  asyncHandler(async (req, res) => {
    if (!req.business) {
      throw new Error('Business profile required');
    }
    
    const settings = await prisma.businessSettings.upsert({
      where: { businessId: req.business.id },
      update: req.body,
      create: {
        businessId: req.business.id,
        ...req.body,
      },
    });
    success(res, { preferences: settings });
  })
);

module.exports = router;
