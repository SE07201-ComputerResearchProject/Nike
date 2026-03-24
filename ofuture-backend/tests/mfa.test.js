// tests/mfa.test.js
// ─────────────────────────────────────────────
// MFA test suite.
//
// Covers:
//   1.  mfaService.isRequired       — adaptive gate logic
//   2.  mfaService.generateMfaToken — pending JWT shape
//   3.  TOTP verify (speakeasy)     — valid / invalid code
//   4.  Backup code lifecycle       — generate, hash, verify, consume
//   5.  exchangeMfaToken            — token exchange happy/sad paths
//   6.  auth middleware             — mfaPending rejection
//   7.  mfaController               — HTTP response shaping
//   8.  mfaRoutes validators        — input validation rules
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

// ── Module stubs (same pattern as security.test.js) ──
const Module       = require('node:module');
const originalLoad = Module._load.bind(Module);
const path         = require('node:path');
const ROOT         = path.resolve(__dirname, '..');

const NOOP_LOGGER = {
  info: () => {}, warn: () => {}, error: () => {}, debug: () => {},
  child: () => NOOP_LOGGER,
};

const FAKE_WINSTON = {
  createLogger: () => NOOP_LOGGER,
  format: {
    combine: () => ({}), timestamp: () => ({}), printf: () => ({}),
    colorize: () => ({}), json: () => ({}), errors: () => ({}),
  },
  transports: { Console: class {}, File: class {} },
};

// ── Fake speakeasy for controlled unit tests ──
let speakeasyVerifyResult = true;   // toggled per test
const FAKE_SPEAKEASY = {
  generateSecret: ({ name, length } = {}) => ({
    base32      : 'JBSWY3DPEHPK3PXP',
    otpauth_url : `otpauth://totp/${encodeURIComponent(name ?? 'test')}?secret=JBSWY3DPEHPK3PXP`,
  }),
  totp: {
    verify: (_opts) => speakeasyVerifyResult,
  },
};

// ── Fake qrcode ───────────────────────────────
const FAKE_QRCODE = {
  toDataURL: async () => 'data:image/png;base64,fakeqr==',
};

// ── In-memory user store for stubs ───────────
const users = new Map();
const mkUser = (overrides = {}) => ({
  id             : 'user-uuid-1',
  email          : 'test@ofuture.io',
  username       : 'testuser',
  role           : 'buyer',
  is_active      : 1,
  is_verified    : 1,
  mfa_enabled    : 0,
  mfa_secret     : null,
  mfa_backup_codes: null,
  password_hash  : '$2b$10$hashedpassword',
  full_name      : 'Test User',
  ...overrides,
});

users.set('user-uuid-1', mkUser());

// ── Pool stub with in-memory ops ──────────────
const poolStub = {
  execute: async (sql, params = []) => {
    const sqlLower = String(sql).trim().toLowerCase();

    // Special-case: update users set ... (explicit block for MFA tests)
    if (sqlLower.startsWith('update users set')) {
      const userId = params[params.length - 1]; // Assume ID is last
      let user = users.get(userId);
      if (!user) return [[], { affectedRows: 0 }];

      // Manual override for MFA tests
      if (sqlLower.includes('mfa_secret = ?')) {
         user.mfa_secret = params[0];
         user.mfa_enabled = params[1] ? 1 : 0;
      }
      if (sqlLower.includes('mfa_backup_codes = ?')) {
         // MUST PARSE the JSON string back to an array
         try {
            user.mfa_backup_codes = JSON.parse(params[0]);
         } catch(e) {
            user.mfa_backup_codes = params[0]; 
         }
      }
      users.set(userId, user);
      return [[], { affectedRows: 1 }];
    }

    // SELECT mfa_backup_codes FROM users
    if (/select mfa_backup_codes from users/i.test(sql)) {
      const u = users.get(params[0]);
      return [[u ? { mfa_backup_codes: u.mfa_backup_codes } : null]];
    }

    // SELECT mfa_enabled, mfa_secret, JSON_LENGTH
    if (/select mfa_enabled, mfa_secret/i.test(sql)) {
      const u = users.get(params[0]);
      const codes = u?.mfa_backup_codes ? (Array.isArray(u.mfa_backup_codes) ? u.mfa_backup_codes : JSON.parse(u.mfa_backup_codes)) : [];
      return [[u ? {
        mfa_enabled : u.mfa_enabled,
        mfa_secret  : u.mfa_secret,
        backup_codes_remaining: codes.length,
      } : null]];
    }

    // Refresh token insert
    if (/insert into refresh_tokens/i.test(sql)) return [{ insertId: 1 }];

    // Fallback
    return [[{}]];
  },
  getConnection: async () => ({
    execute: async (...args) => poolStub.execute(...args),
    beginTransaction: async () => {},
    commit: async () => {},
    rollback: async () => {},
    release: () => {},
  }),
};

