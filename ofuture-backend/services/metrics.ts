// services/metrics.ts
// Prometheus metrics middleware with graceful fallback when prom-client is not installed.

import { Request, Response, NextFunction } from 'express';

let enabled = false;
let registry: any = null;
let httpRequestsTotal: any = null;
let httpRequestDurationSeconds: any = null;

try {
  const client = require('prom-client');
  const collectDefaultMetrics = client.collectDefaultMetrics;
  const Registry = client.Registry;

  registry = new Registry();
  collectDefaultMetrics({ register: registry });

  // Counters / Histograms
  httpRequestsTotal = new client.Counter({
    name: 'ofuture_http_requests_total',
    help: 'Total number of HTTP requests',
    labelNames: ['method', 'route', 'status'],
    registers: [registry],
  });

  httpRequestDurationSeconds = new client.Histogram({
    name: 'ofuture_http_request_duration_seconds',
    help: 'HTTP request latency in seconds',
    labelNames: ['method', 'route', 'status'],
    buckets: [0.005, 0.01, 0.05, 0.1, 0.5, 1, 2, 5],
    registers: [registry],
  });

  enabled = true;
  console.info('[Metrics] prom-client enabled. Collecting default metrics.');
} catch (err) {
  console.info('[Metrics] prom-client not installed. Metrics disabled. Install prom-client to enable Prometheus metrics.');
}

const metricsMiddleware = (req: Request, res: Response, next: NextFunction) => {
  if (!enabled) return next();

  const start = process.hrtime();
  res.once('finish', () => {
    try {
      const delta = process.hrtime(start);
      const duration = delta[0] + delta[1] / 1e9; // seconds
      const method = req.method || 'UNKNOWN';
      const route = req.route && req.route.path ? req.baseUrl + req.route.path : (req.originalUrl || req.url);
      const status = String(res.statusCode || 0);

      httpRequestsTotal.inc({ method, route, status });
      httpRequestDurationSeconds.observe({ method, route, status }, duration);
    } catch (e) {
      // swallow metric errors
    }
  });

  next();
};

const metricsEndpoint = async (req: Request, res: Response) => {
  if (!enabled) {
    return res.status(501).send('Metrics not enabled on this instance.');
  }

  // Optional bearer token protection in production
  const token = process.env.METRICS_BEARER_TOKEN || null;
  if (token && process.env.NODE_ENV === 'production') {
    const auth = (req.headers.authorization || '').trim();
    if (!auth.startsWith('Bearer ') || auth.slice(7) !== token) {
      return res.status(401).send('Unauthorized');
    }
  }

  try {
    res.set('Content-Type', registry.contentType || 'text/plain; version=0.0.4');
    const body = await registry.metrics();
    res.status(200).send(body);
  } catch (err) {
    res.status(500).send('Failed to collect metrics');
  }
};

export = { metricsMiddleware, metricsEndpoint };