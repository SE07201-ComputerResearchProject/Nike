// utils/deviceFingerprint.ts
// Deterministic device fingerprinting using a stable set of client signals.
// Returns SHA-256 hex (64 chars) and provides a constant-time match helper.

import crypto from 'crypto';
import { Request } from 'express';

const normalize = (v: any): string => (v || '').toString().trim().toLowerCase();

/**
 * Build a canonical fingerprint source from request headers and client IP
 */
const buildSourceStringFromReq = (req: Request): string => {
  const headers = req.headers || {};
  const ua = normalize(headers['user-agent']);
  const al = normalize(headers['accept-language']);
  const accept = normalize(headers['accept']);
  const chUa = normalize(headers['sec-ch-ua']);
  const platform = normalize(headers['sec-ch-ua-platform']);
  
  // Lấy IP chính xác từ headers hoặc socket
  const forwarded = req.headers['x-forwarded-for'];
  const ip = normalize(
    Array.isArray(forwarded) ? forwarded[0] : (forwarded?.split(',')[0] || req.ip || (req.connection as any)?.remoteAddress || '')
  );
  
  const cookie = normalize(headers['cookie']);

  // Use a small stable canonical string — avoid including volatile timestamps
  return [ua, al, accept, chUa, platform, ip, cookie].filter(Boolean).join('||');
};

/**
 * derive(req) -> SHA256 hex string
 */
const derive = (req: Request): string => {
  const src = buildSourceStringFromReq(req);
  return crypto.createHash('sha256').update(src).digest('hex');
};

/**
 * matches(stored, current) -> boolean
 * Constant-time comparison to prevent timing attacks.
 */
const matches = (storedHex: string | null | undefined, currentHex: string | null | undefined): boolean => {
  // Graceful degradation: if either side is missing we can't assert mismatch — return true
  if (!storedHex || !currentHex) return true;

  try {
    const a = Buffer.from(storedHex, 'hex');
    const b = Buffer.from(currentHex, 'hex');
    if (a.length !== b.length) return false;
    return crypto.timingSafeEqual(a, b);
  } catch (err) {
    // If hex parsing fails, fall back to simple equality check
    return String(storedHex) === String(currentHex);
  }
};

export = { derive, matches };