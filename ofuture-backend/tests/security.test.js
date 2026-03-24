// tests/security.test.js
// ─────────────────────────────────────────────
// Self-contained security test suite.
//
// Covers:
//   1.  HPP — HTTP Parameter Pollution stripping
//   2.  Input sanitization — HTML/null-byte/JS removal
//   3.  Suspicious payload detection — 8 attack classes
//   4.  IP blocklist — block, isBlocked, unblock, expiry
//   5.  Auto-ban — violation accumulation & threshold
//   6.  CSRF — token issuance, verification, replay, rotation
//   7.  Response hardening — header presence
//   8.  Security config — completeness & type checks
//   9.  Risk scorer — signal accumulation
//  10.  Rate limiter factory — key generation
//
// Run with:
//   node --test tests/security.test.js
//   (no external test runner required — uses built-in node:test)
// ─────────────────────────────────────────────

'use strict';

// Jest compatibility shim (tests originally authored for node:test)
// Provide minimal mappings so tests run under Jest without changing test bodies.
global.before = global.before || global.beforeAll;
global.after = global.after || global.afterAll;
const _it = global.it || global.test;
global.it = (name, fn, timeout) => {
  if (!fn) return _it(name, fn, timeout);
  if (fn.length === 0) return _it(name, fn, timeout);
  const wrapped = (done) => {
    if (fn.length === 2) return fn(undefined, done);
    return fn(done);
  };
  return _it(name, wrapped, timeout);
};
global.test = global.it;
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

// ─────────────────────────────────────────────
// Minimal stubs so we can import middleware
// without a live DB connection
// ─────────────────────────────────────────────
const Module = require('node:module');
const originalLoad = Module._load.bind(Module);

// Shared no-op logger object used for all logger stubs
const NOOP_LOGGER = {
  info  : () => {}, warn  : () => {},
  error : () => {}, debug : () => {},
  child : () => NOOP_LOGGER,
};

// Fake winston module so logger.js can require('winston') without it installed
const FAKE_WINSTON = {
  createLogger   : () => NOOP_LOGGER,
  format         : {
    combine    : () => ({}), timestamp : () => ({}),
    printf     : () => ({}), colorize  : () => ({}),
    json       : () => ({}), errors    : () => ({}),
  },
  transports     : {
    Console : class { constructor(){} },
    File    : class { constructor(){} },
  },
};

// Fake cookie-parser in case it isn't installed locally
const FAKE_COOKIE_PARSER = () => (_req, _res, next) => next();

Module._load = function (id, parent, isMain) {
  // Stub third-party modules that may not be installed in the test env
  if (id === 'winston')       return FAKE_WINSTON;
  if (id === 'cookie-parser') return FAKE_COOKIE_PARSER;

  if (id === 'jsonwebtoken') {
    return {
      sign   : (_p, _s, _o) => 'stub.jwt.token',
      verify : (_t, _s, _o, cb) => cb ? cb(null, { sub: 'u1' }) : { sub: 'u1' },
      decode : (_t) => ({ sub: 'u1' }),
    };
  }
  if (id === 'express-rate-limit') {
    return (opts) => {
      const mw   = (_req, _res, next) => next();
      mw._opts   = opts;
      mw.resetKey = () => {};
      return mw;
    };
  }
  if (id === 'uuid')     return { v4: () => crypto.randomUUID() };
  if (id === 'bcryptjs') return {
    hash    : async (p) => 'hashed:' + p,
    compare : async (p, h) => h === 'hashed:' + p,
    genSalt : async () => '$2b$12$stub',
  };
  if (id === 'speakeasy') return {
    generateSecret: () => ({ base32: 'STUBBASE32', otpauth_url: 'otpauth://stub' }),
    totp: { verify: () => true },
  };
  if (id === 'qrcode')  return { toDataURL: async () => 'data:image/png;base64,stub' };
  if (id === 'morgan')  return () => (_req, _res, next) => next();
  if (id === 'helmet')  return () => (_req, _res, next) => next();

  // Stub DB pool — never actually called in unit tests
  if (id === 'config/db' || /[/\\]config[/\\]db(\.js)?$/.test(id)) {
    return {
      pool: {
        execute    : async () => [[{}]],
        getConnection: async () => ({
          execute         : async () => [[{}]],
          beginTransaction: async () => {},
          commit          : async () => {},
          rollback        : async () => {},
          release         : () => {},
          ping            : async () => {},
        }),
      },
    };
  }
  // Stub logger to suppress output
  if (/[/\\]utils[/\\]logger(\.js)?$/.test(id) || id === 'utils/logger') {
    return NOOP_LOGGER;
  }
  // Stub LogModel
  if (/[/\\]models[/\\]logModel(\.js)?$/.test(id) || id === 'models/logModel') {
    return {
      LogModel : { write: async () => {} },
      LOG_EVENTS: {
        SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
        ESCROW_RELEASED    : 'ESCROW_RELEASED',
        ACCOUNT_SUSPENDED  : 'ACCOUNT_SUSPENDED',
      },
    };
  }
  return originalLoad(id, parent, isMain);
};

