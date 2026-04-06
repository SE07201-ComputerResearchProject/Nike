// services/mfaService.ts

import { pool } from '../config/db';
import UserModel from '../models/userModel';
import { LogModel, LOG_EVENTS } from '../models/logModel';
import securityUtils from '../utils/securityUtils';

import speakeasy from 'speakeasy';
import qrcode from 'qrcode';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'crypto';

import TrustedDeviceModel from '../models/trustedDeviceModel';

const RISK_THRESHOLD = 40;
const MFA_TOKEN_EXPIRY = '10m';

interface ExchangeMfaParams {
  mfaToken: string;
  code: string;
  codeType: 'totp' | 'backup' | string;
}

// =============================
// STATE MACHINE
// =============================
const getUserState = async (userId: string) => {
  const user = await UserModel.findById(userId);
  if (!user) return { state: 'NO_USER', user: null };

  if (!user.mfa_enabled && !user.mfa_secret) return { state: 'NO_MFA', user };
  if (!user.mfa_enabled && user.mfa_secret) return { state: 'SETUP_PENDING', user };
  if (user.mfa_enabled && user.mfa_secret) return { state: 'ENABLED', user };

  return { state: 'NO_MFA', user };
};

// =============================
// TOTP VERIFY (REAL)
// =============================
const verifyTotpInternal = (token: string | number, secret: string): boolean => {
  try {
    return speakeasy.totp.verify({
      secret,
      encoding: 'base32',
      token: String(token),
      window: 1
    });
  } catch {
    return false;
  }
};

// =============================
// GENERATE MFA TOKEN
// =============================
const generateMfaToken = (userId: string) => {
  return jwt.sign(
    { id: userId, mfaPending: true },
    process.env.JWT_SECRET as string,
    { expiresIn: MFA_TOKEN_EXPIRY }
  );
};

// =============================
// GENERATE SETUP (QR CODE)
// =============================
const generateSetup = async (userId: string) => {
  const { state, user } = await getUserState(userId);

  if (state === 'NO_USER')  return { success: false, code: 'USER_NOT_FOUND' };
  if (state === 'ENABLED')  return { success: false, code: 'MFA_ALREADY_ENABLED' };

  const secret = speakeasy.generateSecret({
    name: `${process.env.MFA_ISSUER ?? 'OFuture'}:${user.email}`,
  });

  await UserModel.saveMfaSecret(userId, secret.base32);

  const qrCode = await qrcode.toDataURL(secret.otpauth_url as string);

  return {
    success    : true,
    qrCode,
    otpauthUrl : secret.otpauth_url,   // ← was missing
    secret     : secret.base32,
  };
};

// =============================
// CONFIRM SETUP
// =============================
const confirmSetup = async (userId: string, token: string) => {
  const { state, user } = await getUserState(userId);

  if (state === 'NO_USER') return { success: false };
  if (state === 'NO_MFA') return { success: false, code: 'SETUP_NOT_INITIATED' };
  if (state === 'ENABLED') return { success: false, code: 'MFA_ALREADY_ENABLED' };

  const valid = verifyTotpInternal(token, user.mfa_secret);
  if (!valid) return { success: false, code: 'INVALID_CODE' };

  // Generate backup codes
  const rawCodes: string[] = [];
  const hashedCodes: string[] = [];

  for (let i = 0; i < 10; i++) {
    const code = crypto.randomBytes(5).toString('hex').toUpperCase();
    rawCodes.push(code);
    hashedCodes.push(await bcrypt.hash(code, 10));
  }

  await pool.execute(
    `UPDATE users SET mfa_enabled = 1, mfa_backup_codes = ? WHERE id = ?`,
    [JSON.stringify(hashedCodes), userId]
  );

  return {
    success: true,
    backupCodes: rawCodes
  };
};

// =============================
// VERIFY TOTP
// =============================
const verifyTotp = async (userId: string, token: string) => {
  const { user } = await getUserState(userId);

  if (!user || !user.mfa_secret)
    return { valid: false };

  const valid = verifyTotpInternal(token, user.mfa_secret);

  return {
    valid,
    reason: valid ? null : 'INVALID_CODE'
  };
};

