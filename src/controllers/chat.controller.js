// =============================================================================
// AIRAVAT B2B MARKETPLACE - CHAT CONTROLLER
// =============================================================================

const { prisma } = require('../config/database');
const socketService = require('../services/socket.service');
const { asyncHandler } = require('../middleware/errorHandler');
const { success, created, paginated } = require('../utils/response');
const { parsePagination } = require('../utils/helpers');
const { BadRequestError, NotFoundError, ForbiddenError } = require('../utils/errors');

/**
 * Get all chats
 * GET /api/v1/chat
 */
exports.getChats = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { archived = 'false' } = req.query;
  
  const where = {
    participants: {
      some: { businessId: req.business.id },
    },
    isArchived: archived === 'true',
  };
  
  const [chats, total] = await Promise.all([
    prisma.chat.findMany({
      where,
      skip,
      take: limit,
      orderBy: { lastMessageAt: 'desc' },
      include: {
        participants: {
          include: {
            business: {
              select: { id: true, businessName: true, logo: true },
            },
          },
        },
        lastMessage: true,
        product: {
          select: { id: true, name: true, slug: true, images: true },
        },
      },
    }),
    prisma.chat.count({ where }),
  ]);
  
  // Add unread count for current user
  const chatsWithUnread = chats.map((chat) => {
    const participant = chat.participants.find((p) => p.businessId === req.business.id);
    return {
      ...chat,
      unreadCount: participant?.unreadCount || 0,
    };
  });
  
  paginated(res, chatsWithUnread, { page, limit, total });
});

/**
 * Start new chat
 * POST /api/v1/chat/start
 */
exports.startChat = asyncHandler(async (req, res) => {
  const { recipientId, productId, message } = req.body;
  
  if (!recipientId) {
    throw new BadRequestError('Recipient ID is required');
  }
  
  if (recipientId === req.business.id) {
    throw new BadRequestError('Cannot start chat with yourself');
  }
  
  // Check if chat already exists
  let chat = await prisma.chat.findFirst({
    where: {
      AND: [
        { participants: { some: { businessId: req.business.id } } },
        { participants: { some: { businessId: recipientId } } },
        ...(productId ? [{ productId }] : [{ productId: null }]),
      ],
    },
    include: {
      participants: {
        include: {
          business: { select: { id: true, businessName: true, logo: true } },
        },
      },
    },
  });
  
  if (!chat) {
    // Create new chat
    chat = await prisma.chat.create({
      data: {
        productId,
        participants: {
          create: [
            { businessId: req.business.id },
            { businessId: recipientId },
          ],
        },
      },
      include: {
        participants: {
          include: {
            business: { select: { id: true, businessName: true, logo: true } },
          },
        },
        product: {
          select: { id: true, name: true, slug: true, images: true },
        },
      },
    });
  }
  
  // Send initial message if provided
  if (message) {
    const newMessage = await prisma.message.create({
      data: {
        chatId: chat.id,
        senderId: req.user.id,
        senderBusinessId: req.business.id,
        content: message,
        type: 'TEXT',
      },
    });
    
    // Update chat
    await prisma.chat.update({
      where: { id: chat.id },
      data: {
        lastMessageId: newMessage.id,
        lastMessageAt: new Date(),
      },
    });
    
    // Increment unread for recipient
    await prisma.chatParticipant.updateMany({
      where: {
        chatId: chat.id,
        businessId: { not: req.business.id },
      },
      data: {
        unreadCount: { increment: 1 },
      },
    });
    
    // Real-time notification
    socketService.sendToUser(recipientId, 'new_message', {
      chatId: chat.id,
      message: newMessage,
    });
  }
  
  created(res, { chat }, 'Chat started');
});

/**
 * Get chat by ID
 * GET /api/v1/chat/:chatId
 */
