// services/outboxService.ts
import { pool } from '../config/db';
import logger from '../utils/logger';

interface EnqueueEventParams {
  aggregateType: string;
  aggregateId: string;
  eventType: string;
  payload: any;
}

interface AdminListParams {
  status?: string;
  aggregateType?: string;
  limit?: number;
  offset?: number;
}

const OutboxService = {
  async enqueueEvent(connOrPool: any, { aggregateType, aggregateId, eventType, payload }: EnqueueEventParams) {
    // If a connection is provided, use it (so enqueue can be in same TX). Otherwise use pool.
    const payloadStr = JSON.stringify(payload);
    if (connOrPool && connOrPool.execute) {
      await connOrPool.execute(
        `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
         VALUES (?, ?, ?, ?)`,
        [aggregateType, aggregateId, eventType, payloadStr]
      );
      return;
    }

    await pool.execute(
      `INSERT INTO outbox_events (aggregate_type, aggregate_id, event_type, payload)
       VALUES (?, ?, ?, ?)`,
      [aggregateType, aggregateId, eventType, payloadStr]
    );
  },

  // Fetch a batch and mark as in_progress for this worker
  async fetchAndLockBatch(workerId: string, limit: number = 10) {
    // Simple pattern: atomically mark some rows as in_progress by id list
    const conn = await pool.getConnection();
    try {
      await conn.beginTransaction();

      const [candidates]: any = await conn.execute(
        `SELECT id FROM outbox_events WHERE status = 'pending' AND next_run_at <= NOW() ORDER BY created_at LIMIT ? FOR UPDATE`,
        [limit]
      );

      const ids = candidates.map((r: any) => r.id);
      if (ids.length === 0) { await conn.commit(); return []; }

      const placeholders = ids.map(() => '?').join(',');
      await conn.execute(
        `UPDATE outbox_events SET status = 'in_progress', locked_by = ?, locked_at = NOW() WHERE id IN (${placeholders})`,
        [workerId, ...ids]
      );

      await conn.commit();

      const [rows]: any = await pool.execute(
        `SELECT * FROM outbox_events WHERE locked_by = ? AND status = 'in_progress' ORDER BY created_at LIMIT ?`,
        [workerId, limit]
      );

      return rows;
    } catch (err) {
      await conn.rollback().catch(() => {});
      logger.error('fetchAndLockBatch error:', err);
      throw err;
    } finally {
      conn.release();
    }
  },

  async markSucceeded(eventId: string | number, result: any) {
    await pool.execute(
      `UPDATE outbox_events SET status = 'succeeded', result = ?, updated_at = NOW() WHERE id = ?`,
      [JSON.stringify(result), eventId]
    );
  },

  async markFailed(eventId: string | number, errMsg: any, attemptCount: number, backoffSeconds: number = 60) {
    await pool.execute(
      `UPDATE outbox_events
       SET attempt_count = ?, last_error = ?, next_run_at = DATE_ADD(NOW(), INTERVAL ? SECOND), status = CASE WHEN ? >= 5 THEN 'failed' ELSE 'pending' END, updated_at = NOW()
       WHERE id = ?`,
      [attemptCount, String(errMsg).slice(0, 2000), backoffSeconds, attemptCount, eventId]
    );
  },

  async adminList({ status, aggregateType, limit = 100, offset = 0 }: AdminListParams) {
    const conditions = [];
    const params: any[] = [];
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (aggregateType) { conditions.push('aggregate_type = ?'); params.push(aggregateType); }
    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows]: any = await pool.execute(`SELECT * FROM outbox_events ${where} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, offset]);
    return rows;
  },

  async adminRetry(eventId: string | number) {
    await pool.execute(`UPDATE outbox_events SET status = 'pending', attempt_count = 0, next_run_at = NOW(), last_error = NULL WHERE id = ?`, [eventId]);
  },
};

export = OutboxService;