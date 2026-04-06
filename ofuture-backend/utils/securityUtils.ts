// utils/securityUtils.ts
// ─────────────────────────────────────────────
// Reusable security helpers:
//   • JWT sign / verify
//   • Refresh token generation & hashing
//   • Slug generator
//   • IP extractor
// ─────────────────────────────────────────────

import jwt from 'jsonwebtoken';
import crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';
import { Request } from 'express';

// ── JWT ──────────────────────────────────────

/**
 * Sign a short-lived access token (default 15 min).
 * Payload contains only what middleware needs — no sensitive data.
 */
const signAccessToken = (payload: string | object | Buffer): string => {
  return jwt.sign(payload, process.env.JWT_SECRET as string, {
    expiresIn : (process.env.JWT_EXPIRES_IN || '15m') as any, // <--- Thêm as any ở đây
    issuer    : 'ofuture-api',
    audience  : 'ofuture-client',
  });
};

/**
 * Sign a long-lived refresh token (default 7 days).
 * Stored as a hash in DB — actual token sent to client only.
 */
const signRefreshToken = (payload: string | object | Buffer): string => {
  return jwt.sign(payload, process.env.JWT_REFRESH_SECRET as string, {
    expiresIn : (process.env.JWT_REFRESH_EXPIRES_IN || '7d') as any, // <--- Thêm as any ở đây
    issuer    : 'ofuture-api',
    audience  : 'ofuture-client',
  });
};

/** Verify an access token. Throws if invalid or expired. */
const verifyAccessToken = (token: string): any => {
  return jwt.verify(token, process.env.JWT_SECRET as string, {
    issuer   : 'ofuture-api',
    audience : 'ofuture-client',
  });
};

/** Verify a refresh token. Throws if invalid or expired. */
const verifyRefreshToken = (token: string): any => {
  return jwt.verify(token, process.env.JWT_REFRESH_SECRET as string, {
    issuer   : 'ofuture-api',
    audience : 'ofuture-client',
  });
};

// ── Refresh Token Storage Helpers ────────────

/**
 * Generate a cryptographically random opaque refresh token string.
 * This is what gets sent to the client (in an httpOnly cookie or body).
 */
const generateRawRefreshToken = (): string => {
  return uuidv4() + '.' + crypto.randomBytes(32).toString('hex');
};

/**
 * SHA-256 hash of a raw token for safe DB storage.
 * We never store the raw token — only its hash.
 */
const hashToken = (rawToken: string): string => {
  return crypto.createHash('sha256').update(rawToken).digest('hex');
};

// ── Miscellaneous ────────────────────────────

/** Extract real client IP, respecting proxy headers. */
const getClientIp = (req: Request): string => {
  const forwarded = req.headers['x-forwarded-for'];
  const forwardedIp = Array.isArray(forwarded) ? forwarded[0] : forwarded?.split(',')[0];
  
  return (
    forwardedIp?.trim() ||
    (req.headers['x-real-ip'] as string) ||
    req.socket?.remoteAddress ||
    req.ip ||
    'unknown'
  );
};

/**
 * Generate a URL-safe slug from a string.
 * Appends a short random suffix to guarantee uniqueness.
 */
const generateSlug = (text: string): string => {
  const base = text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')   // strip diacritics
    .replace(/[^a-z0-9\s-]/g, '')      // strip special chars
    .trim()
    .replace(/\s+/g, '-')              // spaces → hyphens
    .replace(/-+/g, '-')               // collapse hyphens
    .slice(0, 80);                     // max 80 chars

  const suffix = crypto.randomBytes(3).toString('hex'); // 6-char hex
  return `${base}-${suffix}`;
};

/**
 * Calculate when an account lockout expires.
 * Uses exponential back-off capped at 24 hours.
 */
const getLockoutExpiry = (failedAttempts: number): Date => {
  const minutes = Math.min(5 * Math.pow(2, failedAttempts - 5), 60);
  return new Date(Date.now() + minutes * 60 * 1000);
};

export = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  generateRawRefreshToken,
  hashToken,
  getClientIp,
  generateSlug,
  getLockoutExpiry,
};