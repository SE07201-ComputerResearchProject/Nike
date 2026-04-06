// services/sessionService.ts
// ─────────────────────────────────────────────
// Session lifecycle and continuous trust service.
//
// Zero Trust responsibilities:
//   listSessions()       — all active sessions for a user
//   revokeSession()      — revoke one session by token ID
//   revokeAllSessions()  — revoke all except current
//   enforceSessionCap()  — revoke oldest when > MAX_SESSIONS
//   validateContinuity() — detect IP drift / fingerprint change
//   touchSession()       — update last_used_at + last_used_ip
//   detectReplay()       — flag if a revoked token is reused
//   pruneExpired()       — maintenance cleanup
// ─────────────────────────────────────────────

import { pool } from '../config/db';
const { hashToken } = require('../utils/securityUtils');
import { LogModel, LOG_EVENTS } from '../models/logModel';
import logger from '../utils/logger';
const deviceFingerprintModule = require('../utils/deviceFingerprint');

// ── Constants ─────────────────────────────────
const MAX_SESSIONS       = 5;        // max concurrent active sessions per user
const IP_CHANGE_WARN_TTL = 60 * 60;  // flag IP change within last 60 min (seconds)

// ─────────────────────────────────────────────
// listSessions(userId)
// Returns all non-revoked, non-expired sessions
// for the user, newest first.
// ─────────────────────────────────────────────
const listSessions = async (userId: string) => {
  const [rows]: any = await pool.execute(
    `SELECT
       id, device_info, device_fingerprint,
       ip_address, last_used_at, last_used_ip,
       created_at, expires_at
     FROM refresh_tokens
     WHERE user_id  = ?
       AND revoked  = 0
       AND expires_at > NOW()
     ORDER BY last_used_at DESC, created_at DESC`,
    [userId]
  );
  return rows.map((r: any) => ({
    sessionId         : r.id,
    deviceInfo        : r.device_info ?? 'Unknown device',
    ipAddress         : r.ip_address,
    lastUsedAt        : r.last_used_at,
    lastUsedIp        : r.last_used_ip,
    createdAt         : r.created_at,
    expiresAt         : r.expires_at,
    // Omit fingerprint from API responses — internal only
  }));
};

// ─────────────────────────────────────────────
// revokeSession(sessionId, requesterId, reason)
// Revoke a specific session by its UUID.
// requesterId must own the session (or be admin).
// ─────────────────────────────────────────────
const revokeSession = async (sessionId: string, requesterId: string, requesterRole: string, reason: string = 'logout') => {
  const [[session]]: any = await pool.execute(
    'SELECT id, user_id FROM refresh_tokens WHERE id = ? LIMIT 1',
    [sessionId]
  );

  if (!session) return { success: false, code: 'NOT_FOUND', message: 'Session not found.' };

  if (requesterRole !== 'admin' && session.user_id !== requesterId) {
    return { success: false, code: 'FORBIDDEN', message: 'Access denied.' };
  }

  await pool.execute(
    'UPDATE refresh_tokens SET revoked = 1, revoke_reason = ? WHERE id = ?',
    [reason, sessionId]
  );

  logger.info(`[Session] Revoked sessionId=${sessionId} by userId=${requesterId} reason=${reason}`);
  return { success: true, message: 'Session revoked.' };
};

// ─────────────────────────────────────────────
// revokeAllSessions(userId, exceptTokenHash)
// Revoke all sessions except the current one.
// ─────────────────────────────────────────────
const revokeAllSessions = async (userId: string, exceptTokenHash: string | null = null, reason: string = 'logout_all') => {
  const params: any[] = [reason, userId];
  let sql = 'UPDATE refresh_tokens SET revoked = 1, revoke_reason = ? WHERE user_id = ? AND revoked = 0';

  if (exceptTokenHash) {
    sql += ' AND token_hash != ?';
    params.push(exceptTokenHash);
  }

  const [result]: any = await pool.execute(sql, params);
  logger.info(`[Session] Revoked ${result.affectedRows} session(s) for userId=${userId}`);
  return { success: true, revokedCount: result.affectedRows };
};

// ─────────────────────────────────────────────
// enforceSessionCap(userId, currentTokenHash)
// If the user now has > MAX_SESSIONS active,
// revoke the oldest ones (keep MAX_SESSIONS most recent).
// Called after issuing a new refresh token.
// ─────────────────────────────────────────────
const enforceSessionCap = async (userId: string) => {
  const [rows]: any = await pool.execute(
    `SELECT id FROM refresh_tokens
     WHERE user_id = ? AND revoked = 0 AND expires_at > NOW()
     ORDER BY last_used_at DESC, created_at DESC`,
    [userId]
  );

  if (rows.length <= MAX_SESSIONS) return { evicted: 0 };

  const toRevoke = rows.slice(MAX_SESSIONS).map((r: any) => r.id);

  await pool.execute(
    `UPDATE refresh_tokens
     SET revoked = 1, revoke_reason = 'session_cap'
     WHERE id IN (${toRevoke.map(() => '?').join(',')})`,
    toRevoke
  );

  logger.warn(`[Session] Evicted ${toRevoke.length} session(s) for userId=${userId} (cap=${MAX_SESSIONS})`);
  return { evicted: toRevoke.length };
};

