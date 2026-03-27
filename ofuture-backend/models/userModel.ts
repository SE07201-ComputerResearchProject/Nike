// models/userModel.ts
// ─────────────────────────────────────────────
// Data-access layer for the `users` table.
// All SQL lives here — controllers stay clean.
// ─────────────────────────────────────────────

import { pool } from '../config/db';

interface CreateUserParams {
  email: string;
  username: string;
  passwordHash: string;
  role?: string;
  fullName: string;
  phone?: string | null;
}

interface UpdateLoginMetaParams {
  ip: string;
  failedAttempts?: number;
  lockedUntil?: Date | null;
}

interface UpdateProfileParams {
  fullName?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
}

interface ListAllUsersParams {
  page?: number;
  limit?: number;
  role?: string;
  isActive?: boolean | number;
}

const UserModel = {

  // ── Create ───────────────────────────────
  async create({ email, username, passwordHash, role = 'buyer', fullName, phone }: CreateUserParams) {
    const [result]: any = await pool.execute(
      `INSERT INTO users
         (email, username, password_hash, role, full_name, phone)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [email, username, passwordHash, role, fullName, phone ?? null]
    );
    return result;
  },

  // ── Find by email (login) ─────────────────
  async findByEmail(email: string) {
    const [rows]: any = await pool.execute(
      `SELECT id, email, username, password_hash, role, full_name,
              is_active, is_verified, mfa_enabled, mfa_secret,
              failed_attempts, locked_until, last_login_at
       FROM users WHERE email = ? LIMIT 1`,
      [email]
    );
    return rows[0] ?? null;
  },

  // ── Find by ID (auth middleware) ──────────
  async findById(id: string) {
    const [rows]: any = await pool.execute(
      `SELECT id, email, username, role, full_name, phone,
              avatar_url, is_active, is_verified, mfa_enabled,
              mfa_secret, mfa_backup_codes, last_login_at, created_at
       FROM users WHERE id = ? LIMIT 1`,
      [id]
    );
    return rows[0] ?? null;
  },

  // ── Find by username ──────────────────────
  async findByUsername(username: string) {
    const [rows]: any = await pool.execute(
      'SELECT id FROM users WHERE username = ? LIMIT 1',
      [username]
    );
    return rows[0] ?? null;
  },

  // ── Update last login metadata ────────────
  async updateLoginMeta(id: string, { ip, failedAttempts = 0, lockedUntil = null }: UpdateLoginMetaParams) {
    await pool.execute(
      `UPDATE users
       SET last_login_at   = NOW(),
           last_login_ip   = ?,
           failed_attempts = ?,
           locked_until    = ?
       WHERE id = ?`,
      [ip, failedAttempts, lockedUntil, id]
    );
  },

  // ── Increment failed login counter ────────
  async incrementFailedAttempts(id: string) {
    await pool.execute(
      'UPDATE users SET failed_attempts = failed_attempts + 1 WHERE id = ?',
      [id]
    );
  },

  // ── Lock account until a datetime ─────────
  async lockAccount(id: string, lockedUntil: Date) {
    await pool.execute(
      'UPDATE users SET locked_until = ? WHERE id = ?',
      [lockedUntil, id]
    );
  },

  // ── Reset failed attempts on success ──────
  async resetFailedAttempts(id: string) {
    await pool.execute(
      'UPDATE users SET failed_attempts = 0, locked_until = NULL WHERE id = ?',
      [id]
    );
  },

  // ── Update profile ────────────────────────
  async updateProfile(id: string, { fullName, phone, avatarUrl }: UpdateProfileParams) {
    await pool.execute(
      `UPDATE users
       SET full_name  = COALESCE(?, full_name),
           phone      = COALESCE(?, phone),
           avatar_url = COALESCE(?, avatar_url)
       WHERE id = ?`,
      [fullName ?? null, phone ?? null, avatarUrl ?? null, id]
    );
  },

  // ── Suspend / unsuspend (admin) ───────────
  async setActiveStatus(id: string, isActive: boolean | number) {
    await pool.execute(
      'UPDATE users SET is_active = ? WHERE id = ?',
      [isActive ? 1 : 0, id]
    );
  },

  // ── Save MFA secret ───────────────────────
  async saveMfaSecret(id: string, secret: string) {
    await pool.execute(
      'UPDATE users SET mfa_secret = ? WHERE id = ?',
      [secret, id]
    );
  },

  // ── Admin: list all users with pagination ─
  async listAll({ page = 1, limit = 20, role, isActive }: ListAllUsersParams) {
    const offset = (page - 1) * limit;
    const conditions = [];
    const params: any[] = [];

    if (role) { conditions.push('role = ?'); params.push(role); }
    if (isActive !== undefined) {
      conditions.push('is_active = ?');
      params.push(isActive ? 1 : 0);
    }

    const where = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';

    const [rows]: any = await pool.execute(
      `SELECT id, email, username, role, full_name, is_active,
              is_verified, mfa_enabled, last_login_at, created_at
       FROM users
       ${where}
       ORDER BY created_at DESC
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    const [[{ total }]]: any = await pool.execute(
      `SELECT COUNT(*) AS total FROM users ${where}`,
      params
    );

    return { rows, total, page, limit };
  },
  
  // ─────────────────────────────────────────────
  // ── NEW: Verify email OTP ────────────────────
  // ─────────────────────────────────────────────
  async verifyUser(userId: string) {
    const [result]: any = await pool.execute(
      'UPDATE users SET is_verified = 1 WHERE id = ?',
      [userId]
    );
    return result;
  },

  // ─────────────────────────────────────────────
  // ── NEW: Soft delete user (Self-delete) ──────
  // ─────────────────────────────────────────────
  async softDeleteUser(id: string, email: string) {
    // Thêm prefix deleted_ và timestamp để giải phóng email này cho việc đăng ký lại
    const deletedEmail = `deleted_${Date.now()}_${email}`;
    await pool.execute(
      `UPDATE users 
       SET is_active = 0, 
           email = ?, 
           full_name = 'Deleted User', 
           avatar_url = NULL,
           phone = NULL
       WHERE id = ?`,
      [deletedEmail, id]
    );
  },

  // ─────────────────────────────────────────────
  // ── NEW: Update password (Reset password) ────
  // ─────────────────────────────────────────────
  async updatePassword(id: string, passwordHash: string) {
    await pool.execute(
      'UPDATE users SET password_hash = ? WHERE id = ?',
      [passwordHash, id]
    );
  }
};

export = UserModel;