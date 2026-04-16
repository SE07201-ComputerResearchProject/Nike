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
         o.id, o.buyer_id, o.seller_id,
         (SELECT product_id FROM order_items WHERE order_id = o.id LIMIT 1) AS product_id,
         (SELECT SUM(quantity) FROM order_items WHERE order_id = o.id) AS quantity,
         (SELECT unit_price FROM order_items WHERE order_id = o.id LIMIT 1) AS unit_price,
         o.final_total_amount as total_amount,
         o.status, o.shipping_address, o.notes,
         o.cancelled_at, o.completed_at,
         o.created_at, o.updated_at,
         b.username  AS buyer_username,
         b.email     AS buyer_email,
         s.username  AS seller_username,
         (SELECT p.name FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = o.id LIMIT 1) AS product_name,
         e.status    AS escrow_status,
         e.amount    AS escrow_amount
       FROM orders o
       JOIN users    b ON b.id = o.buyer_id
       JOIN users    s ON s.id = o.seller_id
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
         o.id, o.status,
         (SELECT SUM(quantity) FROM order_items WHERE order_id = o.id) AS quantity,
         (SELECT unit_price FROM order_items WHERE order_id = o.id LIMIT 1) AS unit_price,
         o.final_total_amount as total_amount,
         o.created_at,
         (SELECT p.name FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = o.id LIMIT 1) AS product_name,
         (SELECT p.image_urls FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = o.id LIMIT 1) AS image_urls,
         (SELECT product_id FROM order_items WHERE order_id = o.id LIMIT 1) AS product_id,
         s.username AS seller_username
       FROM orders o
       JOIN users s ON s.id = o.seller_id
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
         o.id, o.status,
         (SELECT SUM(quantity) FROM order_items WHERE order_id = o.id) AS quantity,
         (SELECT unit_price FROM order_items WHERE order_id = o.id LIMIT 1) AS unit_price,
         o.final_total_amount as total_amount,
         o.created_at,
         (SELECT p.name FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = o.id LIMIT 1) AS product_name,
         b.username AS buyer_username
       FROM orders o
       JOIN users b ON b.id = o.buyer_id
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
         o.id, o.status, o.final_total_amount as total_amount, o.created_at,
         b.username AS buyer,
         s.username AS seller,
         (SELECT p.name FROM order_items oi JOIN products p ON oi.product_id = p.id WHERE oi.order_id = o.id LIMIT 1) AS product
       FROM orders o
       JOIN users b ON b.id = o.buyer_id
       JOIN users s ON s.id = o.seller_id
       ${where}
       ORDER BY o.created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );
    return rows;
  },
};

export = OrderModel;