// ============================================================
// controllers/notificationController.ts
// Notification endpoints
// ============================================================

import { Request, Response, NextFunction } from 'express';
import notificationService from '../services/notificationService';
import notificationModel from '../models/notificationModel';

/**
 * GET /api/notifications
 * Fetch user's notifications (paginated)
 */
export const getNotifications = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User not found',
      });
    }

    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit as string) || 10));
    const offset = (page - 1) * limit;

    const result = await notificationService.getNotifications(userId, limit, offset);

    return res.status(200).json({
      success: true,
      message: 'Notifications retrieved successfully.',
      data: {
        notifications: result.notifications,
        unreadCount: result.unreadCount,
        total: result.total,
      },
      page,
      limit,
    });
  } catch (error) {
    console.error('[NotificationController] Error fetching notifications:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch notifications.',
      error: (error as any).message,
    });
  }
};

/**
 * GET /api/notifications/unread
 * Get unread count and recent unread notifications
 */
export const getUnreadNotifications = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User not found',
      });
    }

    const unreadCount = await notificationService.getUnreadCount(userId);
    const recentUnread = await notificationService.getRecentUnread(userId, 5);

    return res.status(200).json({
      success: true,
      message: 'Unread notifications retrieved successfully.',
      data: {
        unreadCount,
        recent: recentUnread,
      },
    });
  } catch (error) {
    console.error('[NotificationController] Error fetching unread:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to fetch unread notifications.',
      error: (error as any).message,
    });
  }
};

/**
 * PUT /api/notifications/:id/read
 * Mark a single notification as read
 */
export const markNotificationAsRead = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User not found',
      });
    }

    // Verify notification belongs to user
    const notification = await notificationModel.getById(id);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found.',
      });
    }

    if (notification.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to update this notification.',
      });
    }

    const success = await notificationService.markAsRead(id);

    if (!success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to mark notification as read.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Notification marked as read.',
    });
  } catch (error) {
    console.error('[NotificationController] Error marking as read:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark notification as read.',
      error: (error as any).message,
    });
  }
};

/**
 * PUT /api/notifications/read-all
 * Mark all notifications as read for user
 */
export const markAllAsRead = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User not found',
      });
    }

    const count = await notificationService.markAllAsRead(userId);

    return res.status(200).json({
      success: true,
      message: `${count} notification(s) marked as read.`,
      data: {
        markedCount: count,
      },
    });
  } catch (error) {
    console.error('[NotificationController] Error marking all as read:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to mark all notifications as read.',
      error: (error as any).message,
    });
  }
};

/**
 * DELETE /api/notifications/:id
 * Delete a notification
 */
export const deleteNotification = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const id = Array.isArray(req.params.id) ? req.params.id[0] : String(req.params.id);
    const userId = (req as any).user?.id;

    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User not found',
      });
    }

    // Verify notification belongs to user
    const notification = await notificationModel.getById(id);
    if (!notification) {
      return res.status(404).json({
        success: false,
        message: 'Notification not found.',
      });
    }

    if (notification.user_id !== userId) {
      return res.status(403).json({
        success: false,
        message: 'Not authorized to delete this notification.',
      });
    }

    const success = await notificationService.deleteNotification(id);

    if (!success) {
      return res.status(500).json({
        success: false,
        message: 'Failed to delete notification.',
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Notification deleted.',
    });
  } catch (error) {
    console.error('[NotificationController] Error deleting notification:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete notification.',
      error: (error as any).message,
    });
  }
};

/**
 * DELETE /api/notifications/delete-all
 * Delete all notifications for user
 */
export const deleteAllNotifications = async (
  req: Request,
  res: Response,
  next: NextFunction
): Promise<any> => {
  try {
    const userId = (req as any).user?.id;
    if (!userId) {
      return res.status(401).json({
        success: false,
        message: 'Unauthorized: User not found',
      });
    }

    // Optional: Require confirmation
    const { confirm } = req.body;
    if (!confirm) {
      return res.status(400).json({
        success: false,
        message: 'Confirmation required. Send { confirm: true } in body.',
      });
    }

    const count = await notificationModel.deleteAllByUserId(userId);

    return res.status(200).json({
      success: true,
      message: `${count} notification(s) deleted.`,
      data: {
        deletedCount: count,
      },
    });
  } catch (error) {
    console.error('[NotificationController] Error deleting all:', error);
    return res.status(500).json({
      success: false,
      message: 'Failed to delete all notifications.',
      error: (error as any).message,
    });
  }
};

export default {
  getNotifications,
  getUnreadNotifications,
  markNotificationAsRead,
  markAllAsRead,
  deleteNotification,
  deleteAllNotifications,
};
