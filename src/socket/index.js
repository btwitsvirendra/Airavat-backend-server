// =============================================================================
// AIRAVAT B2B MARKETPLACE - WEBSOCKET IMPLEMENTATION
// =============================================================================

const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');
const { prisma } = require('../config/database');
const { redis } = require('../config/redis');
const logger = require('../config/logger');
const config = require('../config');

// =============================================================================
// SOCKET.IO SETUP
// =============================================================================

let io;

function initializeSocket(server) {
  io = new Server(server, {
    cors: {
      origin: config.app.frontendUrl || '*',
      methods: ['GET', 'POST'],
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });
  
  // Make io globally available
  global.io = io;
  
  // Redis adapter for scaling
  // const { createAdapter } = require('@socket.io/redis-adapter');
  // io.adapter(createAdapter(redis, redis.duplicate()));
  
  // Authentication middleware
  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token || socket.handshake.query?.token;
      
      if (!token) {
        return next(new Error('Authentication required'));
      }
      
      // Verify JWT token
      const decoded = jwt.verify(token, config.jwt.secret);
      
      // Get user
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        include: { business: true },
      });
      
      if (!user || user.status !== 'ACTIVE') {
        return next(new Error('Invalid user'));
      }
      
      socket.user = user;
      socket.businessId = user.business?.id;
      
      next();
    } catch (error) {
      logger.error('Socket authentication failed', { error: error.message });
      next(new Error('Authentication failed'));
    }
  });
  
  // Connection handler
  io.on('connection', handleConnection);
  
  logger.info('WebSocket server initialized');
  
  return io;
}

// =============================================================================
// CONNECTION HANDLER
// =============================================================================

