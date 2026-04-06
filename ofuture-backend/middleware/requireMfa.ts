// middleware/requireMfa.ts
// ─────────────────────────────────────────────
// MFA enforcement middleware for Phase 11.
// ─────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
import { LogModel, LOG_EVENTS } from '../models/logModel';
import logger from '../utils/logger';

// Extend Express Request to include custom properties
interface MfaRequest extends Request {
  user?: any;
  meta?: any;
  riskScore?: number;
  riskSignals?: string[];
}

interface AdaptiveMfaOptions {
  requireEnrollment?: boolean;
  riskThreshold?: number;
}

// ─────────────────────────────────────────────
// 1. requireMfaVerified
// ─────────────────────────────────────────────
const requireMfaVerified = async (req: MfaRequest, res: Response, next: NextFunction) => {
  if (!req.user) return next();

  if (req.user.mfaEnabled && !req.user.mfaVerified) {
    const ip = req.meta?.ip ?? 'unknown';

    logger.warn(
      `[MFA] MFA-enrolled user attempted access without verification: ` +
      `userId=${req.user.id} path=${req.path} ip=${ip}`
    );

    await LogModel.write({
      userId    : req.user.id,
      eventType : LOG_EVENTS.MFA_FAIL, // <-- Đã sửa thành MFA_FAIL
      severity  : 'warn',
      ipAddress : ip,
      userAgent : req.meta?.userAgent,
      endpoint  : req.originalUrl,
      method    : req.method,
      message   : `Access blocked: MFA enrolled but not verified this session`,
    }).catch(() => {});

    return res.status(403).json({
      success     : false,
      message     : 'MFA verification required. Call POST /api/mfa/verify to complete authentication.',
      mfaRequired : true,
      code        : 'MFA_NOT_VERIFIED',
      nextStep    : 'POST /api/mfa/verify  Body: { mfaToken, code, codeType: "totp"|"backup" }',
    });
  }

  next();
};

// ─────────────────────────────────────────────
// 2. requireMfaEnrolled
// ─────────────────────────────────────────────
const requireMfaEnrolled = (req: MfaRequest, res: Response, next: NextFunction) => {
  if (!req.user) return next();

  if (!req.user.mfaEnabled) {
    return res.status(403).json({
      success    : false,
      message    : 'This action requires Multi-Factor Authentication (MFA) to be enabled on your account.',
      mfaSetup   : true,
      code       : 'MFA_NOT_ENROLLED',
      nextStep   : 'POST /api/mfa/setup  then  POST /api/mfa/confirm',
    });
  }

  next();
};

// ─────────────────────────────────────────────
// 3. adaptiveMfaGate(options)
// ─────────────────────────────────────────────
const adaptiveMfaGate = ({
  requireEnrollment = false,
  riskThreshold     = 40,
}: AdaptiveMfaOptions = {}) => {
  return async (req: MfaRequest, res: Response, next: NextFunction) => {
    if (!req.user) return next();

    const riskScore  = req.riskScore  ?? 0;
    const riskSignals = req.riskSignals ?? [];

    if (riskScore >= riskThreshold && !req.user.mfaVerified) {
      const ip = req.meta?.ip ?? 'unknown';

      logger.warn(
        `[MFA] High-risk session blocked: userId=${req.user.id} ` +
        `score=${riskScore} signals=[${riskSignals.join(',')}] path=${req.path}`
      );

      await LogModel.write({
        userId    : req.user.id,
        eventType : LOG_EVENTS.MFA_FAIL, // <-- Đã sửa thành MFA_FAIL
        severity  : 'warn',
        ipAddress : ip,
        endpoint  : req.originalUrl,
        method    : req.method,
        message   : `High-risk session blocked: score=${riskScore}, signals=[${riskSignals.join(', ')}]`,
      }).catch(() => {});

      return res.status(403).json({
        success     : false,
        message     : 'High-risk session detected. MFA verification required.',
        mfaRequired : true,
        code        : 'HIGH_RISK_MFA_REQUIRED',
        riskScore,
        riskSignals,
        nextStep    : 'POST /api/mfa/verify  Body: { mfaToken, code, codeType: "totp"|"backup" }',
      });
    }

    if (req.user.mfaEnabled && !req.user.mfaVerified) {
      return res.status(403).json({
        success     : false,
        message     : 'MFA verification required. Complete your login at POST /api/mfa/verify.',
        mfaRequired : true,
        code        : 'MFA_NOT_VERIFIED',
        nextStep    : 'POST /api/mfa/verify  Body: { mfaToken, code, codeType: "totp"|"backup" }',
      });
    }

    if (requireEnrollment && !req.user.mfaEnabled) {
      return res.status(403).json({
        success   : false,
        message   : 'This action requires Multi-Factor Authentication to be enabled on your account.',
        mfaSetup  : true,
        code      : 'MFA_NOT_ENROLLED',
        nextStep  : 'POST /api/mfa/setup  then  POST /api/mfa/confirm',
      });
    }

    next();
  };
};

const mfaForFinancial = adaptiveMfaGate({ requireEnrollment: false, riskThreshold: 40 });
const mfaForAdmin = adaptiveMfaGate({ requireEnrollment: true, riskThreshold: 30 });

export = {
  requireMfaVerified,
  requireMfaEnrolled,
  adaptiveMfaGate,
  mfaForFinancial,
  mfaForAdmin,
};