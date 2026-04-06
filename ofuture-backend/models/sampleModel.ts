import { pool } from '../config/db';
import crypto from 'crypto';

export interface SampleRequestData {
  product_id: string;
  buyer_id: string;
  seller_id: string;
  deposit_amount: number;
  notes?: string;
}

export class SampleModel {
  /**
   * 1. Tạo mới một yêu cầu hàng mẫu
   */
  static async create(data: SampleRequestData): Promise<string> {
    // Tạo UUID trực tiếp từ Node.js để có thể trả về ngay ID cho controller
    const id = crypto.randomUUID();
    
    await pool.execute(
      `INSERT INTO sample_requests 
        (id, product_id, buyer_id, seller_id, deposit_amount, notes)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        id,
        data.product_id,
        data.buyer_id,
        data.seller_id,
        data.deposit_amount,
        data.notes || null
      ]
    );
    return id;
  }

  /**
   * 2. Lấy chi tiết một yêu cầu mẫu theo ID
   */
  static async findById(id: string): Promise<any> {
    const [rows]: any = await pool.execute(
      `SELECT s.*,
              p.name        AS product_name,
              p.price       AS wholesale_price,
              u.full_name   AS buyer_name,
              seller.full_name AS seller_name
       FROM sample_requests s
       JOIN products p      ON s.product_id = p.id
       JOIN users u         ON s.buyer_id   = u.id
       JOIN users seller    ON s.seller_id  = seller.id
       WHERE s.id = ?`,
      [id]
    );
    return rows[0] || null;
  }

  /**
   * 3. Lấy danh sách yêu cầu mẫu dành cho Người Mua (Buyer)
   */
  static async findByBuyer(
    buyerId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<any[]> {
    const [rows]: any = await pool.execute(
      `SELECT s.*, p.name AS product_name, seller.full_name AS seller_name
       FROM sample_requests s
       JOIN products p   ON s.product_id = p.id
       JOIN users seller ON s.seller_id  = seller.id
       WHERE s.buyer_id = ?
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`,
      [buyerId, limit.toString(), offset.toString()]
    );
    return rows;
  }

  /**
   * 4. Lấy danh sách yêu cầu mẫu dành cho Người Bán (Seller)
   */
  static async findBySeller(
    sellerId: string,
    limit: number = 20,
    offset: number = 0
  ): Promise<any[]> {
    const [rows]: any = await pool.execute(
      `SELECT s.*, p.name AS product_name, u.full_name AS buyer_name
       FROM sample_requests s
       JOIN products p ON s.product_id = p.id
       JOIN users u    ON s.buyer_id   = u.id
       WHERE s.seller_id = ?
       ORDER BY s.created_at DESC
       LIMIT ? OFFSET ?`,
      [sellerId, limit.toString(), offset.toString()]
    );
    return rows;
  }

  /**
   * 5. Cập nhật trạng thái của yêu cầu mẫu (Duyệt, Hủy, Trả hàng, Chuyển đơn)
   */
  static async updateStatus(id: string, newStatus: string): Promise<boolean> {
    const [result]: any = await pool.execute(
      `UPDATE sample_requests SET status = ? WHERE id = ?`,
      [newStatus, id]
    );
    return result.affectedRows > 0;
  }
}