Module._load = function (id, parent, isMain) {
  if (id === 'winston')        return FAKE_WINSTON;
  if (id === 'speakeasy')      return FAKE_SPEAKEASY;
  if (id === 'qrcode')         return FAKE_QRCODE;
  if (id === 'cookie-parser')  return () => (_r, _s, n) => n();
  if (id === 'express') {
    // Minimal express stub — just enough for Router
    const router = () => {
      const stack = [];
      const r = { stack, handle: (rq, rs, n) => n?.() };
      const addRoute = (method, path, ...handlers) => {
        const route = { path, methods: { [method]: true }, stack: handlers.map(h => ({ handle: h })) };
        stack.push({ route });
      };
      r.get    = (p, ...h) => { addRoute('get',    p, ...h); return r; };
      r.post   = (p, ...h) => { addRoute('post',   p, ...h); return r; };
      r.put    = (p, ...h) => { addRoute('put',    p, ...h); return r; };
      r.delete = (p, ...h) => { addRoute('delete', p, ...h); return r; };
      r.use    = (...args) => { stack.push({ handle: args[args.length-1] }); return r; };
      return r;
    };
    const app = router();
    app.Router = router;
    return Object.assign(router, { Router: router });
  }
  if (id === 'morgan')         return () => (_r, _s, n) => n();
  if (id === 'helmet')         return () => (_r, _s, n) => n();
  if (id === 'express-rate-limit') return (opts) => {
    const mw = (_r, _s, n) => n();
    mw._opts = opts; mw.resetKey = () => {};
    return mw;
  };
  if (id === 'jsonwebtoken') return {
    sign  : (payload, secret, opts) => {
      const header  = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
      const body    = Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now()/1000) })).toString('base64url');
      const sig     = crypto.createHmac('sha256', secret ?? 'test').update(`${header}.${body}`).digest('base64url');
      return `${header}.${body}.${sig}`;
    },
    verify: (token, secret, opts, cb) => {
      try {
        const [, body] = token.split('.');
        const payload  = JSON.parse(Buffer.from(body, 'base64url').toString());
        if (cb) return cb(null, payload);
        return payload;
      } catch (e) {
        if (cb) return cb(e);
        throw e;
      }
    },
    decode: (token) => {
      const [, body] = token.split('.');
      return JSON.parse(Buffer.from(body, 'base64url').toString());
    },
  };
  if (id === 'uuid') return { v4: () => crypto.randomUUID() };
  if (id === 'express-validator') {
    // express-validator stub.
    // ValidationChain must be both a callable middleware AND have
    // fluent chaining methods (each method returns `self`).
    // Field name + rules are accumulated; rules are checked on call.
    const makeChain = (field, source) => {
      const rules = [];   // { type, args }
      // The chain IS a middleware function
      const self = async (req, res, next) => {
        const src = source === 'body'  ? req.body  :
                    source === 'query' ? req.query :
                    source === 'param' ? req.params : {};
        const val = src?.[field];
        const absent = val == null || val === '';

        // Optional field with no value — skip all validation
        if (self._isOptional && absent) { if (next) next(); return; }

        for (const rule of rules) {
          let msg = rule.msg || `${field} is invalid`;
          let fail = false;
          if (rule.type === 'notEmpty' && absent) fail = true;
          if (rule.type === 'isLength' && !absent) {
            const s = String(val);
            if (rule.args.min != null && s.length < rule.args.min) fail = true;
            if (rule.args.max != null && s.length > rule.args.max) fail = true;
          }
          if (rule.type === 'isIn' && !absent && !rule.args.includes(String(val))) fail = true;
          if (fail) {
            req._validationErrors = req._validationErrors ?? [];
            req._validationErrors.push({ path: field, msg });
          }
        }
        if (next) next();
      };
      self.run = async (req) => { await self(req, null, () => {}); };
      const addRule = (type, args, msg) => { rules.push({ type, args, msg }); return self; };
      self.trim         = ()          => self;
      self.escape       = ()          => self;
      self.normalizeEmail = ()        => self;
      self.toFloat      = ()          => self;
      self.toInt        = ()          => self;
      self.isMobilePhone = ()         => self;
      self.isEmail      = ()          => self;
      self.isUUID       = ()          => self;
      self.isFloat      = ()          => self;
      self.isInt        = ()          => self;
      self.isObject     = ()          => self;
      self.isIP         = ()          => self;
      self.matches      = ()          => self;
      self.optional     = (opts)      => { self._isOptional = true; return self; };
      self.notEmpty     = ()          => addRule('notEmpty', {});
      self.isLength     = (opts)      => addRule('isLength', opts ?? {});
      self.isIn         = (vals)      => addRule('isIn', vals ?? []);
      self.withMessage  = (m)         => { if (rules.length) rules[rules.length-1].msg = m; return self; };
      return self;
    };
    const validationResult = (req) => ({
      isEmpty : () => !(req._validationErrors?.length),
      array   : () => req._validationErrors ?? [],
    });
    return {
      body  : (f) => makeChain(f, 'body'),
      param : (f) => makeChain(f, 'param'),
      query : (f) => makeChain(f, 'query'),
      validationResult,
    };
  }
  if (id === 'bcryptjs') return {
    hash   : async (p, rounds) => `bcrypt:${p}:${rounds}`,
    compare: async (p, h)      => h === `bcrypt:${p}:10`,
    genSalt: async ()          => '$2b$12$stub',
  };
  if (/[/\\]config[/\\]db(\.js)?$/.test(id) || id === 'config/db') {
    return { pool: poolStub };
  }
  if (/[/\\]utils[/\\]logger(\.js)?$/.test(id) || id === 'utils/logger') {
    return NOOP_LOGGER;
  }
  if (/[/\\]models[/\\]logModel(\.js)?$/.test(id) || id === 'models/logModel') {
    return {
      LogModel  : { write: async () => {} },
      LOG_EVENTS: {
        MFA_ENABLED : 'MFA_ENABLED',  MFA_DISABLED: 'MFA_DISABLED',
        MFA_FAILED  : 'MFA_FAILED',   MFA_SUCCESS : 'MFA_SUCCESS',
        LOGIN_SUCCESS: 'LOGIN_SUCCESS', LOGIN_FAIL: 'LOGIN_FAIL',
        SUSPICIOUS_ACTIVITY: 'SUSPICIOUS_ACTIVITY',
      },
    };
  }
  if (/[/\\]utils[/\\]securityUtils(\.js)?$/.test(id) || id === 'utils/securityUtils') {
    return {
      signAccessToken: (payload) => 'access.token',
      generateRawRefreshToken: () => 'raw-refresh-token',
      hashToken: (t) => require('crypto').createHash('sha256').update(t).digest('hex'),
      getClientIp: (req) => req?.meta?.ip || req?.ip || '127.0.0.1',
    };
  }
  if (/[/\\]models[/\\]userModel(\.js)?$/.test(id) || id === 'models/userModel') {
    return {
      findById       : async (id) => users.get(id) ?? null,
      updateLoginMeta: async () => {},
      saveMfaSecret  : async (id, secret) => {
        const u = users.get(id); if (u) u.mfa_secret = secret;
      },
    };
  }
  if (/[/\\]models[/\\]refreshTokenModel(\.js)?$/.test(id)) {
    return { create: async () => ({ id: 'rt-1' }) };
  }
  return originalLoad(id, parent, isMain);
};

// ── Now safe to load modules ──────────────────
// Top-level requires moved here to avoid importing inside test cases
const { signAccessToken, generateRawRefreshToken, hashToken, getClientIp } = require(`${ROOT}/utils/securityUtils`);
const { authenticate } = require(`${ROOT}/middleware/auth`);
const { requireMfaVerified, requireMfaEnrolled, adaptiveMfaGate, mfaForFinancial, mfaForAdmin } = require(`${ROOT}/middleware/requireMfa`);
const { validateMfaCode, validateMfaVerify, validateMfaDisable } = require(`${ROOT}/middleware/validate`);
const router = require(`${ROOT}/routes/mfaRoutes`);
const mfaService = require(`${ROOT}/services/mfaService`);

// ── Mock req/res helpers ──────────────────────
const mockReq = (overrides = {}) => ({
  headers: { 'user-agent': 'test-agent/1.0', authorization: 'Bearer token' },
  body: {}, query: {}, params: {}, cookies: {},
  meta: { ip: '127.0.0.1', userAgent: 'test-agent' },
  user: null, path: '/test', originalUrl: '/test', method: 'POST',
  ...overrides,
});

