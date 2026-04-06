// models/logModel.ts
// ─────────────────────────────────────────────
// Append-only audit log writer.
// Never UPDATE or DELETE — insert only.
// ─────────────────────────────────────────────

import { pool } from '../config/db';

export const LOG_EVENTS = {
  REGISTER_SUCCESS     : 'REGISTER_SUCCESS',
  REGISTER_FAIL        : 'REGISTER_FAIL',
  LOGIN_SUCCESS        : 'LOGIN_SUCCESS',
  LOGIN_FAIL           : 'LOGIN_FAIL',
  LOGIN_BLOCKED        : 'LOGIN_BLOCKED',
  LOGOUT               : 'LOGOUT',
  TOKEN_REFRESH        : 'TOKEN_REFRESH',
  TOKEN_REFRESH_FAIL   : 'TOKEN_REFRESH_FAIL',
  PASSWORD_RESET       : 'PASSWORD_RESET',
  MFA_ENABLED          : 'MFA_ENABLED',
  MFA_DISABLED         : 'MFA_DISABLED',
  MFA_VERIFIED         : 'MFA_VERIFIED',
  MFA_FAIL             : 'MFA_FAIL',
  MFA_SUCCESS          : 'MFA_SUCCESS',
  REPLAY_ATTACK        : 'REPLAY_ATTACK',
  ACCOUNT_SUSPENDED    : 'ACCOUNT_SUSPENDED',
  PRODUCT_CREATED      : 'PRODUCT_CREATED',
  PRODUCT_DELETED      : 'PRODUCT_DELETED',
  ORDER_CREATED        : 'ORDER_CREATED',
  ORDER_CANCELLED      : 'ORDER_CANCELLED',
  ESCROW_HELD          : 'ESCROW_HELD',
  ESCROW_RELEASED      : 'ESCROW_RELEASED',
  ESCROW_REFUNDED      : 'ESCROW_REFUNDED',
  SUSPICIOUS_ACTIVITY  : 'SUSPICIOUS_ACTIVITY',
  RATE_LIMIT_HIT       : 'RATE_LIMIT_HIT',
} as const;

interface WriteLogParams {
  userId?: string | null;
  eventType: string;
  severity?: string;
  ipAddress?: string | null;
  userAgent?: string | null;
  endpoint?: string | null;
  method?: string | null;
  statusCode?: number | null;
  payload?: any;
  message?: string | null;
}

// Ensure the same shape for both test and dev/prod
export let LogModel: any;

if (process.env.NODE_ENV === 'test') {
  LogModel = {
    async write() { /* no-op */ },
    async findByUser() { return []; },
    async findSuspicious() { return []; },
  };
} else {
  LogModel = {
    async write({ userId = null, eventType, severity = 'info', ipAddress, userAgent, endpoint, method, statusCode, payload, message }: WriteLogParams) {
      try {
        await pool.execute(
          `INSERT INTO logs
             (user_id, event_type, severity, ip_address, user_agent,
              endpoint, method, status_code, payload, message)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            userId      ?? null,
            eventType,
            severity,
            ipAddress   ?? null,
            userAgent   ?? null,
            endpoint    ?? null,
            method      ?? null,
            statusCode  ?? null,
            payload     ? JSON.stringify(payload) : null,
            message     ?? null,
          ]
        );
      } catch (err: any) {
        console.error('[LogModel] Failed to write log:', err?.message ?? String(err));
      }
    },

    async findByUser(userId: string, { page = 1, limit = 50 } = {}) {
      const offset = (page - 1) * limit;
      const [rows]: any = await pool.execute(
        `SELECT id, event_type, severity, ip_address, endpoint, message, created_at
         FROM logs WHERE user_id = ?
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
        [userId, limit, offset]
      );
      return rows;
    },

    async findSuspicious({ hours = 24, limit = 100 } = {}) {
      const [rows]: any = await pool.execute(
        `SELECT * FROM logs
         WHERE severity IN ('warn','critical')
           AND created_at > DATE_SUB(NOW(), INTERVAL ? HOUR)
         ORDER BY created_at DESC LIMIT ?`,
        [hours, limit]
      );
      return rows;
    },
  };
}