// ============================================================
// services/notificationService.ts
// Business logic for creating notifications from events
// ============================================================

import notificationModel from '../models/notificationModel';
import webSocketService from './webSocketService';

interface NotificationParams {
  userId: string;
  type: 'order' | 'escrow' | 'chat' | 'review' | 'alert';
  title: string;
  message?: string;
  link?: string;
}

class NotificationService {
  /**
   * Create a generic notification
   */
  async createNotification(params: NotificationParams): Promise<string> {
    const notifId = await notificationModel.create({
      userId: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
    });

    // Emit real-time notification via WebSocket
    const notification = {
      id: notifId,
      userId: params.userId,
      type: params.type,
      title: params.title,
      message: params.message,
      link: params.link,
      is_read: 0,
      created_at: new Date(),
    };

    webSocketService.emitNotificationToUser(params.userId, notification);

    return notifId;
  }

  /**
   * Notify seller of new order
   */
  async notifyOrderCreated(
    sellerId: string,
    orderId: string,
    buyerName: string,
    amount: number
  ): Promise<string> {
    return this.createNotification({
      userId: sellerId,
      type: 'order',
      title: `New order from ${buyerName}`,
      message: `Order #${orderId.substring(0, 8)} for ${amount.toLocaleString('vi-VN')} đ received`,
      link: `/seller/orders/${orderId}`,
    });
  }

  /**
   * Notify buyer of order status change
   */
  async notifyOrderStatusChange(params: {
    orderId: string;
    buyerId: string;
    sellerId: string;
    previousStatus: string;
    newStatus: string;
    productName: string;
    totalAmount: any;
  }): Promise<void> {
    const statusMessages: { [key: string]: string } = {
      pending: 'Your order is waiting for payment',
      paid: 'Payment confirmed! Your order is being prepared',
      shipped: 'Your order has been shipped!',
      delivered: 'Your order has been delivered',
      cancelled: 'Your order has been cancelled',
      completed: 'Order completed',
    };

    const message = statusMessages[params.newStatus] || `Order status updated to ${params.newStatus}`;

    // Notify buyer
    await this.createNotification({
      userId: params.buyerId,
      type: 'order',
      title: `Order #${params.orderId.substring(0, 8)} - ${params.newStatus}`,
      message,
      link: `/buyer/orders/${params.orderId}`,
    });

    // Notify seller if relevant
    if (['shipped', 'completed'].includes(params.newStatus)) {
      await this.createNotification({
        userId: params.sellerId,
        type: 'order',
        title: `Order #${params.orderId.substring(0, 8)} - ${params.newStatus}`,
        message: `Your order "${params.productName}" is now ${params.newStatus}`,
        link: `/seller/orders/${params.orderId}`,
      });
    }
  }

  /**
   * Notify seller when escrow is released
   */
  async notifyEscrowReleased(params: {
    orderId: string;
    sellerId: string;
    productName: string;
    amount: any;
  }): Promise<void> {
    const amount = typeof params.amount === 'string' ? parseFloat(params.amount) : params.amount;
    await this.createNotification({
      userId: params.sellerId,
      type: 'escrow',
      title: 'Escrow released',
      message: `${amount.toLocaleString('vi-VN')} đ from order #${params.orderId.substring(0, 8)} has been released to your wallet`,
      link: '/seller/wallet',
    });
  }

  /**
   * Notify buyer when escrow is refunded
   */
  async notifyEscrowRefunded(params: {
    orderId: string;
    buyerId: string;
    productName: string;
    amount: any;
    reason?: string;
  }): Promise<void> {
    const amount = typeof params.amount === 'string' ? parseFloat(params.amount) : params.amount;
    await this.createNotification({
      userId: params.buyerId,
      type: 'escrow',
      title: 'Refund processed',
      message: `${amount.toLocaleString('vi-VN')} đ from order #${params.orderId.substring(0, 8)} has been refunded to your wallet`,
      link: '/buyer/wallet',
    });
  }

  /**
   * Notify other party when a chat message is sent in dispute
   */
  async notifyChatMessage(params: {
    disputeId: string;
    otherUserId: string;
    senderId: string;
    senderName: string;
    message: string;
    orderId: string;
  }): Promise<void> {
    await this.createNotification({
      userId: params.otherUserId,
      type: 'chat',
      title: `${params.senderName} replied to dispute`,
      message: params.message.substring(0, 100),
      link: `/disputes/${params.disputeId}`,
    });
  }

  /**
   * Notify buyer when seller replies to review
   */
  async notifyReviewReply(
    buyerId: string,
    orderId: string
  ): Promise<string> {
    return this.createNotification({
      userId: buyerId,
      type: 'review',
      title: 'Seller replied to your review',
      message: 'Check out what the seller said about your feedback',
      link: `/buyer/reviews?orderId=${orderId}`,
    });
  }

  /**
   * Notify about dispute status change
   */
  async notifyDisputeResolved(
    userId: string,
    disputeId: string,
    resolution: string
  ): Promise<string> {
    const resolutionMessages: { [key: string]: string } = {
      refund_buyer: 'Dispute resolved in buyer favor. Refund issued.',
      release_seller: 'Dispute resolved in seller favor. Funds released.',
      reject: 'Dispute rejected.',
    };

    const message = resolutionMessages[resolution] || 'Dispute has been resolved';

    return this.createNotification({
      userId,
      type: 'alert',
      title: `Dispute #${disputeId.substring(0, 8)} resolved`,
      message,
      link: `/disputes/${disputeId}`,
    });
  }

  /**
   * Send alert notification (for important events)
   */
  async sendAlert(
    userId: string,
    title: string,
    message: string,
    link?: string
  ): Promise<string> {
    return this.createNotification({
      userId,
      type: 'alert',
      title,
      message,
      link,
    });
  }

  /**
   * Get all notifications for a user
   */
  async getNotifications(
    userId: string,
    limit: number = 10,
    offset: number = 0
  ) {
    const notifications = await notificationModel.getByUserId(userId, limit, offset);
    const unreadCount = await notificationModel.getUnreadCount(userId);
    const totalCount = await notificationModel.getTotalCount(userId);

    return {
      notifications,
      unreadCount,
      total: totalCount,
    };
  }

  /**
   * Get unread count
   */
  async getUnreadCount(userId: string): Promise<number> {
    return notificationModel.getUnreadCount(userId);
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string): Promise<boolean> {
    return notificationModel.markAsRead(notificationId);
  }

  /**
   * Mark all notifications as read
   */
  async markAllAsRead(userId: string): Promise<number> {
    return notificationModel.markAllAsRead(userId);
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string): Promise<boolean> {
    return notificationModel.delete(notificationId);
  }

  /**
   * Get recent unread for quick preview
   */
  async getRecentUnread(userId: string, limit: number = 5) {
    return notificationModel.getRecentUnread(userId, limit);
  }
}

export default new NotificationService();
