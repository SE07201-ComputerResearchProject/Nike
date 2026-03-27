// models/paymentModel.ts
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