const mockRes = () => {
  const res = {
    _status: null, _body: null, statusCode: 200,
    status: (code) => { res._status = code; res.statusCode = code; return res; },
    json  : (body) => { res._body = body; return res; },
  };
  return res;
};

// ─────────────────────────────────────────────
// 1. isRequired — adaptive gate
// ─────────────────────────────────────────────
describe('mfaService.isRequired', () => {
  it('returns false for null user', () => {
    assert.equal(mfaService.isRequired(null, 0), false);
  });

  it('returns true when mfa_enabled, any risk', () => {
    assert.equal(mfaService.isRequired({ mfa_enabled: true }, 0), true);
  });

  it('returns true for high-risk even without MFA enrolled', () => {
    const score = mfaService.RISK_THRESHOLD;
    assert.equal(mfaService.isRequired({ mfa_enabled: false }, score), true);
  });

  it('returns false for low-risk, MFA not enrolled', () => {
    assert.equal(mfaService.isRequired({ mfa_enabled: false }, 0), false);
  });

  it('returns false for risk score just below threshold', () => {
    const score = mfaService.RISK_THRESHOLD - 1;
    assert.equal(mfaService.isRequired({ mfa_enabled: false }, score), false);
  });
});

// ─────────────────────────────────────────────
// 2. generateMfaToken
// ─────────────────────────────────────────────
describe('mfaService.generateMfaToken', () => {
  it('returns a JWT string', () => {
    const token = mfaService.generateMfaToken('user-uuid-1');
    assert.ok(typeof token === 'string');
    assert.ok(token.split('.').length === 3, 'Should be a 3-part JWT');
  });

  it('payload contains id and mfaPending=true', () => {
    const token   = mfaService.generateMfaToken('user-uuid-1');
    const payload = JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString());
    assert.equal(payload.id,         'user-uuid-1');
    assert.equal(payload.mfaPending, true);
  });

  it('different users get different tokens', () => {
    const t1 = mfaService.generateMfaToken('user-a');
    const t2 = mfaService.generateMfaToken('user-b');
    assert.notEqual(t1, t2);
  });
});

// ─────────────────────────────────────────────
// 3. generateSetup
// ─────────────────────────────────────────────
describe('mfaService.generateSetup', () => {
  beforeEach(() => {
    // Reset user to clean state
    users.set('user-uuid-1', mkUser({ mfa_enabled: 0, mfa_secret: null }));
  });

  it('returns secret, qrCode, otpauthUrl on success', async () => {
    const result = await mfaService.generateSetup('user-uuid-1');
    assert.equal(result.success, true);
    assert.ok(result.secret);
    assert.ok(result.qrCode.startsWith('data:image/'));
    assert.ok(result.otpauthUrl.startsWith('otpauth://'));
  });

  it('rejects if MFA is already enabled', async () => {
    users.set('user-uuid-1', mkUser({ mfa_enabled: 1, mfa_secret: 'EXISTS' }));
    const result = await mfaService.generateSetup('user-uuid-1');
    assert.equal(result.success, false);
    assert.equal(result.code, 'MFA_ALREADY_ENABLED');
  });
});

// ─────────────────────────────────────────────
// 4. confirmSetup
// ─────────────────────────────────────────────
describe('mfaService.confirmSetup', () => {
  beforeEach(() => {
    users.set('user-uuid-1', mkUser({
      mfa_enabled : 0,
      mfa_secret  : 'JBSWY3DPEHPK3PXP',
    }));
    speakeasyVerifyResult = true;
  });

  it('enables MFA and returns backup codes on valid TOTP', async () => {
    const result = await mfaService.confirmSetup('user-uuid-1', '123456', '127.0.0.1');
    assert.equal(result.success, true);
    assert.ok(Array.isArray(result.backupCodes));
    assert.equal(result.backupCodes.length, 10);
    assert.equal(result.backupCount, 10);
  });

  it('rejects invalid TOTP code', async () => {
    speakeasyVerifyResult = false;
    const result = await mfaService.confirmSetup('user-uuid-1', '000000', '127.0.0.1');
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_CODE');
  });

  it('rejects if setup not initiated (no secret)', async () => {
    users.set('user-uuid-1', mkUser({ mfa_enabled: 0, mfa_secret: null }));
    const result = await mfaService.confirmSetup('user-uuid-1', '123456', '127.0.0.1');
    assert.equal(result.success, false);
    assert.equal(result.code, 'SETUP_NOT_INITIATED');
  });

  it('rejects if MFA already enabled', async () => {
    users.set('user-uuid-1', mkUser({ mfa_enabled: 1, mfa_secret: 'JBSWY3DPEHPK3PXP' }));
    const result = await mfaService.confirmSetup('user-uuid-1', '123456', '127.0.0.1');
    assert.equal(result.success, false);
    assert.equal(result.code, 'MFA_ALREADY_ENABLED');
  });

  it('backup codes are unique', async () => {
    const result = await mfaService.confirmSetup('user-uuid-1', '123456', '127.0.0.1');
    const unique = new Set(result.backupCodes);
    assert.equal(unique.size, result.backupCodes.length, 'All backup codes should be unique');
  });

  it('backup codes are hex uppercase strings', async () => {
    const result = await mfaService.confirmSetup('user-uuid-1', '123456', '127.0.0.1');
    for (const code of result.backupCodes) {
      assert.match(code, /^[A-F0-9]+$/, `"${code}" should be hex uppercase`);
    }
  });
});

// ─────────────────────────────────────────────
// 5. verifyTotp
// ─────────────────────────────────────────────
describe('mfaService.verifyTotp', () => {
  beforeEach(() => {
    users.set('user-uuid-1', mkUser({
      mfa_enabled : 1,
      mfa_secret  : 'JBSWY3DPEHPK3PXP',
    }));
    speakeasyVerifyResult = true;
  });

  it('returns valid=true for correct TOTP', async () => {
    const result = await mfaService.verifyTotp('user-uuid-1', '123456');
    assert.equal(result.valid, true);
    assert.equal(result.reason, null);
  });

  it('returns valid=false for incorrect TOTP', async () => {
    speakeasyVerifyResult = false;
    const result = await mfaService.verifyTotp('user-uuid-1', '000000');
    assert.equal(result.valid, false);
    assert.ok(result.reason);
  });

  it('returns valid=false if no mfa_secret on user', async () => {
    users.set('user-uuid-1', mkUser({ mfa_enabled: 0, mfa_secret: null }));
    const result = await mfaService.verifyTotp('user-uuid-1', '123456');
    assert.equal(result.valid, false);
  });
});

