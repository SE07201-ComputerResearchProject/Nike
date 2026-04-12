// ============================================================
// Notifications System - Frontend Implementation
// ============================================================

class NotificationManager {
  constructor() {
    this.notifications = [];
    this.unreadCount = 0;
    this.isDropdownOpen = false;
    this.pollInterval = null;
  }

  /**
   * Initialize notification system
   */
  async init() {
    await this.loadNotifications();
    this.setupDropdown();
    this.setupPolling();
  }

  /**
   * Fetch notifications from API
   */
  async loadNotifications() {
    try {
      const response = await fetchAPI('/notifications?limit=10&page=1');
      if (response.success) {
        this.notifications = response.data.notifications || [];
        this.unreadCount = response.data.unreadCount || 0;
        this.updateBadge();
      }
    } catch (error) {
      console.error('Failed to load notifications:', error);
    }
  }

  /**
   * Get unread count
   */
  async getUnreadCount() {
    try {
      const response = await fetchAPI('/notifications/unread');
      if (response.success) {
        this.unreadCount = response.data.unreadCount || 0;
        this.updateBadge();
      }
    } catch (error) {
      console.error('Failed to get unread count:', error);
    }
  }

  /**
   * Update badge display
   */
  updateBadge() {
    const badge = document.getElementById('notificationBadge');
    if (badge) {
      if (this.unreadCount > 0) {
        badge.textContent = this.unreadCount > 99 ? '99+' : this.unreadCount;
        badge.style.display = 'flex';
      } else {
        badge.style.display = 'none';
      }
    }
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId) {
    try {
      const response = await fetchAPI(`/notifications/${notificationId}/read`, {
        method: 'PUT',
        body: JSON.stringify({}),
      });
      if (response.success) {
        await this.loadNotifications();
      }
    } catch (error) {
      console.error('Failed to mark notification as read:', error);
    }
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead() {
    try {
      const response = await fetchAPI('/notifications/read-all', {
        method: 'PUT',
        body: JSON.stringify({}),
      });
      if (response.success) {
        await this.loadNotifications();
        this.renderDropdown();
      }
    } catch (error) {
      console.error('Failed to mark all as read:', error);
    }
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId) {
    try {
      const response = await fetchAPI(`/notifications/${notificationId}`, {
        method: 'DELETE',
      });
      if (response.success) {
        await this.loadNotifications();
        this.renderDropdown();
      }
    } catch (error) {
      console.error('Failed to delete notification:', error);
    }
  }

  /**
   * Setup dropdown toggle and event listeners
   */
  setupDropdown() {
    const bell = document.getElementById('notificationBell');
    const dropdown = document.getElementById('notificationDropdown');

    if (bell) {
      bell.addEventListener('click', (e) => {
        e.stopPropagation();
        this.isDropdownOpen = !this.isDropdownOpen;
        if (this.isDropdownOpen) {
          this.loadNotifications().then(() => this.renderDropdown());
          dropdown.style.display = 'block';
        } else {
          dropdown.style.display = 'none';
        }
      });
    }

    // Close dropdown when clicking outside
    document.addEventListener('click', () => {
      if (this.isDropdownOpen && dropdown) {
        this.isDropdownOpen = false;
        dropdown.style.display = 'none';
      }
    });

    // Prevent closing when clicking inside dropdown
    if (dropdown) {
      dropdown.addEventListener('click', (e) => {
        e.stopPropagation();
      });
    }
  }

  /**
   * Render notification dropdown
   */
  renderDropdown() {
    const dropdown = document.getElementById('notificationDropdown');
    if (!dropdown) return;

    if (this.notifications.length === 0) {
      dropdown.innerHTML = `
        <div class="notification-empty">
          <p>Không có thông báo</p>
        </div>
      `;
      return;
    }

    let html = `
      <div class="notification-list">
    `;

    this.notifications.slice(0, 10).forEach((notif) => {
      const isUnread = notif.is_read === 0 ? 'unread' : '';
      const notifTypeIcon = this.getNotificationIcon(notif.type);

      html += `
        <div class="notification-item ${isUnread}" data-id="${notif.id}">
          <div class="notification-icon">${notifTypeIcon}</div>
          <div class="notification-content">
            <p class="notification-title">${notif.title}</p>
            <p class="notification-message">${notif.message || ''}</p>
            <span class="notification-time">${this.formatTime(notif.created_at)}</span>
          </div>
          <button class="notification-delete" data-id="${notif.id}" onclick="notificationManager.deleteNotification('${notif.id}')">✕</button>
        </div>
      `;
    });

    html += `
      <div class="notification-footer">
        <button class="btn-small" onclick="notificationManager.markAllAsRead()">Đánh dấu tất cả đã đọc</button>
        <a href="#notifications" class="btn-small-link">Xem tất cả</a>
      </div>
      </div>
    `;

    dropdown.innerHTML = html;

    // Add click handlers for unread items
    dropdown.querySelectorAll('.notification-item.unread').forEach((item) => {
      item.addEventListener('click', () => {
        const notifId = item.dataset.id;
        this.markAsRead(notifId);
      });
    });
  }

  /**
   * Get notification icon by type
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
   * Format time display
   */
  formatTime(createdAt) {
    const date = new Date(createdAt);
    const now = new Date();
    const diffMs = now - date;
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return 'Vừa xong';
    if (diffMins < 60) return `${diffMins}p trước`;
    if (diffHours < 24) return `${diffHours}h trước`;
    if (diffDays < 7) return `${diffDays}d trước`;

    return date.toLocaleDateString('vi-VN');
  }

    /**
   * Setup polling for new notifications
   * - Uses longer interval for sellers, short for buyers
   * - Backoff on 429 responses
   * - Stops polling when WebSocket becomes active
   */
  setupPolling() {
    // Prevent duplicate pollers
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    if (this.pollChecker) {
      clearInterval(this.pollChecker);
      this.pollChecker = null;
    }

    // If WebSocket is connected, skip polling entirely
    if (typeof notificationWebSocketClient !== 'undefined' && notificationWebSocketClient.isConnectedStatus()) {
      console.log('WebSocket active - skipping notifications polling');
      return;
    }

    // Determine base delay (sellers get longer interval to avoid rate limits)
    let defaultDelay = 5000; // buyer default
    try {
      const user = JSON.parse(localStorage.getItem('user') || '{}');
      if (user && user.role === 'seller') defaultDelay = 30000; // 30s for sellers
    } catch (e) {
      // ignore and use default
    }

    this.pollDelay = defaultDelay;

    const startInterval = () => {
      // clear existing
      if (this.pollInterval) {
        clearInterval(this.pollInterval);
        this.pollInterval = null;
      }

      this.pollInterval = setInterval(async () => {
        // If WS became available, stop polling
        if (typeof notificationWebSocketClient !== 'undefined' && notificationWebSocketClient.isConnectedStatus()) {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
          console.log('WebSocket connected - stopped polling');
          return;
        }

        try {
          await this.getUnreadCount();
          // success => reset backoff to default
          this.pollDelay = defaultDelay;
        } catch (err) {
          const msg = (err && err.message) ? err.message : '';
          if (msg.includes('429')) {
            // exponential backoff on rate limit
            this.pollDelay = Math.min(this.pollDelay * 2, 60000); // cap at 60s
            console.warn('Notifications polling hit 429. Backing off to', this.pollDelay);
            // restart interval with new delay
            startInterval();
          } else {
            console.error('Notifications polling error:', err);
          }
        }
      }, this.pollDelay);
    };

    startInterval();

    // Stop polling if tab is hidden and resume when visible
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.pollInterval) {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
        }
      } else {
        // Re-init polling only if WS not connected
        if (!(typeof notificationWebSocketClient !== 'undefined' && notificationWebSocketClient.isConnectedStatus())) {
          this.setupPolling();
        }
      }
    });

    // Periodically check if WebSocket becomes connected; stop polling if it does
    this.pollChecker = setInterval(() => {
      if (typeof notificationWebSocketClient !== 'undefined' && notificationWebSocketClient.isConnectedStatus()) {
        if (this.pollInterval) {
          clearInterval(this.pollInterval);
          this.pollInterval = null;
        }
        clearInterval(this.pollChecker);
        this.pollChecker = null;
        console.log('WebSocket connected (checker) - stopped polling');
      }
    }, 3000);
  }, 5000);

    // Stop polling if tab is hidden
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        clearInterval(this.pollInterval);
      } else {
        this.setupPolling();
      }
    });
  }
}

// Initialize notification manager globally
const notificationManager = new NotificationManager();

// Auto-initialize when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  notificationManager.init();
});