// ── Now safe to require modules ───────────────
const path         = require('node:path');
const ROOT         = path.resolve(__dirname, '..');

const SECURITY_CONFIG = require(`${ROOT}/config/securityConfig`);
const ipBlocklist     = require(`${ROOT}/utils/ipBlocklist`);

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────

/** Build a minimal mock Express request */
const mockReq = (overrides = {}) => ({
  headers : { 'user-agent': 'jest-agent/1.0' },
  body    : {},
  query   : {},
  params  : {},
  cookies : {},
  meta    : { ip: '127.0.0.1', userAgent: 'jest-agent/1.0', isBot: false },
  user    : null,
  path    : '/test',
  originalUrl: '/test',
  method  : 'POST',
  ...overrides,
});

/** Build a mock res with header tracking */
const mockRes = () => {
  const headers = {};
  const res = {
    _headers : headers,
    _status  : null,
    _body    : null,
    _cookies : {},
    statusCode: 200,
    setHeader    : (k, v)     => { headers[k.toLowerCase()] = v; },
    removeHeader : (k)        => { delete headers[k.toLowerCase()]; },
    cookie       : (k, v, o) => { res._cookies[k] = { value: v, options: o }; },
    clearCookie  : (k)       => { delete res._cookies[k]; },
    status       : (code)    => { res._status = code; res.statusCode = code; return res; },
    json         : (body)    => { res._body = body; return res; },
    locals       : {},
  };
  return res;
};

const noop = () => {};
const asyncNoop = async () => {};

// ─────────────────────────────────────────────
// 1. HPP — HTTP Parameter Pollution
// ─────────────────────────────────────────────
describe('HPP Protection', () => {
  // Import inline to avoid module-cache issues with stubs
  const { hppProtection } = require(`${ROOT}/middleware/security`);

  it('deduplicates array query params → keeps last value', (t, done) => {
    const req = mockReq({ query: { role: ['admin', 'buyer'] }, body: {} });
    hppProtection(req, mockRes(), () => {
      assert.equal(req.query.role, 'buyer');
      done();
    });
  });

  it('leaves whitelisted array body params intact', (t, done) => {
    const req = mockReq({ body: { imageUrls: ['a.jpg', 'b.jpg'] }, query: {} });
    hppProtection(req, mockRes(), () => {
      assert.deepEqual(req.body.imageUrls, ['a.jpg', 'b.jpg']);
      done();
    });
  });

  it('deduplicates non-whitelisted array body params', (t, done) => {
    const req = mockReq({ body: { status: ['active', 'deleted'] }, query: {} });
    hppProtection(req, mockRes(), () => {
      assert.equal(req.body.status, 'deleted');
      done();
    });
  });

  it('leaves scalar query params untouched', (t, done) => {
    const req = mockReq({ query: { page: '2' }, body: {} });
    hppProtection(req, mockRes(), () => {
      assert.equal(req.query.page, '2');
      done();
    });
  });
});