// ─────────────────────────────────────────────
// 6. verifyBackupCode
// ─────────────────────────────────────────────
describe('mfaService.verifyBackupCode', () => {
  const RAW_CODE   = 'AABBCCDDEE';
  const HASHED     = `bcrypt:${RAW_CODE}:10`;   // matches fake bcrypt

  beforeEach(() => {
    users.set('user-uuid-1', mkUser({
      mfa_enabled      : 1,
      mfa_backup_codes : JSON.stringify([HASHED, 'bcrypt:OTHER:10']),
    }));
  });

  it('returns valid=true and remaining count for correct code', async () => {
    const result = await mfaService.verifyBackupCode('user-uuid-1', RAW_CODE);
    assert.equal(result.valid, true);
    assert.equal(result.remaining, 1);   // one code consumed, one left
  });

  it('returns valid=false for wrong code', async () => {
    const result = await mfaService.verifyBackupCode('user-uuid-1', 'WRONGCODE');
    assert.equal(result.valid, false);
    assert.ok(result.reason);
  });

  it('returns valid=false when no backup codes exist', async () => {
    users.set('user-uuid-1', mkUser({ mfa_backup_codes: null }));
    const result = await mfaService.verifyBackupCode('user-uuid-1', RAW_CODE);
    assert.equal(result.valid, false);
  });

  it('consuming a code reduces remaining count by 1', async () => {
    const before = JSON.parse(users.get('user-uuid-1').mfa_backup_codes).length;
    await mfaService.verifyBackupCode('user-uuid-1', RAW_CODE);
    const after = JSON.parse(users.get('user-uuid-1').mfa_backup_codes).length;
    assert.equal(after, before - 1);
  });

  it('is case-insensitive (trim + uppercase normalization)', async () => {
    const result = await mfaService.verifyBackupCode('user-uuid-1', 'aabbccddee');
    assert.equal(result.valid, true);
  });
});

// ─────────────────────────────────────────────
// 7. exchangeMfaToken
// ─────────────────────────────────────────────
describe('mfaService.exchangeMfaToken', () => {
  beforeEach(() => {
    users.set('user-uuid-1', mkUser({ mfa_enabled: 1, mfa_secret: 'JBSWY3DPEHPK3PXP' }));
    speakeasyVerifyResult = true;
  });

  it('returns accessToken + refreshToken on valid TOTP', async () => {
    const mfaToken = mfaService.generateMfaToken('user-uuid-1');
    const result   = await mfaService.exchangeMfaToken({
      mfaToken, code: '123456', codeType: 'totp', ipAddress: '127.0.0.1',
    });
    assert.equal(result.success, true);
    assert.ok(result.accessToken);
    assert.ok(result.refreshToken);
    assert.equal(result.mfaVerified, true);
  });

  it('access token payload has mfaVerified=true', async () => {
    const mfaToken = mfaService.generateMfaToken('user-uuid-1');
    const result   = await mfaService.exchangeMfaToken({
      mfaToken, code: '123456', codeType: 'totp', ipAddress: '127.0.0.1',
    });
    const payload  = JSON.parse(Buffer.from(result.accessToken.split('.')[1], 'base64url').toString());
    assert.equal(payload.mfaVerified, true);
  });

  it('fails with invalid TOTP code', async () => {
    speakeasyVerifyResult = false;
    const mfaToken = mfaService.generateMfaToken('user-uuid-1');
    const result   = await mfaService.exchangeMfaToken({
      mfaToken, code: '000000', codeType: 'totp', ipAddress: '127.0.0.1',
    });
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_CODE');
  });

  it('fails with non-mfaPending token', async () => {
    // A normal access token (no mfaPending field)
    const regularToken = signAccessToken({ id: 'user-uuid-1', role: 'buyer' });
    const result = await mfaService.exchangeMfaToken({
      mfaToken: regularToken, code: '123456', codeType: 'totp',
    });
    assert.equal(result.success, false);
    assert.equal(result.code, 'NOT_MFA_TOKEN');
  });

  it('fails with a completely invalid token', async () => {
    const result = await mfaService.exchangeMfaToken({
      mfaToken: 'not.a.jwt', code: '123456',
    });
    assert.equal(result.success, false);
    assert.ok(['TOKEN_INVALID', 'NOT_MFA_TOKEN'].includes(result.code));
  });

  it('works with backup code type', async () => {
    const RAW      = 'AABBCCDDEE';
    const HASHED   = `bcrypt:${RAW}:10`;
    users.set('user-uuid-1', mkUser({
      mfa_enabled      : 1,
      mfa_secret       : 'JBSWY3DPEHPK3PXP',
      mfa_backup_codes : JSON.stringify([HASHED]),
    }));
    const mfaToken = mfaService.generateMfaToken('user-uuid-1');
    const result   = await mfaService.exchangeMfaToken({
      mfaToken, code: RAW, codeType: 'backup', ipAddress: '127.0.0.1',
    });
    assert.equal(result.success, true);
    assert.equal(result.codeType, 'backup');
    assert.equal(result.backupCodesRemaining, 0);
  });

  it('includes low-backup warning when ≤3 codes remain', async () => {
    const codes    = ['bcrypt:A:10', 'bcrypt:B:10', 'bcrypt:C:10'];
    users.set('user-uuid-1', mkUser({
      mfa_enabled      : 1,
      mfa_secret       : 'JBSWY3DPEHPK3PXP',
      mfa_backup_codes : JSON.stringify(['bcrypt:AABBCCDDEE:10', ...codes]),
    }));
    const mfaToken = mfaService.generateMfaToken('user-uuid-1');
    const result   = await mfaService.exchangeMfaToken({
      mfaToken, code: 'AABBCCDDEE', codeType: 'backup', ipAddress: '127.0.0.1',
    });
    assert.ok(result.warning, 'Should have a low-backup warning');
    assert.ok(result.warning.includes('backup code'));
  });
});

// ─────────────────────────────────────────────
// 8. disableMfa
// ─────────────────────────────────────────────
describe('mfaService.disableMfa', () => {
  beforeEach(() => {
    // password_hash matches bcrypt stub: 'bcrypt:correctpass:10'
    users.set('user-uuid-1', mkUser({
      mfa_enabled   : 1,
      mfa_secret    : 'JBSWY3DPEHPK3PXP',
      password_hash : 'bcrypt:correctpass:10',
    }));
    speakeasyVerifyResult = true;
  });

  it('disables MFA with correct password + TOTP', async () => {
    const result = await mfaService.disableMfa('user-uuid-1', 'correctpass', '123456', '127.0.0.1');
    assert.equal(result.success, true);
  });

  it('rejects wrong password', async () => {
    const result = await mfaService.disableMfa('user-uuid-1', 'wrongpass', '123456', '127.0.0.1');
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_PASSWORD');
  });

  it('rejects wrong TOTP', async () => {
    speakeasyVerifyResult = false;
    const result = await mfaService.disableMfa('user-uuid-1', 'correctpass', '000000', '127.0.0.1');
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_CODE');
  });

  it('rejects if MFA not enabled', async () => {
    users.set('user-uuid-1', mkUser({ mfa_enabled: 0 }));
    const result = await mfaService.disableMfa('user-uuid-1', 'correctpass', '123456', '127.0.0.1');
    assert.equal(result.success, false);
    assert.equal(result.code, 'MFA_NOT_ENABLED');
  });
});

