// config/db.ts
// ─────────────────────────────────────────────
// MySQL connection pool using mysql2/promise
// Uses connection pooling for performance &
// automatic reconnect on connection loss.
// ─────────────────────────────────────────────

import dotenv from 'dotenv';
dotenv.config();

let pool: any;
let testConnection: () => Promise<void>;

// In test environment we provide a lightweight in-memory stub to avoid
// real MySQL connections and to keep Jest from leaking handles.
if (process.env.NODE_ENV === 'test') {
  // Smarter pool stub for unit tests. Returns shapes expected by application code
  const poolStub = {
    async execute(sql: string = '', params: any[] = []): Promise<any[]> {
      const s = String(sql || '').toLowerCase();

      // SELECT mfa_backup_codes
      if (s.includes('select mfa_backup_codes')) {
        return [[{ mfa_backup_codes: null }], []];
      }

      // SELECT mfa_enabled, mfa_secret, JSON_LENGTH(...)
      if (s.includes('select mfa_enabled') || s.includes('json_length')) {
        return [[{ mfa_enabled: 0, mfa_secret: null, backup_codes_remaining: 0 }], []];
      }

      // SELECT ... FROM users WHERE id = ?
      if (s.includes('select') && s.includes('from users') && s.includes('where') && s.includes('id')) {
        const uid = Array.isArray(params) && params.length ? params[0] : 'test-user-id';
        return [[{ id: uid, email: 'test@example.com', role: 'buyer', mfa_enabled: 0, mfa_secret: null }], []];
      }

      // SELECT ... FROM users WHERE email = ?
      if (s.includes('select') && s.includes('from users') && s.includes('where') && s.includes('email')) {
        const email = Array.isArray(params) && params.length ? params[0] : 'test@example.com';
        return [[{ id: 'user-1', email, password_hash: '$2a$10$testhash', role: 'buyer', mfa_enabled: 0, mfa_secret: null }], []];
      }

      // INSERT INTO refresh_tokens => emulate insertId
      if (s.includes('insert into refresh_tokens')) {
        return [{ insertId: 1 }, undefined];
      }

      // INSERT INTO trusted_devices => emulate insertId
      if (s.includes('insert into trusted_devices')) {
        return [{ insertId: 1 }, undefined];
      }

      // SELECT ... FROM trusted_devices
      if (s.includes('select') && s.includes('from trusted_devices')) {
        // default: no remembered device
        return [[], []];
      }

      // UPDATE users => emulate affectedRows
      if (s.includes('update users')) {
        return [{ affectedRows: 1 }, undefined];
      }

      // DELETE / generic write
      if (s.trim().startsWith('delete') || s.trim().startsWith('insert') || s.trim().startsWith('update')) {
        return [{ affectedRows: 1 }, undefined];
      }

      // Generic select fallback
      if (s.trim().startsWith('select')) {
        return [[], []];
      }

      // Default
      return [[], {}];
    },
    async getConnection(): Promise<any> {
      return {
        async execute(sql: string, params: any[]) { return poolStub.execute(sql, params); },
        async beginTransaction() {},
        async commit() {},
        async rollback() {},
        release() {},
      };
    },
  };
  
  testConnection = async (): Promise<void> => { /* noop in tests */ };
  pool = poolStub;

} else {
  // Giữ nguyên logic require trong scope else để tránh lỗi load module khi test
  const mysql = require('mysql2/promise');
  
  pool = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT) || 3306,
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'ofuture_db',
    waitForConnections: true,
    connectionLimit: 10,       // max simultaneous connections
    queueLimit: 0,             // unlimited queued requests
    enableKeepAlive: true,
    keepAliveInitialDelay: 0,
    timezone: '+00:00',        // store all times in UTC
    decimalNumbers: true,
  });

  testConnection = async (): Promise<void> => {
    try {
      const connection = await pool.getConnection();
      console.log('✅  MySQL connected successfully');
      connection.release();
    } catch (error: any) {
      console.error('❌  MySQL connection failed:', error.message);
      process.exit(1);
    }
  };
}

export { pool, testConnection };