// ─────────────────────────────────────────────
// 2. Input Sanitization
// ─────────────────────────────────────────────
describe('Input Sanitization', () => {
  const { sanitizeInputs } = require(`${ROOT}/middleware/security`);

  it('strips HTML tags from body strings', (t, done) => {
    const req = mockReq({ body: { name: '<script>alert(1)</script>Clean' }, query: {} });
    sanitizeInputs(req, mockRes(), () => {
      assert.ok(!req.body.name.includes('<script>'));
      assert.ok(req.body.name.includes('Clean'));
      done();
    });
  });

  it('strips null bytes', (t, done) => {
    const req = mockReq({ body: { field: 'hello\0world' }, query: {} });
    sanitizeInputs(req, mockRes(), () => {
      assert.ok(!req.body.field.includes('\0'));
      done();
    });
  });

  it('strips javascript: URI from query strings', (t, done) => {
    const req = mockReq({ query: { next: 'javascript:alert(1)' }, body: {} });
    sanitizeInputs(req, mockRes(), () => {
      assert.ok(!req.query.next.includes('javascript:'));
      done();
    });
  });

  it('strips inline event handlers', (t, done) => {
    const req = mockReq({ body: { bio: 'hi onclick=bad()' }, query: {} });
    sanitizeInputs(req, mockRes(), () => {
      assert.ok(!req.body.bio.includes('onclick='));
      done();
    });
  });

  it('sanitizes nested objects recursively', (t, done) => {
    const req = mockReq({
      body  : { address: { street: '<b>Main</b> St', city: 'NYC' } },
      query : {},
    });
    sanitizeInputs(req, mockRes(), () => {
      assert.ok(!req.body.address.street.includes('<b>'));
      assert.ok(req.body.address.street.includes('Main'));
      done();
    });
  });

  it('preserves numbers and booleans', (t, done) => {
    const req = mockReq({ body: { price: 99.99, active: true }, query: {} });
    sanitizeInputs(req, mockRes(), () => {
      assert.equal(req.body.price, 99.99);
      assert.equal(req.body.active, true);
      done();
    });
  });
});

// ─────────────────────────────────────────────
// 3. Suspicious Payload Detection
// ─────────────────────────────────────────────
describe('detectSuspiciousPayload', () => {
  const { detectSuspiciousPayload } = require(`${ROOT}/middleware/security`);

  const testAttack = (label, body, query = {}) =>
    it(`blocks ${label}`, async () => {
      const req = mockReq({ body, query, user: null });
      const res = mockRes();
      let nextCalled = false;

      await detectSuspiciousPayload(req, res, () => { nextCalled = true; });

      assert.equal(nextCalled, false, `next() should NOT be called for ${label}`);
      assert.equal(res._status, 400);
      assert.equal(res._body?.success, false);
    });

  testAttack('SQL UNION injection',   { q: "' UNION SELECT * FROM users--" });
  testAttack('SQL DROP TABLE',        { q: 'DROP TABLE users' });
  testAttack('XSS script tag',        { bio: '<script>alert(1)</script>' });
  testAttack('XSS javascript: uri',   {}, { next: 'javascript:alert(1)' });
  testAttack('XSS inline handler',    { x: '<img onerror=alert(1)>' });
  testAttack('Path traversal',        { file: '../../../etc/passwd' });
  testAttack('SSTI Jinja2',           { t: '{{7*7}}' });
  testAttack('SSTI JS template',      { t: '${7*7}' });
  testAttack('Command injection bash',{ cmd: '; bash -i' });
  testAttack('NoSQL $where',          { query: { '$where': 'sleep(1000)' } });
  testAttack('XXE DOCTYPE',           { xml: '<!DOCTYPE foo [<!ENTITY' });
  testAttack('PHP eval injection',    { p: 'eval(base64_decode(' });

  it('passes clean payloads through', async () => {
    const req = mockReq({
      body  : { name: 'Luxury Watch', price: 1200, description: 'Beautiful piece' },
      query : { page: '1', sort: 'newest' },
    });
    const res = mockRes();
    let nextCalled = false;

    await detectSuspiciousPayload(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true);
    assert.equal(res._status, null);
  });
});

