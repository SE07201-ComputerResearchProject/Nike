// models/paymentModel.ts
// ─────────────────────────────────────────────
// MySQL Payment Model
// Replace Mongoose Payment Model from the old code.
// 
// ── MUST RUN THIS SQL IF TABLE DOES NOT EXIST: ──
// CREATE TABLE payments (
//   id VARCHAR(36) PRIMARY KEY,
//   order_id VARCHAR(36) NOT NULL,
//   method ENUM('cod', 'momo', 'qr') NOT NULL,
//   amount DECIMAL(10, 2) NOT NULL,
//   status ENUM('pending', 'success', 'failed', 'expired') DEFAULT 'pending',
//   transaction_id VARCHAR(100),
//   payment_data JSON,
//   expires_at DATETIME,
//   created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
//   updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
//   INDEX(order_id),
//   INDEX(status)
// );
// ─────────────────────────────────────────────

import { pool } from '../config/db';
import crypto from 'crypto';

export interface PaymentData {
  orderId: string;
  method: 'momo' | 'qr' | 'cod';
  amount: number;
  status: 'pending' | 'success' | 'failed' | 'expired';
  transactionId?: string | null;
  paymentData?: any;
  expiresAt: Date;
}

const create = async (data: PaymentData): Promise<string> => {
  const id = crypto.randomUUID();
  await pool.execute(
    `INSERT INTO payments (id, order_id, method, amount, status, payment_data, expires_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    [
      id,
      data.orderId,
      data.method,
      data.amount,
      data.status,
      JSON.stringify(data.paymentData || {}),
      data.expiresAt
    ]
  );
  return id;
};

const findByOrderIdAndMethod = async (orderId: string, method: string): Promise<any> => {
  const [rows]: any = await pool.execute(
    `SELECT * FROM payments WHERE order_id = ? AND method = ? ORDER BY created_at DESC LIMIT 1`,
    [orderId, method]
  );
  return rows[0];
};

const findById = async (id: string): Promise<any> => {
  const [rows]: any = await pool.execute(`SELECT * FROM payments WHERE id = ? LIMIT 1`, [id]);
  return rows[0];
};

export default {
  create,
  findByOrderIdAndMethod,
  findById,
};