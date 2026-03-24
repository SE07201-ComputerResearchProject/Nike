// utils/ipBlocklist.ts
// ─────────────────────────────────────────────
// IP block list with optional Redis-backed persistence.
// ─────────────────────────────────────────────

import logger from './logger';
const redisClient = require('./redisClient');

interface BlockInfo {
  expiresAt: number;
  reason: string;
  blockedAt: string;
}

interface BlockDetail extends Omit<BlockInfo, 'expiresAt'> {
  ip: string;
  expiresAt: string;
  remainingMs: number;
}

// In-memory fallback storage
const blockList = new Map<string, BlockInfo>();
const REDIS_PREFIX = 'ipblock:';

const redisKey = (ip: string): string => `${REDIS_PREFIX}${ip}`;

// ── Periodic cleanup for in-memory store ──────
setInterval(() => {
  const now = Date.now();
  let removed = 0;
  for (const [ip, info] of blockList.entries()) {
    if (info.expiresAt <= now) {
      blockList.delete(ip);
      removed++;
    }
  }
  if (removed > 0) {
    logger.debug(`[IPBlocklist] Swept ${removed} expired ban(s).`);
  }
}, 5 * 60 * 1000).unref();

const block = async (ip: string, durationMs: number = 60 * 60 * 1000, reason: string = 'Automated security block'): Promise<void> => {
  const expiresAt = Date.now() + durationMs;

  if (redisClient) {
    try {
      const payload = JSON.stringify({ expiresAt, reason, blockedAt: new Date().toISOString() });
      const key = redisKey(ip);
      await redisClient.set(key, payload, 'PX', durationMs);
      logger.warn(`[IPBlocklist][redis] Blocked IP=${ip} for ${Math.round(durationMs / 60000)} min — ${reason}`);
      return;
    } catch (err: any) {
      logger.error('[IPBlocklist] Redis set failed, falling back to memory:', err.message);
    }
  }

  const info: BlockInfo = { expiresAt, reason, blockedAt: new Date().toISOString() };
  blockList.set(ip, info);
  logger.warn(`[IPBlocklist] Blocked IP=${ip} for ${Math.round(durationMs / 60000)} min — ${reason}`);
};

const isBlocked = async (ip: string): Promise<boolean> => {
  if (redisClient) {
    try {
      const key = redisKey(ip);
      const v = await redisClient.get(key);
      return !!v;
    } catch (err: any) {
      logger.error('[IPBlocklist] Redis get failed, falling back to memory:', err.message);
    }
  }

  const info = blockList.get(ip);
  if (!info) return false;
  if (info.expiresAt <= Date.now()) {
    blockList.delete(ip);
    return false;
  }
  return true;
};

const unblock = async (ip: string): Promise<boolean> => {
  let existed = false;
  if (redisClient) {
    try {
      const key = redisKey(ip);
      existed = (await redisClient.del(key)) > 0;
      if (existed) logger.info(`[IPBlocklist][redis] Unblocked IP=${ip}`);
      return existed;
    } catch (err: any) {
      logger.error('[IPBlocklist] Redis del failed, falling back to memory:', err.message);
    }
  }

  existed = blockList.has(ip);
  blockList.delete(ip);
  if (existed) logger.info(`[IPBlocklist] Unblocked IP=${ip}`);
  return existed;
};

const getBlockInfo = async (ip: string): Promise<BlockDetail | null> => {
  if (redisClient) {
    try {
      const key = redisKey(ip);
      const raw = await redisClient.get(key);
      if (!raw) return null;
      
      const parsed: BlockInfo = JSON.parse(raw);
      const ttlMs = await redisClient.pttl(key);
      
      return {
        ip,
        reason: parsed.reason,
        blockedAt: parsed.blockedAt,
        expiresAt: new Date(parsed.expiresAt).toISOString(),
        remainingMs: ttlMs > 0 ? ttlMs : Math.max(0, parsed.expiresAt - Date.now()),
      };
    } catch (err: any) {
      logger.error('[IPBlocklist] Redis error, checking memory:', err.message);
    }
  }

  const info = blockList.get(ip);
  if (!info || info.expiresAt <= Date.now()) return null;
  return {
    ip,
    reason: info.reason,
    blockedAt: info.blockedAt,
    expiresAt: new Date(info.expiresAt).toISOString(),
    remainingMs: info.expiresAt - Date.now(),
  };
};

const listAll = async (): Promise<Partial<BlockDetail>[]> => {
  if (redisClient) {
    try {
      const keys: string[] = [];
      let cursor = '0';
      do {
        const reply = await redisClient.scan(cursor, 'MATCH', `${REDIS_PREFIX}*`, 'COUNT', 100);
        cursor = reply[0];
        keys.push(...(reply[1] || []));
      } while (cursor !== '0');

      if (keys.length === 0) return [];
      const values = await redisClient.mGet(keys);
      const out: Partial<BlockDetail>[] = [];
      
      for (let i = 0; i < keys.length; i++) {
        const raw = values[i];
        if (!raw) continue;
        const parsed: BlockInfo = JSON.parse(raw);
        out.push({
          ip: keys[i].slice(REDIS_PREFIX.length),
          reason: parsed.reason,
          blockedAt: parsed.blockedAt,
          expiresAt: new Date(parsed.expiresAt).toISOString(),
        });
      }
      return out;
    } catch (err: any) {
      logger.error('[IPBlocklist] Redis list failed:', err.message);
    }
  }

  const now = Date.now();
  return Array.from(blockList.entries())
    .filter(([_, info]) => info.expiresAt > now)
    .map(([ip, info]) => ({
      ip,
      reason: info.reason,
      blockedAt: info.blockedAt,
      expiresAt: new Date(info.expiresAt).toISOString(),
      remainingMs: info.expiresAt - now,
    }))
    .sort((a, b) => (b.remainingMs || 0) - (a.remainingMs || 0));
};

const size = async (): Promise<number> => {
  if (redisClient) {
    try {
      let cursor = '0';
      let count = 0;
      do {
        const reply = await redisClient.scan(cursor, 'MATCH', `${REDIS_PREFIX}*`, 'COUNT', 100);
        cursor = reply[0];
        count += (reply[1] || []).length;
      } while (cursor !== '0');
      return count;
    } catch (err: any) {
      logger.error('[IPBlocklist] Redis size failed:', err.message);
    }
  }

  const now = Date.now();
  return Array.from(blockList.values()).filter(info => info.expiresAt > now).length;
};

export = { block, isBlocked, unblock, getBlockInfo, listAll, size };