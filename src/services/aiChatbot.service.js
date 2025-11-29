// =============================================================================
// AIRAVAT B2B MARKETPLACE - AI CHATBOT SERVICE
// GPT-powered customer support chatbot
// =============================================================================

const { prisma } = require('../config/database');
const logger = require('../config/logger');
const { AppError } = require('../utils/errors');

// =============================================================================
// CONFIGURATION
// =============================================================================

const CONFIG = {
  maxTokens: 2000,
  temperature: 0.7,
  maxConversationHistory: 20,
  sessionTimeout: 30 * 60 * 1000, // 30 minutes
  rateLimit: 60, // messages per hour
};

/**
 * Chatbot intents
 */
const INTENTS = {
  GREETING: { confidence: 0.9, handler: 'handleGreeting' },
  ORDER_STATUS: { confidence: 0.85, handler: 'handleOrderStatus' },
  PRODUCT_INQUIRY: { confidence: 0.8, handler: 'handleProductInquiry' },
  PAYMENT_HELP: { confidence: 0.85, handler: 'handlePaymentHelp' },
  SHIPPING_INFO: { confidence: 0.85, handler: 'handleShippingInfo' },
  RETURNS_REFUNDS: { confidence: 0.85, handler: 'handleReturnsRefunds' },
  ACCOUNT_HELP: { confidence: 0.8, handler: 'handleAccountHelp' },
  SELLER_SUPPORT: { confidence: 0.8, handler: 'handleSellerSupport' },
  GENERAL_QUERY: { confidence: 0.7, handler: 'handleGeneralQuery' },
  ESCALATE_HUMAN: { confidence: 0.95, handler: 'handleEscalation' },
};

/**
 * Quick replies/suggestions
 */
const QUICK_REPLIES = {
  MAIN_MENU: [
    'Track my order',
    'Product inquiry',
    'Payment help',
    'Returns & Refunds',
    'Talk to human',
  ],
  ORDER_HELP: [
    'Where is my order?',
    'Cancel order',
    'Change delivery address',
    'Download invoice',
  ],
  PRODUCT_HELP: [
    'Check availability',
    'Compare products',
    'Request quote',
    'Bulk order inquiry',
  ],
};

// =============================================================================
// CHAT SESSION MANAGEMENT
// =============================================================================

/**
 * Start or resume chat session
 * @param {string} userId - User ID (optional for anonymous)
 * @param {string} sessionId - Session ID (optional)
 * @returns {Promise<Object>} Chat session
 */
exports.startSession = async (userId = null, sessionId = null) => {
  try {
    // Resume existing session if valid
    if (sessionId) {
      const existing = await prisma.chatSession.findUnique({
        where: { id: sessionId },
        include: {
          messages: {
            orderBy: { createdAt: 'asc' },
            take: CONFIG.maxConversationHistory,
          },
        },
      });

      if (existing && !isSessionExpired(existing)) {
        return {
          sessionId: existing.id,
          messages: existing.messages,
          context: existing.context,
        };
      }
    }

    // Create new session
    const session = await prisma.chatSession.create({
      data: {
        userId,
        status: 'ACTIVE',
        context: {
          intent: null,
          entities: {},
          lastIntent: null,
        },
        messages: {
          create: {
            role: 'assistant',
            content: getWelcomeMessage(userId),
            metadata: {
              type: 'greeting',
              quickReplies: QUICK_REPLIES.MAIN_MENU,
            },
          },
        },
      },
      include: {
        messages: true,
      },
    });

    logger.info('Chat session started', { sessionId: session.id, userId });

    return {
      sessionId: session.id,
      messages: session.messages,
      context: session.context,
    };
  } catch (error) {
    logger.error('Start session error', { error: error.message });
    throw error;
  }
};

/**
 * Send message to chatbot
 * @param {string} sessionId - Session ID
 * @param {string} message - User message
 * @returns {Promise<Object>} Bot response
 */
exports.sendMessage = async (sessionId, message) => {
  try {
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
      include: {
        messages: {
          orderBy: { createdAt: 'desc' },
          take: CONFIG.maxConversationHistory,
        },
        user: true,
      },
    });

    if (!session) {
      throw new AppError('Session not found', 404);
    }

    if (isSessionExpired(session)) {
      throw new AppError('Session expired. Please start a new chat.', 410);
    }

    // Check rate limit
    await checkRateLimit(sessionId);

    // Store user message
    await prisma.chatMessage.create({
      data: {
        sessionId,
        role: 'user',
        content: message,
      },
    });

    // Process message and generate response
    const response = await processMessage(session, message);

    // Store bot response
    const botMessage = await prisma.chatMessage.create({
      data: {
        sessionId,
        role: 'assistant',
        content: response.content,
        metadata: response.metadata,
      },
    });

    // Update session context
    await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        context: response.context,
        lastActivityAt: new Date(),
      },
    });

    logger.debug('Chat message processed', { sessionId, intent: response.intent });

    return {
      message: botMessage,
      quickReplies: response.quickReplies,
      actions: response.actions,
    };
  } catch (error) {
    logger.error('Send message error', { error: error.message, sessionId });
    throw error;
  }
};