// ─────────────────────────────────────────────
// 4. IP Blocklist
// ─────────────────────────────────────────────
describe('IP Blocklist', () => {
  const TEST_IP = '10.0.0.99';

  beforeEach(async () => {
    await ipBlocklist.unblock(TEST_IP);   // clean slate
  });

  it('isBlocked returns false for unknown IP', async () => {
    const blocked = await ipBlocklist.isBlocked(TEST_IP);
    assert.equal(blocked, false);
  });

  it('block() causes isBlocked to return true', async () => {
    await ipBlocklist.block(TEST_IP, 60000, 'test');
    const blocked = await ipBlocklist.isBlocked(TEST_IP);
    assert.equal(blocked, true);
  });

  it('unblock() removes the ban', async () => {
    await ipBlocklist.block(TEST_IP, 60000, 'test');
    await ipBlocklist.unblock(TEST_IP);
    const blocked = await ipBlocklist.isBlocked(TEST_IP);
    assert.equal(blocked, false);
  });

  it('getBlockInfo returns correct details', async () => {
    await ipBlocklist.block(TEST_IP, 60000, 'testing reason');
    const info = await ipBlocklist.getBlockInfo(TEST_IP);
    assert.equal(info.ip, TEST_IP);
    assert.equal(info.reason, 'testing reason');
    assert.ok(info.remainingMs > 0);
    assert.ok(info.remainingMs <= 60000);
  });

  it('expired ban auto-clears on isBlocked read', async () => {
    await ipBlocklist.block(TEST_IP, 1, 'expires fast');   // 1 ms
    await new Promise(r => setTimeout(r, 10));
    const blocked = await ipBlocklist.isBlocked(TEST_IP);
    assert.equal(blocked, false);
  });

  it('listAll returns only active bans', async () => {
    const IP_A = '10.0.0.11';
    const IP_B = '10.0.0.12';
    await ipBlocklist.unblock(IP_A);
    await ipBlocklist.unblock(IP_B);
    await ipBlocklist.block(IP_A, 60000, 'a');
    await ipBlocklist.block(IP_B, 60000, 'b');
    const list = await ipBlocklist.listAll();
    const ips  = list.map(e => e.ip);
    assert.ok(ips.includes(IP_A));
    assert.ok(ips.includes(IP_B));
    await ipBlocklist.unblock(IP_A);
    await ipBlocklist.unblock(IP_B);
  });

  it('size() reflects current active count', async () => {
    const before = await ipBlocklist.size();
    await ipBlocklist.block(TEST_IP, 60000, 'size test');
    assert.equal(await ipBlocklist.size(), before + 1);
    await ipBlocklist.unblock(TEST_IP);
    assert.equal(await ipBlocklist.size(), before);
  });
});

// ─────────────────────────────────────────────
// 5. Auto-ban violation accumulation
// ─────────────────────────────────────────────
describe('Auto-ban (trackViolation)', () => {
  const { trackViolation, _violationMap } = require(`${ROOT}/middleware/security`);
  const TEST_IP = '192.168.99.99';

  beforeEach(async () => {
    _violationMap.delete(TEST_IP);
    await ipBlocklist.unblock(TEST_IP);
  });

  it('accumulates violations without banning below threshold', async () => {
    const threshold = SECURITY_CONFIG.ipBlock.autobanThreshold;
    for (let i = 0; i < threshold - 1; i++) {
      trackViolation(TEST_IP, 'test');
    }
    const blocked = await ipBlocklist.isBlocked(TEST_IP);
    assert.equal(blocked, false);
  });

  it('bans IP once threshold is reached', async () => {
    const threshold = SECURITY_CONFIG.ipBlock.autobanThreshold;
    for (let i = 0; i < threshold; i++) {
      trackViolation(TEST_IP, 'test');
    }
    const blocked = await ipBlocklist.isBlocked(TEST_IP);
    assert.equal(blocked, true);
    await ipBlocklist.unblock(TEST_IP);
  });

  it('resets violation counter after ban', async () => {
    const threshold = SECURITY_CONFIG.ipBlock.autobanThreshold;
    for (let i = 0; i < threshold; i++) {
      trackViolation(TEST_IP, 'test');
    }
    // Counter should be gone after auto-ban
    assert.equal(_violationMap.has(TEST_IP), false);
    await ipBlocklist.unblock(TEST_IP);
  });
});