// ─────────────────────────────────────────────
// 9. getMfaStatus
// ─────────────────────────────────────────────
describe('mfaService.getMfaStatus', () => {
  it('returns mfaEnabled=false for fresh user', async () => {
    users.set('user-uuid-1', mkUser({ mfa_enabled: 0, mfa_secret: null }));
    const result = await mfaService.getMfaStatus('user-uuid-1');
    assert.equal(result.success, true);
    assert.equal(result.mfaEnabled, false);
    assert.equal(result.setupPending, false);
  });

  it('returns setupPending=true when secret set but not confirmed', async () => {
    users.set('user-uuid-1', mkUser({ mfa_enabled: 0, mfa_secret: 'PENDING_SECRET' }));
    const result = await mfaService.getMfaStatus('user-uuid-1');
    assert.equal(result.mfaEnabled, false);
    assert.equal(result.setupPending, true);
  });

  it('returns mfaEnabled=true after confirmation', async () => {
    users.set('user-uuid-1', mkUser({ mfa_enabled: 1, mfa_secret: 'CONFIRMED', mfa_backup_codes: JSON.stringify(['a','b']) }));
    const result = await mfaService.getMfaStatus('user-uuid-1');
    assert.equal(result.mfaEnabled, true);
    assert.equal(result.backupCodesRemaining, 2);
  });
});

// ─────────────────────────────────────────────
// 10. regenerateBackupCodes
// ─────────────────────────────────────────────
describe('mfaService.regenerateBackupCodes', () => {
  beforeEach(() => {
    users.set('user-uuid-1', mkUser({
      mfa_enabled      : 1,
      mfa_secret       : 'JBSWY3DPEHPK3PXP',
      mfa_backup_codes : JSON.stringify(['bcrypt:OLD:10']),
    }));
    speakeasyVerifyResult = true;
  });

  it('returns 10 new backup codes on valid TOTP', async () => {
    const result = await mfaService.regenerateBackupCodes('user-uuid-1', '123456', '127.0.0.1');
    assert.equal(result.success, true);
    assert.equal(result.backupCodes.length, 10);
  });

  it('rejects invalid TOTP', async () => {
    speakeasyVerifyResult = false;
    const result = await mfaService.regenerateBackupCodes('user-uuid-1', '000000', '127.0.0.1');
    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_CODE');
  });

  it('new codes differ from old ones (regeneration is real)', async () => {
    const before = JSON.parse(users.get('user-uuid-1').mfa_backup_codes);
    const result = await mfaService.regenerateBackupCodes('user-uuid-1', '123456', '127.0.0.1');
    const after  = JSON.parse(users.get('user-uuid-1').mfa_backup_codes);
    assert.notDeepEqual(before, after);
    assert.equal(result.backupCodes.length, 10);
  });
});

// ─────────────────────────────────────────────
// 11. auth middleware — mfaPending rejection
// ─────────────────────────────────────────────
describe('auth middleware — mfaPending rejection', () => {

  const mockRes = () => {
    const res = { _status: null, _body: null };
    res.status = (c) => { res._status = c; return res; };
    res.json   = (b) => { res._body = b; return res; };
    return res;
  };

  it('rejects a mfaPending JWT with 401 + MFA_PENDING code', async () => {
    const mfaToken = mfaService.generateMfaToken('user-uuid-1');
    const req      = mockReq({ headers: { authorization: `Bearer ${mfaToken}`, 'user-agent': 'test' } });
    const res      = mockRes();

    await authenticate(req, res, () => {
      throw new Error('next() should not be called for mfaPending token');
    });

    assert.equal(res._status, 401);
    assert.equal(res._body?.code, 'MFA_PENDING');
    assert.equal(res._body?.mfaRequired, true);
  });

  it('attaches mfaVerified=true from a post-MFA token', async () => {
    // Simulate a token that has mfaVerified: true in payload
    const token = signAccessToken({ id: 'user-uuid-1', role: 'buyer', mfaVerified: true });
    users.set('user-uuid-1', mkUser({ mfa_enabled: 1 }));

    const req = mockReq({ headers: { authorization: `Bearer ${token}`, 'user-agent': 'test' } });
    const res = mockRes();
    let nextCalled = false;

    await authenticate(req, res, () => { nextCalled = true; });

    assert.equal(nextCalled, true, 'next() should be called for valid token');
    assert.equal(req.user?.mfaVerified, true);
  });
});

// ─────────────────────────────────────────────
// 12. requireMfaVerified middleware
// ─────────────────────────────────────────────
describe('requireMfaVerified', () => {

  const mkReq = (userOverrides = {}, meta = {}) => ({
    user       : { id: 'u1', mfaEnabled: false, mfaVerified: false, ...userOverrides },
    meta       : { ip: '1.2.3.4', userAgent: 'test', ...meta },
    path       : '/api/escrow/pay',
    originalUrl: '/api/escrow/pay',
    method     : 'POST',
  });
  const mkRes = () => {
    const r = { _status: null, _body: null };
    r.status = c => { r._status = c; return r; };
    r.json   = b => { r._body = b; return r; };
    return r;
  };

  it('passes when user has no MFA enrolled', (t, done) => {
    const req = mkReq({ mfaEnabled: false, mfaVerified: false });
    requireMfaVerified(req, mkRes(), () => done());
  });

  it('passes when MFA is enrolled AND verified', (t, done) => {
    const req = mkReq({ mfaEnabled: true, mfaVerified: true });
    requireMfaVerified(req, mkRes(), () => done());
  });

  it('blocks when MFA is enrolled but NOT verified', async () => {
    const req = mkReq({ mfaEnabled: true, mfaVerified: false });
    const res = mkRes();
    await requireMfaVerified(req, res, () => { throw new Error('next() must not be called'); });
    assert.equal(res._status, 403);
    assert.equal(res._body?.code, 'MFA_NOT_VERIFIED');
    assert.equal(res._body?.mfaRequired, true);
  });

  it('includes nextStep guidance in the blocked response', async () => {
    const req = mkReq({ mfaEnabled: true, mfaVerified: false });
    const res = mkRes();
    await requireMfaVerified(req, res, () => {});
    assert.ok(res._body?.nextStep?.includes('/api/mfa/verify'));
  });

  it('skips unauthenticated requests (no req.user)', (t, done) => {
    const req = { user: null, meta: { ip: '1.2.3.4' }, path: '/test', method: 'POST' };
    requireMfaVerified(req, mkRes(), () => done());
  });
});

