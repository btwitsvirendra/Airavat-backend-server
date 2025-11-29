// =============================================================================
// AIRAVAT B2B MARKETPLACE - SOCKET.IO SERVICE
// Real-time communication for chat, notifications, and live updates
// =============================================================================

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const config = require('../config');
const { prisma } = require('../config/database');
const { cache } = require('../config/redis');
const logger = require('../config/logger');

let io = null;

// Store online users: userId -> Set of socketIds
const onlineUsers = new Map();
// Store business online status: businessId -> Set of userIds
const onlineBusinesses = new Map();

/**
 * Initialize Socket.IO server
 */
const initSocketIO = (server) => {
  io = new Server(server, {
    cors: {
      origin: config.app.frontendUrl,
      methods: ['GET', 'POST'],
      credentials: true,
    },
    pingTimeout: 60000,
    pingInterval: 25000,
  });

  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth.token || socket.handshake.query.token;
      
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const decoded = jwt.verify(token, config.jwt.secret);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          role: true,
          business: {
            select: {
              id: true,
              businessName: true,
            },
          },
        },
      });

      if (!user) {
        return next(new Error('User not found'));
      }

      socket.user = user;
      socket.userId = user.id;
      socket.businessId = user.business?.id;
      
      next();
    } catch (error) {
      next(new Error('Invalid token'));
    }
  });

  // Connection handler
  io.on('connection', (socket) => {
    const { userId, businessId } = socket;
    
    logger.info(`Socket connected: ${userId} (${socket.id})`);

    // Track online users
    if (!onlineUsers.has(userId)) {
      onlineUsers.set(userId, new Set());
    }
    onlineUsers.get(userId).add(socket.id);

    // Track online businesses
    if (businessId) {
      if (!onlineBusinesses.has(businessId)) {
        onlineBusinesses.set(businessId, new Set());
      }
      onlineBusinesses.get(businessId).add(userId);
      
      // Notify others that business is online
      socket.broadcast.emit('business:online', { businessId });
    }

    // Join user's personal room
    socket.join(`user:${userId}`);
    
    // Join business room if applicable
    if (businessId) {
      socket.join(`business:${businessId}`);
    }

    // ==========================================================================
    // CHAT EVENTS
    // ==========================================================================

    // Join chat room
    socket.on('chat:join', async (chatId) => {
      try {
        // Verify user is participant in this chat
        const participant = await prisma.chatParticipant.findFirst({
          where: {
            chatId,
            OR: [
              { userId },
              { businessId },
            ],
          },
        });

        if (!participant) {
          socket.emit('error', { message: 'Not authorized to join this chat' });
          return;
        }

        socket.join(`chat:${chatId}`);
        socket.emit('chat:joined', { chatId });
        
        // Mark messages as read
        await prisma.chatParticipant.update({
          where: { id: participant.id },
          data: { lastReadAt: new Date(), unreadCount: 0 },
        });

      } catch (error) {
        logger.error('Error joining chat:', error);
        socket.emit('error', { message: 'Failed to join chat' });
      }
    });

    // Leave chat room
    socket.on('chat:leave', (chatId) => {
      socket.leave(`chat:${chatId}`);
    });

    // Send message
    socket.on('chat:message', async (data) => {
      try {
        const { chatId, content, type = 'TEXT', attachments, metadata } = data;

        // Verify participation
        const participant = await prisma.chatParticipant.findFirst({
          where: {
            chatId,
            OR: [{ userId }, { businessId }],
          },
        });

        if (!participant) {
          socket.emit('error', { message: 'Not authorized' });
          return;
        }

        // Create message
        const message = await prisma.message.create({
          data: {
            chatId,
            senderId: userId,
            type,
            content,
            attachments: attachments || undefined,
            metadata: metadata || undefined,
          },
          include: {
            sender: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                avatar: true,
              },
            },
          },
        });

        // Update chat's last message
        await prisma.chat.update({
          where: { id: chatId },
          data: {
            lastMessageAt: new Date(),
            lastMessagePreview: content?.substring(0, 200),
          },
        });

        // Increment unread count for other participants
        await prisma.chatParticipant.updateMany({
          where: {
            chatId,
            NOT: { userId },
          },
          data: {
            unreadCount: { increment: 1 },
          },
        });

        // Broadcast to chat room
        io.to(`chat:${chatId}`).emit('chat:message', message);

        // Send push notification to offline users
        const otherParticipants = await prisma.chatParticipant.findMany({
          where: {
            chatId,
            NOT: { userId },
          },
          select: { userId: true },
        });

        for (const p of otherParticipants) {
          if (p.userId && !isUserOnline(p.userId)) {
            // Queue push notification
            emitToUser(p.userId, 'notification:new', {
              type: 'MESSAGE',
              title: `New message from ${socket.user.firstName}`,
              body: content?.substring(0, 100),
              chatId,
            });
          }
        }

      } catch (error) {
        logger.error('Error sending message:', error);
        socket.emit('error', { message: 'Failed to send message' });
      }
    });

    // Typing indicator
    socket.on('chat:typing', (chatId) => {
      socket.to(`chat:${chatId}`).emit('chat:typing', {
        chatId,
        userId,
        userName: `${socket.user.firstName} ${socket.user.lastName}`,
      });
    });

    // Stop typing
    socket.on('chat:stopTyping', (chatId) => {
      socket.to(`chat:${chatId}`).emit('chat:stopTyping', { chatId, userId });
    });

    // Mark messages as read
    socket.on('chat:read', async (chatId) => {
      try {
        await prisma.chatParticipant.updateMany({
          where: { chatId, userId },
          data: { lastReadAt: new Date(), unreadCount: 0 },
        });

        socket.to(`chat:${chatId}`).emit('chat:read', { chatId, userId });
      } catch (error) {
        logger.error('Error marking chat as read:', error);
      }
    });

    // ==========================================================================
    // RFQ & QUOTATION EVENTS
    // ==========================================================================

    // Subscribe to RFQ updates
    socket.on('rfq:subscribe', (rfqId) => {
      socket.join(`rfq:${rfqId}`);
    });

    socket.on('rfq:unsubscribe', (rfqId) => {
      socket.leave(`rfq:${rfqId}`);
    });

    // ==========================================================================
    // ORDER EVENTS
    // ==========================================================================

    // Subscribe to order updates
    socket.on('order:subscribe', (orderId) => {
      socket.join(`order:${orderId}`);
    });

    socket.on('order:unsubscribe', (orderId) => {
      socket.leave(`order:${orderId}`);
    });

    // ==========================================================================
    // NOTIFICATION EVENTS
    // ==========================================================================

    // Mark notification as read
    socket.on('notification:read', async (notificationId) => {
      try {
        await prisma.notification.update({
          where: { id: notificationId, userId },
          data: { isRead: true, readAt: new Date() },
        });
      } catch (error) {
        logger.error('Error marking notification as read:', error);
      }
    });

    // Mark all notifications as read
    socket.on('notification:readAll', async () => {
      try {
        await prisma.notification.updateMany({
          where: { userId, isRead: false },
          data: { isRead: true, readAt: new Date() },
        });
        socket.emit('notification:allRead');
      } catch (error) {
        logger.error('Error marking all notifications as read:', error);
      }
    });

    // ==========================================================================
    // DISCONNECT
    // ==========================================================================

    socket.on('disconnect', () => {
      logger.info(`Socket disconnected: ${userId} (${socket.id})`);

      // Remove from online users
      const userSockets = onlineUsers.get(userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          onlineUsers.delete(userId);
          
          // Remove from online businesses
          if (businessId) {
            const businessUsers = onlineBusinesses.get(businessId);
            if (businessUsers) {
              businessUsers.delete(userId);
              if (businessUsers.size === 0) {
                onlineBusinesses.delete(businessId);
                socket.broadcast.emit('business:offline', { businessId });
              }
            }
          }
        }
      }
    });
  });

  logger.info('Socket.IO initialized');
  return io;
};