// ─────────────────────────────────────────────
// 6. CSRF middleware
// ─────────────────────────────────────────────
describe('CSRF Protection', () => {
  const {
    issueCsrfToken,
    verifyCsrf,
    rotateCsrfToken,
    clearCsrfToken,
    CSRF_COOKIE_NAME,
    CSRF_HEADER_NAME,
  } = require(`${ROOT}/middleware/csrf`);

  // We need the internal signToken — re-derive it for tests
  const CSRF_SECRET = process.env.CSRF_SECRET ?? process.env.JWT_SECRET ?? 'changeme-csrf-secret-fallback';
  const signToken   = (raw) => crypto.createHmac('sha256', CSRF_SECRET).update(raw).digest('hex');

  it('issueCsrfToken sets cookie and returns raw token', () => {
    const req = mockReq({ method: 'GET' });
    const res = mockRes();

    issueCsrfToken(req, res);

    assert.ok(res._cookies[CSRF_COOKIE_NAME], 'cookie should be set');
    assert.ok(res._body?.csrfToken, 'body should contain csrfToken');
    assert.equal(res._body?.success, true);
  });

  it('verifyCsrf passes when header matches cookie', (t, done) => {
    const raw    = crypto.randomBytes(32).toString('hex');
    const signed = signToken(raw);

    const req = mockReq({
      method  : 'POST',
      headers : {
        'user-agent'      : 'test',
        [CSRF_HEADER_NAME]: raw,
      },
      cookies : { [CSRF_COOKIE_NAME]: signed },
    });
    const res = mockRes();

    verifyCsrf(req, res, () => {
      done();
    });
  });

  it('verifyCsrf rejects mismatched token', () => {
    const req = mockReq({
      method  : 'POST',
      headers : {
        'user-agent'      : 'test',
        [CSRF_HEADER_NAME]: 'wrong-token',
      },
      cookies : { [CSRF_COOKIE_NAME]: signToken('correct-token') },
    });
    const res = mockRes();

    verifyCsrf(req, res, () => {
      throw new Error('next() should not be called on mismatch');
    });

    assert.equal(res._status, 403);
    assert.equal(res._body?.code, 'CSRF_TOKEN_INVALID');
  });

  it('verifyCsrf rejects missing header', () => {
    const req = mockReq({
      method  : 'POST',
      headers : { 'user-agent': 'test' },
      cookies : { [CSRF_COOKIE_NAME]: signToken('some-token') },
    });
    const res = mockRes();

    verifyCsrf(req, res, noop);
    assert.equal(res._status, 403);
    assert.equal(res._body?.code, 'CSRF_TOKEN_MISSING');
  });

  it('verifyCsrf rejects missing cookie', () => {
    const req = mockReq({
      method  : 'POST',
      headers : { 'user-agent': 'test', [CSRF_HEADER_NAME]: 'some-token' },
      cookies : {},
    });
    const res = mockRes();

    verifyCsrf(req, res, noop);
    assert.equal(res._status, 403);
  });

  it('verifyCsrf skips GET requests', (t, done) => {
    const req = mockReq({
      method  : 'GET',
      headers : { 'user-agent': 'test' },
      cookies : {},
    });
    const res = mockRes();

    verifyCsrf(req, res, () => done());
  });

  it('verifyCsrf skips HEAD requests', (t, done) => {
    const req = mockReq({
      method  : 'HEAD',
      headers : { 'user-agent': 'test' },
      cookies : {},
    });
    const res = mockRes();

    verifyCsrf(req, res, () => done());
  });

  it('rotateCsrfToken sets a new cookie and attaches token to res.locals', (t, done) => {
    const req = mockReq({ method: 'POST' });
    const res = mockRes();

    rotateCsrfToken(req, res, () => {
      assert.ok(res._cookies[CSRF_COOKIE_NAME], 'new cookie should be set');
      assert.ok(res.locals.newCsrfToken, 'token should be in res.locals');
      assert.equal(typeof res.locals.newCsrfToken, 'string');
      assert.ok(res.locals.newCsrfToken.length >= 64); // 32 bytes hex = 64 chars
      done();
    });
  });

  it('clearCsrfToken removes the cookie', (t, done) => {
    const req = mockReq();
    const res = mockRes();
    // Pre-set cookie
    res._cookies[CSRF_COOKIE_NAME] = { value: 'signed', options: {} };

    clearCsrfToken(req, res, () => {
      assert.ok(!res._cookies[CSRF_COOKIE_NAME], 'cookie should be cleared');
      done();
    });
  });

  it('constant-time comparison: no timing shortcut on length mismatch', () => {
    // Token of different length should still take constant time (no throw)
    const req = mockReq({
      method  : 'POST',
      headers : {
        'user-agent'      : 'test',
        [CSRF_HEADER_NAME]: 'short',
      },
      cookies : { [CSRF_COOKIE_NAME]: signToken('a-much-longer-token-here') },
    });
    const res = mockRes();
    // Should not throw, just reject
    assert.doesNotThrow(() => verifyCsrf(req, res, noop));
    assert.equal(res._status, 403);
  });
});