// ─────────────────────────────────────────────
// 13. requireMfaEnrolled middleware
// ─────────────────────────────────────────────
describe('requireMfaEnrolled', () => {

  const mkReq = (u = {}) => ({
    user: { id: 'u1', mfaEnabled: false, ...u },
    meta: { ip: '1.2.3.4' }, path: '/test', method: 'POST',
  });
  const mkRes = () => {
    const r = { _status: null, _body: null };
    r.status = c => { r._status = c; return r; };
    r.json   = b => { r._body = b; return r; };
    return r;
  };

  it('blocks when MFA is not enrolled', () => {
    const res = mkRes();
    requireMfaEnrolled(mkReq({ mfaEnabled: false }), res, () => {
      throw new Error('next() must not be called');
    });
    assert.equal(res._status, 403);
    assert.equal(res._body?.code, 'MFA_NOT_ENROLLED');
    assert.equal(res._body?.mfaSetup, true);
  });

  it('passes when MFA is enrolled', (t, done) => {
    requireMfaEnrolled(mkReq({ mfaEnabled: true }), mkRes(), () => done());
  });

  it('includes setup guidance in blocked response', () => {
    const res = mkRes();
    requireMfaEnrolled(mkReq({ mfaEnabled: false }), res, () => {});
    assert.ok(res._body?.nextStep?.includes('/api/mfa/setup'));
  });

  it('skips unauthenticated requests', (t, done) => {
    const req = { user: null, meta: { ip: '1.2.3.4' }, path: '/test', method: 'GET' };
    requireMfaEnrolled(req, mkRes(), () => done());
  });
});

// ─────────────────────────────────────────────
// 14. adaptiveMfaGate factory
// ─────────────────────────────────────────────
describe('adaptiveMfaGate', () => {

  const mkReq = (u = {}, risk = 0, signals = []) => ({
    user       : { id: 'u1', mfaEnabled: false, mfaVerified: false, ...u },
    riskScore  : risk,
    riskSignals: signals,
    meta       : { ip: '5.5.5.5', userAgent: 'test' },
    path       : '/api/escrow/pay',
    originalUrl: '/api/escrow/pay',
    method     : 'POST',
  });
  const mkRes = () => {
    const r = { _status: null, _body: null };
    r.status = c => { r._status = c; return r; };
    r.json   = b => { r._body = b; return r; };
    return r;
  };

  it('passes a clean low-risk non-enrolled session', (t, done) => {
    const gate = adaptiveMfaGate({ requireEnrollment: false, riskThreshold: 40 });
    gate(mkReq({ mfaEnabled: false, mfaVerified: false }, 10), mkRes(), () => done());
  });

  it('passes an enrolled + verified session', (t, done) => {
    const gate = adaptiveMfaGate();
    gate(mkReq({ mfaEnabled: true, mfaVerified: true }, 50), mkRes(), () => done());
  });

  it('blocks enrolled-but-unverified regardless of risk score', () => {
    const gate = adaptiveMfaGate({ riskThreshold: 40 });
    const res  = mkRes();
    gate(mkReq({ mfaEnabled: true, mfaVerified: false }, 5), res, () => {
      throw new Error('next() should not be called');
    });
    assert.equal(res._status, 403);
    assert.equal(res._body?.code, 'MFA_NOT_VERIFIED');
  });

  it('blocks high-risk unverified session above threshold', async () => {
    const gate = adaptiveMfaGate({ riskThreshold: 40 });
    const res  = mkRes();
    await gate(mkReq({ mfaEnabled: false, mfaVerified: false }, 55, ['bot_ua', 'proxy']), res, () => {
      throw new Error('next() should not be called');
    });
    assert.equal(res._status, 403);
    assert.equal(res._body?.code, 'HIGH_RISK_MFA_REQUIRED');
    assert.ok(res._body?.riskScore >= 40);
    assert.ok(Array.isArray(res._body?.riskSignals));
  });

  it('passes high-risk session that IS verified', (t, done) => {
    const gate = adaptiveMfaGate({ riskThreshold: 40 });
    gate(mkReq({ mfaEnabled: true, mfaVerified: true }, 80, ['bot_ua']), mkRes(), () => done());
  });

  it('blocks when requireEnrollment=true and not enrolled', () => {
    const gate = adaptiveMfaGate({ requireEnrollment: true, riskThreshold: 40 });
    const res  = mkRes();
    gate(mkReq({ mfaEnabled: false, mfaVerified: false }, 0), res, () => {
      throw new Error('next() must not be called');
    });
    assert.equal(res._status, 403);
    assert.equal(res._body?.code, 'MFA_NOT_ENROLLED');
  });

  it('passes when requireEnrollment=true and enrolled+verified', (t, done) => {
    const gate = adaptiveMfaGate({ requireEnrollment: true, riskThreshold: 40 });
    gate(mkReq({ mfaEnabled: true, mfaVerified: true }, 0), mkRes(), () => done());
  });

  it('high-risk check takes priority over enrollment check', async () => {
    // enrolled=false, risk=80 — should get HIGH_RISK response not MFA_NOT_ENROLLED
    const gate = adaptiveMfaGate({ requireEnrollment: true, riskThreshold: 40 });
    const res  = mkRes();
    await gate(mkReq({ mfaEnabled: false, mfaVerified: false }, 80), res, () => {});
    assert.equal(res._body?.code, 'HIGH_RISK_MFA_REQUIRED');
  });

  it('skips unauthenticated requests', (t, done) => {
    const gate = adaptiveMfaGate({ requireEnrollment: true });
    const req  = { user: null, riskScore: 100, meta: { ip: '1.1.1.1' }, path: '/', method: 'GET' };
    gate(req, mkRes(), () => done());
  });
});

