// middleware/security.ts
// ─────────────────────────────────────────────
// Complete security middleware pipeline.
// ─────────────────────────────────────────────

import { Request, Response, NextFunction } from 'express';
const SECURITY_CONFIG = require('../config/securityConfig');
import { LogModel, LOG_EVENTS } from '../models/logModel';
const { getClientIp } = require('../utils/securityUtils');
const ipBlocklist = require('../utils/ipBlocklist');
import logger from '../utils/logger';
const redisClient = require('../utils/redisClient');

interface SecurityRequest extends Request {
  meta?: any;
  user?: any;
  riskScore?: number;
  riskSignals?: string[];
}

const ipBlockEnforcer = async (req: SecurityRequest, res: Response, next: NextFunction): Promise<any> => {
  const ip = getClientIp(req);
  const info = await ipBlocklist.getBlockInfo(ip);
  if (info) {
    logger.warn(`[Security] Blocked IP attempted access: IP=${ip} path=${req.path}`);
    return res.status(403).json({
      success   : false,
      message   : 'Access denied. Your IP has been temporarily blocked due to suspicious activity.',
      unblockIn : `${Math.ceil(info.remainingMs / 60000)} minute(s)`,
    });
  }
  next();
};

const responseHardening = (_req: Request, res: Response, next: NextFunction) => {
  res.removeHeader('X-Powered-By');
  res.removeHeader('Server');
  res.setHeader('X-Content-Type-Options',       'nosniff');
  res.setHeader('X-Frame-Options',              'DENY');
  res.setHeader('X-XSS-Protection',             '1; mode=block');
  res.setHeader('Referrer-Policy',              'strict-origin-when-cross-origin');
  res.setHeader('Permissions-Policy',           'geolocation=(), microphone=(), camera=(), payment=()');
  res.setHeader('Cross-Origin-Opener-Policy',   'same-origin');
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
  next();
};

const requestFingerprint = (req: SecurityRequest, _res: Response, next: NextFunction) => {
  req.meta = {
    ip        : getClientIp(req),
    userAgent : (req.headers['user-agent'] ?? 'unknown').slice(0, 300),
    origin    : req.headers['origin']  ?? 'unknown',
    referer   : req.headers['referer'] ?? null,
    timestamp : new Date(),
    isBot     : /bot|crawler|spider|scraper|curl|wget/i.test(req.headers['user-agent'] ?? ''),
  };
  next();
};

const HPP_ARRAY_WHITELIST = new Set(['imageUrls', 'tags', 'items']);

const hppProtection = (req: Request, _res: Response, next: NextFunction) => {
  if (req.query) {
    for (const key of Object.keys(req.query)) {
      if (Array.isArray(req.query[key])) {
        req.query[key] = req.query[key][(req.query[key] as any[]).length - 1];
      }
    }
  }
  if (req.body && typeof req.body === 'object') {
    for (const key of Object.keys(req.body)) {
      if (Array.isArray(req.body[key]) && !HPP_ARRAY_WHITELIST.has(key)) {
        req.body[key] = req.body[key][req.body[key].length - 1];
      }
    }
  }
  next();
};

const cleanString = (str: string) =>
  str
    .replace(/\0/g, '')
    .replace(/<[^>]*>/g, '')
    .replace(/javascript:/gi, '')
    .replace(/on\w+\s*=/gi, '')
    .trim();

const deepSanitize = (value: any, depth = 0): any => {
  if (depth > 10) return value;
  if (typeof value === 'string') return cleanString(value);
  if (Array.isArray(value))     return value.map(v => deepSanitize(v, depth + 1));
  if (value !== null && typeof value === 'object') {
    const out: any = {};
    for (const [k, v] of Object.entries(value)) out[k] = deepSanitize(v, depth + 1);
    return out;
  }
  return value;
};

const sanitizeInputs = (req: Request, _res: Response, next: NextFunction) => {
  if (req.body  && typeof req.body  === 'object') req.body  = deepSanitize(req.body);
  if (req.query && typeof req.query === 'object') req.query = deepSanitize(req.query) as any;
  next();
};

const detectSuspiciousPayload = async (req: SecurityRequest, res: Response, next: NextFunction): Promise<any> => {
  const { suspiciousPatterns } = SECURITY_CONFIG;
  const targets = [
    JSON.stringify(req.body   ?? {}),
    JSON.stringify(req.query  ?? {}),
    JSON.stringify(req.params ?? {}),
  ].join(' ');

  for (const { name, pattern } of suspiciousPatterns) {
    if (pattern.test(targets)) {
      const ip = req.meta?.ip ?? getClientIp(req);
      logger.warn(`[Security] Suspicious pattern "${name}" IP=${ip} path=${req.path}`);

      await LogModel.write({
        userId    : req.user?.id ?? null,
        eventType : LOG_EVENTS.SUSPICIOUS_ACTIVITY,
        severity  : 'critical',
        ipAddress : ip,
        userAgent : req.meta?.userAgent,
        endpoint  : req.originalUrl,
        method    : req.method,
        message   : `Payload attack detected: pattern="${name}"`,
        payload   : { pattern: name, body: req.body, query: req.query },
      }).catch(() => {});

      trackViolation(ip, `Payload attack: ${name}`);

      return res.status(400).json({
        success : false,
        message : 'Request rejected: malicious content detected.',
      });
    }
  }
  next();
};