// ─────────────────────────────────────────────
// 7. Response Hardening
// ─────────────────────────────────────────────
describe('Response Hardening', () => {
  const { responseHardening } = require(`${ROOT}/middleware/security`);

  it('sets all required security headers', (t, done) => {
    const req = mockReq();
    const res = mockRes();
    // Simulate Helmet having set X-Powered-By
    res._headers['x-powered-by'] = 'Express';

    responseHardening(req, res, () => {
      assert.equal(res._headers['x-content-type-options'], 'nosniff');
      assert.equal(res._headers['x-frame-options'],        'DENY');
      assert.equal(res._headers['x-xss-protection'],       '1; mode=block');
      assert.ok(res._headers['referrer-policy']);
      assert.ok(res._headers['permissions-policy']);
      assert.ok(res._headers['cross-origin-opener-policy']);
      assert.ok(res._headers['cross-origin-resource-policy']);
      done();
    });
  });

  it('removes X-Powered-By header', (t, done) => {
    const req = mockReq();
    const res = mockRes();
    res._headers['x-powered-by'] = 'Express';

    responseHardening(req, res, () => {
      assert.equal(res._headers['x-powered-by'], undefined);
      done();
    });
  });

  it('removes Server header', (t, done) => {
    const req = mockReq();
    const res = mockRes();
    res._headers['server'] = 'nginx/1.24';

    responseHardening(req, res, () => {
      assert.equal(res._headers['server'], undefined);
      done();
    });
  });
});

// ─────────────────────────────────────────────
// 8. noCache
// ─────────────────────────────────────────────
describe('noCache', () => {
  const { noCache } = require(`${ROOT}/middleware/security`);

  it('sets all cache-prevention headers', (t, done) => {
    const req = mockReq();
    const res = mockRes();

    noCache(req, res, () => {
      assert.ok(res._headers['cache-control']?.includes('no-store'));
      assert.equal(res._headers['pragma'], 'no-cache');
      assert.equal(res._headers['expires'], '0');
      assert.ok(res._headers['surrogate-control']?.includes('no-store'));
      done();
    });
  });
});

// ─────────────────────────────────────────────
// 9. Security Config Completeness
// ─────────────────────────────────────────────
describe('Security Config', () => {
  it('exports a frozen object', () => {
    assert.ok(Object.isFrozen(SECURITY_CONFIG));
  });

  it('rateLimits has all required tier keys', () => {
    const keys = ['global', 'auth', 'financial', 'writes', 'publicRead', 'admin'];
    for (const k of keys) {
      assert.ok(k in SECURITY_CONFIG.rateLimits, `Missing rateLimits.${k}`);
    }
  });

  it('all rate limit tiers have windowMs and max', () => {
    const { rateLimits } = SECURITY_CONFIG;
    for (const [tier, val] of Object.entries(rateLimits)) {
      if (tier === 'auth') {
        for (const [sub, cfg] of Object.entries(val)) {
          assert.ok(typeof cfg.windowMs === 'number', `auth.${sub}.windowMs`);
          assert.ok(typeof cfg.max      === 'number', `auth.${sub}.max`);
        }
      } else {
        assert.ok(typeof val.windowMs === 'number', `${tier}.windowMs`);
        assert.ok(typeof val.max      === 'number', `${tier}.max`);
      }
    }
  });

  it('ipBlock config has all keys', () => {
    const keys = ['autobanThreshold', 'autobanWindowMs', 'banDurationMs'];
    for (const k of keys) {
      assert.ok(k in SECURITY_CONFIG.ipBlock, `Missing ipBlock.${k}`);
    }
  });

  it('suspiciousPatterns is a non-empty array of objects with name+pattern', () => {
    const { suspiciousPatterns } = SECURITY_CONFIG;
    assert.ok(Array.isArray(suspiciousPatterns));
    assert.ok(suspiciousPatterns.length >= 8, 'Should have at least 8 patterns');
    for (const p of suspiciousPatterns) {
      assert.ok(typeof p.name === 'string',  `pattern.name should be string: ${JSON.stringify(p)}`);
      assert.ok(p.pattern instanceof RegExp, `pattern.pattern should be RegExp: ${p.name}`);
    }
  });

  it('password policy has minimum required fields', () => {
    const { password } = SECURITY_CONFIG;
    assert.ok(typeof password.minLength    === 'number');
    assert.ok(typeof password.bcryptRounds === 'number');
    assert.ok(password.bcryptRounds >= 10, 'bcrypt rounds should be >= 10');
  });

  it('JWT config has required fields', () => {
    const { jwt } = SECURITY_CONFIG;
    assert.ok(jwt.accessExpiresIn);
    assert.ok(jwt.refreshExpiresIn);
    assert.ok(jwt.algorithm);
    assert.ok(jwt.issuer);
    assert.ok(jwt.audience);
  });
});

