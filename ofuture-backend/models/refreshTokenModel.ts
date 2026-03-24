// models/refreshTokenModel.ts
// ─────────────────────────────────────────────
// Data-access layer for the `refresh_tokens` table.
// Tokens are stored as SHA-256 hashes — never raw.
// ─────────────────────────────────────────────

import { pool } from '../config/db';
const { hashToken } = require('../utils/securityUtils'); // Giữ nguyên require hoặc dùng import nếu đã chuyển securityUtils sang TS

interface CreateRefreshTokenParams {
  userId: string;
  rawToken: string;
  deviceInfo?: string | null;
  ipAddress?: string | null;
  expiresAt: Date;
}

const RefreshTokenModel = {

  /**
   * Store a new refresh token (hashed) for a user session.
   * expiresAt: JS Date object
   */
  async create({ userId, rawToken, deviceInfo, ipAddress, expiresAt }: CreateRefreshTokenParams) {
    const tokenHash = hashToken(rawToken);
    await pool.execute(
      `INSERT INTO refresh_tokens (user_id, token_hash, device_info, ip_address, expires_at)
       VALUES (?, ?, ?, ?, ?)`,
      [userId, tokenHash, deviceInfo ?? null, ipAddress ?? null, expiresAt]
    );
    return tokenHash;
  },

  /**
   * Find a valid (non-revoked, non-expired) token by its raw value.
   */
  async findValid(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const [rows]: any = await pool.execute(
      `SELECT * FROM refresh_tokens
       WHERE token_hash = ?
         AND revoked    = 0
         AND expires_at > NOW()
       LIMIT 1`,
      [tokenHash]
    );
    return rows[0] ?? null;
  },

  /**
   * Revoke a single token (logout from one device).
   */
  async revoke(rawToken: string) {
    const tokenHash = hashToken(rawToken);
    const [result]: any = await pool.execute(
      'UPDATE refresh_tokens SET revoked = 1 WHERE token_hash = ? AND revoked = 0 AND expires_at > NOW()',
      [tokenHash]
    );
    return result;
  },

  /**
   * Revoke ALL tokens for a user (logout from all devices).
   */
  async revokeAllForUser(userId: string) {
    await pool.execute(
      'UPDATE refresh_tokens SET revoked = 1 WHERE user_id = ?',
      [userId]
    );
  },

  /**
   * Clean up expired tokens (run as a scheduled job).
   */
  async deleteExpired() {
    const [result]: any = await pool.execute(
      'DELETE FROM refresh_tokens WHERE expires_at < NOW()'
    );
    return result.affectedRows;
  },
};

export = RefreshTokenModel;