// ============================================================
// models/notificationModel.ts
// Notification data operations
// ============================================================

import { v4 as uuidv4 } from 'uuid';
import { pool } from '../config/db';
import { RowDataPacket } from 'mysql2';

export interface NotificationData extends RowDataPacket {
  id: string;
  user_id: string;
  type: string;
  title: string;
  message?: string;
  link?: string;
  is_read: number;
  created_at: string;
  updated_at: string;
}

interface CreateNotificationParams {
  userId: string;
  type: string;
  title: string;
  message?: string;
  link?: string;
}

class NotificationModel {
  /**
   * Create a new notification
   */
  async create(params: CreateNotificationParams): Promise<string> {
    const id = uuidv4();
    const { userId, type, title, message, link } = params;

    const query = `
      INSERT INTO notifications
        (id, user_id, type, title, message, link, is_read, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, 0, NOW(), NOW())
    `;

    const conn = await pool.getConnection();
    try {
      await conn.execute(query, [id, userId, type, title, message || null, link || null]);
      return id;
    } finally {
      conn.release();
    }
  }

  /**
   * Get notifications for a user (paginated, most recent first)
   */
  async getByUserId(
    userId: string,
    limit: number = 10,
    offset: number = 0
  ): Promise<NotificationData[]> {
    const query = `
      SELECT
        id, user_id, type, title, message, link, is_read,
        created_at, updated_at
      FROM notifications
      WHERE user_id = ?
      ORDER BY created_at DESC
      LIMIT ? OFFSET ?
    `;

    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute<NotificationData[]>(query, [userId, limit, offset]);
      return rows;
    } finally {
      conn.release();
    }
  }

  /**
   * Get unread notification count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM notifications
      WHERE user_id = ? AND is_read = 0
    `;

    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute<RowDataPacket[]>(query, [userId]);
      return rows[0]?.count || 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Get a single notification by ID
   */
  async getById(id: string): Promise<NotificationData | null> {
    const query = `
      SELECT
        id, user_id, type, title, message, link, is_read,
        created_at, updated_at
      FROM notifications
      WHERE id = ?
    `;

    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute<NotificationData[]>(query, [id]);
      return rows[0] || null;
    } finally {
      conn.release();
    }
  }

  /**
   * Mark a notification as read
   */
  async markAsRead(id: string): Promise<boolean> {
    const query = `
      UPDATE notifications
      SET is_read = 1, updated_at = NOW()
      WHERE id = ?
    `;

    const conn = await pool.getConnection();
    try {
      const [result] = await conn.execute(query, [id]);
      return (result as any).affectedRows > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Mark all notifications for a user as read
   */
  async markAllAsRead(userId: string): Promise<number> {
    const query = `
      UPDATE notifications
      SET is_read = 1, updated_at = NOW()
      WHERE user_id = ? AND is_read = 0
    `;

    const conn = await pool.getConnection();
    try {
      const [result] = await conn.execute(query, [userId]);
      return (result as any).affectedRows;
    } finally {
      conn.release();
    }
  }

  /**
   * Delete a notification
   */
  async delete(id: string): Promise<boolean> {
    const query = `
      DELETE FROM notifications
      WHERE id = ?
    `;

    const conn = await pool.getConnection();
    try {
      const [result] = await conn.execute(query, [id]);
      return (result as any).affectedRows > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Delete all notifications for a user
   */
  async deleteAllByUserId(userId: string): Promise<number> {
    const query = `
      DELETE FROM notifications
      WHERE user_id = ?
    `;

    const conn = await pool.getConnection();
    try {
      const [result] = await conn.execute(query, [userId]);
      return (result as any).affectedRows;
    } finally {
      conn.release();
    }
  }

  /**
   * Get total count of notifications for a user
   */
  async getTotalCount(userId: string): Promise<number> {
    const query = `
      SELECT COUNT(*) as count
      FROM notifications
      WHERE user_id = ?
    `;

    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute<RowDataPacket[]>(query, [userId]);
      return rows[0]?.count || 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Get recent unread notifications (for quick preview)
   */
  async getRecentUnread(userId: string, limit: number = 5): Promise<NotificationData[]> {
    const query = `
      SELECT
        id, user_id, type, title, message, link, is_read,
        created_at, updated_at
      FROM notifications
      WHERE user_id = ? AND is_read = 0
      ORDER BY created_at DESC
      LIMIT ?
    `;

    const conn = await pool.getConnection();
    try {
      const [rows] = await conn.execute<NotificationData[]>(query, [userId, limit]);
      return rows;
    } finally {
      conn.release();
    }
  }
}

export default new NotificationModel();