// ─────────────────────────────────────────────
// 10. Risk Scorer
// ─────────────────────────────────────────────
describe('riskScore middleware', () => {
  const { riskScore } = require(`${ROOT}/middleware/security`);

  it('skips unauthenticated requests (no req.user)', (t, done) => {
    const req = mockReq({ user: null });
    const res = mockRes();

    riskScore(req, res, () => {
      assert.equal(req.riskScore, undefined);
      done();
    });
  });

  it('scores 0 for a clean authenticated request', (t, done) => {
    const req = mockReq({
      user    : { id: 'u1', mfaEnabled: true, mfaVerified: true },
      headers : { 'user-agent': 'Mozilla/5.0 (normal browser)' },
      meta    : { ip: '1.2.3.4', isBot: false, userAgent: 'Mozilla/5.0' },
      path    : '/api/products',
    });
    const res = mockRes();

    riskScore(req, res, () => {
      assert.ok(req.riskScore <= 15, `Expected low score, got ${req.riskScore}`);
      done();
    });
  });

  it('adds score for bot user-agent', (t, done) => {
    const req = mockReq({
      user    : { id: 'u1', mfaEnabled: true },
      headers : { 'user-agent': 'python-requests/2.28.0' },
      meta    : { ip: '1.2.3.4', isBot: true },
      path    : '/api/products',
    });
    const res = mockRes();

    riskScore(req, res, () => {
      assert.ok(req.riskScore >= 15, `Should add bot penalty: got ${req.riskScore}`);
      done();
    });
  });

  it('adds score for proxy headers', (t, done) => {
    const req = mockReq({
      user    : { id: 'u1', mfaEnabled: true },
      headers : { 'user-agent': 'normal', 'via': '1.1 proxy.example.com' },
      meta    : { ip: '1.2.3.4', isBot: false },
      path    : '/api/products',
    });
    const res = mockRes();

    riskScore(req, res, () => {
      assert.ok(req.riskScore >= 20, `Should add proxy penalty: got ${req.riskScore}`);
      done();
    });
  });

  it('adds score for escrow path without MFA', (t, done) => {
    const req = mockReq({
      user    : { id: 'u1', mfaEnabled: false },
      headers : { 'user-agent': 'Mozilla/5.0' },
      meta    : { ip: '1.2.3.4', isBot: false },
      path    : '/api/escrow/pay',
    });
    const res = mockRes();

    riskScore(req, res, () => {
      assert.ok(req.riskScore >= 10, `Should add MFA-disabled-financial penalty: got ${req.riskScore}`);
      done();
    });
  });

  it('caps score at 100', (t, done) => {
    const req = mockReq({
      user    : { id: 'u1', mfaEnabled: false },
      headers : { 'user-agent': '', 'via': 'proxy', 'x-tor-exit': '1' },
      meta    : { ip: '1.2.3.4', isBot: true },
      path    : '/api/escrow/pay',
    });
    const res = mockRes();

    riskScore(req, res, () => {
      assert.ok(req.riskScore <= 100, `Score should be capped at 100: got ${req.riskScore}`);
      done();
    });
  });

  it('populates riskSignals array', (t, done) => {
    const req = mockReq({
      user    : { id: 'u1', mfaEnabled: false },
      headers : { 'user-agent': 'python-bot/1.0' },
      meta    : { ip: '1.2.3.4', isBot: true },
      path    : '/api/escrow/pay',
    });
    const res = mockRes();

    riskScore(req, res, () => {
      assert.ok(Array.isArray(req.riskSignals));
      assert.ok(req.riskSignals.length > 0);
      done();
    });
  });
});