// ─────────────────────────────────────────────
// validateContinuity(storedSession, currentIp, currentFp)
//
// Zero Trust: every token rotation checks that
// the device hasn't changed underneath the session.
//
// Returns:
//   { trusted: true }                         — all good
//   { trusted: false, reason, severity }      — anomaly detected
// ─────────────────────────────────────────────
const validateContinuity = (storedSession: any, currentIp: string | null, currentFp: string | null) => {
  // If no stored session info, we can't validate — return limited signal
  if (!storedSession) return { trusted: false, reason: 'no_stored_session', severity: 'warn' };

  const storedFp = storedSession.device_fingerprint || null;

  // Fingerprint check (deterministic SHA-256 hex)
  if (storedFp) {
    try {
      const fpMatches = deviceFingerprintModule.matches(storedFp, currentFp);
      if (!fpMatches) {
        return { trusted: false, reason: 'device_fingerprint_mismatch', severity: 'critical', message: 'Device fingerprint changed mid-session' };
      }
    } catch (err) {
      return { trusted: false, reason: 'fp_compare_error', severity: 'warn' };
    }
  }

  // IP drift detection — allow if last_used older than tolerance
  const lastIp = storedSession.last_used_ip ?? storedSession.ip_address;
  const lastUsedAt = storedSession.last_used_at ? new Date(storedSession.last_used_at).getTime() : 0;
  const ageSeconds = lastUsedAt ? (Date.now() - lastUsedAt) / 1000 : Number.POSITIVE_INFINITY;

  // If IP changed and last activity was recent, flag as warning (reason must be 'ip_changed' per tests)
  if (lastIp && currentIp && lastIp !== currentIp) {
    const tolerance = IP_CHANGE_WARN_TTL; 
    if (ageSeconds < tolerance) {
      return { trusted: true, warning: true, reason: 'ip_changed', severity: 'warn', message: `IP changed from ${lastIp} to ${currentIp}` };
    }
  }

  return { trusted: true };
};

// ─────────────────────────────────────────────
// touchSession(tokenHash, ip)
// Updates last_used_at and last_used_ip on each
// successful token rotation — keeps sessions alive
// and records activity for anomaly detection.
// ─────────────────────────────────────────────
const touchSession = async (tokenHash: string, ip: string | null) => {
  await pool.execute(
    `UPDATE refresh_tokens
     SET last_used_at = NOW(), last_used_ip = ?
     WHERE token_hash = ?`,
    [ip ?? null, tokenHash]
  );
};

// ─────────────────────────────────────────────
// detectReplay(rawToken)
//
// Zero Trust: if a REVOKED token is presented,
// it indicates either a replay attack or that the
// token was stolen. Respond by revoking ALL sessions
// for that user immediately.
//
// Returns { replay: false } if token is fine,
//         { replay: true, userId } if attack detected.
// ─────────────────────────────────────────────
const detectReplay = async (rawToken: string, ipAddress: string | null) => {
  const hash = hashToken(rawToken);

  const [[row]]: any = await pool.execute(
    `SELECT id, user_id, revoked, revoke_reason
     FROM refresh_tokens
     WHERE token_hash = ? LIMIT 1`,
    [hash]
  );

  // Token never existed — not a replay, just invalid
  if (!row) return { replay: false };

  // Token exists and is not revoked — normal flow
  if (row.revoked === 0) return { replay: false };

  // Token exists but was already revoked — REPLAY ATTACK
  logger.warn(
    `[ZeroTrust] REPLAY ATTACK: revoked token reused! ` +
    `userId=${row.user_id} ip=${ipAddress} sessionId=${row.id}`
  );

  // Nuclear response: revoke ALL sessions for this user
  await pool.execute(
    `UPDATE refresh_tokens
     SET revoked = 1, revoke_reason = 'replay_nuke'
     WHERE user_id = ? AND revoked = 0`,
    [row.user_id]
  );

  await LogModel.write({
    userId    : row.user_id,
    eventType : LOG_EVENTS.REPLAY_ATTACK,
    severity  : 'critical',
    ipAddress,
    message   : `Replay attack detected — all sessions revoked for userId=${row.user_id}`,
    payload   : { sessionId: row.id, previousRevokeReason: row.revoke_reason },
  });

  return { replay: true, userId: row.user_id };
};

// ─────────────────────────────────────────────
// pruneExpired()
// Deletes expired + revoked tokens older than 30 days.
// Safe to call from a cron job.
// ─────────────────────────────────────────────
const pruneExpired = async () => {
  const [result]: any = await pool.execute(
    `DELETE FROM refresh_tokens
     WHERE (expires_at < NOW())
        OR (revoked = 1 AND created_at < DATE_SUB(NOW(), INTERVAL 30 DAY))`
  );
  logger.info(`[Session] Pruned ${result.affectedRows} stale token(s)`);
  return result.affectedRows;
};

export = {
  listSessions,
  revokeSession,
  revokeAllSessions,
  enforceSessionCap,
  validateContinuity,
  touchSession,
  detectReplay,
  pruneExpired,
  MAX_SESSIONS,
};