/**
 * Get Socket.IO instance
 */
const getIO = () => {
  if (!io) {
    throw new Error('Socket.IO not initialized');
  }
  return io;
};

/**
 * Check if user is online
 */
const isUserOnline = (userId) => {
  return onlineUsers.has(userId) && onlineUsers.get(userId).size > 0;
};

/**
 * Check if any user from business is online
 */
const isBusinessOnline = (businessId) => {
  return onlineBusinesses.has(businessId) && onlineBusinesses.get(businessId).size > 0;
};

/**
 * Emit event to specific user
 */
const emitToUser = (userId, event, data) => {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
};

/**
 * Emit event to business
 */
const emitToBusiness = (businessId, event, data) => {
  if (io) {
    io.to(`business:${businessId}`).emit(event, data);
  }
};

/**
 * Emit event to chat room
 */
const emitToChat = (chatId, event, data) => {
  if (io) {
    io.to(`chat:${chatId}`).emit(event, data);
  }
};

/**
 * Emit event to RFQ subscribers
 */
const emitToRFQ = (rfqId, event, data) => {
  if (io) {
    io.to(`rfq:${rfqId}`).emit(event, data);
  }
};

/**
 * Emit event to order subscribers
 */
const emitToOrder = (orderId, event, data) => {
  if (io) {
    io.to(`order:${orderId}`).emit(event, data);
  }
};

/**
 * Broadcast to all connected clients
 */
const broadcast = (event, data) => {
  if (io) {
    io.emit(event, data);
  }
};

/**
 * Get online user count
 */
const getOnlineCount = () => {
  return onlineUsers.size;
};

/**
 * Get online business count
 */
const getOnlineBusinessCount = () => {
  return onlineBusinesses.size;
};

module.exports = {
  initSocketIO,
  getIO,
  isUserOnline,
  isBusinessOnline,
  emitToUser,
  emitToBusiness,
  emitToChat,
  emitToRFQ,
  emitToOrder,
  broadcast,
  getOnlineCount,
  getOnlineBusinessCount,
};
