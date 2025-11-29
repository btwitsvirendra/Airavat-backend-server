// =============================================================================
// AIRAVAT B2B MARKETPLACE - NOTIFICATION CONTROLLER
// =============================================================================

const NotificationService = require('../services/notification.service');
const { asyncHandler } = require('../utils/asyncHandler');

// Get notifications
exports.getNotifications = asyncHandler(async (req, res) => {
  const result = await NotificationService.getNotifications(req.user.id, req.query);
  res.json({ success: true, data: result });
});

// Mark as read
exports.markAsRead = asyncHandler(async (req, res) => {
  await NotificationService.markAsRead(req.params.notificationId, req.user.id);
  res.json({ success: true, message: 'Marked as read' });
});

// Mark all as read
exports.markAllAsRead = asyncHandler(async (req, res) => {
  await NotificationService.markAllAsRead(req.user.id);
  res.json({ success: true, message: 'All marked as read' });
});

// Delete notification
exports.deleteNotification = asyncHandler(async (req, res) => {
  await NotificationService.deleteNotification(req.params.notificationId, req.user.id);
  res.json({ success: true, message: 'Notification deleted' });
});

// Get preferences
exports.getPreferences = asyncHandler(async (req, res) => {
  const result = await NotificationService.getPreferences(req.user.id);
  res.json({ success: true, data: result });
});

// Update preferences
exports.updatePreferences = asyncHandler(async (req, res) => {
  const result = await NotificationService.updatePreferences(req.user.id, req.body);
  res.json({ success: true, data: result });
});

// Register FCM token
exports.registerFCMToken = asyncHandler(async (req, res) => {
  const { token, deviceInfo } = req.body;
  await NotificationService.registerFCMToken(req.user.id, token, deviceInfo);
  res.json({ success: true, message: 'Token registered' });
});

