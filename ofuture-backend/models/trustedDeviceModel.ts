// models/trustedDeviceModel.ts
import { pool } from '../config/db';

interface CreateTrustedDeviceParams {
  userId: string;
  deviceFingerprint: string;
  deviceName?: string | null;
  ipAddress?: string | null;
  rememberedUntil?: Date | null;
}

const create = async ({ userId, deviceFingerprint, deviceName = null, ipAddress = null, rememberedUntil = null }: CreateTrustedDeviceParams) => {
  const [result]: any = await pool.execute(
    `INSERT INTO trusted_devices (user_id, device_fingerprint, device_name, ip_address, remembered_until, last_used_at)
     VALUES (?, ?, ?, ?, ?, NOW())`,
    [userId, deviceFingerprint, deviceName, ipAddress, rememberedUntil]
  );
  return { id: result.insertId };
};

const findByFingerprint = async (userId: string, deviceFingerprint: string) => {
  const [rows]: any = await pool.execute(
    `SELECT * FROM trusted_devices WHERE user_id = ? AND device_fingerprint = ? AND revoked = 0 LIMIT 1`,
    [userId, deviceFingerprint]
  );
  return rows[0] || null;
};

const markUsed = async (id: string | number) => {
  await pool.execute(
    `UPDATE trusted_devices SET last_used_at = NOW() WHERE id = ?`,
    [id]
  );
};

const revoke = async (id: string | number) => {
  await pool.execute(`UPDATE trusted_devices SET revoked = 1 WHERE id = ?`, [id]);
};

export = { create, findByFingerprint, markUsed, revoke };