// =============================================================================
// AIRAVAT B2B MARKETPLACE - ANNOUNCEMENT ROUTES
// Routes for system announcements
// =============================================================================

const express = require('express');
const router = express.Router();
const { body, param, query } = require('express-validator');

const announcementController = require('../controllers/announcement.controller');
const { protect, authorize, optionalAuth } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validation.middleware');

// =============================================================================
// PUBLIC ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/announcements
 * @desc    Get active announcements
 */
router.get('/', optionalAuth, announcementController.getActiveAnnouncements);

/**
 * @route   GET /api/v1/announcements/types
 * @desc    Get announcement types
 */
router.get('/types', announcementController.getAnnouncementTypes);

/**
 * @route   GET /api/v1/announcements/:id
 * @desc    Get announcement by ID
 */
router.get(
  '/:id',
  [param('id').notEmpty().withMessage('Announcement ID is required')],
  validate,
  announcementController.getAnnouncement
);

/**
 * @route   POST /api/v1/announcements/:id/view
 * @desc    Track view
 */
router.post(
  '/:id/view',
  optionalAuth,
  [param('id').notEmpty().withMessage('Announcement ID is required')],
  validate,
  announcementController.trackView
);

/**
 * @route   POST /api/v1/announcements/:id/click
 * @desc    Track click
 */
router.post(
  '/:id/click',
  optionalAuth,
  [param('id').notEmpty().withMessage('Announcement ID is required')],
  validate,
  announcementController.trackClick
);

// =============================================================================
// AUTHENTICATED ROUTES
// =============================================================================

/**
 * @route   POST /api/v1/announcements/:id/dismiss
 * @desc    Dismiss announcement
 */
router.post(
  '/:id/dismiss',
  protect,
  [param('id').notEmpty().withMessage('Announcement ID is required')],
  validate,
  announcementController.dismissAnnouncement
);

// =============================================================================
// ADMIN ROUTES
// =============================================================================

/**
 * @route   GET /api/v1/announcements/admin
 * @desc    Get all announcements (Admin)
 */
router.get(
  '/admin/list',
  protect,
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    query('page').optional().isInt({ min: 1 }),
    query('limit').optional().isInt({ min: 1, max: 100 }),
    query('status').optional().isString(),
    query('type').optional().isString(),
    query('search').optional().isString(),
  ],
  validate,
  announcementController.getAllAnnouncements
);

/**
 * @route   POST /api/v1/announcements/admin
 * @desc    Create announcement (Admin)
 */
router.post(
  '/admin',
  protect,
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    body('title').notEmpty().trim().withMessage('Title is required'),
    body('message').notEmpty().withMessage('Message is required'),
    body('type')
      .optional()
      .isIn(['INFO', 'SUCCESS', 'WARNING', 'ERROR', 'MAINTENANCE', 'PROMOTION', 'UPDATE']),
    body('targetAudience')
      .optional()
      .isIn(['ALL', 'BUYERS', 'SELLERS', 'PREMIUM', 'ADMINS', 'VERIFIED']),
    body('startDate').optional().isISO8601(),
    body('endDate').optional().isISO8601(),
    body('priority').optional().isInt({ min: 0, max: 10 }),
    body('link').optional().isURL(),
    body('linkText').optional().isString(),
    body('dismissible').optional().isBoolean(),
    body('sticky').optional().isBoolean(),
  ],
  validate,
  announcementController.createAnnouncement
);

/**
 * @route   PUT /api/v1/announcements/admin/:id
 * @desc    Update announcement (Admin)
 */
router.put(
  '/admin/:id',
  protect,
  authorize('ADMIN', 'SUPER_ADMIN'),
  [
    param('id').notEmpty().withMessage('Announcement ID is required'),
    body('title').optional().trim(),
    body('message').optional(),
    body('type').optional(),
    body('status').optional().isIn(['ACTIVE', 'INACTIVE', 'SCHEDULED']),
  ],
  validate,
  announcementController.updateAnnouncement
);

/**
 * @route   DELETE /api/v1/announcements/admin/:id
 * @desc    Delete announcement (Admin)
 */
router.delete(
  '/admin/:id',
  protect,
  authorize('ADMIN', 'SUPER_ADMIN'),
  [param('id').notEmpty().withMessage('Announcement ID is required')],
  validate,
  announcementController.deleteAnnouncement
);

/**
 * @route   GET /api/v1/announcements/admin/:id/analytics
 * @desc    Get announcement analytics (Admin)
 */
router.get(
  '/admin/:id/analytics',
  protect,
  authorize('ADMIN', 'SUPER_ADMIN'),
  [param('id').notEmpty().withMessage('Announcement ID is required')],
  validate,
  announcementController.getAnnouncementAnalytics
);

module.exports = router;



