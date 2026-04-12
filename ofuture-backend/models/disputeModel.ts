// models/disputeModel.ts
import { pool } from '../config/db';
import crypto from 'crypto';

export interface DisputeData {
  order_id: string;
  complainant_id: string;
  reason: string;
  evidence_urls?: string[]; // NEW: JSON array instead of single URL
}

export class DisputeModel {
  /**
   * 1. Create new dispute
   */
  static async create(data: DisputeData, conn: any = null): Promise<string> {
    const db = conn ?? pool;
    const id = crypto.randomUUID();
    
    await db.execute(
      `INSERT INTO disputes 
        (id, order_id, complainant_id, reason, evidence_urls)
       VALUES (?, ?, ?, ?, ?)`,
      [
        id,
        data.order_id,
        data.complainant_id,
        data.reason,
        data.evidence_urls ? JSON.stringify(data.evidence_urls) : null
      ]
    );
    return id;
  }

  /**
   * 2. Get dispute details by ID
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
    
    if (rows.length > 0 && rows[0].evidence_urls && typeof rows[0].evidence_urls === 'string') {
      rows[0].evidence_urls = JSON.parse(rows[0].evidence_urls);
    }
    
    return rows[0] || null;
  }

  /**
   * 3. Get disputes by user (Buyer)
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
   * 4. Admin get all disputes with status filter
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
   * 5. Admin update dispute status
   */
  static async updateStatus(
    id: string, 
    newStatus: string, 
    resolvedBy?: string, 
    resolutionNote?: string, 
    conn: any = null
  ): Promise<boolean> {
    const db = conn ?? pool;
    const [result]: any = await db.execute(
      `UPDATE disputes 
       SET status = ?, resolved_at = NOW(), resolved_by = ?, resolution_note = ?
       WHERE id = ?`,
      [newStatus, resolvedBy || null, resolutionNote || null, id]
    );
    return result.affectedRows > 0;
  }

  /**
   * Add evidence URL to dispute
   */
  static async addEvidenceUrl(id: string, url: string): Promise<boolean> {
    const [rows]: any = await pool.execute('SELECT evidence_urls FROM disputes WHERE id = ?', [id]);
    
    if (rows.length === 0) return false;

    let urls: string[] = [];
    if (rows[0].evidence_urls) {
      urls = JSON.parse(rows[0].evidence_urls);
    }

    urls.push(url);

    const [result]: any = await pool.execute(
      'UPDATE disputes SET evidence_urls = ? WHERE id = ?',
      [JSON.stringify(urls), id]
    );

    return result.affectedRows > 0;
  }

  /**
   * Remove evidence URL from dispute
   */
  static async removeEvidenceUrl(id: string, url: string): Promise<boolean> {
    const [rows]: any = await pool.execute('SELECT evidence_urls FROM disputes WHERE id = ?', [id]);
    
    if (rows.length === 0) return false;

    let urls: string[] = [];
    if (rows[0].evidence_urls) {
      urls = JSON.parse(rows[0].evidence_urls);
    }

    urls = urls.filter((u) => u !== url);

    const [result]: any = await pool.execute(
      'UPDATE disputes SET evidence_urls = ? WHERE id = ?',
      [JSON.stringify(urls), id]
    );

    return result.affectedRows > 0;
  }
}