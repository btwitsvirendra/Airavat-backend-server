// =============================================================================
// AIRAVAT B2B MARKETPLACE - AI CHATBOT ROUTES
// Routes for AI-powered customer support
// =============================================================================

const express = require('express');
const { body, param, query } = require('express-validator');
const router = express.Router();

const chatbotController = require('../controllers/chatbot.controller');
const { authenticate, authorize, optionalAuth } = require('../middleware/auth.middleware');
const validate = require('../middleware/validate.middleware');

// =============================================================================
// VALIDATION SCHEMAS
// =============================================================================

const messageValidation = [
  param('sessionId').isUUID(),
  body('message').notEmpty().isLength({ min: 1, max: 2000 }),
  body('attachments').optional().isArray(),
];

const feedbackValidation = [
  param('sessionId').isUUID(),
  body('rating').isInt({ min: 1, max: 5 }),
  body('comment').optional().isString().isLength({ max: 500 }),
];

// =============================================================================
// PUBLIC ROUTES (WITH OPTIONAL AUTH)
// =============================================================================

router.post(
  '/sessions',
  optionalAuth,
  body('context').optional().isObject(),
  validate,
  chatbotController.startSession
);

router.get(
  '/sessions/:sessionId',
  optionalAuth,
  param('sessionId').isUUID(),
  validate,
  chatbotController.getSession
);

router.post(
  '/sessions/:sessionId/messages',
  optionalAuth,
  messageValidation,
  validate,
  chatbotController.sendMessage
);

router.get(
  '/sessions/:sessionId/messages',
  optionalAuth,
  param('sessionId').isUUID(),
  validate,
  chatbotController.getMessages
);

router.post(
  '/sessions/:sessionId/end',
  optionalAuth,
  param('sessionId').isUUID(),
  validate,
  chatbotController.endSession
);

router.post(
  '/sessions/:sessionId/feedback',
  optionalAuth,
  feedbackValidation,
  validate,
  chatbotController.submitFeedback
);

router.post(
  '/sessions/:sessionId/handoff',
  optionalAuth,
  param('sessionId').isUUID(),
  body('reason').optional().isString(),
  validate,
  chatbotController.requestHandoff
);

// =============================================================================
// QUICK ACTIONS
// =============================================================================

router.get(
  '/quick-actions',
  optionalAuth,
  chatbotController.getQuickActions
);

router.post(
  '/quick-actions/:actionId',
  optionalAuth,
  param('actionId').notEmpty(),
  validate,
  chatbotController.executeQuickAction
);

// =============================================================================
// FAQ & KNOWLEDGE BASE
// =============================================================================

router.get(
  '/faq/search',
  query('q').notEmpty().isLength({ min: 2 }),
  validate,
  chatbotController.searchFaq
);

router.get(
  '/faq/categories',
  chatbotController.getFaqCategories
);

router.get(
  '/faq/categories/:category',
  param('category').notEmpty(),
  validate,
  chatbotController.getFaqByCategory
);

// =============================================================================
// AUTHENTICATED USER ROUTES
// =============================================================================

router.get(
  '/sessions',
  authenticate,
  chatbotController.getSessions
);

// =============================================================================
// ADMIN ROUTES
// =============================================================================

router.get(
  '/admin/analytics',
  authenticate,
  authorize('admin'),
  chatbotController.getAnalytics
);

router.get(
  '/admin/tickets',
  authenticate,
  authorize('admin'),
  chatbotController.getTickets
);

router.put(
  '/admin/tickets/:ticketId',
  authenticate,
  authorize('admin'),
  param('ticketId').isUUID(),
  validate,
  chatbotController.updateTicket
);

router.post(
  '/admin/train',
  authenticate,
  authorize('admin'),
  chatbotController.trainChatbot
);

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = router;



