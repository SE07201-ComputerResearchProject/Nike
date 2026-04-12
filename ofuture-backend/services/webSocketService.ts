// ============================================================
// services/webSocketService.ts
// Real-time notification delivery via Socket.io
// ============================================================

import { Server as SocketIOServer, Socket } from 'socket.io';
import logger from '../utils/logger';

class WebSocketService {
  private io: SocketIOServer | null = null;
  private userConnections: Map<string, Set<string>> = new Map(); // userId -> socketIds

  /**
   * Initialize Socket.io server
   */
  initializeIO(server: any) {
    this.io = new SocketIOServer(server, {
      cors: {
        origin: ['http://localhost:3000', 'http://localhost:5173', 'http://localhost:5000'],
        credentials: true,
      },
      transports: ['websocket', 'polling'],
    });

    this.setupMiddleware();
    this.setupEventHandlers();

    logger.info('✓ WebSocket (Socket.io) server initialized');
    return this.io;
  }

  /**
   * Setup authentication middleware
   */
  private setupMiddleware() {
    if (!this.io) return;

    this.io.use((socket, next) => {
      const token = socket.handshake.auth.token;
      const userId = socket.handshake.auth.userId;

      if (!token || !userId) {
        logger.warn(`WebSocket: Unauthorized connection attempt from ${socket.id}`);
        return next(new Error('Authentication failed'));
      }

      // Store userId in socket for later use
      socket.data.userId = userId;
      socket.data.token = token;

      next();
    });
  }

  /**
   * Setup connection/disconnection event handlers
   */
  private setupEventHandlers() {
    if (!this.io) return;

    this.io.on('connection', (socket: Socket) => {
      const userId = socket.data.userId;
      logger.info(`✓ User ${userId} connected via WebSocket (socket: ${socket.id})`);

      // Track user connection
      if (!this.userConnections.has(userId)) {
        this.userConnections.set(userId, new Set());
      }
      this.userConnections.get(userId)!.add(socket.id);

      // User joins their personal room
      socket.join(`user_${userId}`);

      socket.on('disconnect', () => {
        const socketIds = this.userConnections.get(userId);
        if (socketIds) {
          socketIds.delete(socket.id);
          if (socketIds.size === 0) {
            this.userConnections.delete(userId);
          }
        }
        logger.info(`✓ User ${userId} disconnected (socket: ${socket.id})`);
      });

      socket.on('error', (error) => {
        logger.error(`WebSocket error for user ${userId}:`, error);
      });
    });
  }

  /**
   * Emit notification to specific user
   */
  emitNotificationToUser(userId: string, notification: any) {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return;
    }

    this.io.to(`user_${userId}`).emit('notification', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      link: notification.link,
      isRead: notification.is_read,
      createdAt: notification.created_at,
    });

    logger.info(`Emitted notification to user ${userId}: ${notification.title}`);
  }

  /**
   * Emit notification to multiple users
   */
  emitNotificationToUsers(userIds: string[], notification: any) {
    userIds.forEach((userId) => {
      this.emitNotificationToUser(userId, notification);
    });
  }

  /**
   * Emit notification to all connected users (admin broadcast)
   */
  broadcastNotification(notification: any) {
    if (!this.io) {
      logger.warn('Socket.io not initialized');
      return;
    }

    this.io.emit('broadcast-notification', notification);
    logger.info(`Broadcasted notification to all users: ${notification.title}`);
  }

  /**
   * Emit unread count update to user
   */
  emitUnreadCountUpdate(userId: string, unreadCount: number) {
    if (!this.io) return;

    this.io.to(`user_${userId}`).emit('unread-count-update', {
      unreadCount,
      timestamp: new Date(),
    });
  }

  /**
   * Check if user is online
   */
  isUserOnline(userId: string): boolean {
    return this.userConnections.has(userId) && this.userConnections.get(userId)!.size > 0;
  }

  /**
   * Get all connected users
   */
  getConnectedUsers(): string[] {
    return Array.from(this.userConnections.keys());
  }

  /**
   * Get Socket.io instance
   */
  getIO(): SocketIOServer | null {
    return this.io;
  }
}

export default new WebSocketService();