exports.getChatById = asyncHandler(async (req, res) => {
  const chat = await prisma.chat.findUnique({
    where: { id: req.params.chatId },
    include: {
      participants: {
        include: {
          business: {
            select: { id: true, businessName: true, logo: true, verificationStatus: true },
          },
        },
      },
      product: {
        select: { id: true, name: true, slug: true, images: true, minPrice: true, maxPrice: true },
      },
      order: {
        select: { id: true, orderNumber: true, status: true },
      },
    },
  });
  
  if (!chat) {
    throw new NotFoundError('Chat');
  }
  
  // Verify access
  const isParticipant = chat.participants.some((p) => p.businessId === req.business.id);
  if (!isParticipant) {
    throw new ForbiddenError('Access denied');
  }
  
  success(res, { chat });
});

/**
 * Get chat messages
 * GET /api/v1/chat/:chatId/messages
 */
exports.getMessages = asyncHandler(async (req, res) => {
  const { page, limit, skip } = parsePagination(req.query);
  const { before } = req.query;
  
  // Verify access
  const chat = await prisma.chat.findFirst({
    where: {
      id: req.params.chatId,
      participants: { some: { businessId: req.business.id } },
    },
  });
  
  if (!chat) {
    throw new ForbiddenError('Access denied');
  }
  
  const where = {
    chatId: req.params.chatId,
    isDeleted: false,
    ...(before && { createdAt: { lt: new Date(before) } }),
  };
  
  const [messages, total] = await Promise.all([
    prisma.message.findMany({
      where,
      skip,
      take: limit,
      orderBy: { createdAt: 'desc' },
      include: {
        sender: {
          select: { id: true, firstName: true, lastName: true, avatar: true },
        },
        senderBusiness: {
          select: { id: true, businessName: true, logo: true },
        },
        attachments: true,
        productCard: {
          select: { id: true, name: true, images: true, minPrice: true },
        },
        quotationCard: {
          select: { id: true, quotationNumber: true, totalAmount: true, status: true },
        },
      },
    }),
    prisma.message.count({ where }),
  ]);
  
  // Return in chronological order
  paginated(res, messages.reverse(), { page, limit, total });
});

/**
 * Send message
 * POST /api/v1/chat/:chatId/messages
 */
exports.sendMessage = asyncHandler(async (req, res) => {
  const { content, type = 'TEXT', attachments, replyToId } = req.body;
  
  if (!content && (!attachments || attachments.length === 0)) {
    throw new BadRequestError('Message content or attachment is required');
  }
  
  // Verify access
  const chat = await prisma.chat.findFirst({
    where: {
      id: req.params.chatId,
      participants: { some: { businessId: req.business.id } },
    },
    include: {
      participants: true,
    },
  });
  
  if (!chat) {
    throw new ForbiddenError('Access denied');
  }
  
  const message = await prisma.message.create({
    data: {
      chatId: chat.id,
      senderId: req.user.id,
      senderBusinessId: req.business.id,
      content,
      type,
      replyToId,
      attachments: attachments ? {
        create: attachments.map((a) => ({
          url: a.url,
          name: a.name,
          size: a.size,
          mimeType: a.mimeType,
        })),
      } : undefined,
    },
    include: {
      sender: {
        select: { id: true, firstName: true, lastName: true, avatar: true },
      },
      senderBusiness: {
        select: { id: true, businessName: true, logo: true },
      },
      attachments: true,
      replyTo: true,
    },
  });
  
  // Update chat
  await prisma.chat.update({
    where: { id: chat.id },
    data: {
      lastMessageId: message.id,
      lastMessageAt: new Date(),
    },
  });
  
  // Increment unread for other participants
  await prisma.chatParticipant.updateMany({
    where: {
      chatId: chat.id,
      businessId: { not: req.business.id },
    },
    data: {
      unreadCount: { increment: 1 },
    },
  });
  
  // Real-time notification to other participants
  const otherParticipants = chat.participants.filter((p) => p.businessId !== req.business.id);
  for (const participant of otherParticipants) {
    socketService.sendToUser(participant.businessId, 'new_message', {
      chatId: chat.id,
      message,
    });
  }
  
  created(res, { message }, 'Message sent');
});

