// server.ts
// ─────────────────────────────────────────────
// O'Future Backend — Main Entry Point
// ─────────────────────────────────────────────

import dotenv from 'dotenv';
dotenv.config();

import express, { Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import morgan from 'morgan';
import rateLimit from 'express-rate-limit';
import { v4 as uuidv4 } from 'uuid';

// Mở rộng interface Request của Express để TypeScript nhận diện req.requestId
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}

const { testConnection } = require('./config/db');
const logger = require('./utils/logger');

// ── Security middleware pipeline ─────────────
const {
  requestFingerprint,
  detectSuspiciousPayload,
  responseHardening,
  hppProtection,
  sanitizeInputs,
} = require('./middleware/security');

// Metrics (Prometheus) — optional, graceful fallback if prom-client missing
const { metricsMiddleware, metricsEndpoint } = require('./services/metrics');

// ── Route imports ────────────────────────────
const authRoutes     = require('./routes/authRoutes');
const productRoutes  = require('./routes/productRoutes');   // Phase 5
const orderRoutes    = require('./routes/orderRoutes');     // Phase 6
const escrowRoutes   = require('./routes/escrowRoutes');    // Phase 7
const reviewRoutes   = require('./routes/reviewRoutes');    // Phase 8
const adminRoutes    = require('./routes/adminRoutes');     // Phase 9
const mfaRoutes      = require('./routes/mfaRoutes');       // Phase 11 
const chatRoutes     = require('./routes/chatRoutes');      // Phase 12
const paymentRoutes  = require('./routes/paymentRoutes');

const app = express();
const PORT = process.env.PORT || 5000;

// ────────────────────────────────────────────
// 1. SECURITY MIDDLEWARE
// ────────────────────────────────────────────

// Helmet sets secure HTTP headers
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'"],
      imgSrc: ["'self'", 'data:', 'https:'],
    },
  },
  crossOriginEmbedderPolicy: true,
  hsts: {
    maxAge: 31536000,          // 1 year
    includeSubDomains: true,
    preload: true,
  },
}));

// CORS — only allow trusted origins
const allowedOrigins = (process.env.ALLOWED_ORIGINS || '')
  .split(',')
  .map(o => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (e.g. curl, Postman in dev)
    if (!origin || process.env.NODE_ENV !== 'production') {
      return callback(null, true);
    }
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    callback(new Error(`CORS policy: origin "${origin}" not allowed`));
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
}));

// ────────────────────────────────────────────
// 2. RATE LIMITING (Global — Phase 10 adds route-level limits)
// ────────────────────────────────────────────
const globalLimiter = rateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS) || 15 * 60 * 1000, // 15 min
  max: Number(process.env.RATE_LIMIT_MAX) || 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    message: 'Too many requests from this IP. Please try again later.',
  },
  handler: (req: Request, res: Response, next: NextFunction, options: any) => {
    logger.warn(`Rate limit exceeded: IP=${req.ip} PATH=${req.path}`);
    res.status(429).json(options.message);
  },
});

app.use(globalLimiter);

// ────────────────────────────────────────────
// 3. BODY PARSING
// ────────────────────────────────────────────
app.use(express.json({ limit: '10kb' }));        // reject large payloads
app.use(express.urlencoded({ extended: true, limit: '10kb' }));

// ────────────────────────────────────────────
// 3b. CUSTOM SECURITY PIPELINE (Phase 4)
// ────────────────────────────────────────────
app.use(responseHardening);          // harden response headers
app.use(requestFingerprint);         // attach IP/UA to req.meta
app.use(hppProtection);              // HTTP Parameter Pollution protection
app.use(sanitizeInputs);             // sanitize body/query strings
app.use(detectSuspiciousPayload);    // block injection patterns

// ────────────────────────────────────────────
// 4. HTTP REQUEST LOGGING (Morgan → Winston)
// ────────────────────────────────────────────
app.use(
  morgan('combined', {
    stream: { write: (msg) => logger.http(msg.trim()) },
    skip: (req: Request) => req.path === '/health', // skip health check noise
  })
);

