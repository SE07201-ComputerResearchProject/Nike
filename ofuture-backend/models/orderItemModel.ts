// models/orderItemModel.ts
// ─────────────────────────────────────────────
// Order Item Model — Multi-item order support
// Each row represents one product in an order
// ─────────────────────────────────────────────

import { pool } from '../config/db';

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  quantity: number;
  unit_price: number;
  subtotal: number;
  created_at: Date;
  updated_at: Date;
}

/**
 * Create a new order item
 */
const create = async (
  order_id: string,
  product_id: string,
  quantity: number,
  unit_price: number
): Promise<string> => {
  const id = require('crypto').randomUUID();
  const subtotal = quantity * unit_price;

  await pool.execute(
    `INSERT INTO order_items (id, order_id, product_id, quantity, unit_price, subtotal)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [id, order_id, product_id, quantity, unit_price, subtotal]
  );

  return id;
};

/**
 * Get order items by order ID
 */
const getByOrderId = async (order_id: string): Promise<OrderItem[]> => {
  const [rows]: any = await pool.execute(
    `SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at ASC`,
    [order_id]
  );
  return rows || [];
};

/**
 * Get single order item by ID
 */
const getById = async (id: string): Promise<OrderItem | null> => {
  const [rows]: any = await pool.execute(
    `SELECT * FROM order_items WHERE id = ? LIMIT 1`,
    [id]
  );
  return rows[0] || null;
};

/**
 * Update order item quantity and recalculate subtotal
 */
const update = async (id: string, quantity: number): Promise<void> => {
  // Get current item to get unit_price
  const item = await getById(id);
  if (!item) throw new Error('Order item not found');

  const subtotal = quantity * item.unit_price;

  await pool.execute(
    `UPDATE order_items SET quantity = ?, subtotal = ?, updated_at = NOW() WHERE id = ?`,
    [quantity, subtotal, id]
  );
};

/**
 * Delete order item
 */
const delete_item = async (id: string): Promise<void> => {
  await pool.execute(`DELETE FROM order_items WHERE id = ?`, [id]);
};

/**
 * Delete all items for an order
 */
const deleteByOrderId = async (order_id: string): Promise<number> => {
  const [result]: any = await pool.execute(
    `DELETE FROM order_items WHERE order_id = ?`,
    [order_id]
  );
  return result.affectedRows || 0;
};

/**
 * Calculate total amount for an order (sum of all subtotals)
 */
const calculateOrderTotal = async (order_id: string): Promise<number> => {
  const [rows]: any = await pool.execute(
    `SELECT SUM(subtotal) as total FROM order_items WHERE order_id = ?`,
    [order_id]
  );
  return parseFloat(rows[0]?.total) || 0;
};

/**
 * Get order items with product details
 */
const getWithProducts = async (order_id: string): Promise<any[]> => {
  const [rows]: any = await pool.execute(
    `SELECT 
       oi.id,
       oi.quantity,
       oi.unit_price,
       oi.subtotal,
       oi.created_at,
       p.id as product_id,
       p.name as product_name,
       p.slug as product_slug,
       p.image_urls,
       p.category,
       u.username as seller_username
     FROM order_items oi
     JOIN products p ON oi.product_id = p.id
     LEFT JOIN users u ON p.seller_id = u.id
     WHERE oi.order_id = ?
     ORDER BY oi.created_at ASC`,
    [order_id]
  );
  return rows || [];
};

export default {
  create,
  getByOrderId,
  getById,
  update,
  delete: delete_item,
  deleteByOrderId,
  calculateOrderTotal,
  getWithProducts,
};
