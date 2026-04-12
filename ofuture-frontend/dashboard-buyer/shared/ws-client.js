// ============================================================
// WebSocket Client for Real-time Notifications
// ============================================================

class NotificationWebSocketClient {
  constructor() {
    this.socket = null;
    this.isConnected = false;
    this.reconnectAttempts = 0;
    this.maxReconnectAttempts = 5;
    this.reconnectDelay = 3000; // 3 seconds
  }

  /**
   * Initialize WebSocket connection
   */
  connect(userId, token) {
    if (this.socket) {
      console.warn('WebSocket already connected');
      return;
    }

    // Detect Socket.io script - if not loaded, fallback to polling
    if (typeof window.io === 'undefined') {
      console.info('Socket.io not loaded, using polling fallback');
      return;
    }

    try {
      this.socket = window.io('http://localhost:5000', {
        auth: {
          userId,
          token,
        },
        transports: ['websocket', 'polling'],
        reconnection: true,
        reconnectionDelay: 1000,
        reconnectionDelayMax: 5000,
        reconnectionAttempts: 5,
      });

      this.setupEventHandlers();
      this.isConnected = true;
      console.log('✓ WebSocket connected for real-time notifications');
    } catch (error) {
      console.error('Failed to connect to WebSocket:', error);
    }
  }

  /**
   * Setup event handlers
   */
  setupEventHandlers() {
    if (!this.socket) return;

    // Connection events
    this.socket.on('connect', () => {
      console.log('✓ Socket.io connected');
      this.reconnectAttempts = 0;
    });

    this.socket.on('disconnect', () => {
      console.log('⊘ Socket.io disconnected');
    });

    // Notification events
    this.socket.on('notification', (notification) => {
      console.log('📨 New notification received:', notification);

      // Update notification manager if available
      if (typeof notificationManager !== 'undefined') {
        notificationManager.loadNotifications();
      }

      // Show browser notification if permission granted
      this.showBrowserNotification(notification);
    });

    this.socket.on('unread-count-update', (data) => {
      console.log('🔔 Unread count updated:', data.unreadCount);

      if (typeof notificationManager !== 'undefined') {
        notificationManager.unreadCount = data.unreadCount;
        notificationManager.updateBadge();
      }
    });

    this.socket.on('broadcast-notification', (notification) => {
      console.log('📢 Broadcast notification:', notification);
    });

    this.socket.on('error', (error) => {
      console.error('Socket.io error:', error);
    });
  }

  /**
   * Show browser notification
   */
  showBrowserNotification(notification) {
    // Check if browser notifications are supported
    if (!('Notification' in window)) {
      return;
    }

    // Request permission if not granted
    if (Notification.permission === 'default') {
      Notification.requestPermission();
    }

    // Show notification if permission granted
    if (Notification.permission === 'granted') {
      const notifIcon = this.getNotificationIcon(notification.type);
      new Notification(`${notifIcon} ${notification.title}`, {
        body: notification.message,
        icon: '/Logo.png',
        badge: '/Logo.png',
        tag: `notification-${notification.id}`,
        requireInteraction: false,
      });
    }
  }

  /**
   * Get emoji icon by notification type
   */
  getNotificationIcon(type) {
    const icons = {
      order: '📦',
      escrow: '💰',
      chat: '💬',
      review: '⭐',
      alert: '🔔',
    };
    return icons[type] || '🔔';
  }

  /**
   * Disconnect WebSocket
   */
  disconnect() {
    if (this.socket) {
      this.socket.disconnect();
      this.socket = null;
      this.isConnected = false;
      console.log('WebSocket disconnected');
    }
  }

  /**
   * Check if WebSocket is connected
   */
  isConnectedStatus() {
    return this.isConnected && this.socket && this.socket.connected;
  }

  /**
   * Emit custom event (if needed)
   */
  emit(event, data) {
    if (this.socket) {
      this.socket.emit(event, data);
    }
  }

  /**
   * Listen to custom event
   */
  on(event, callback) {
    if (this.socket) {
      this.socket.on(event, callback);
    }
  }
}

// Global instance
const notificationWebSocketClient = new NotificationWebSocketClient();

// Auto-connect when user logs in
document.addEventListener('DOMContentLoaded', () => {
  const token = localStorage.getItem('accessToken');
  const user = localStorage.getItem('user');

  if (token && user) {
    try {
      const userData = JSON.parse(user);
      notificationWebSocketClient.connect(userData.id, token);
    } catch (e) {
      console.error('Failed to parse user data:', e);
    }
  }
});

// Disconnect on logout
window.addEventListener('storage', (e) => {
  if (e.key === 'accessToken' && !e.newValue) {
    // Token was removed (logout)
    notificationWebSocketClient.disconnect();
  }
});
