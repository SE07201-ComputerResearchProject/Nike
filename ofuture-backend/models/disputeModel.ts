// models/disputeModel.ts
import { pool } from '../config/db';
import crypto from 'crypto';

export interface DisputeData {
  order_id: string;
  complainant_id: string;
  reason: string;
  evidence_url?: string;
}

export class DisputeModel {
  /**
   * 1. Tạo mới một khiếu nại
   */
  static async create(data: DisputeData, conn: any = null): Promise<string> {
    const db = conn ?? pool;
    const id = crypto.randomUUID();
    
    await db.execute(
      `INSERT INTO disputes 
        (id, order_id, complainant_id, reason, evidence_url)
       VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        data.order_id,
        data.complainant_id,
        data.reason,
        data.evidence_url || null
      ]
    );
    return id;
  }

  /**
   * 2. Lấy chi tiết một khiếu nại theo ID
   */
  static async findById(id: string): Promise<any> {
    const [rows]: any = await pool.execute(
      `SELECT d.*, 
              o.total_amount, o.seller_id,
              b.username as complainant_name,
              s.username as seller_name
       FROM disputes d
       JOIN orders o ON d.order_id = o.id
       JOIN users b ON d.complainant_id = b.id
       JOIN users s ON o.seller_id = s.id
       WHERE d.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * 3. Lấy danh sách khiếu nại của một người dùng (Buyer)
   */
  static async findByUser(userId: string, limit: number = 20, offset: number = 0): Promise<any[]> {
    const [rows]: any = await pool.execute(
      `SELECT d.id, d.order_id, d.reason, d.status, d.created_at, o.total_amount
       FROM disputes d
       JOIN orders o ON d.order_id = o.id
       WHERE d.complainant_id = ?
       ORDER BY d.created_at DESC
       LIMIT ? OFFSET ?`,
      [userId, limit.toString(), offset.toString()]
    );
    return rows;
  }

  /**
   * 4. Admin lấy toàn bộ danh sách khiếu nại (có filter theo trạng thái)
   */
  static async adminListAll(status?: string, limit: number = 20, offset: number = 0): Promise<any[]> {
    let query = `
       SELECT d.id, d.order_id, d.status, d.created_at, 
              u.username as complainant, o.total_amount
       FROM disputes d
       JOIN users u ON d.complainant_id = u.id
       JOIN orders o ON d.order_id = o.id
    `;
    const params: any[] = [];

    if (status) {
      query += ` WHERE d.status = ?`;
      params.push(status);
    }

    query += ` ORDER BY d.created_at DESC LIMIT ? OFFSET ?`;
    params.push(limit.toString(), offset.toString());

    const [rows]: any = await pool.execute(query, params);
    return rows;
  }

  /**
   * 5. Admin cập nhật trạng thái khiếu nại (Xử lý xong)
   */
  static async updateStatus(id: string, newStatus: string, conn: any = null): Promise<boolean> {
    const db = conn ?? pool;
    const [result]: any = await db.execute(
      `UPDATE disputes 
       SET status = ?, resolved_at = NOW() 
       WHERE id = ?`,
      [newStatus, id]
    );
    return result.affectedRows > 0;
  }
}