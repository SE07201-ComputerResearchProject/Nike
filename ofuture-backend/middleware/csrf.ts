// middleware/csrf.ts
// ─────────────────────────────────────────────
// CSRF protection — Double-Submit Cookie pattern.
// ─────────────────────────────────────────────

import crypto from 'crypto';
import logger from '../utils/logger';
import { Request, Response, NextFunction } from 'express';

// Khai báo mở rộng để TypeScript hiểu req.meta
interface CsrfRequest extends Request {
  meta?: any;
}

const CSRF_COOKIE_NAME = 'ofuture_csrf';
const CSRF_HEADER_NAME = 'x-csrf-token';
const TOKEN_BYTES      = 32;
const COOKIE_MAX_AGE   = 4 * 60 * 60 * 1000;   // 4 hours

// ── HMAC signing ──────────────────────────────
const CSRF_SECRET = process.env.CSRF_SECRET
  ?? process.env.JWT_SECRET
  ?? 'changeme-csrf-secret-fallback';

if (!process.env.CSRF_SECRET) {
  logger.warn('[CSRF] CSRF_SECRET not set in env — falling back to JWT_SECRET. Set CSRF_SECRET explicitly in production.');
}

const signToken = (raw: string) =>
  crypto.createHmac('sha256', CSRF_SECRET).update(raw).digest('hex');

const makeToken = () => crypto.randomBytes(TOKEN_BYTES).toString('hex');

// Constant-time comparison to prevent timing attacks
const safeEqual = (a: any, b: any) => {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  if (a.length !== b.length) {
    crypto.timingSafeEqual(Buffer.alloc(32), Buffer.alloc(32));
    return false;
  }
  try {
    return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
  } catch {
    return false;
  }
};

const issueCsrfToken = (req: Request, res: Response) => {
  const raw    = makeToken();
  const signed = signToken(raw);

  res.cookie(CSRF_COOKIE_NAME, signed, {
    httpOnly : true,
    secure   : process.env.NODE_ENV === 'production',
    sameSite : 'strict',
    maxAge   : COOKIE_MAX_AGE,
    path     : '/',
  });

  res.status(200).json({
    success   : true,
    csrfToken : raw,
    message   : 'Include this token in the X-CSRF-Token header for all state-changing requests.',
    expiresIn : `${COOKIE_MAX_AGE / 3600000}h`,
  });
};

const SAFE_METHODS = new Set(['GET', 'HEAD', 'OPTIONS']);

// Sử dụng CsrfRequest thay vì Request thông thường
const verifyCsrf = (req: CsrfRequest, res: Response, next: NextFunction): any => {
  if (SAFE_METHODS.has(req.method)) return next();

  const headerToken = req.headers[CSRF_HEADER_NAME] as string;
  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];

  if (!headerToken || !cookieToken) {
    logger.warn(
      `[CSRF] Missing token: IP=${req.meta?.ip ?? 'unknown'} path=${req.path} ` +
      `hasHeader=${!!headerToken} hasCookie=${!!cookieToken}`
    );
    return res.status(403).json({
      success : false,
      message : 'CSRF token missing. Fetch a token from GET /api/auth/csrf-token and include it as X-CSRF-Token header.',
      code    : 'CSRF_TOKEN_MISSING',
    });
  }

  const expectedSigned = signToken(headerToken);

  if (!safeEqual(expectedSigned, cookieToken)) {
    logger.warn(`[CSRF] Token mismatch: IP=${req.meta?.ip ?? 'unknown'} path=${req.path}`);
    return res.status(403).json({
      success : false,
      message : 'CSRF token invalid or expired. Fetch a new token from GET /api/auth/csrf-token.',
      code    : 'CSRF_TOKEN_INVALID',
    });
  }

  next();
};

const rotateCsrfToken = (req: Request, res: Response, next: NextFunction) => {
  const raw    = makeToken();
  const signed = signToken(raw);

  res.cookie(CSRF_COOKIE_NAME, signed, {
    httpOnly : true,
    secure   : process.env.NODE_ENV === 'production',
    sameSite : 'strict',
    maxAge   : COOKIE_MAX_AGE,
    path     : '/',
  });

  res.locals.newCsrfToken = raw;
  next();
};

const clearCsrfToken = (_req: Request, res: Response, next: NextFunction) => {
  res.clearCookie(CSRF_COOKIE_NAME, {
    httpOnly : true,
    secure   : process.env.NODE_ENV === 'production',
    sameSite : 'strict',
    path     : '/',
  });
  next();
};

export = {
  issueCsrfToken,
  verifyCsrf,
  rotateCsrfToken,
  clearCsrfToken,
  CSRF_COOKIE_NAME,
  CSRF_HEADER_NAME,
};