// utils/redisClient.ts
// Simpler Redis client initializer with deterministic fallback for tests and dev.

import fs from 'fs';
import logger from './logger';

// ─────────────────────────────────────────────
// In-memory Redis-like client (for tests / fallback)
// ─────────────────────────────────────────────
const createMemoryClient = (): any => {
  const store = new Map<string, string>();
  const lists = new Map<string, string[]>();
  const ttls = new Map<string, number>();

  const isExpired = (key: string): boolean => {
    const t = ttls.get(key);
    if (!t) return false;
    if (Date.now() > t) {
      store.delete(key);
      lists.delete(key);
      ttls.delete(key);
      return true;
    }
    return false;
  };

  return {
    async get(key: string) {
      if (isExpired(key)) return null;
      return store.has(key) ? store.get(key) : null;
    },
    async set(key: string, value: any, ...extra: any[]) {
      store.set(key, String(value));
      if (extra && extra.length >= 2) {
        const mode = String(extra[0]).toUpperCase();
        const duration = Number(extra[1]);
        if (mode === 'PX' && !Number.isNaN(duration)) {
          ttls.set(key, Date.now() + duration);
        }
      }
      return 'OK';
    },
    async del(key: string) {
      const existed = store.delete(key) || lists.delete(key);
      ttls.delete(key);
      return existed ? 1 : 0;
    },

    async lPush(key: string, ...values: any[]) {
      if (isExpired(key)) { /* cleared */ }
      const arr = lists.get(key) || [];
      for (const v of values) arr.unshift(String(v));
      lists.set(key, arr);
      return arr.length;
    },
    async lTrim(key: string, start: number = 0, stop: number = -1) {
      const arr = lists.get(key) || [];
      const s = Math.max(0, start);
      const e = stop === -1 ? arr.length - 1 : stop;
      const sliced = arr.slice(s, e + 1);
      lists.set(key, sliced);
      return 'OK';
    },
    async lLen(key: string) {
      if (isExpired(key)) return 0;
      const arr = lists.get(key) || [];
      return arr.length;
    },
    async lRange(key: string, start: number = 0, stop: number = -1) {
      if (isExpired(key)) return [];
      const arr = lists.get(key) || [];
      const s = start < 0 ? arr.length + start : start;
      const e = stop < 0 ? arr.length + stop : stop;
      return arr.slice(s, e + 1);
    },

    async expire(key: string, seconds: number) {
      if (!store.has(key) && !lists.has(key)) return 0;
      ttls.set(key, Date.now() + seconds * 1000);
      return 1;
    },
    async pexpire(key: string, ms: number) {
      if (!store.has(key) && !lists.has(key)) return 0;
      ttls.set(key, Date.now() + Number(ms));
      return 1;
    },
    async pttl(key: string) {
      if (isExpired(key)) return -2;
      if (!ttls.has(key)) return -1;
      return Math.max(0, (ttls.get(key) || 0) - Date.now());
    },

    async scan(cursor: string = '0', _match: string = 'MATCH', pattern: string = '*', _count: string = 'COUNT', count: number = 100) {
      const re = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
      const keys: string[] = [];
      for (const k of new Set([...store.keys(), ...lists.keys()])) {
        if (isExpired(k)) continue;
        if (re.test(k)) keys.push(k);
      }
      return ['0', keys.slice(0, count)];
    },
    async mGet(keys: string[]) {
      return keys.map(k => {
        if (isExpired(k)) return null;
        return store.get(k) ?? null;
      });
    },

    async incr(key: string) {
      if (isExpired(key)) { /* cleared */ }
      const cur = parseInt(store.get(key) || '0', 10) || 0;
      const next = cur + 1;
      store.set(key, String(next));
      return next;
    },

    on(event: string, fn: any) { /* noop for memory */ },
    async connect() { /* noop */ },
    async quit() { /* noop */ },
  };
};

let backend = createMemoryClient();

const buildAdapterFromRaw = (rawClient: any) => {
  if (!rawClient) return createMemoryClient();
  const pick = (names: string[]) => {
    for (const n of names) {
      if (typeof rawClient[n] === 'function') return rawClient[n].bind(rawClient);
    }
    return null;
  };

  return {
    get: pick(['get','GET','mget']),
    set: pick(['set','SET']),
    del: pick(['del','DEL','delete']),
    lPush: pick(['lpush','lPush','LPUSH']),
    lTrim: pick(['ltrim','lTrim','LTRIM']),
    lLen: pick(['llen','lLen','LLEN']),
    lRange: pick(['lrange','lRange','LRANGE']),
    expire: pick(['expire','EXPIRE']),
    pexpire: pick(['pexpire','pExpire','PEXPIRE']),
    pttl: pick(['pttl','pTtl','PTTL']),
    scan: pick(['scan','SCAN']),
    mGet: pick(['mget','mGet','MGET']),
    incr: pick(['incr','INCR']),
    connect: pick(['connect','CONNECT']) || (async () => { if (rawClient.connect) return rawClient.connect(); }),
    quit: pick(['quit','disconnect','disconnectClient']) || (async () => { if (rawClient.quit) return rawClient.quit(); if (rawClient.disconnect) return rawClient.disconnect(); }),
    on: (rawClient.on || (()=>{})).bind(rawClient),
  };
};

