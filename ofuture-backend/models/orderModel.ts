// models/orderModel.ts
// ─────────────────────────────────────────────
// Data-access layer for the orders table.
// ─────────────────────────────────────────────

import { pool } from '../config/db';

interface CreateOrderParams {
  buyerId: string;
  sellerId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  totalAmount: number;
  shippingAddress?: any;
  notes?: string;
}

const OrderModel = {
  async create({ buyerId, sellerId, productId, quantity, unitPrice,
                 totalAmount, shippingAddress, notes }: CreateOrderParams, conn: any = null) {
    const db = conn ?? pool;
    const [result]: any = await db.execute(
      `INSERT INTO orders
         (buyer_id, seller_id, product_id, quantity, unit_price,
          total_amount, shipping_address, notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [buyerId, sellerId, productId, quantity, unitPrice, totalAmount,
       shippingAddress ? JSON.stringify(shippingAddress) : null, notes ?? null]
    );
    return result;
  },

  async findById(id: string) {
    const [rows]: any = await pool.execute(
      `SELECT
         o.id, o.buyer_id, o.seller_id, o.product_id,
         o.quantity, o.unit_price, o.total_amount,
         o.status, o.shipping_address, o.notes,
         o.cancelled_at, o.completed_at,
         o.created_at, o.updated_at,
         b.username  AS buyer_username,
         b.email     AS buyer_email,
         s.username  AS seller_username,
         p.name      AS product_name,
         e.status    AS escrow_status,
         e.amount    AS escrow_amount
       FROM orders o
       JOIN users    b ON b.id = o.buyer_id
       JOIN users    s ON s.id = o.seller_id
       JOIN products p ON p.id = o.product_id
       LEFT JOIN escrow_transactions e ON e.order_id = o.id
       WHERE o.id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  },

  async findByBuyer(buyerId: string, { page = 1, limit = 20, status }: { page?: number, limit?: number, status?: string } = {}) {
    const offset = (page - 1) * limit;
    const conditions = ['o.buyer_id = ?'];
    const params: any[] = [buyerId];
    if (status) { conditions.push('o.status = ?'); params.push(status); }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const [rows]: any = await pool.execute(
      `SELECT
         o.id, o.status, o.quantity, o.unit_price, o.total_amount,
         o.created_at,
         p.name AS product_name,
         p.id   AS product_id,
         s.username AS seller_username
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN users    s ON s.id = o.seller_id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return rows;
  },

  async findBySeller(sellerId: string, { page = 1, limit = 20, status }: { page?: number, limit?: number, status?: string } = {}) {
    const offset = (page - 1) * limit;
    const conditions = ['o.seller_id = ?'];
    const params: any[] = [sellerId];
    if (status) { conditions.push('o.status = ?'); params.push(status); }

    const where = `WHERE ${conditions.join(' AND ')}`;
    const [rows]: any = await pool.execute(
      `SELECT
         o.id, o.status, o.quantity, o.unit_price, o.total_amount,
         o.created_at,
         p.name AS product_name,
         b.username AS buyer_username
       FROM orders o
       JOIN products p ON p.id = o.product_id
       JOIN users    b ON b.id = o.buyer_id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return rows;
  },

  async updateStatus(id: string, status: string, extra: any = {}, conn: any = null) {
    const db = conn ?? pool;
    const fields = ['status = ?'];
    const params: any[] = [status];

    if (status === 'cancelled') { fields.push('cancelled_at = NOW()'); }
    if (status === 'completed') { fields.push('completed_at = NOW()'); }
    if (extra.notes) { fields.push('notes = ?'); params.push(extra.notes); }

    params.push(id);
    const [result]: any = await db.execute(
      `UPDATE orders SET ${fields.join(', ')} WHERE id = ?`,
      params
    );
    return result;
  },

  async adminListAll({ page = 1, limit = 20, status }: { page?: number, limit?: number, status?: string } = {}) {
    const offset = (page - 1) * limit;
    const params: any[] = [];
    const where  = status ? 'WHERE o.status = ?' : '';
    if (status) params.push(status);

    const [rows]: any = await pool.execute(
      `SELECT
         o.id, o.status, o.total_amount, o.created_at,
         b.username AS buyer,
         s.username AS seller,
         p.name     AS product
       FROM orders o
       JOIN users    b ON b.id = o.buyer_id
       JOIN users    s ON s.id = o.seller_id
       JOIN products p ON p.id = o.product_id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return rows;
  },
};

export = OrderModel;