// =============================
// VERIFY BACKUP CODE
// =============================
const verifyBackupCode = async (userId: string, rawCode: string) => {
  const code = String(rawCode).trim().toUpperCase();

  const [[row]]: any = await pool.execute(
    `SELECT mfa_backup_codes FROM users WHERE id = ?`,
    [userId]
  );

  if (!row?.mfa_backup_codes)
    return { valid: false };

  let codes = JSON.parse(row.mfa_backup_codes);

  for (let i = 0; i < codes.length; i++) {
    const match = await bcrypt.compare(code, codes[i]);
    if (match) {
      codes.splice(i, 1);

      await pool.execute(
        `UPDATE users SET mfa_backup_codes = ? WHERE id = ?`,
        [JSON.stringify(codes), userId]
      );

      return { valid: true, remaining: codes.length };
    }
  }

  return { valid: false };
};

// =============================
// EXCHANGE MFA TOKEN
// =============================
const exchangeMfaToken = async ({ mfaToken, code, codeType }: ExchangeMfaParams) => {
  let payload: any;

  try {
    payload = jwt.verify(mfaToken, process.env.JWT_SECRET as string);
  } catch {
    return { success: false };
  }

  if (!payload.mfaPending)
    return { success: false };

  const userId = payload.id;

  let verified = false;

  if (codeType === 'totp') {
    verified = (await verifyTotp(userId, code)).valid;
  } else {
    verified = (await verifyBackupCode(userId, code)).valid;
  }

  if (!verified)
    return { success: false, code: 'INVALID_CODE' };

  const user = await UserModel.findById(userId);

  const accessToken = securityUtils.signAccessToken({
    id: userId,
    role: user.role,
    mfaVerified: true
  });

  const refreshToken = securityUtils.generateRawRefreshToken();

  return {
    success: true,
    accessToken,
    refreshToken,
    mfaVerified: true
  };
};

// =============================
// DISABLE MFA
// =============================
const disableMfa = async (userId: string, password: string, token: string) => {
  const { state, user } = await getUserState(userId);

  if (state !== 'ENABLED')
    return { success: false, code: 'MFA_NOT_ENABLED' };

  // FIX: Truy vấn riêng password_hash vì UserModel.findById không bao gồm trường này
  const [[dbUser]]: any = await pool.execute(
    `SELECT password_hash FROM users WHERE id = ?`,
    [userId]
  );

  if (!dbUser || !dbUser.password_hash) {
    return { success: false, code: 'USER_NOT_FOUND' };
  }

  const passOk = await bcrypt.compare(password, dbUser.password_hash);
  if (!passOk)
    return { success: false, code: 'INVALID_PASSWORD' };

  const valid = verifyTotpInternal(token, user.mfa_secret);
  if (!valid)
    return { success: false, code: 'INVALID_CODE' };

  await pool.execute(
    `UPDATE users SET mfa_enabled=0, mfa_secret=NULL, mfa_backup_codes=NULL WHERE id=?`,
    [userId]
  );

  return { success: true };
};

// =============================
// STATUS
// =============================
const getMfaStatus = async (userId: string) => {
  const { state, user } = await getUserState(userId);

  if (state === 'NO_USER') return { success: false };   // ← add success flag

  return {
    success      : true,                                 // ← was missing
    mfaEnabled   : Boolean(user?.mfa_enabled),
    setupPending : Boolean(user?.mfa_secret && !user?.mfa_enabled),
    backupCodesRemaining: (() => {
      try {
        const codes = user?.mfa_backup_codes
          ? JSON.parse(user.mfa_backup_codes)
          : [];
        return Array.isArray(codes) ? codes.length : 0;
      } catch { return 0; }
    })(),
  };
};

// =============================
export = {
  generateSetup,
  confirmSetup,
  verifyTotp,
  verifyBackupCode,
  exchangeMfaToken,
  disableMfa,
  getMfaStatus,
  generateMfaToken
};