// ─────────────────────────────────────────────
// 15. mfaForFinancial & mfaForAdmin pre-configs
// ─────────────────────────────────────────────
describe('mfaForFinancial and mfaForAdmin', () => {

  const mkReq = (u = {}, risk = 0) => ({
    user       : { id: 'u1', mfaEnabled: false, mfaVerified: false, ...u },
    riskScore  : risk,
    riskSignals: [],
    meta       : { ip: '1.2.3.4', userAgent: 'test' },
    path       : '/api/escrow/pay',
    originalUrl: '/api/escrow/pay',
    method     : 'POST',
  });
  const mkRes = () => {
    const r = { _status: null, _body: null };
    r.status = c => { r._status = c; return r; };
    r.json   = b => { r._body = b; return r; };
    return r;
  };

  // mfaForFinancial: requireEnrollment=false, threshold=40
  it('mfaForFinancial: passes clean non-enrolled low-risk session', (t, done) => {
    mfaForFinancial(mkReq({ mfaEnabled: false }, 10), mkRes(), () => done());
  });

  it('mfaForFinancial: blocks enrolled-but-unverified', () => {
    const res = mkRes();
    mfaForFinancial(mkReq({ mfaEnabled: true, mfaVerified: false }, 5), res, () => {
      throw new Error('next() must not be called');
    });
    assert.equal(res._status, 403);
    assert.equal(res._body?.code, 'MFA_NOT_VERIFIED');
  });

  it('mfaForFinancial: blocks non-enrolled above risk threshold=40', async () => {
    const res = mkRes();
    await mfaForFinancial(mkReq({ mfaEnabled: false }, 45), res, () => {
      throw new Error('next() must not be called');
    });
    assert.equal(res._status, 403);
    assert.equal(res._body?.code, 'HIGH_RISK_MFA_REQUIRED');
  });

  it('mfaForFinancial: passes enrolled+verified even at high risk', (t, done) => {
    mfaForFinancial(mkReq({ mfaEnabled: true, mfaVerified: true }, 90), mkRes(), () => done());
  });

  // mfaForAdmin: requireEnrollment=true, threshold=30
  it('mfaForAdmin: blocks non-enrolled admin even at low risk', () => {
    const res = mkRes();
    mfaForAdmin(mkReq({ mfaEnabled: false, role: 'admin' }, 5), res, () => {
      throw new Error('next() must not be called');
    });
    assert.equal(res._status, 403);
    // Either not enrolled (if risk < 30) or high-risk
    assert.ok(['MFA_NOT_ENROLLED', 'HIGH_RISK_MFA_REQUIRED'].includes(res._body?.code));
  });

  it('mfaForAdmin: blocks admin with enrollment but unverified', () => {
    const res = mkRes();
    mfaForAdmin(mkReq({ mfaEnabled: true, mfaVerified: false, role: 'admin' }, 0), res, () => {
      throw new Error('next() must not be called');
    });
    assert.equal(res._status, 403);
    assert.equal(res._body?.code, 'MFA_NOT_VERIFIED');
  });

  it('mfaForAdmin: passes enrolled+verified admin', (t, done) => {
    mfaForAdmin(mkReq({ mfaEnabled: true, mfaVerified: true, role: 'admin' }, 0), mkRes(), () => done());
  });

  it('mfaForAdmin: threshold is tighter (30) than mfaForFinancial (40)', async () => {
    // riskScore=35: passes mfaForFinancial, blocked by mfaForAdmin
    const res1 = mkRes(); const res2 = mkRes();
    const req1 = mkReq({ mfaEnabled: false, mfaVerified: false }, 35);
    const req2 = { ...req1 };

    await mfaForFinancial(req1, res1, () => {});  // should pass (35 < 40)
    await mfaForAdmin(req2, res2, () => {});       // should block (35 >= 30)

    assert.equal(res1._status, null, 'mfaForFinancial should pass at risk=35');
    assert.equal(res2._status, 403,  'mfaForAdmin should block at risk=35');
  });
});

// ─────────────────────────────────────────────
// 16. MFA validators (from validate.js)
// ─────────────────────────────────────────────
describe('MFA input validators', () => {
  // We test validators by running them as middleware chains
  // against mock express req/res objects.

  const runValidators = async (validators, body, query = {}) => {
    const req = {
      body, query, params: {},
      headers: { 'content-type': 'application/json' },
    };
    const res = {
      _status: null, _body: null,
      status(c) { this._status = c; return this; },
      json(b)   { this._body = b; return this; },
    };

    // Execute each validator middleware in sequence
    for (const mw of validators) {
      await mw(req, res, () => {});
      if (res._status) break;   // validation failed — stop chain
    }

    const { validationResult } = require('express-validator');
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      res._status = 422;
      res._body = { errors: errors.array() };
    }

    return { req, res };
  };

  describe('validateMfaCode', () => {

    it('passes with a valid 6-digit code', async () => {
      const { res } = await runValidators(validateMfaCode, { code: '123456' });
      assert.equal(res._status, null);
    });

    it('rejects empty code', async () => {
      const { res } = await runValidators(validateMfaCode, { code: '' });
      assert.equal(res._status, 422);
    });

    it('rejects missing code field', async () => {
      const { res } = await runValidators(validateMfaCode, {});
      assert.equal(res._status, 422);
    });

    it('rejects code shorter than 6 chars', async () => {
      const { res } = await runValidators(validateMfaCode, { code: '12345' });
      assert.equal(res._status, 422);
    });

    it('rejects code longer than 10 chars', async () => {
      const { res } = await runValidators(validateMfaCode, { code: '12345678901' });
      assert.equal(res._status, 422);
    });

    it('passes a 10-char backup code', async () => {
      const { res } = await runValidators(validateMfaCode, { code: 'ABCDEF1234' });
      assert.equal(res._status, null);
    });
  });

  describe('validateMfaVerify', () => {

    it('passes with mfaToken + code', async () => {
      const { res } = await runValidators(validateMfaVerify, {
        mfaToken: 'some.jwt.token',
        code    : '123456',
      });
      assert.equal(res._status, null);
    });

    it('rejects missing mfaToken', async () => {
      const { res } = await runValidators(validateMfaVerify, { code: '123456' });
      assert.equal(res._status, 422);
      const fields = res._body?.errors?.map(e => e.field) ?? [];
      assert.ok(fields.includes('mfaToken'));
    });

    it('rejects missing code', async () => {
      const { res } = await runValidators(validateMfaVerify, { mfaToken: 'tok' });
      assert.equal(res._status, 422);
    });

    it('accepts codeType="totp"', async () => {
      const { res } = await runValidators(validateMfaVerify, {
        mfaToken: 'some.jwt.token', code: '123456', codeType: 'totp',
      });
      assert.equal(res._status, null);
    });

    it('accepts codeType="backup"', async () => {
      const { res } = await runValidators(validateMfaVerify, {
        mfaToken: 'some.jwt.token', code: 'ABCDEF12', codeType: 'backup',
      });
      assert.equal(res._status, null);
    });

    it('rejects invalid codeType', async () => {
      const { res } = await runValidators(validateMfaVerify, {
        mfaToken: 'some.jwt.token', code: '123456', codeType: 'sms',
      });
      assert.equal(res._status, 422);
      const fields = res._body?.errors?.map(e => e.field) ?? [];
      assert.ok(fields.includes('codeType'));
    });
  });

  describe('validateMfaDisable', () => {

    it('passes with valid password and 6-digit code', async () => {
      const { res } = await runValidators(validateMfaDisable, {
        password: 'MyStr0ng!Pass', code: '654321',
      });
      assert.equal(res._status, null);
    });

    it('rejects missing password', async () => {
      const { res } = await runValidators(validateMfaDisable, { code: '123456' });
      assert.equal(res._status, 422);
      const fields = res._body?.errors?.map(e => e.field) ?? [];
      assert.ok(fields.includes('password'));
    });

    it('rejects missing code', async () => {
      const { res } = await runValidators(validateMfaDisable, { password: 'pass' });
      assert.equal(res._status, 422);
    });

    it('rejects code that is not exactly 6 digits', async () => {
      const { res } = await runValidators(validateMfaDisable, {
        password: 'pass', code: '12345',
      });
      assert.equal(res._status, 422);
    });

    it('rejects 7-digit code', async () => {
      const { res } = await runValidators(validateMfaDisable, {
        password: 'pass', code: '1234567',
      });
      assert.equal(res._status, 422);
    });
  });
});