/**
 * End chat session
 * @param {string} sessionId - Session ID
 * @param {Object} feedback - User feedback
 * @returns {Promise<Object>} Session end result
 */
exports.endSession = async (sessionId, feedback = {}) => {
  const session = await prisma.chatSession.findUnique({
    where: { id: sessionId },
  });

  if (!session) {
    throw new AppError('Session not found', 404);
  }

  await prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      status: 'ENDED',
      endedAt: new Date(),
      feedback: feedback.rating,
      feedbackComment: feedback.comment,
    },
  });

  logger.info('Chat session ended', { sessionId, rating: feedback.rating });

  return { success: true };
};

// =============================================================================
// MESSAGE PROCESSING
// =============================================================================

/**
 * Process user message and generate response
 */
async function processMessage(session, userMessage) {
  // Detect intent
  const intent = await detectIntent(userMessage, session.context);

  // Extract entities
  const entities = await extractEntities(userMessage, intent);

  // Update context
  const context = {
    ...session.context,
    intent,
    entities: { ...session.context?.entities, ...entities },
    lastIntent: intent,
  };

  // Generate response based on intent
  const response = await generateResponse(intent, entities, session, userMessage);

  return {
    content: response.message,
    metadata: {
      intent,
      confidence: response.confidence,
      entities,
    },
    context,
    quickReplies: response.quickReplies || [],
    actions: response.actions || [],
    intent,
  };
}

/**
 * Detect user intent from message
 */
async function detectIntent(message, context) {
  const lowerMessage = message.toLowerCase();

  // Pattern matching for common intents
  if (/(hello|hi|hey|good\s?(morning|afternoon|evening)|namaste)/i.test(lowerMessage)) {
    return 'GREETING';
  }

  if (/(order|tracking|where\s*is|status|shipped|delivery|arrived)/i.test(lowerMessage)) {
    return 'ORDER_STATUS';
  }

  if (/(product|item|available|stock|price|cost|how\s*much)/i.test(lowerMessage)) {
    return 'PRODUCT_INQUIRY';
  }

  if (/(payment|pay|invoice|transaction|failed|refund|money)/i.test(lowerMessage)) {
    return 'PAYMENT_HELP';
  }

  if (/(shipping|ship|deliver|freight|logistics|courier)/i.test(lowerMessage)) {
    return 'SHIPPING_INFO';
  }

  if (/(return|refund|exchange|cancel|dispute)/i.test(lowerMessage)) {
    return 'RETURNS_REFUNDS';
  }

  if (/(account|profile|password|login|register|settings)/i.test(lowerMessage)) {
    return 'ACCOUNT_HELP';
  }

  if (/(sell|seller|list\s*product|become\s*seller|vendor)/i.test(lowerMessage)) {
    return 'SELLER_SUPPORT';
  }

  if (/(human|agent|person|speak\s*to|escalate|manager)/i.test(lowerMessage)) {
    return 'ESCALATE_HUMAN';
  }

  return 'GENERAL_QUERY';
}

/**
 * Extract entities from message
 */
