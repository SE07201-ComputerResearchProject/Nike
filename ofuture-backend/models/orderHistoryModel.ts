// models/orderHistoryModel.ts
// ─────────────────────────────────────────────
// Order History Model — Order status change audit trail
// Track all state transitions with timestamps
// ─────────────────────────────────────────────

import { pool } from '../config/db';

export interface OrderHistory {
  id: string;
  order_id: string;
  status: 'pending' | 'paid' | 'shipped' | 'completed' | 'cancelled' | 'refunded';
  reason?: string;
  created_by?: string;
  created_at: Date;
}

/**
 * Record a status change in history
 */
const record = async (
  order_id: string,
  status: string,
  reason?: string,
  created_by?: string
): Promise<string> => {
  const id = require('crypto').randomUUID();

  await pool.execute(
    `INSERT INTO order_histories (id, order_id, status, reason, created_by)
     VALUES (?, ?, ?, ?, ?)`,
    [id, order_id, status, reason || null, created_by || null]
  );

  return id;
};

/**
 * Get full history for an order
 */
const getByOrderId = async (order_id: string): Promise<OrderHistory[]> => {
  const [rows]: any = await pool.execute(
    `SELECT * FROM order_histories WHERE order_id = ? ORDER BY created_at ASC`,
    [order_id]
  );
  return rows || [];
};

/**
 * Get last status change for an order
 */
const getLatest = async (order_id: string): Promise<OrderHistory | null> => {
  const [rows]: any = await pool.execute(
    `SELECT * FROM order_histories WHERE order_id = ? ORDER BY created_at DESC LIMIT 1`,
    [order_id]
  );
  return rows[0] || null;
};

/**
 * Get history with user information
 */
const getWithUsers = async (order_id: string): Promise<any[]> => {
  const [rows]: any = await pool.execute(
    `SELECT 
       oh.id,
       oh.status,
       oh.reason,
       oh.created_at,
       u.id as user_id,
       u.username,
       u.full_name,
       u.role
     FROM order_histories oh
     LEFT JOIN users u ON oh.created_by = u.id
     WHERE oh.order_id = ?
     ORDER BY oh.created_at ASC`,
    [order_id]
  );
  return rows || [];
};

/**
 * Get order status transition timeline
 */
const getTimeline = async (order_id: string): Promise<any[]> => {
  const [rows]: any = await pool.execute(
    `SELECT 
       status,
       reason,
       created_at,
       TIMEDIFF(
         (SELECT created_at FROM order_histories oh2 
          WHERE oh2.order_id = ? AND oh2.created_at > oh1.created_at 
          LIMIT 1),
         created_at
       ) as time_in_status
     FROM order_histories oh1
     WHERE order_id = ?
     ORDER BY created_at ASC`,
    [order_id, order_id]
  );
  return rows || [];
};

/**
 * Check if order has ever been in a certain status
 */
const hasBeenInStatus = async (order_id: string, status: string): Promise<boolean> => {
  const [rows]: any = await pool.execute(
    `SELECT COUNT(*) as count FROM order_histories WHERE order_id = ? AND status = ? LIMIT 1`,
    [order_id, status]
  );
  return (rows[0]?.count || 0) > 0;
};

/**
 * Delete all history for an order
 */
const deleteByOrderId = async (order_id: string): Promise<number> => {
  const [result]: any = await pool.execute(
    `DELETE FROM order_histories WHERE order_id = ?`,
    [order_id]
  );
  return result.affectedRows || 0;
};

export default {
  record,
  getByOrderId,
  getLatest,
  getWithUsers,
  getTimeline,
  hasBeenInStatus,
  deleteByOrderId,
};
