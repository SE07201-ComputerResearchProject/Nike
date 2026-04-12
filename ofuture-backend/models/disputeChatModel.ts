import { RowDataPacket } from 'mysql2';
import { pool } from '../config/db';

export interface DisputeChat extends RowDataPacket {
  id: string;
  dispute_id: string;
  sender_id: string;
  message: string;
  attachments?: string[]; // JSON array of URLs
  is_read: number;
  created_at: string;
  updated_at: string;
}

export interface DisputeChatWithSender extends DisputeChat {
  sender_username?: string;
  sender_avatar?: string;
}

class DisputeChatModel {
  /**
   * Create a new chat message in a dispute
   */
  static async create(data: {
    dispute_id: string;
    sender_id: string;
    message: string;
    attachments?: string[];
  }): Promise<string> {
    const conn = await pool.getConnection();
    try {
      const query = `
        INSERT INTO dispute_chats 
        (dispute_id, sender_id, message, attachments, is_read)
        VALUES (?, ?, ?, ?, 0)
      `;
      const [result]: any = await conn.execute(query, [
        data.dispute_id,
        data.sender_id,
        data.message,
        data.attachments ? JSON.stringify(data.attachments) : null,
      ]);
      return result.insertId;
    } finally {
      conn.release();
    }
  }

  /**
   * Get chat message by ID
   */
  static async getById(id: string): Promise<DisputeChat | null> {
    const conn = await pool.getConnection();
    try {
      const query = 'SELECT * FROM dispute_chats WHERE id = ?';
      const [rows] = await conn.execute<DisputeChat[]>(query, [id]);
      return rows.length > 0 ? rows[0] : null;
    } finally {
      conn.release();
    }
  }

  /**
   * Get all chat messages for a dispute
   */
  static async getByDisputeId(
    disputeId: string,
    includeUserInfo: boolean = false
  ): Promise<DisputeChatWithSender[]> {
    const conn = await pool.getConnection();
    try {
      let query = `
        SELECT dc.*, 
               ${includeUserInfo ? 'u.username as sender_username, u.avatar_url as sender_avatar' : ''}
        FROM dispute_chats dc
        ${includeUserInfo ? 'JOIN users u ON dc.sender_id = u.id' : ''}
        WHERE dc.dispute_id = ?
        ORDER BY dc.created_at ASC
      `;
      const [rows] = await conn.execute<DisputeChatWithSender[]>(query, [disputeId]);
      return rows;
    } finally {
      conn.release();
    }
  }

  /**
   * Get unread messages for a user from a specific dispute
   */
  static async getUnreadByDispute(
    disputeId: string,
    userId: string
  ): Promise<DisputeChat[]> {
    const conn = await pool.getConnection();
    try {
      const query = `
        SELECT * FROM dispute_chats 
        WHERE dispute_id = ? AND sender_id != ? AND is_read = 0
        ORDER BY created_at ASC
      `;
      const [rows] = await conn.execute<DisputeChat[]>(query, [disputeId, userId]);
      return rows;
    } finally {
      conn.release();
    }
  }

  /**
   * Mark chat message as read
   */
  static async markAsRead(id: string): Promise<boolean> {
    const conn = await pool.getConnection();
    try {
      const query = 'UPDATE dispute_chats SET is_read = 1 WHERE id = ?';
      const [result]: any = await conn.execute(query, [id]);
      return result.affectedRows > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Mark all unread messages in a dispute as read
   */
  static async markDisputeAsRead(disputeId: string, userId: string): Promise<boolean> {
    const conn = await pool.getConnection();
    try {
      const query = `
        UPDATE dispute_chats 
        SET is_read = 1 
        WHERE dispute_id = ? AND sender_id != ? AND is_read = 0
      `;
      const [result]: any = await conn.execute(query, [disputeId, userId]);
      return result.affectedRows > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Update chat message
   */
  static async update(
    id: string,
    data: {
      message?: string;
      attachments?: string[];
    }
  ): Promise<boolean> {
    const conn = await pool.getConnection();
    try {
      const updates: string[] = [];
      const values: any[] = [];

      if (data.message !== undefined) {
        updates.push('message = ?');
        values.push(data.message);
      }
      if (data.attachments !== undefined) {
        updates.push('attachments = ?');
        values.push(data.attachments ? JSON.stringify(data.attachments) : null);
      }

      if (updates.length === 0) return true;

      values.push(id);
      const query = `UPDATE dispute_chats SET ${updates.join(', ')} WHERE id = ?`;
      const [result]: any = await conn.execute(query, values);
      return result.affectedRows > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Delete chat message
   */
  static async delete(id: string): Promise<boolean> {
    const conn = await pool.getConnection();
    try {
      const query = 'DELETE FROM dispute_chats WHERE id = ?';
      const [result]: any = await conn.execute(query, [id]);
      return result.affectedRows > 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Get message count for a dispute
   */
  static async getMessageCount(disputeId: string): Promise<number> {
    const conn = await pool.getConnection();
    try {
      const query = 'SELECT COUNT(*) as total FROM dispute_chats WHERE dispute_id = ?';
      const [rows]: any = await conn.execute(query, [disputeId]);
      return rows[0].total || 0;
    } finally {
      conn.release();
    }
  }

  /**
   * Paginated message retrieval
   */
  static async getByDisputeIdPaginated(
    disputeId: string,
    page: number = 1,
    limit: number = 20,
    includeUserInfo: boolean = false
  ): Promise<{ messages: DisputeChatWithSender[]; total: number }> {
    const conn = await pool.getConnection();
    try {
      const offset = (page - 1) * limit;

      let query = `
        SELECT dc.*, 
               ${includeUserInfo ? 'u.username as sender_username, u.avatar_url as sender_avatar' : ''}
        FROM dispute_chats dc
        ${includeUserInfo ? 'JOIN users u ON dc.sender_id = u.id' : ''}
        WHERE dc.dispute_id = ?
        ORDER BY dc.created_at ASC
        LIMIT ? OFFSET ?
      `;

      const [messages] = await conn.execute<DisputeChatWithSender[]>(query, [
        disputeId,
        limit,
        offset,
      ]);

      const countQuery = 'SELECT COUNT(*) as total FROM dispute_chats WHERE dispute_id = ?';
      const [countResult]: any = await conn.execute(countQuery, [disputeId]);

      return {
        messages,
        total: countResult[0].total || 0,
      };
    } finally {
      conn.release();
    }
  }
}

export default DisputeChatModel;