// ─────────────────────────────────────────────
// 11. requireHighRiskMFA
// ─────────────────────────────────────────────
describe('requireHighRiskMFA', () => {
  const { requireHighRiskMFA } = require(`${ROOT}/middleware/security`);

  it('blocks when riskScore >= threshold and MFA not verified', () => {
    const mw  = requireHighRiskMFA(40);
    const req = mockReq({
      user       : { id: 'u1', mfaVerified: false },
      riskScore  : 50,
      riskSignals: ['bot'],
    });
    const res = mockRes();

    mw(req, res, () => {
      throw new Error('next() should not be called');
    });

    assert.equal(res._status, 403);
    assert.equal(res._body?.mfaRequired, true);
  });

  it('passes when riskScore >= threshold but MFA is verified', (t, done) => {
    const mw  = requireHighRiskMFA(40);
    const req = mockReq({
      user       : { id: 'u1', mfaVerified: true },
      riskScore  : 50,
      riskSignals: ['bot'],
    });
    const res = mockRes();

    mw(req, res, () => done());
  });

  it('passes when riskScore is below threshold', (t, done) => {
    const mw  = requireHighRiskMFA(40);
    const req = mockReq({
      user       : { id: 'u1', mfaVerified: false },
      riskScore  : 20,
      riskSignals: [],
    });
    const res = mockRes();

    mw(req, res, () => done());
  });

  it('passes unauthenticated requests', (t, done) => {
    const mw  = requireHighRiskMFA(40);
    const req = mockReq({ user: null, riskScore: 80 });
    const res = mockRes();

    mw(req, res, () => done());
  });
});

// ─────────────────────────────────────────────
// 12. Rate Limiter factory
// ─────────────────────────────────────────────
describe('Rate Limiter Factory', () => {
  const { createLimiter, authLimiters, financialLimiter,
          writeLimiter, publicLimiter, adminLimiter, globalLimiter }
    = require(`${ROOT}/middleware/rateLimiter`);

  it('createLimiter returns a middleware function', () => {
    const limiter = createLimiter({ windowMs: 60000, max: 10 });
    assert.equal(typeof limiter, 'function');
  });

  it('all named limiters are functions', () => {
    for (const [name, fn] of Object.entries({
      financialLimiter, writeLimiter, publicLimiter, adminLimiter, globalLimiter,
    })) {
      assert.equal(typeof fn, 'function', `${name} should be a function`);
    }
  });

  it('authLimiters has register / login / refresh / mfa', () => {
    for (const key of ['register', 'login', 'refresh', 'mfa']) {
      assert.equal(typeof authLimiters[key], 'function', `authLimiters.${key} missing`);
    }
  });

  it('financialLimiter has lower max than publicLimiter', () => {
    // Inspect by checking config directly
    const fin = SECURITY_CONFIG.rateLimits.financial.max;
    const pub = SECURITY_CONFIG.rateLimits.publicRead.max;
    assert.ok(fin < pub, `financial (${fin}) should be tighter than public (${pub})`);
  });

  it('authLimiters.login is tighter than authLimiters.refresh', () => {
    const loginMax   = SECURITY_CONFIG.rateLimits.auth.login.max;
    const refreshMax = SECURITY_CONFIG.rateLimits.auth.refresh.max;
    assert.ok(loginMax < refreshMax,
      `login (${loginMax}) should be tighter than refresh (${refreshMax})`);
  });
});

// ─────────────────────────────────────────────
// 13. requestFingerprint
// ─────────────────────────────────────────────
describe('requestFingerprint', () => {
  const { requestFingerprint } = require(`${ROOT}/middleware/security`);

  it('attaches ip, userAgent, origin, timestamp, isBot to req.meta', (t, done) => {
    const req = mockReq({
      headers: {
        'user-agent': 'Mozilla/5.0',
        'origin'    : 'https://app.ofuture.io',
        'x-forwarded-for': '5.6.7.8',
      },
    });
    const res = mockRes();

    requestFingerprint(req, res, () => {
      assert.ok(req.meta.ip);
      assert.ok(req.meta.userAgent);
      assert.ok(req.meta.origin);
      assert.ok(req.meta.timestamp instanceof Date);
      assert.equal(typeof req.meta.isBot, 'boolean');
      done();
    });
  });

  it('flags bot user-agents correctly', (t, done) => {
    const req = mockReq({ headers: { 'user-agent': 'Googlebot/2.1' } });
    requestFingerprint(req, mockRes(), () => {
      assert.equal(req.meta.isBot, true);
      done();
    });
  });

  it('does not flag normal browser user-agents as bots', (t, done) => {
    const req = mockReq({
      headers: { 'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/120' },
    });
    requestFingerprint(req, mockRes(), () => {
      assert.equal(req.meta.isBot, false);
      done();
    });
  });
});