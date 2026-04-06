// middleware/rateLimiter.ts
// ─────────────────────────────────────────────
// Centralised rate-limiter factory.
// ─────────────────────────────────────────────

import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
const SECURITY_CONFIG = require('../config/securityConfig');
import logger from '../utils/logger';
const { getClientIp } = require('../utils/securityUtils');
const redisClient = require('../utils/redisClient');

interface LimiterOptions {
  windowMs: number;
  max: number;
  message?: string;
  skipPaths?: string[];
  keyPrefix?: string;
}

// Helper: create a tiny Redis-backed store compatible with express-rate-limit
const createRedisStore = (keyPrefix = 'rl:', windowMs = 15 * 60 * 1000) => {
  const pfx = keyPrefix;
  const store = {
    incr: async (key: string, cb: (err: any, count?: number) => void) => {
      try {
        const redisKey = `${pfx}${key}`;
        const count = await redisClient.incr(redisKey);
        if (Number(count) === 1) {
          // set expiry (ms)
          await redisClient.pexpire(redisKey, windowMs);
        }
        cb(null, Number(count));
      } catch (err: any) {
        logger.error('[RateLimiter][redis] incr error:', err.message);
        cb(err);
      }
    },
    resetKey: async (key: string) => {
      try {
        const redisKey = `${pfx}${key}`;
        await redisClient.del(redisKey);
      } catch (err: any) {
        logger.error('[RateLimiter][redis] resetKey error:', err.message);
      }
    },
    increment: undefined as any // will be aliased below
  };
  store.increment = store.incr;
  return store;
};

// ─────────────────────────────────────────────
// Base factory
// ─────────────────────────────────────────────
const createLimiter = ({
  windowMs,
  max,
  message = 'Too many requests. Please try again later.',
  skipPaths = ['/health'],
  keyPrefix = '',
}: LimiterOptions) => {
  
  if (process.env.NODE_ENV === 'test') {
    return rateLimit({
      windowMs,
      max,
      standardHeaders: true,
      legacyHeaders: false,
      store: undefined,
      keyGenerator: (req: Request) => `${keyPrefix}${getClientIp(req)}`,
      skip: (req: Request) => skipPaths.some((p) => req.path === p),
      handler: (req: Request, res: Response) => {
        const ip = getClientIp(req);
        logger.warn(
          `[RateLimit] Hit: ip=${ip} path=${req.path} limit=${max}/${Math.round(windowMs / 60000)}min`
        );
        res.status(429).json({
          success: false,
          message,
          retryAfter: Math.ceil(windowMs / 1000),
        });
      },
    });
  }

  let store: any;

  try {
    const RedisStore = require('rate-limit-redis');
    let adapterClient = null;
    try {
      const IORedis = require('ioredis');
      adapterClient = new IORedis(process.env.REDIS_URL || undefined);
      logger.debug('[RateLimiter] Using ioredis client for rate-limit-redis adapter.');
    } catch (e) {
      if (redisClient) {
        adapterClient = redisClient;
        logger.debug('[RateLimiter] Using node-redis client for rate-limit-redis adapter.');
      }
    }

    if (adapterClient) {
      try {
        store = new RedisStore({ client: adapterClient, prefix: keyPrefix });
        logger.info(`[RateLimiter] Using rate-limit-redis adapter for prefix=${keyPrefix}`);
      } catch (err: any) {
        logger.warn('[RateLimiter] rate-limit-redis adapter failed to init, falling back:', err.message);
        store = undefined;
      }
    }
  } catch (err) {
    if (redisClient) {
      try {
        store = createRedisStore(keyPrefix, windowMs);
        logger.debug(`[RateLimiter] Using internal Redis store for prefix=${keyPrefix}`);
      } catch (e: any) {
        logger.warn('[RateLimiter] Failed to create internal Redis store, falling back to memory store:', e.message);
        store = undefined;
      }
    }
  }

  return rateLimit({
    windowMs,
    max,
    standardHeaders: true,
    legacyHeaders: false,
    store,
    keyGenerator: (req: Request) => `${keyPrefix}${getClientIp(req)}`,
    skip: (req: Request) => skipPaths.some((p) => req.path === p),
    handler: (req: Request, res: Response) => {
      const ip = getClientIp(req);
      logger.warn(
        `[RateLimit] Hit: ip=${ip} path=${req.path} limit=${max}/${Math.round(windowMs / 60000)}min`
      );
      res.status(429).json({
        success: false,
        message,
        retryAfter: Math.ceil(windowMs / 1000),
      });
    },
  });
};

const { auth, financial, writes, publicRead, admin, global: globalCfg } = SECURITY_CONFIG.rateLimits;

const authLimiters = {
  register: createLimiter({ ...auth.register, keyPrefix: 'rl:register:', message: 'Too many registration attempts. Try again in 1 hour.' }),
  login: createLimiter({ ...auth.login, keyPrefix: 'rl:login:', message: 'Too many login attempts. Try again in 15 minutes.' }),
  refresh: createLimiter({ ...auth.refresh, keyPrefix: 'rl:refresh:', message: 'Token refresh limit reached. Try again later.' }),
  mfa: createLimiter({ ...auth.mfa, keyPrefix: 'rl:mfa:', message: 'Too many MFA attempts. Try again in 15 minutes.' }),
};

const financialLimiter = createLimiter({ ...financial, keyPrefix: 'rl:financial:', message: 'Too many financial requests. Wait 15 minutes.' });
const writeLimiter = createLimiter({ ...writes, keyPrefix: 'rl:write:', message: 'Write rate limit reached. Wait 15 minutes.' });
const publicLimiter = createLimiter({ ...publicRead, keyPrefix: 'rl:public:', message: 'Request rate limit exceeded.' });
const adminLimiter = createLimiter({ ...admin, max: 200, keyPrefix: 'rl:admin:', message: 'Admin request rate limit reached.' });
const globalLimiter = createLimiter({ ...globalCfg, keyPrefix: 'rl:global:', message: 'Global rate limit reached. Slow down.' });

export = {
  createLimiter,
  authLimiters,
  financialLimiter,
  writeLimiter,
  publicLimiter,
  adminLimiter,
  globalLimiter,
};