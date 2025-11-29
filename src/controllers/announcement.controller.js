// =============================================================================
// AIRAVAT B2B MARKETPLACE - ANNOUNCEMENT CONTROLLER
// Controller for system announcements and notifications
// =============================================================================

const asyncHandler = require('../middleware/async.middleware');
const announcementService = require('../services/announcement.service');
const logger = require('../config/logger');

// =============================================================================
// PUBLIC ENDPOINTS
// =============================================================================

/**
 * @desc    Get active announcements for current user
 * @route   GET /api/v1/announcements
 * @access  Public/Private
 */
exports.getActiveAnnouncements = asyncHandler(async (req, res) => {
  const announcements = await announcementService.getActiveAnnouncements(req.user);

  res.status(200).json({
    success: true,
    data: announcements,
  });
});

/**
 * @desc    Get announcement by ID
 * @route   GET /api/v1/announcements/:id
 * @access  Public
 */
exports.getAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await announcementService.getAnnouncementById(req.params.id);

  res.status(200).json({
    success: true,
    data: announcement,
  });
});

// =============================================================================
// USER INTERACTIONS
// =============================================================================

/**
 * @desc    Dismiss an announcement
 * @route   POST /api/v1/announcements/:id/dismiss
 * @access  Private
 */
exports.dismissAnnouncement = asyncHandler(async (req, res) => {
  const result = await announcementService.dismissAnnouncement(
    req.params.id,
    req.user.id
  );

  res.status(200).json({
    success: true,
    data: result,
  });
});

/**
 * @desc    Track announcement view
 * @route   POST /api/v1/announcements/:id/view
 * @access  Public
 */
exports.trackView = asyncHandler(async (req, res) => {
  await announcementService.trackView(req.params.id, req.user?.id);

  res.status(200).json({
    success: true,
  });
});

/**
 * @desc    Track announcement click
 * @route   POST /api/v1/announcements/:id/click
 * @access  Public
 */
exports.trackClick = asyncHandler(async (req, res) => {
  await announcementService.trackClick(req.params.id, req.user?.id);

  res.status(200).json({
    success: true,
  });
});

// =============================================================================
// ADMIN ENDPOINTS
// =============================================================================

/**
 * @desc    Create announcement (Admin)
 * @route   POST /api/v1/announcements/admin
 * @access  Private (Admin)
 */
exports.createAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await announcementService.createAnnouncement(
    req.body,
    req.user.id
  );

  res.status(201).json({
    success: true,
    message: 'Announcement created successfully',
    data: announcement,
  });
});

/**
 * @desc    Update announcement (Admin)
 * @route   PUT /api/v1/announcements/admin/:id
 * @access  Private (Admin)
 */
exports.updateAnnouncement = asyncHandler(async (req, res) => {
  const announcement = await announcementService.updateAnnouncement(
    req.params.id,
    req.body,
    req.user.id
  );

  res.status(200).json({
    success: true,
    message: 'Announcement updated successfully',
    data: announcement,
  });
});

/**
 * @desc    Delete announcement (Admin)
 * @route   DELETE /api/v1/announcements/admin/:id
 * @access  Private (Admin)
 */
exports.deleteAnnouncement = asyncHandler(async (req, res) => {
  await announcementService.deleteAnnouncement(req.params.id, req.user.id);

  res.status(200).json({
    success: true,
    message: 'Announcement deleted successfully',
  });
});

/**
 * @desc    Get all announcements (Admin)
 * @route   GET /api/v1/announcements/admin
 * @access  Private (Admin)
 */
exports.getAllAnnouncements = asyncHandler(async (req, res) => {
  const { page, limit, status, type, search } = req.query;

  const result = await announcementService.getAllAnnouncements({
    page: parseInt(page) || 1,
    limit: parseInt(limit) || 20,
    status,
    type,
    search,
  });

  res.status(200).json({
    success: true,
    data: result.announcements,
    pagination: result.pagination,
  });
});

/**
 * @desc    Get announcement analytics (Admin)
 * @route   GET /api/v1/announcements/admin/:id/analytics
 * @access  Private (Admin)
 */
exports.getAnnouncementAnalytics = asyncHandler(async (req, res) => {
  const analytics = await announcementService.getAnnouncementAnalytics(req.params.id);

  res.status(200).json({
    success: true,
    data: analytics,
  });
});

/**
 * @desc    Get announcement types
 * @route   GET /api/v1/announcements/types
 * @access  Private (Admin)
 */
exports.getAnnouncementTypes = asyncHandler(async (req, res) => {
  res.status(200).json({
    success: true,
    data: {
      types: announcementService.ANNOUNCEMENT_TYPES,
      audiences: announcementService.TARGET_AUDIENCES,
    },
  });
});

module.exports = exports;



