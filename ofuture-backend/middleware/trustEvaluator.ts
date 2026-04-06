// middleware/trustEvaluator.ts
// ─────────────────────────────────────────────
// Zero Trust continuous trust evaluation.
// ─────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { LogModel, LOG_EVENTS } from '../models/logModel';
import { pool } from '../config/db';
const { hashToken } = require('../utils/securityUtils');
const deviceFingerprintModule = require('../utils/deviceFingerprint');
import logger from '../utils/logger';

interface TrustContext {
  level: 'full' | 'standard' | 'limited' | 'none';
  score: number;
  signals: string[];
  warnings: string[];
}

interface TrustRequest extends Request {
  user?: any;
  meta?: any;
  riskScore?: number;
  trustContext?: TrustContext;
  deviceFp?: string;
  permissions?: any;
}

// ── Trust level constants ─────────────────────
const TRUST_LEVELS: Record<string, number> = Object.freeze({
  full    : 100,
  standard: 70,
  limited : 40,
  none    : 0,
});

// ─────────────────────────────────────────────
// Private helpers
// ─────────────────────────────────────────────
const buildRemediation = (trustCtx: TrustContext) => {
  const steps: string[] = [];
  const s = trustCtx.signals;

  if (s.includes('mfa_enrolled_not_verified')) {
    steps.push('Complete MFA verification: POST /api/mfa/verify');
  }
  if (s.includes('device_fingerprint_mismatch')) {
    steps.push('Re-login from your usual device to re-establish session trust.');
  }
  if (s.includes('ip_drift_recent')) {
    steps.push('Your IP address changed recently. Re-login to re-verify your location.');
  }
  if (s.some((signal) => signal.startsWith('high_risk_score'))) {
    steps.push('High-risk signals detected. Re-login with MFA to elevate trust.');
  }

  return steps.length > 0 ? steps : ['Re-login to establish a new trusted session.'];
};

// ─────────────────────────────────────────────
// evaluateTrust(req, res, next)
// ─────────────────────────────────────────────
const evaluateTrust = async (req: TrustRequest, res: Response, next: NextFunction): Promise<any> => {
  try {
    if (!req.user) return next();

    const signals: string[] = [];
    const warnings: string[] = [];

    const mfaVerified = Boolean(req.user.mfaVerified);
    const mfaEnrolled = Boolean(req.user.mfaEnabled);

    const currentFp = deviceFingerprintModule.derive(req);

    let storedSession: any = null;
    try {
      const [[session]]: any = await pool.execute(
        `SELECT device_fingerprint, last_used_ip, last_used_at, ip_address
         FROM refresh_tokens
         WHERE user_id = ? AND revoked = 0 AND expires_at > NOW()
         ORDER BY last_used_at DESC LIMIT 1`,
        [req.user.id]
      );
      storedSession = session ?? null;
    } catch (err) {
      signals.push('session_lookup_failed');
    }

    const storedFp = storedSession?.device_fingerprint || null;
    const fpMatch = storedFp ? deviceFingerprintModule.matches(storedFp, currentFp) : true;
    
    if (storedFp) signals.push(fpMatch ? 'device_fingerprint_match' : 'device_fingerprint_mismatch');
    else signals.push('no_stored_fingerprint');

    if (mfaVerified) signals.push('mfa_verified');
    if (mfaEnrolled && !mfaVerified) signals.push('mfa_enrolled_not_verified');

    if (req.meta?.isBot) {
      signals.push('bot_user_agent');
    }

    const storedIp = storedSession?.last_used_ip ?? storedSession?.ip_address;
    const currentIp = req.meta?.ip;
    let ipDriftRecent = false;
    
    if (storedIp && currentIp && storedIp !== currentIp && storedSession?.last_used_at) {
      const ageSec = (Date.now() - new Date(storedSession.last_used_at).getTime()) / 1000;
      ipDriftRecent = ageSec < 3600; // 1 hour tolerance
      if (ipDriftRecent) warnings.push('ip_drift_recent');
      else signals.push('ip_changed_aged');
    }

    const riskScore = req.riskScore ?? 0;

    if (mfaVerified && fpMatch) {
      req.trustContext = { level: 'full', score: 100, signals, warnings };
      req.deviceFp = currentFp;
      return next();
    }

    if (riskScore >= 60 || !fpMatch || (mfaEnrolled && !mfaVerified) || ipDriftRecent) {
      if (riskScore >= 60) signals.push(`high_risk_score:${riskScore}`);
      if (!fpMatch) signals.push('device_fingerprint_mismatch');
      req.trustContext = { level: 'limited', score: 40, signals, warnings };
      req.deviceFp = currentFp;

      LogModel.write({
        userId    : req.user.id,
        eventType : LOG_EVENTS.SUSPICIOUS_ACTIVITY,
        severity  : 'warn',
        ipAddress : req.meta?.ip,
        endpoint  : req.originalUrl,
        method    : req.method,
        message   : `Low trust (limited): signals=${signals.join(', ')}`,
        payload   : { warnings },
      }).catch(() => {});

      return next();
    }

    req.trustContext = { level: 'standard', score: 70, signals, warnings };
    req.deviceFp = currentFp;
    return next();
  } catch (err: any) {
    console.error('[TrustEvaluator Error]:', err);
    logger.error('[evaluateTrust] error:', err?.message ?? String(err));
    req.trustContext = { level: 'limited', score: 40, signals: ['evaluate_error'], warnings: [] };
    return next();
  }
};

