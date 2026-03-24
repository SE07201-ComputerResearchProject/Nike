// models/escrowModel.ts
// ─────────────────────────────────────────────
// Data-access layer for escrow_transactions.
// ─────────────────────────────────────────────

import { pool } from '../config/db';

const PLATFORM_FEE_RATE = 0.025; // 2.5%

interface CreateEscrowParams {
  orderId: string;
  buyerId: string;
  sellerId: string;
  amount: number;
}

const EscrowModel = {
  async create({ orderId, buyerId, sellerId, amount }: CreateEscrowParams, conn: any = null) {
    const db = conn ?? pool;
    const platformFee = parseFloat((amount * PLATFORM_FEE_RATE).toFixed(2));
    const netAmount   = parseFloat((amount - platformFee).toFixed(2));

    const [result]: any = await db.execute(
      `INSERT INTO escrow_transactions
         (order_id, buyer_id, seller_id, amount, platform_fee, net_amount, status)
       VALUES (?, ?, ?, ?, ?, ?, 'pending')`,
      [orderId, buyerId, sellerId, amount, platformFee, netAmount]
    );
    return { insertId: result.insertId, platformFee, netAmount };
  },

  async findByOrderId(orderId: string) {
    const [rows]: any = await pool.execute(
      'SELECT * FROM escrow_transactions WHERE order_id = ? LIMIT 1',
      [orderId]
    );
    return rows[0] ?? null;
  },

  async hold(orderId: string, chargeId: string | null = null, conn: any = null) {
    const db = conn ?? pool;

    if (chargeId) {
      await db.execute(
        `UPDATE escrow_transactions
         SET status   = 'held',
             held_at  = NOW(),
             charge_id = ?
         WHERE order_id = ? AND status IN ('pending','processing')`,
        [chargeId, orderId]
      );
    } else {
      await db.execute(
        `UPDATE escrow_transactions
         SET status   = 'held',
             held_at  = NOW()
         WHERE order_id = ? AND status IN ('pending','processing')`,
        [orderId]
      );
    }
  },

  async release(orderId: string, transferId: string | null = null, reason: string | null = null, conn: any = null) {
    const db = conn ?? pool;
    if (transferId) {
      const [result]: any = await db.execute(
        `UPDATE escrow_transactions
         SET status = 'released', released_at = NOW(), release_reason = ?, transfer_id = ?
         WHERE order_id = ? AND status IN ('held','releasing')`,
        [reason, transferId, orderId]
      );
      return result;
    }

    const [result]: any = await db.execute(
      `UPDATE escrow_transactions
       SET status = 'released', released_at = NOW(), release_reason = ?
       WHERE order_id = ? AND status IN ('held','releasing')`,
      [reason, orderId]
    );
    return result;
  },

  async refund(orderId: string, refundId: string | null = null, reason: string | null = null, conn: any = null) {
    const db = conn ?? pool;
    if (refundId) {
      const [result]: any = await db.execute(
        `UPDATE escrow_transactions
         SET status        = 'refunded',
             refunded_at   = NOW(),
             refund_reason = ?,
             refund_id     = ?
         WHERE order_id = ? AND status IN ('held','pending','refunding')`,
        [reason, refundId, orderId]
      );
      return result;
    }

    const [result]: any = await db.execute(
      `UPDATE escrow_transactions
       SET status        = 'refunded',
           refunded_at   = NOW(),
           refund_reason = ?
       WHERE order_id = ? AND status IN ('held','pending','refunding')`,
      [reason, orderId]
    );
    return result;
  }, 

  async dispute(orderId: string, conn: any = null) {
    const db = conn ?? pool;
    await db.execute(
      `UPDATE escrow_transactions SET status = 'disputed'
       WHERE order_id = ? AND status = 'held'`,
      [orderId]
    );
  },
};

export = EscrowModel;