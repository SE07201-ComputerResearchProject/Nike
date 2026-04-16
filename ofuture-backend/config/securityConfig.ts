// config/securityConfig.ts
// ─────────────────────────────────────────────
// Single source of truth for every security
// tuning parameter in the application.
// ─────────────────────────────────────────────

const SECURITY_CONFIG = {

  // ── Rate Limiting ──────────────────────────
  rateLimits: {
    global: {
      windowMs : 1 * 60 * 1000,   // 15 min
      max      : 300000,               // requests per window
    },
    auth: {
      register : { windowMs: 1 * 60 * 1000, max: 500   },  // 5 / hr
      login    : { windowMs: 1 * 60 * 1000, max: 1000  },  // 10 / 15 min
      refresh  : { windowMs: 1 * 60 * 1000, max: 3000  },  // 30 / 15 min
      mfa      : { windowMs: 15 * 60 * 1000, max: 1000  },  // 10 / 15 min
    },
    financial: {
      windowMs : 1 * 60 * 1000,
      max      : 1500,
    },
    writes: {
      windowMs : 1 * 60 * 1000,
      max      : 3000,
    },
    publicRead: {
      windowMs : 1 * 60 * 1000,
      max      : 50000,
    },
    admin: {
      windowMs : 1 * 60 * 1000,
      max      : 20000,
    },
  },

  // ── IP Block List ──────────────────────────
  ipBlock: {
    autobanThreshold : 2000,
    autobanWindowMs  : 1 * 60 * 1000,   // 10 min
    banDurationMs    : 60 * 60 * 1000,   // 1 hr ban
  },

  // ── Request Limits ─────────────────────────
  payload: {
    maxJsonBytes  : '10kb',
    maxFormBytes  : '10kb',
    maxFileBytes  : '5mb',
  },

  // ── Password Policy ────────────────────────
  password: {
    minLength         : 8,
    requireUppercase  : true,
    requireLowercase  : true,
    requireNumber     : true,
    requireSpecial    : true,
    bcryptRounds      : 12,
  },

  // ── Account Lockout ────────────────────────
  lockout: {
    maxFailedAttempts : 500,
    baseLockMinutes   : 1,
    maxLockMinutes    : 1,
  },

  // ── JWT ────────────────────────────────────
  jwt: {
    accessExpiresIn  : '15d',
    refreshExpiresIn : '7d',
    algorithm        : 'HS256',
    issuer           : 'ofuture-api',
    audience         : 'ofuture-client',
  },

  // ── Suspicious Pattern Regexes ─────────────
  suspiciousPatterns: [
    { name: 'sql_injection',  pattern: /(\bUNION\b.*\bSELECT\b|\bDROP\b.*\bTABLE\b|\bINSERT\b.*\bINTO\b|\bOR\b\s+['"]?\d+['"]?\s*=\s*['"]?\d)/i },
    { name: 'xss',            pattern: /(<script[\s>]|javascript:|on\w+\s*=|<iframe|<object|<embed)/i },
    { name: 'path_traversal', pattern: /(\.\.[/\\]){2,}/ },
    { name: 'ssti',           pattern: /\{\{[\s\S]*?\}\}|\$\{[\s\S]*?\}|<%[\s\S]*?%>/ },
    { name: 'cmd_injection',  pattern: /(;|\||`|&&|\$\()\s*(ls|cat|rm|curl|wget|bash|sh|python|node)/i },
    { name: 'php_injection',  pattern: /<\?php|eval\s*\(|base64_decode\s*\(/i },
    { name: 'xxe',            pattern: /<!ENTITY|<!DOCTYPE[\s\S]*?\[/i },
    { name: 'nosql_injection',pattern: /(\$where|\$gt|\$lt|\$ne|\$regex|\$or|\$and)/i },
  ],

  // ── CORS ───────────────────────────────────
  cors: {
    methods        : ['GET','POST','PUT','PATCH','DELETE','OPTIONS'],
    allowedHeaders : ['Content-Type','Authorization','X-Request-ID','X-CSRF-Token'],
    exposedHeaders : ['X-Request-ID','X-RateLimit-Remaining'],
    maxAge         : 86400,   // preflight cache: 24 hrs
  },

  // ── Security Headers (Helmet overrides) ────
  headers: {
    hsts: {
      maxAge            : 31536000,   // 1 year
      includeSubDomains : true,
      preload           : true,
    },
    csp: {
      defaultSrc : ["'self'"],
      scriptSrc  : ["'self'"],
      styleSrc   : ["'self'", "'unsafe-inline'"],
      imgSrc     : ["'self'", 'data:', 'https:'],
      connectSrc : ["'self'"],
      fontSrc    : ["'self'"],
      objectSrc  : ["'none'"],
      frameSrc   : ["'none'"],
    },
  },
} as const;

export = SECURITY_CONFIG;