// Metrics middleware (collects Prometheus metrics per request)
app.use(metricsMiddleware);
// Metrics endpoint — protected by METRICS_BEARER_TOKEN in production
app.get('/metrics', metricsEndpoint);

// ────────────────────────────────────────────
// 5. REQUEST ID (traceability)
// ────────────────────────────────────────────
app.use((req: Request, _res: Response, next: NextFunction) => {
  req.requestId = (req.headers['x-request-id'] as string) || uuidv4();
  next();
});

// ────────────────────────────────────────────
// 6. ROUTES
// ────────────────────────────────────────────

// ── Health Check ──────────────────────────
app.get('/health', async (req: Request, res: Response) => {
  const { pool } = require('./config/db');
  let dbStatus = 'disconnected';
  let dbLatencyMs: number | null = null;

  try {
    const start = Date.now();
    const conn = await pool.getConnection();
    await conn.ping();
    conn.release();
    dbLatencyMs = Date.now() - start;
    dbStatus = 'connected';
  } catch {
    dbStatus = 'error';
  }

  const status = dbStatus === 'connected' ? 200 : 503;

  res.status(status).json({
    success: dbStatus === 'connected',
    service: "O'Future API",
    version: '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    timestamp: new Date().toISOString(),
    uptime: `${Math.floor(process.uptime())}s`,
    database: {
      status: dbStatus,
      latency: dbLatencyMs !== null ? `${dbLatencyMs}ms` : null,
    },
    requestId: req.requestId,
  });
});

// ── API Routes ────────────────────────────
app.use('/api/auth',     authRoutes);
app.use('/api/products', productRoutes);     // Phase 5

// Dev-only: RBAC test harness (disable in production)
if (process.env.NODE_ENV !== 'production') {
  const rbacTestRoutes = require('./routes/rbacTestRoutes');
  app.use('/api/rbac-test', rbacTestRoutes);
  logger.info('🧪  RBAC test routes enabled (development only)');
}
app.use('/api/orders',   orderRoutes);    // Phase 6
app.use('/api/escrow',   escrowRoutes);   // Phase 7
app.use('/api/reviews',  reviewRoutes);   // Phase 8
app.use('/api/admin',    adminRoutes);    // Phase 9
app.use('/api/mfa',      mfaRoutes);      // Phase 11
app.use('/api/chat',     chatRoutes);     // Phase 12
app.use('/api/payments', paymentRoutes);

// ────────────────────────────────────────────
// 7. 404 HANDLER
// ────────────────────────────────────────────
app.use((req: Request, res: Response) => {
  res.status(404).json({
    success: false,
    message: `Route ${req.method} ${req.path} not found`,
    requestId: req.requestId,
  });
});

// ────────────────────────────────────────────
// 8. GLOBAL ERROR HANDLER
// ────────────────────────────────────────────
app.use((err: any, req: Request, res: Response, _next: NextFunction) => {
  logger.error(`[${req.requestId}] ${err.stack || err.message}`);

  // Don't leak stack traces in production
  const response: any = {
    success: false,
    message: process.env.NODE_ENV === 'production'
      ? 'Internal server error'
      : err.message,
    requestId: req.requestId,
  };

  if (process.env.NODE_ENV !== 'production') {
    response.stack = err.stack;
  }

  res.status(err.status || 500).json(response);
});

// ────────────────────────────────────────────
// 9. START SERVER
// ────────────────────────────────────────────
const startServer = async () => {
  await testConnection(); // fail fast if DB unreachable

  app.listen(PORT, () => {
    logger.info(`🚀  O'Future API running on port ${PORT}`);
    logger.info(`📍  Environment: ${process.env.NODE_ENV || 'development'}`);
    logger.info(`🔗  Health check: http://localhost:${PORT}/health`);
  });
};

startServer();

export = app; // export for testing