async function extractEntities(message, intent) {
  const entities = {};

  // Extract order numbers
  const orderMatch = message.match(/(?:order\s*(?:number|#|no\.?)?:?\s*)?([A-Z]{2,3}\d{4,}-[A-Z0-9]+)/i);
  if (orderMatch) {
    entities.orderNumber = orderMatch[1].toUpperCase();
  }

  // Extract product references
  const productMatch = message.match(/(?:product|item|sku)[\s:#]*([A-Z0-9-]+)/i);
  if (productMatch) {
    entities.productSku = productMatch[1].toUpperCase();
  }

  // Extract email
  const emailMatch = message.match(/([a-zA-Z0-9._-]+@[a-zA-Z0-9._-]+\.[a-zA-Z0-9_-]+)/i);
  if (emailMatch) {
    entities.email = emailMatch[1];
  }

  // Extract phone
  const phoneMatch = message.match(/(\+?\d{10,15})/);
  if (phoneMatch) {
    entities.phone = phoneMatch[1];
  }

  return entities;
}

/**
 * Generate response based on intent
 */
async function generateResponse(intent, entities, session, userMessage) {
  const userId = session.userId;

  switch (intent) {
    case 'GREETING':
      return handleGreeting(userId);

    case 'ORDER_STATUS':
      return await handleOrderStatus(entities, userId);

    case 'PRODUCT_INQUIRY':
      return handleProductInquiry(entities);

    case 'PAYMENT_HELP':
      return handlePaymentHelp(entities, userId);

    case 'SHIPPING_INFO':
      return handleShippingInfo(entities);

    case 'RETURNS_REFUNDS':
      return handleReturnsRefunds(entities);

    case 'ACCOUNT_HELP':
      return handleAccountHelp(userId);

    case 'SELLER_SUPPORT':
      return handleSellerSupport();

    case 'ESCALATE_HUMAN':
      return await handleEscalation(session);

    default:
      return handleGeneralQuery(userMessage, session.context);
  }
}

// =============================================================================
// INTENT HANDLERS
// =============================================================================

function handleGreeting(userId) {
  const greeting = userId
    ? "Hello! Welcome back to Airavat. I'm here to help you with orders, products, payments, and more."
    : "Hello! Welcome to Airavat B2B Marketplace. I'm your virtual assistant. How can I help you today?";

  return {
    message: greeting,
    confidence: 0.95,
    quickReplies: QUICK_REPLIES.MAIN_MENU,
  };
}

async function handleOrderStatus(entities, userId) {
  if (entities.orderNumber) {
    // Look up specific order
    const order = await prisma.order.findFirst({
      where: {
        orderNumber: entities.orderNumber,
        ...(userId && { buyerId: userId }),
      },
      select: {
        orderNumber: true,
        status: true,
        createdAt: true,
        total: true,
        shipments: {
          select: { trackingNumber: true, status: true, carrier: true },
        },
      },
    });

    if (order) {
      const shipmentInfo = order.shipments[0]
        ? `\n📦 Tracking: ${order.shipments[0].trackingNumber} (${order.shipments[0].carrier})`
        : '';

      return {
        message: `Order ${order.orderNumber}:\n📋 Status: ${order.status}\n💰 Total: ₹${order.total}${shipmentInfo}\n\nWould you like to track this order or need any other help?`,
        confidence: 0.9,
        quickReplies: ['Track shipment', 'Download invoice', 'Report issue', 'Back to menu'],
        actions: [
          { type: 'track_order', orderId: order.orderNumber },
        ],
      };
    }

    return {
      message: "I couldn't find an order with that number. Please check the order number and try again, or you can view all your orders in your account.",
      confidence: 0.85,
      quickReplies: ['View all orders', 'Try another number', 'Talk to human'],
    };
  }

  return {
    message: "I can help you track your order! Please provide your order number (e.g., ORD2312-ABC12) or I can show you your recent orders.",
    confidence: 0.85,
    quickReplies: ['Show recent orders', 'I have the order number', 'Back to menu'],
  };
}

function handleProductInquiry(entities) {
  if (entities.productSku) {
    return {
      message: `I'll look up product ${entities.productSku} for you. What would you like to know - availability, pricing, or specifications?`,
      confidence: 0.85,
      quickReplies: ['Check availability', 'Get price quote', 'See specifications', 'Similar products'],
    };
  }

  return {
    message: "I can help you find products! You can:\n• Search by product name or SKU\n• Browse categories\n• Get quotes for bulk orders\n\nWhat are you looking for?",
    confidence: 0.8,
    quickReplies: QUICK_REPLIES.PRODUCT_HELP,
  };
}

function handlePaymentHelp(entities, userId) {
  return {
    message: "I can help with payment-related queries! Here are common topics:\n\n💳 Payment Methods - UPI, Cards, Net Banking, Credit Line\n📄 Invoice & Billing\n💰 Refund Status\n🔒 Payment Issues\n\nWhat do you need help with?",
    confidence: 0.85,
    quickReplies: ['Payment methods', 'Check refund status', 'Invoice download', 'Payment failed'],
  };
}

function handleShippingInfo(entities) {
  return {
    message: "Here's what I can help you with regarding shipping:\n\n🚚 Track shipment\n📍 Delivery areas\n💼 Shipping rates\n📦 Packaging info\n\nWhat would you like to know?",
    confidence: 0.85,
    quickReplies: ['Track my shipment', 'Shipping rates', 'Delivery time estimate', 'Back to menu'],
  };
}

function handleReturnsRefunds(entities) {
  return {
    message: "I can help with returns and refunds! Here's our policy:\n\n📅 Return Window: 7-15 days (varies by category)\n💰 Refund Timeline: 5-7 business days\n📦 Return Shipping: Free for quality issues\n\nHow can I assist you?",
    confidence: 0.85,
    quickReplies: ['Start a return', 'Check refund status', 'Return policy', 'File dispute'],
  };
}

function handleAccountHelp(userId) {
  const message = userId
    ? "I can help you with your account! What do you need?\n\n👤 Profile settings\n🔐 Password & security\n📧 Notification preferences\n🏢 Business details"
    : "For account-related help, please log in first. Or I can help you with:\n\n📝 Create an account\n🔑 Reset password\n❓ Registration help";

  return {
    message,
    confidence: 0.85,
    quickReplies: userId
      ? ['Update profile', 'Change password', 'Notification settings', 'Delete account']
      : ['Login', 'Register', 'Reset password', 'Back to menu'],
  };
}

function handleSellerSupport() {
  return {
    message: "Interested in selling on Airavat? Here's what I can help with:\n\n🏪 Become a seller\n📦 List products\n💰 Pricing & fees\n📊 Seller dashboard\n\nWhat would you like to know?",
    confidence: 0.85,
    quickReplies: ['How to become a seller', 'Selling fees', 'Seller benefits', 'Back to menu'],
  };
}

async function handleEscalation(session) {
  // Create support ticket
  const ticket = await prisma.supportTicket.create({
    data: {
      userId: session.userId,
      chatSessionId: session.id,
      status: 'PENDING',
      priority: 'NORMAL',
      subject: 'Chat escalation - Human assistance requested',
    },
  });

  return {
    message: "I'm connecting you with a human agent. Your ticket number is " + ticket.id.slice(-8).toUpperCase() + ". \n\nExpected wait time: 2-5 minutes\n\nIn the meantime, you can continue chatting with me or browse our help center.",
    confidence: 0.95,
    quickReplies: ['View help center', 'Continue with bot', 'Cancel request'],
    actions: [
      { type: 'escalate', ticketId: ticket.id },
    ],
  };
}

function handleGeneralQuery(message, context) {
  // Use AI to generate response for general queries
  // In production, integrate with OpenAI GPT or similar
  return {
    message: "I understand you're asking about something specific. Let me help you find the right information. Could you tell me more about what you need?\n\nOr choose from these common topics:",
    confidence: 0.6,
    quickReplies: QUICK_REPLIES.MAIN_MENU,
  };
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

function getWelcomeMessage(userId) {
  if (userId) {
    return "👋 Welcome back to Airavat! I'm your AI assistant. I can help you with orders, products, payments, and more. How can I assist you today?";
  }
  return "👋 Hello! Welcome to Airavat B2B Marketplace. I'm your virtual assistant and I'm here to help you 24/7. What would you like help with?";
}

function isSessionExpired(session) {
  if (!session.lastActivityAt) return false;
  const lastActivity = new Date(session.lastActivityAt);
  return Date.now() - lastActivity.getTime() > CONFIG.sessionTimeout;
}

async function checkRateLimit(sessionId) {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const messageCount = await prisma.chatMessage.count({
    where: {
      sessionId,
      role: 'user',
      createdAt: { gte: hourAgo },
    },
  });

  if (messageCount >= CONFIG.rateLimit) {
    throw new AppError('Rate limit exceeded. Please wait before sending more messages.', 429);
  }
}

// =============================================================================
// ANALYTICS
// =============================================================================

/**
 * Get chatbot analytics
 * @param {Object} options - Query options
 * @returns {Promise<Object>} Analytics data
 */
exports.getAnalytics = async (options = {}) => {
  const { startDate, endDate } = options;

  const where = {};
  if (startDate) where.createdAt = { gte: new Date(startDate) };
  if (endDate) where.createdAt = { ...where.createdAt, lte: new Date(endDate) };

  const [totalSessions, avgRating, intentDistribution, escalations] = await Promise.all([
    prisma.chatSession.count({ where }),
    prisma.chatSession.aggregate({
      where: { ...where, feedback: { not: null } },
      _avg: { feedback: true },
    }),
    prisma.chatMessage.groupBy({
      by: ['metadata'],
      where: { ...where, role: 'assistant' },
      _count: true,
    }),
    prisma.supportTicket.count({
      where: { ...where, chatSessionId: { not: null } },
    }),
  ]);

  return {
    totalSessions,
    avgRating: avgRating._avg.feedback || 0,
    escalationRate: totalSessions > 0 ? (escalations / totalSessions * 100).toFixed(2) : 0,
    escalations,
  };
};

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  ...exports,
  INTENTS,
  QUICK_REPLIES,
  CONFIG,
};