/**
 * Mark messages as read
 * POST /api/v1/chat/:chatId/read
 */
exports.markAsRead = asyncHandler(async (req, res) => {
  // Verify access
  const participant = await prisma.chatParticipant.findFirst({
    where: {
      chatId: req.params.chatId,
      businessId: req.business.id,
    },
  });
  
  if (!participant) {
    throw new ForbiddenError('Access denied');
  }
  
  // Reset unread count
  await prisma.chatParticipant.update({
    where: { id: participant.id },
    data: {
      unreadCount: 0,
      lastReadAt: new Date(),
    },
  });
  
  // Mark messages as read
  await prisma.message.updateMany({
    where: {
      chatId: req.params.chatId,
      senderBusinessId: { not: req.business.id },
      readAt: null,
    },
    data: {
      readAt: new Date(),
    },
  });
  
  success(res, null, 'Messages marked as read');
});

/**
 * Toggle mute
 * PATCH /api/v1/chat/:chatId/mute
 */
exports.toggleMute = asyncHandler(async (req, res) => {
  const { muted } = req.body;
  
  await prisma.chatParticipant.updateMany({
    where: {
      chatId: req.params.chatId,
      businessId: req.business.id,
    },
    data: {
      isMuted: muted,
    },
  });
  
  success(res, null, muted ? 'Chat muted' : 'Chat unmuted');
});

/**
 * Archive chat
 * POST /api/v1/chat/:chatId/archive
 */
exports.archiveChat = asyncHandler(async (req, res) => {
  await prisma.chat.update({
    where: { id: req.params.chatId },
    data: { isArchived: true },
  });
  
  success(res, null, 'Chat archived');
});

/**
 * Edit message
 * PATCH /api/v1/chat/:chatId/messages/:messageId
 */
exports.editMessage = asyncHandler(async (req, res) => {
  const { content } = req.body;
  
  const message = await prisma.message.findUnique({
    where: { id: req.params.messageId },
  });
  
  if (!message || message.senderBusinessId !== req.business.id) {
    throw new ForbiddenError('Can only edit your own messages');
  }
  
  // Can only edit within 15 minutes
  const fifteenMinutesAgo = new Date(Date.now() - 15 * 60 * 1000);
  if (message.createdAt < fifteenMinutesAgo) {
    throw new BadRequestError('Can only edit messages within 15 minutes');
  }
  
  const updatedMessage = await prisma.message.update({
    where: { id: req.params.messageId },
    data: {
      content,
      isEdited: true,
      editedAt: new Date(),
    },
  });
  
  success(res, { message: updatedMessage }, 'Message edited');
});

/**
 * Delete message
 * DELETE /api/v1/chat/:chatId/messages/:messageId
 */
exports.deleteMessage = asyncHandler(async (req, res) => {
  const message = await prisma.message.findUnique({
    where: { id: req.params.messageId },
  });
  
  if (!message || message.senderBusinessId !== req.business.id) {
    throw new ForbiddenError('Can only delete your own messages');
  }
  
  await prisma.message.update({
    where: { id: req.params.messageId },
    data: {
      isDeleted: true,
      deletedAt: new Date(),
    },
  });
  
  success(res, null, 'Message deleted');
});

/**
 * Send product card
 * POST /api/v1/chat/:chatId/messages/product
 */
