// =============================================================================
// AIRAVAT B2B MARKETPLACE - AI CHATBOT CONTROLLER
// Handles AI-powered customer support conversations
// =============================================================================

const aiChatbotService = require('../services/aiChatbot.service');
const asyncHandler = require('../middleware/async.middleware');
const { NotFoundError } = require('../utils/errors');

// =============================================================================
// CHAT SESSION MANAGEMENT
// =============================================================================

/**
 * Start a new chat session
 * @route POST /api/v1/chatbot/sessions
 */
const startSession = asyncHandler(async (req, res) => {
  const session = await aiChatbotService.startSession(
    req.user?.id,
    req.body.context
  );

  res.status(201).json({
    success: true,
    message: 'Chat session started',
    data: session,
  });
});

/**
 * Get chat session by ID
 * @route GET /api/v1/chatbot/sessions/:sessionId
 */
const getSession = asyncHandler(async (req, res) => {
  const session = await aiChatbotService.getSession(
    req.params.sessionId,
    req.user?.id
  );

  if (!session) {
    throw new NotFoundError('Chat session not found');
  }

  res.json({
    success: true,
    data: session,
  });
});

/**
 * Get user's chat sessions
 * @route GET /api/v1/chatbot/sessions
 */
const getSessions = asyncHandler(async (req, res) => {
  const sessions = await aiChatbotService.getUserSessions(
    req.user.id,
    req.query
  );

  res.json({
    success: true,
    data: sessions.sessions,
    pagination: sessions.pagination,
  });
});

/**
 * End chat session
 * @route POST /api/v1/chatbot/sessions/:sessionId/end
 */
const endSession = asyncHandler(async (req, res) => {
  const session = await aiChatbotService.endSession(
    req.params.sessionId,
    req.user?.id
  );

  res.json({
    success: true,
    message: 'Chat session ended',
    data: session,
  });
});

// =============================================================================
// MESSAGING
// =============================================================================

/**
 * Send a message to the chatbot
 * @route POST /api/v1/chatbot/sessions/:sessionId/messages
 */
const sendMessage = asyncHandler(async (req, res) => {
  const response = await aiChatbotService.sendMessage(
    req.params.sessionId,
    req.user?.id,
    req.body.message,
    req.body.attachments
  );

  res.json({
    success: true,
    data: response,
  });
});

/**
 * Get chat history for a session
 * @route GET /api/v1/chatbot/sessions/:sessionId/messages
 */
const getMessages = asyncHandler(async (req, res) => {
  const messages = await aiChatbotService.getMessages(
    req.params.sessionId,
    req.user?.id,
    req.query
  );

  res.json({
    success: true,
    data: messages.messages,
    pagination: messages.pagination,
  });
});

// =============================================================================
// FEEDBACK & HANDOFF
// =============================================================================

/**
 * Submit feedback for a session
 * @route POST /api/v1/chatbot/sessions/:sessionId/feedback
 */
const submitFeedback = asyncHandler(async (req, res) => {
  await aiChatbotService.submitFeedback(
    req.params.sessionId,
    req.user?.id,
    req.body.rating,
    req.body.comment
  );

  res.json({
    success: true,
    message: 'Feedback submitted successfully',
  });
});

/**
 * Request handoff to human agent
 * @route POST /api/v1/chatbot/sessions/:sessionId/handoff
 */
const requestHandoff = asyncHandler(async (req, res) => {
  const ticket = await aiChatbotService.requestHandoff(
    req.params.sessionId,
    req.user?.id,
    req.body.reason
  );

  res.json({
    success: true,
    message: 'Handoff requested. A support agent will contact you shortly.',
    data: ticket,
  });
});

// =============================================================================
// QUICK ACTIONS
// =============================================================================

/**
 * Get quick action suggestions
 * @route GET /api/v1/chatbot/quick-actions
 */
const getQuickActions = asyncHandler(async (req, res) => {
  const actions = await aiChatbotService.getQuickActions(req.user?.id);

  res.json({
    success: true,
    data: actions,
  });
});

/**
 * Execute a quick action
 * @route POST /api/v1/chatbot/quick-actions/:actionId
 */
const executeQuickAction = asyncHandler(async (req, res) => {
  const result = await aiChatbotService.executeQuickAction(
    req.params.actionId,
    req.user?.id,
    req.body.params
  );

  res.json({
    success: true,
    data: result,
  });
});

// =============================================================================
// FAQ & KNOWLEDGE BASE
// =============================================================================

/**
 * Search FAQ/knowledge base
 * @route GET /api/v1/chatbot/faq/search
 */
const searchFaq = asyncHandler(async (req, res) => {
  const results = await aiChatbotService.searchFaq(req.query.q);

  res.json({
    success: true,
    data: results,
  });
});

/**
 * Get FAQ categories
 * @route GET /api/v1/chatbot/faq/categories
 */
const getFaqCategories = asyncHandler(async (req, res) => {
  const categories = await aiChatbotService.getFaqCategories();

  res.json({
    success: true,
    data: categories,
  });
});

/**
 * Get FAQ by category
 * @route GET /api/v1/chatbot/faq/categories/:category
 */
const getFaqByCategory = asyncHandler(async (req, res) => {
  const faqs = await aiChatbotService.getFaqByCategory(req.params.category);

  res.json({
    success: true,
    data: faqs,
  });
});

// =============================================================================
// ADMIN OPERATIONS
// =============================================================================

/**
 * Get chatbot analytics (admin)
 * @route GET /api/v1/admin/chatbot/analytics
 */
const getAnalytics = asyncHandler(async (req, res) => {
  const analytics = await aiChatbotService.getAnalytics(req.query);

  res.json({
    success: true,
    data: analytics,
  });
});

/**
 * Get all support tickets (admin)
 * @route GET /api/v1/admin/chatbot/tickets
 */
const getTickets = asyncHandler(async (req, res) => {
  const result = await aiChatbotService.getTickets(req.query);

  res.json({
    success: true,
    data: result.tickets,
    pagination: result.pagination,
  });
});

/**
 * Update ticket status (admin)
 * @route PUT /api/v1/admin/chatbot/tickets/:ticketId
 */
const updateTicket = asyncHandler(async (req, res) => {
  const ticket = await aiChatbotService.updateTicket(
    req.params.ticketId,
    req.body
  );

  res.json({
    success: true,
    message: 'Ticket updated',
    data: ticket,
  });
});

/**
 * Train chatbot with new data (admin)
 * @route POST /api/v1/admin/chatbot/train
 */
const trainChatbot = asyncHandler(async (req, res) => {
  const result = await aiChatbotService.train(req.body);

  res.json({
    success: true,
    message: 'Training initiated',
    data: result,
  });
});

// =============================================================================
// MODULE EXPORTS
// =============================================================================

module.exports = {
  startSession,
  getSession,
  getSessions,
  endSession,
  sendMessage,
  getMessages,
  submitFeedback,
  requestHandoff,
  getQuickActions,
  executeQuickAction,
  searchFaq,
  getFaqCategories,
  getFaqByCategory,
  getAnalytics,
  getTickets,
  updateTicket,
  trainChatbot,
};