async function handleConnection(socket) {
  const userId = socket.user.id;
  const businessId = socket.businessId;
  
  logger.info('Socket connected', { userId, socketId: socket.id });
  
  // Join user-specific room
  socket.join(`user:${userId}`);
  
  // Join business room if applicable
  if (businessId) {
    socket.join(`business:${businessId}`);
  }
  
  // Track online status
  await setUserOnline(userId);
  
  // =============================================================================
  // CHAT HANDLERS
  // =============================================================================
  
  // Join chat room
  socket.on('chat:join', async (chatId) => {
    try {
      // Verify access to chat
      const chat = await prisma.chat.findFirst({
        where: {
          id: chatId,
          OR: [
            { buyerId: businessId },
            { sellerId: businessId },
          ],
        },
      });
      
      if (chat) {
        socket.join(`chat:${chatId}`);
        logger.info('User joined chat', { userId, chatId });
      }
    } catch (error) {
      logger.error('Failed to join chat', { error: error.message });
    }
  });
  
  // Leave chat room
  socket.on('chat:leave', (chatId) => {
    socket.leave(`chat:${chatId}`);
    logger.info('User left chat', { userId, chatId });
  });
  
  // Send message
  socket.on('chat:message', async (data) => {
    try {
      const { chatId, content, type = 'TEXT', attachments = [] } = data;
      
      // Create message
      const message = await prisma.message.create({
        data: {
          chatId,
          senderId: businessId,
          senderUserId: userId,
          content,
          type,
          attachments,
        },
        include: {
          sender: {
            select: { id: true, businessName: true, logo: true },
          },
        },
      });
      
      // Update chat
      await prisma.chat.update({
        where: { id: chatId },
        data: {
          lastMessageAt: new Date(),
          lastMessagePreview: content.substring(0, 100),
        },
      });
      
      // Emit to chat room
      io.to(`chat:${chatId}`).emit('chat:message', message);
      
      // Send notification to recipient
      const chat = await prisma.chat.findUnique({
        where: { id: chatId },
      });
      
      const recipientId = chat.buyerId === businessId ? chat.sellerId : chat.buyerId;
      const recipient = await prisma.business.findUnique({
        where: { id: recipientId },
      });
      
      io.to(`user:${recipient.ownerId}`).emit('notification', {
        type: 'NEW_MESSAGE',
        title: 'New Message',
        message: `New message from ${message.sender.businessName}`,
        data: { chatId, messageId: message.id },
      });
    } catch (error) {
      logger.error('Failed to send message', { error: error.message });
      socket.emit('chat:error', { message: 'Failed to send message' });
    }
  });
  
  // Typing indicator
  socket.on('chat:typing', (data) => {
    const { chatId, isTyping } = data;
    socket.to(`chat:${chatId}`).emit('chat:typing', {
      userId,
      businessId,
      isTyping,
    });
  });
  
  // Mark messages as read
  socket.on('chat:read', async (data) => {
    try {
      const { chatId, messageIds } = data;
      
      await prisma.message.updateMany({
        where: {
          id: { in: messageIds },
          chatId,
        },
        data: {
          isRead: true,
          readAt: new Date(),
        },
      });
      
      socket.to(`chat:${chatId}`).emit('chat:read', {
        messageIds,
        readBy: userId,
      });
    } catch (error) {
      logger.error('Failed to mark messages as read', { error: error.message });
    }
  });
  
  // =============================================================================
  // NOTIFICATION HANDLERS
  // =============================================================================
  
  // Mark notification as read
  socket.on('notification:read', async (notificationId) => {
    try {
      await prisma.notification.update({
        where: { id: notificationId, userId },
        data: { isRead: true, readAt: new Date() },
      });
    } catch (error) {
      logger.error('Failed to mark notification as read', { error: error.message });
    }
  });
  
  // Get unread count
  socket.on('notification:unread-count', async () => {
    try {
      const count = await prisma.notification.count({
        where: { userId, isRead: false },
      });
      socket.emit('notification:unread-count', { count });
    } catch (error) {
      logger.error('Failed to get unread count', { error: error.message });
    }
  });
  
  // =============================================================================
  // ORDER HANDLERS (Real-time updates)
  // =============================================================================
  
  // Subscribe to order updates
  socket.on('order:subscribe', (orderId) => {
    socket.join(`order:${orderId}`);
  });
  
  socket.on('order:unsubscribe', (orderId) => {
    socket.leave(`order:${orderId}`);
  });
  
  // =============================================================================
  // PRESENCE HANDLERS
  // =============================================================================
  
  // Update presence
  socket.on('presence:update', async (status) => {
    if (businessId) {
      await redis.hset(`presence:${businessId}`, {
        status,
        lastSeen: Date.now(),
      });
      
      // Broadcast to interested parties
      socket.broadcast.emit('presence:change', {
        businessId,
        status,
        lastSeen: new Date(),
      });
    }
  });
  
  // Get user presence
  socket.on('presence:get', async (targetBusinessId) => {
    const presence = await redis.hgetall(`presence:${targetBusinessId}`);
    socket.emit('presence:status', {
      businessId: targetBusinessId,
      ...presence,
    });
  });
  
  // =============================================================================
  // DISCONNECTION HANDLER
  // =============================================================================
  
  socket.on('disconnect', async (reason) => {
    logger.info('Socket disconnected', { userId, socketId: socket.id, reason });
    
    // Update online status
    await setUserOffline(userId);
    
    // Update business presence
    if (businessId) {
      await redis.hset(`presence:${businessId}`, {
        status: 'offline',
        lastSeen: Date.now(),
      });
    }
  });
  
  // =============================================================================
  // ERROR HANDLER
  // =============================================================================
  
  socket.on('error', (error) => {
    logger.error('Socket error', { userId, error: error.message });
  });
}

// =============================================================================
// HELPER FUNCTIONS
// =============================================================================

async function setUserOnline(userId) {
  await redis.sadd('online-users', userId);
  await redis.hset(`user:${userId}:status`, {
    online: true,
    lastSeen: Date.now(),
  });
}

async function setUserOffline(userId) {
  await redis.srem('online-users', userId);
  await redis.hset(`user:${userId}:status`, {
    online: false,
    lastSeen: Date.now(),
  });
}

async function isUserOnline(userId) {
  return redis.sismember('online-users', userId);
}

async function getOnlineUsers() {
  return redis.smembers('online-users');
}

// =============================================================================
// EMIT HELPERS
// =============================================================================

function emitToUser(userId, event, data) {
  if (io) {
    io.to(`user:${userId}`).emit(event, data);
  }
}

function emitToBusiness(businessId, event, data) {
  if (io) {
    io.to(`business:${businessId}`).emit(event, data);
  }
}

function emitToChat(chatId, event, data) {
  if (io) {
    io.to(`chat:${chatId}`).emit(event, data);
  }
}

function emitToOrder(orderId, event, data) {
  if (io) {
    io.to(`order:${orderId}`).emit(event, data);
  }
}

function emitToAll(event, data) {
  if (io) {
    io.emit(event, data);
  }
}

// =============================================================================
// EXPORTS
// =============================================================================

module.exports = {
  initializeSocket,
  emitToUser,
  emitToBusiness,
  emitToChat,
  emitToOrder,
  emitToAll,
  isUserOnline,
  getOnlineUsers,
};