exports.sendProductCard = asyncHandler(async (req, res) => {
  const { productId, message: textMessage } = req.body;
  
  const product = await prisma.product.findUnique({
    where: { id: productId },
    select: { id: true, name: true, images: true, minPrice: true, businessId: true },
  });
  
  if (!product) {
    throw new NotFoundError('Product');
  }
  
  // Verify chat access
  const chat = await prisma.chat.findFirst({
    where: {
      id: req.params.chatId,
      participants: { some: { businessId: req.business.id } },
    },
  });
  
  if (!chat) {
    throw new ForbiddenError('Access denied');
  }
  
  const message = await prisma.message.create({
    data: {
      chatId: chat.id,
      senderId: req.user.id,
      senderBusinessId: req.business.id,
      content: textMessage || `Check out: ${product.name}`,
      type: 'PRODUCT_CARD',
      productCardId: productId,
    },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true } },
      senderBusiness: { select: { id: true, businessName: true, logo: true } },
      productCard: { select: { id: true, name: true, images: true, minPrice: true } },
    },
  });
  
  // Update chat
  await prisma.chat.update({
    where: { id: chat.id },
    data: {
      lastMessageId: message.id,
      lastMessageAt: new Date(),
    },
  });
  
  created(res, { message }, 'Product card sent');
});

/**
 * Send quotation card
 * POST /api/v1/chat/:chatId/messages/quotation
 */
exports.sendQuotationCard = asyncHandler(async (req, res) => {
  const { quotationId, message: textMessage } = req.body;
  
  const quotation = await prisma.quotation.findUnique({
    where: { id: quotationId },
  });
  
  if (!quotation || quotation.sellerId !== req.business.id) {
    throw new ForbiddenError('Can only share your own quotations');
  }
  
  // Verify chat access
  const chat = await prisma.chat.findFirst({
    where: {
      id: req.params.chatId,
      participants: { some: { businessId: req.business.id } },
    },
  });
  
  if (!chat) {
    throw new ForbiddenError('Access denied');
  }
  
  const message = await prisma.message.create({
    data: {
      chatId: chat.id,
      senderId: req.user.id,
      senderBusinessId: req.business.id,
      content: textMessage || `Quotation: ${quotation.quotationNumber}`,
      type: 'QUOTATION_CARD',
      quotationCardId: quotationId,
    },
    include: {
      sender: { select: { id: true, firstName: true, lastName: true } },
      quotationCard: { select: { id: true, quotationNumber: true, totalAmount: true, status: true } },
    },
  });
  
  created(res, { message }, 'Quotation card sent');
});

/**
 * Send order card
 * POST /api/v1/chat/:chatId/messages/order
 */
exports.sendOrderCard = asyncHandler(async (req, res) => {
  const { orderId, message: textMessage } = req.body;
  
  const order = await prisma.order.findUnique({
    where: { id: orderId },
  });
  
  if (!order || (order.buyerId !== req.business.id && order.sellerId !== req.business.id)) {
    throw new ForbiddenError('Access denied');
  }
  
  const chat = await prisma.chat.findFirst({
    where: {
      id: req.params.chatId,
      participants: { some: { businessId: req.business.id } },
    },
  });
  
  if (!chat) {
    throw new ForbiddenError('Access denied');
  }
  
  const message = await prisma.message.create({
    data: {
      chatId: chat.id,
      senderId: req.user.id,
      senderBusinessId: req.business.id,
      content: textMessage || `Order: ${order.orderNumber}`,
      type: 'ORDER_CARD',
      orderCardId: orderId,
    },
  });
  
  created(res, { message }, 'Order card sent');
});

/**
 * Upload attachment
 * POST /api/v1/chat/:chatId/attachments
 */
exports.uploadAttachment = asyncHandler(async (req, res) => {
  const { url, name, size, mimeType } = req.body;
  
  if (!url) {
    throw new BadRequestError('Attachment URL is required');
  }
  
  success(res, { 
    attachment: { url, name, size, mimeType } 
  }, 'Attachment ready');
});

/**
 * Create quick quote
 * POST /api/v1/chat/:chatId/quick-quote
 */