// ─────────────────────────────────────────────
// 17. Full adaptive login flow (integration)
// ─────────────────────────────────────────────
describe('Adaptive login flow — integration', () => {
  const mfaService = require(`${ROOT}/services/mfaService`);

  before(() => {
    // Reset user to a known state
    users.set('user-uuid-1', mkUser({ mfa_enabled: 0, mfa_secret: null }));
  });

  it('isRequired returns false for low-risk non-enrolled user', () => {
    const user = mkUser({ mfa_enabled: 0 });
    assert.equal(mfaService.isRequired(user, 10), false);
  });

  it('isRequired returns true for enrolled user regardless of risk', () => {
    const user = mkUser({ mfa_enabled: 1 });
    assert.equal(mfaService.isRequired(user, 0), true);
    assert.equal(mfaService.isRequired(user, 90), true);
  });

  it('isRequired returns true for non-enrolled user above risk threshold', () => {
    const user = mkUser({ mfa_enabled: 0 });
    assert.equal(mfaService.isRequired(user, 40), true);
    assert.equal(mfaService.isRequired(user, 99), true);
  });

  it('isRequired returns false for null user', () => {
    assert.equal(mfaService.isRequired(null, 50), false);
  });

  it('generateMfaToken produces a token with mfaPending=true', () => {
    const token   = mfaService.generateMfaToken('user-uuid-1');
    const [, b64] = token.split('.');
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    assert.equal(payload.mfaPending, true);
    assert.equal(payload.id, 'user-uuid-1');
  });

  it('exchangeMfaToken — valid TOTP flow issues real token pair', async () => {
    speakeasyVerifyResult = true;
    users.set('user-uuid-1', mkUser({ mfa_enabled: 1, mfa_secret: 'JBSWY3DPEHPK3PXP' }));

    const mfaToken = mfaService.generateMfaToken('user-uuid-1');
    const result   = await mfaService.exchangeMfaToken({
      mfaToken,
      code      : '123456',
      codeType  : 'totp',
      ipAddress : '127.0.0.1',
      userAgent : 'test-agent',
    });

    assert.equal(result.success, true);
    assert.ok(result.accessToken);
    assert.ok(result.refreshToken);
    assert.equal(result.mfaVerified, true);

    // Decode access token — must have mfaVerified=true
    const [, b64] = result.accessToken.split('.');
    const payload = JSON.parse(Buffer.from(b64, 'base64url').toString());
    assert.equal(payload.mfaVerified, true);
  });

  it('exchangeMfaToken — invalid TOTP is rejected', async () => {
    speakeasyVerifyResult = false;
    users.set('user-uuid-1', mkUser({ mfa_enabled: 1, mfa_secret: 'JBSWY3DPEHPK3PXP' }));

    const mfaToken = mfaService.generateMfaToken('user-uuid-1');
    const result   = await mfaService.exchangeMfaToken({
      mfaToken,
      code     : '000000',
      codeType : 'totp',
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    });

    assert.equal(result.success, false);
    assert.equal(result.code, 'INVALID_CODE');
    speakeasyVerifyResult = true;  // restore
  });

  it('exchangeMfaToken — expired/invalid mfaToken returns TOKEN_INVALID', async () => {
    const result = await mfaService.exchangeMfaToken({
      mfaToken : 'not.a.real.token',
      code     : '123456',
      codeType : 'totp',
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    });
    assert.equal(result.success, false);
    assert.equal(result.code, 'TOKEN_INVALID');
  });

  it('exchangeMfaToken — non-mfaPending token returns NOT_MFA_TOKEN', async () => {
    const realToken = signAccessToken({ id: 'user-uuid-1', role: 'buyer' });

    const result = await mfaService.exchangeMfaToken({
      mfaToken : realToken,
      code     : '123456',
      codeType : 'totp',
      ipAddress: '127.0.0.1',
      userAgent: 'test',
    });
    assert.equal(result.success, false);
    assert.equal(result.code, 'NOT_MFA_TOKEN');
  });
});

// ─────────────────────────────────────────────
// 18. mfaRoutes — smoke test route definitions
// ─────────────────────────────────────────────
describe('mfaRoutes route structure', () => {
  // We import the router and inspect its stack
  // without spinning up a full HTTP server.
  const router = require(`${ROOT}/routes/mfaRoutes`);

  it('router exports an express Router', () => {
    assert.ok(router?.stack, 'should have a .stack property');
    assert.ok(typeof router.handle === 'function' || typeof router === 'function');
  });

  it('router has at least 6 route definitions', () => {
    const routes = router.stack.filter(l => l.route);
    assert.ok(routes.length >= 6, `Expected >= 6 routes, got ${routes.length}`);
  });

  it('POST /verify is in the route stack', () => {
    const routes = router.stack.filter(l => l.route);
    const verify = routes.find(l => l.route.path === '/verify' && l.route.methods.post);
    assert.ok(verify, 'POST /verify route not found');
  });

  it('GET /status is in the route stack', () => {
    const routes = router.stack.filter(l => l.route);
    const status = routes.find(l => l.route.path === '/status' && l.route.methods.get);
    assert.ok(status, 'GET /status route not found');
  });

  it('POST /disable is in the route stack', () => {
    const routes = router.stack.filter(l => l.route);
    const disable = routes.find(l => l.route.path === '/disable' && l.route.methods.post);
    assert.ok(disable, 'POST /disable route not found');
  });

  it('POST /backup-codes/regenerate is in the route stack', () => {
    const routes = router.stack.filter(l => l.route);
    const regen = routes.find(l =>
      l.route.path === '/backup-codes/regenerate' && l.route.methods.post
    );
    assert.ok(regen, 'POST /backup-codes/regenerate route not found');
  });
});