const proxy: any = new Proxy({}, {
  get(_target, prop: string) {
    const impl = backend[prop];
    if (typeof impl === 'function') return impl.bind(backend);
    return impl;
  },
  set(_t, prop: string, value: any) {
    backend[prop] = value; return true;
  }
});

if (process.env.NODE_ENV === 'test') {
  backend = createMemoryClient();
  module.exports = proxy;
} else {
  (async () => {
    try {
      const { REDIS_URL, REDIS_CLUSTER_HOSTS, REDIS_SENTINEL_HOSTS, REDIS_SENTINEL_NAME, REDIS_USERNAME, REDIS_PASSWORD, REDIS_TLS, REDIS_TLS_CA_PATH } = process.env;
      const hasConfig = !!(REDIS_URL || REDIS_CLUSTER_HOSTS || REDIS_SENTINEL_HOSTS);

      if (!hasConfig) {
        logger.debug('[redisClient] No Redis configuration detected — using in-memory fallback.');
        backend = createMemoryClient();
        module.exports = proxy;
        return;
      }

      try {
        const IORedis = require('ioredis');
        const tlsEnabled = String(REDIS_TLS || '').toLowerCase() === 'true';
        const tlsOptions: any = {};
        if (tlsEnabled && REDIS_TLS_CA_PATH) {
          try { tlsOptions.ca = [fs.readFileSync(REDIS_TLS_CA_PATH)]; } catch (e: any) { logger.warn('[redisClient] Failed to read REDIS_TLS_CA_PATH:', e.message); }
        }

        let rawCandidate = null;
        if (REDIS_CLUSTER_HOSTS) {
          const nodes = REDIS_CLUSTER_HOSTS.split(',').map(hp => { const [host, port] = hp.split(':'); return { host, port: Number(port || 6379) }; });
          rawCandidate = new IORedis.Cluster(nodes, { redisOptions: { username: REDIS_USERNAME || undefined, password: REDIS_PASSWORD || undefined, tls: tlsEnabled ? tlsOptions : undefined } });
        } else if (REDIS_SENTINEL_HOSTS && REDIS_SENTINEL_NAME) {
          const sentinels = REDIS_SENTINEL_HOSTS.split(',').map(hp => { const [host, port] = hp.split(':'); return { host, port: Number(port || 26379) }; });
          rawCandidate = new IORedis({ sentinels, name: REDIS_SENTINEL_NAME, username: REDIS_USERNAME || undefined, password: REDIS_PASSWORD || undefined, tls: tlsEnabled ? tlsOptions : undefined });
        } else if (REDIS_URL) {
          rawCandidate = new IORedis(REDIS_URL, { username: REDIS_USERNAME || undefined, password: REDIS_PASSWORD || undefined, tls: tlsEnabled ? tlsOptions : undefined });
        }

        if (rawCandidate) {
          rawCandidate.on('error', (err: any) => {
            logger.warn('[redisClient] ioredis error — falling back to in-memory client. Error:', err?.message || String(err));
            try { rawCandidate.disconnect && rawCandidate.disconnect(); } catch (e) {}
            backend = createMemoryClient();
          });
          rawCandidate.on('ready', () => {
            logger.info('[redisClient] ioredis ready — using real Redis client.');
            backend = buildAdapterFromRaw(rawCandidate);
          });

          backend = buildAdapterFromRaw(rawCandidate);
          module.exports = proxy;
          return;
        }
      } catch (e: any) {
        logger.warn('[redisClient] ioredis not available or failed to initialize:', e.message || String(e));
      }

      try {
        const { createClient } = require('redis');
        const options = { url: process.env.REDIS_URL || undefined, username: process.env.REDIS_USERNAME || undefined, password: process.env.REDIS_PASSWORD || undefined };
        const nr = createClient(options);
        nr.on('error', (err: any) => {
          logger.warn('[redisClient] node-redis error — falling back to in-memory client. Error:', err?.message || String(err));
          try { nr.disconnect && nr.disconnect(); } catch (e) {}
          backend = createMemoryClient();
        });
        await nr.connect().then(() => {
          logger.info('[redisClient] node-redis connected — using real Redis.');
          backend = buildAdapterFromRaw(nr);
        }).catch((err: any) => {
          logger.warn('[redisClient] node-redis connect failed — using in-memory. Error:', err?.message || String(err));
          backend = createMemoryClient();
        });

        module.exports = proxy;
        return;
      } catch (e2) {
        logger.warn('[redisClient] node-redis not installed or failed, using in-memory fallback.');
      }

      backend = createMemoryClient();
      module.exports = proxy;

    } catch (topErr: any) {
      logger.error('[redisClient] Unexpected initialization error:', topErr.message || String(topErr));
      backend = createMemoryClient();
      module.exports = proxy;
    }
  })();
}

export = proxy;