// ─────────────────────────────────────────────
// requireTrust(level)
// ─────────────────────────────────────────────
const requireTrust = (requiredLevel = 'standard') => {
  return (req: TrustRequest, res: Response, next: NextFunction): any => {
    if (!req.user) {
      return res.status(401).json({ success: false, message: 'Authentication required.' });
    }

    if (!req.trustContext) {
      return next();
    }

    const current  = TRUST_LEVELS[req.trustContext.level] ?? 0;
    const required = TRUST_LEVELS[requiredLevel]           ?? 70;

    if (current < required) {
      logger.warn(
        `[ZeroTrust] Trust gate blocked: userId=${req.user.id} ` +
        `level=${req.trustContext.level}(${current}) required=${requiredLevel}(${required})`
      );

      return res.status(403).json({
        success        : false,
        message        : 'Insufficient trust level for this operation.',
        code           : 'TRUST_LEVEL_INSUFFICIENT',
        yourTrustLevel : req.trustContext.level,
        requiredLevel,
        signals        : req.trustContext.signals,
        warnings       : req.trustContext.warnings,
        remediation    : buildRemediation(req.trustContext),
      });
    }

    next();
  };
};

// ─────────────────────────────────────────────
// scopedPermissions()
// ─────────────────────────────────────────────
const scopedPermissions = (req: TrustRequest, res: Response, next: NextFunction): any => {
  if (!req.user) return next();

  const level = req.trustContext?.level ?? 'standard';

  const SCOPES: Record<string, any> = {
    full: {
      canRead         : true,
      canWrite        : true,
      canPurchase     : true,
      canWithdraw     : true,
      canChangeProfile: true,
      canDeleteAccount: true,
    },
    standard: {
      canRead         : true,
      canWrite        : true,
      canPurchase     : true,
      canWithdraw     : false,
      canChangeProfile: true,
      canDeleteAccount: false,
    },
    limited: {
      canRead         : true,
      canWrite        : false,
      canPurchase     : false,
      canWithdraw     : false,
      canChangeProfile: false,
      canDeleteAccount: false,
    },
    none: {
      canRead         : false,
      canWrite        : false,
      canPurchase     : false,
      canWithdraw     : false,
      canChangeProfile: false,
      canDeleteAccount: false,
    },
  };

  req.permissions = SCOPES[level] ?? SCOPES.standard;
  next();
};

export = {
  evaluateTrust,
  requireTrust,
  scopedPermissions,
  TRUST_LEVELS,
};