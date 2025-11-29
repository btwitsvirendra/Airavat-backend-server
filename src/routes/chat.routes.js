// =============================================================================
// AIRAVAT B2B MARKETPLACE - CHAT ROUTES
// =============================================================================

const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chat.controller');
const { authenticate, requireBusiness } = require('../middleware/auth');
const { chatLimiter } = require('../middleware/rateLimiter');

// =============================================================================
// CHAT MANAGEMENT
// =============================================================================

// Get all chats
router.get(
  '/',
  authenticate,
  requireBusiness,
  chatController.getChats
);

// Start new chat (inquiry about product)
router.post(
  '/start',
  authenticate,
  requireBusiness,
  chatController.startChat
);

// Get chat by ID
router.get(
  '/:chatId',
  authenticate,
  requireBusiness,
  chatController.getChatById
);

// Get chat messages
router.get(
  '/:chatId/messages',
  authenticate,
  requireBusiness,
  chatController.getMessages
);

// Send message
router.post(
  '/:chatId/messages',
  authenticate,
  requireBusiness,
  chatLimiter,
  chatController.sendMessage
);

// Mark messages as read
router.post(
  '/:chatId/read',
  authenticate,
  requireBusiness,
  chatController.markAsRead
);

// Mute/unmute chat
router.patch(
  '/:chatId/mute',
  authenticate,
  requireBusiness,
  chatController.toggleMute
);

// Archive chat
router.post(
  '/:chatId/archive',
  authenticate,
  requireBusiness,
  chatController.archiveChat
);

// =============================================================================
// MESSAGE ACTIONS
// =============================================================================

// Edit message
router.patch(
  '/:chatId/messages/:messageId',
  authenticate,
  requireBusiness,
  chatController.editMessage
);

// Delete message
router.delete(
  '/:chatId/messages/:messageId',
  authenticate,
  requireBusiness,
  chatController.deleteMessage
);

// =============================================================================
// SPECIAL MESSAGE TYPES
// =============================================================================

// Send product card
router.post(
  '/:chatId/messages/product',
  authenticate,
  requireBusiness,
  chatController.sendProductCard
);

// Send quotation card
router.post(
  '/:chatId/messages/quotation',
  authenticate,
  requireBusiness,
  chatController.sendQuotationCard
);

// Send order card
router.post(
  '/:chatId/messages/order',
  authenticate,
  requireBusiness,
  chatController.sendOrderCard
);

// =============================================================================
// ATTACHMENTS
// =============================================================================

// Upload attachment
router.post(
  '/:chatId/attachments',
  authenticate,
  requireBusiness,
  chatController.uploadAttachment
);

// =============================================================================
// QUICK NEGOTIATION
// =============================================================================

// Create quick quotation from chat
router.post(
  '/:chatId/quick-quote',
  authenticate,
  requireBusiness,
  chatController.createQuickQuote
);

// Accept quick quotation
router.post(
  '/:chatId/quick-quote/:quoteId/accept',
  authenticate,
  requireBusiness,
  chatController.acceptQuickQuote
);

// Counter quick quotation
router.post(
  '/:chatId/quick-quote/:quoteId/counter',
  authenticate,
  requireBusiness,
  chatController.counterQuickQuote
);

// =============================================================================
// UNREAD COUNT
// =============================================================================

// Get total unread count
router.get(
  '/unread/count',
  authenticate,
  requireBusiness,
  chatController.getUnreadCount
);

module.exports = router;