exports.createQuickQuote = asyncHandler(async (req, res) => {
  const { productId, quantity, unitPrice, validHours = 24, note } = req.body;
  
  const chat = await prisma.chat.findFirst({
    where: {
      id: req.params.chatId,
      participants: { some: { businessId: req.business.id } },
    },
  });
  
  if (!chat) {
    throw new ForbiddenError('Access denied');
  }
  
  const quickQuote = await prisma.quickQuote.create({
    data: {
      chatId: chat.id,
      sellerId: req.business.id,
      productId,
      quantity,
      unitPrice,
      totalAmount: quantity * unitPrice,
      validUntil: new Date(Date.now() + validHours * 60 * 60 * 1000),
      note,
      status: 'PENDING',
    },
  });
  
  // Create message
  const message = await prisma.message.create({
    data: {
      chatId: chat.id,
      senderId: req.user.id,
      senderBusinessId: req.business.id,
      content: `Quick quote: ${quantity} units @ ₹${unitPrice}/unit = ₹${quantity * unitPrice}`,
      type: 'QUICK_QUOTE',
      metadata: { quickQuoteId: quickQuote.id },
    },
  });
  
  await prisma.chat.update({
    where: { id: chat.id },
    data: { lastMessageId: message.id, lastMessageAt: new Date() },
  });
  
  created(res, { quickQuote, message }, 'Quick quote sent');
});

/**
 * Accept quick quote
 * POST /api/v1/chat/:chatId/quick-quote/:quoteId/accept
 */
exports.acceptQuickQuote = asyncHandler(async (req, res) => {
  const quickQuote = await prisma.quickQuote.findUnique({
    where: { id: req.params.quoteId },
    include: { chat: true },
  });
  
  if (!quickQuote) {
    throw new NotFoundError('Quick quote');
  }
  
  if (quickQuote.sellerId === req.business.id) {
    throw new BadRequestError('Cannot accept your own quote');
  }
  
  if (quickQuote.status !== 'PENDING') {
    throw new BadRequestError('Quote is no longer available');
  }
  
  if (quickQuote.validUntil < new Date()) {
    throw new BadRequestError('Quote has expired');
  }
  
  await prisma.quickQuote.update({
    where: { id: quickQuote.id },
    data: { status: 'ACCEPTED' },
  });
  
  // Create system message
  await prisma.message.create({
    data: {
      chatId: quickQuote.chatId,
      senderId: req.user.id,
      senderBusinessId: req.business.id,
      content: 'Quick quote accepted. You can now proceed to create an order.',
      type: 'SYSTEM',
    },
  });
  
  success(res, null, 'Quote accepted');
});

/**
 * Counter quick quote
 * POST /api/v1/chat/:chatId/quick-quote/:quoteId/counter
 */
exports.counterQuickQuote = asyncHandler(async (req, res) => {
  const { quantity, unitPrice, note } = req.body;
  
  const originalQuote = await prisma.quickQuote.findUnique({
    where: { id: req.params.quoteId },
  });
  
  if (!originalQuote) {
    throw new NotFoundError('Quick quote');
  }
  
  if (originalQuote.sellerId === req.business.id) {
    throw new BadRequestError('Cannot counter your own quote');
  }
  
  // Create counter quote
  const counterQuote = await prisma.quickQuote.create({
    data: {
      chatId: originalQuote.chatId,
      sellerId: originalQuote.sellerId,
      buyerId: req.business.id,
      productId: originalQuote.productId,
      quantity: quantity || originalQuote.quantity,
      unitPrice: unitPrice || originalQuote.unitPrice,
      totalAmount: (quantity || originalQuote.quantity) * (unitPrice || originalQuote.unitPrice),
      validUntil: new Date(Date.now() + 24 * 60 * 60 * 1000),
      note,
      status: 'COUNTER',
      parentQuoteId: originalQuote.id,
    },
  });
  
  // Update original
  await prisma.quickQuote.update({
    where: { id: originalQuote.id },
    data: { status: 'COUNTERED' },
  });
  
  created(res, { counterQuote }, 'Counter offer sent');
});

/**
 * Get unread count
 * GET /api/v1/chat/unread/count
 */
exports.getUnreadCount = asyncHandler(async (req, res) => {
  const result = await prisma.chatParticipant.aggregate({
    where: { businessId: req.business.id },
    _sum: { unreadCount: true },
  });
  
  success(res, { count: result._sum.unreadCount || 0 });
});