const violationMap = new Map<string, number[]>();
const VIOLATION_PREFIX = 'violations:';
const violationRedisKey = (ip: string) => `${VIOLATION_PREFIX}${ip}`;

const pushViolationRedis = async (ip: string, ts: number, windowMs: number) => {
  const key = violationRedisKey(ip);
  try {
    await redisClient.lPush(key, String(ts));
    await redisClient.lTrim(key, 0, 99);
    await redisClient.expire(key, Math.ceil(windowMs / 1000));
    const len = await redisClient.lLen(key);
    return Number(len);
  } catch (err) {
    return null;
  }
};

const getRecentViolationCount = async (ip: string, windowMs: number) => {
  if (redisClient) {
    try {
      const key = violationRedisKey(ip);
      const list = await redisClient.lRange(key, 0, -1);
      if (!list || list.length === 0) return 0;
      const now = Date.now();
      return list.filter((ts: any) => now - Number(ts) < windowMs).length;
    } catch (err) {}
  }

  const now = Date.now();
  const timestamps = (violationMap.get(ip) || []).filter(t => now - t < windowMs);
  return timestamps.length;
};

const trackViolation = async (ip: string, reason = 'security violation') => {
  const { autobanThreshold, autobanWindowMs, banDurationMs } = SECURITY_CONFIG.ipBlock;
  const now = Date.now();

  if (redisClient) {
    try {
      const count = await pushViolationRedis(ip, now, autobanWindowMs);
      if (count !== null) {
        if (count >= autobanThreshold) {
          await ipBlocklist.block(ip, banDurationMs, `Auto-banned: ${reason} (${count} violations)`);
          try { await redisClient.del(violationRedisKey(ip)); } catch (e) {}
        }
        return;
      }
    } catch (err) {}
  }

  const existing = violationMap.get(ip) || [];
  const timestamps = existing.filter(t => now - t < autobanWindowMs);
  timestamps.push(now);
  violationMap.set(ip, timestamps);

  if (timestamps.length >= autobanThreshold) {
    await ipBlocklist.block(ip, banDurationMs, `Auto-banned: ${reason} (${timestamps.length} violations)`);
    violationMap.delete(ip);
  }
};

const autobanCheck = async (req: SecurityRequest, res: Response, next: NextFunction) => {
  const ip = req.meta?.ip ?? getClientIp(req);
  const originalJson = res.json.bind(res);

  res.json = function (body: any) {
    const status = res.statusCode;
    if (status === 401 || status === 403 || status === 429) {
      trackViolation(ip, `HTTP ${status} on ${req.path}`).catch(() => {});
    }
    return originalJson(body);
  };

  next();
};

const riskScore = async (req: SecurityRequest, _res: Response, next: NextFunction) => {
  if (!req.user) return next();

  let score = 0;
  const signals: string[] = [];

  if (!req.headers['user-agent'] || req.meta?.isBot) {
    score += 15; signals.push('missing_or_bot_ua');
  }
  if (req.headers['x-tor-exit'] || req.headers['via']) {
    score += 20; signals.push('possible_proxy');
  }
  const hour = new Date().getUTCHours();
  if (hour >= 0 && hour < 5) {
    score += 10; signals.push('unusual_hour');
  }
  const recentViolations = await getRecentViolationCount(req.meta?.ip, 15 * 60 * 1000);
  if (recentViolations > 0) {
    score += Math.min(recentViolations * 10, 40);
    signals.push(`recent_violations:${recentViolations}`);
  }
  if (!req.user.mfaEnabled && req.path.includes('/escrow')) {
    score += 10; signals.push('mfa_disabled_financial');
  }

  req.riskScore   = Math.min(score, 100);
  req.riskSignals = signals;

  if (req.riskScore >= 30) {
    logger.warn(`[Security] High-risk request: userId=${req.user.id} score=${req.riskScore} signals=[${signals.join(',')}]`);
    await LogModel.write({
      userId    : req.user.id,
      eventType : LOG_EVENTS.SUSPICIOUS_ACTIVITY,
      severity  : 'warn',
      ipAddress : req.meta?.ip,
      endpoint  : req.originalUrl,
      method    : req.method,
      message   : `High-risk request score=${req.riskScore}: [${signals.join(', ')}]`,
    }).catch(() => {});
  }
  next();
};

const noCache = (_req: Request, res: Response, next: NextFunction) => {
  res.setHeader('Cache-Control',    'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma',           'no-cache');
  res.setHeader('Expires',          '0');
  res.setHeader('Surrogate-Control','no-store');
  next();
};

const requireHighRiskMFA = (threshold = 40) => {
  return (req: SecurityRequest, res: Response, next: NextFunction): any => {
    if (!req.user) return next();
    if ((req.riskScore ?? 0) >= threshold && !req.user.mfaVerified) {
      return res.status(403).json({
        success     : false,
        message     : 'High-risk session detected. MFA verification required.',
        mfaRequired : true,
        riskScore   : req.riskScore,
        riskSignals : req.riskSignals,
      });
    }
    next();
  };
};

export = {
  ipBlockEnforcer,
  responseHardening,
  requestFingerprint,
  hppProtection,
  sanitizeInputs,
  detectSuspiciousPayload,
  autobanCheck,
  riskScore,
  noCache,
  requireHighRiskMFA,
  trackViolation,
  _violationMap : violationMap,
};