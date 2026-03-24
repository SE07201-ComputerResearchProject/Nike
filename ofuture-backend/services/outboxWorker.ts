// services/outboxWorker.ts

import os from 'os';
import { v4 as uuidv4 } from 'uuid';
import OutboxService from './outboxService';
import paymentService from './paymentService';
import { pool } from '../config/db';
import logger from '../utils/logger';

const workerId = `${os.hostname()}_${process.pid}_${uuidv4().slice(0,6)}`;

const PROCESS_LIMIT = Number(process.env.OUTBOX_BATCH_SIZE) || 10;
const MAX_ATTEMPTS = 5;

interface OutboxEvent {
  id: string | number;
  aggregate_type: string;
  aggregate_id: string;
  event_type: string;
  payload: any;
  attempt_count?: number;
}

async function processEvent(evt: OutboxEvent) {
  const { id, aggregate_type, aggregate_id, event_type, payload } = evt;
  let data: any;
  try { data = JSON.parse(payload); } catch { data = payload; }

  try {
    if (event_type === 'charge') {
      const res = await paymentService.chargeCard({ orderId: data.orderId, amount: data.amount, currency: data.currency, paymentMethod: data.paymentMethod });
      if (!res.success) throw new Error(res.message || 'charge failed');

      // persist charge id and finalize escrow/order in a short TX
      const conn: any = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute(`UPDATE escrow_transactions SET charge_id = ?, gateway = ?, status = 'held', held_at = NOW() WHERE id = ? AND status IN ('processing')`, [res.chargeId, res.gateway || 'simulated', aggregate_id]);
        await conn.execute(`UPDATE orders SET status = 'paid' WHERE id = ?`, [data.orderId]);
        await conn.commit();
      } catch (err) {
        await conn.rollback().catch(() => {});
        throw err;
      } finally { conn.release(); }

      await OutboxService.markSucceeded(id, res);
      logger.info(`Outbox charge succeeded: event=${id} escrow=${aggregate_id}`);

    } else if (event_type === 'transfer') {
      const res = await paymentService.transferToSeller({ sellerId: data.sellerId, amount: data.amount, currency: data.currency, orderId: data.orderId });
      if (!res.success) throw new Error(res.message || 'transfer failed');

      const conn: any = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute(`UPDATE escrow_transactions SET transfer_id = ?, gateway = ?, status = 'released', released_at = NOW() WHERE id = ? AND status IN ('releasing')`, [res.transferId, res.gateway || 'simulated', aggregate_id]);
        await conn.execute(`UPDATE orders SET status = 'completed', completed_at = NOW() WHERE id = ?`, [data.orderId]);
        await conn.commit();
      } catch (err) { await conn.rollback().catch(() => {}); throw err; } finally { conn.release(); }

      await OutboxService.markSucceeded(id, res);
      logger.info(`Outbox transfer succeeded: event=${id} escrow=${aggregate_id}`);

    } else if (event_type === 'refund') {
      const res = await paymentService.refundCharge({ chargeId: data.chargeId, amount: data.amount, reason: data.reason });
      if (!res.success) throw new Error(res.message || 'refund failed');

      const conn: any = await pool.getConnection();
      try {
        await conn.beginTransaction();
        await conn.execute(`UPDATE escrow_transactions SET refund_id = ?, gateway = ?, status = 'refunded', refunded_at = NOW() WHERE id = ? AND status IN ('refunding')`, [res.refundId, res.gateway || 'simulated', aggregate_id]);
        await conn.execute(`UPDATE orders SET status = 'refunded', cancelled_at = NOW() WHERE id = ?`, [data.orderId]);
        await conn.execute('UPDATE products SET stock_quantity = stock_quantity + ? WHERE id = ?', [data.quantity, data.productId]);
        await conn.commit();
      } catch (err) { await conn.rollback().catch(() => {}); throw err; } finally { conn.release(); }

      await OutboxService.markSucceeded(id, res);
      logger.info(`Outbox refund succeeded: event=${id} escrow=${aggregate_id}`);

    } else {
      throw new Error(`Unknown event_type=${event_type}`);
    }

  } catch (err: any) {
    logger.error(`Outbox event processing failed for id=${id}:`, err.message || err);
    // increment attempt count and set backoff (exponential)
    const nextAttempt = (evt.attempt_count || 0) + 1;
    const backoff = Math.min(60 * Math.pow(2, nextAttempt - 1), 3600); // cap at 1 hour
    await OutboxService.markFailed(id, err.message || String(err), nextAttempt, backoff);

    if (nextAttempt >= MAX_ATTEMPTS) {
      logger.error(`Outbox event ${id} reached max attempts and marked as failed.`);
    }
  }
}

async function loop() {
  while (true) {
    try {
      const rows = await OutboxService.fetchAndLockBatch(workerId, PROCESS_LIMIT);
      if (rows.length === 0) {
        await new Promise(r => setTimeout(r, 1000));
        continue;
      }

      for (const evt of rows) {
        await processEvent(evt);
      }

    } catch (err) {
      logger.error('Outbox worker loop error:', err);
      await new Promise(r => setTimeout(r, 2000));
    }
  }
}

if (require.main === module) {
  logger.info(`Starting outbox worker id=${workerId}`);
  loop().catch(err => { logger.error('Worker crashed:', err); process.exit(1); });
}

export = { loop };