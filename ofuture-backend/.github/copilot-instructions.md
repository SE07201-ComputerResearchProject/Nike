# Copilot instructions for O'Future repository (backend)

## Build / dev / test
- Dev server (TypeScript + ts-node + nodemon): npm run dev (entry: server.ts)
- Start production (node): npm start
- Run tests (Jest): npm test
- Run a single test by name: npm test -- -t "<test name>"
- Run a single test file: npx jest path/to/file.test.ts -t "<test name>"
- CI runs tests with Redis service. Locally: docker run -d -p 6379:6379 redis:7 && set REDIS_URL=redis://localhost:6379 && npm test -- --runInBand

## Where key files live
- Backend entry: ofuture-backend/server.ts
- DB schema (source of truth): ofuture-backend/config/schema.sql
- Env/config: ofuture-backend/config/* (db.ts, securityConfig.ts)
- Routes / services / middleware: ofuture-backend/routes/, services/, middleware/
- Frontend (static): ofuture-frontend/ (vanilla HTML/CSS/JS)

## High-level architecture (short)
- Backend: TypeScript Express API; MySQL primary datastore (schema.sql); Redis used for rate-limiting, transient counters (failed login), and test CI; Socket.io for real-time notifications; services implement domain logic (notificationService, webSocketService, paymentService).
- Frontend: static, multi-dashboard (buyer/seller/admin) pages under ofuture-frontend/. JavaScript files directly call backend REST endpoints and use Socket.io for realtime.

## Key conventions & patterns
- Server port: default 5000 (process.env.PORT || 5000). Health: /health
- Currency: VND only. Formatting and business logic assume VND (see AI_AGENT_TODO.md).
- Virtual-money flow: wallet and escrow logic implemented as internal (no external bank flows by default).
- DB migrations: schema.sql is canonical; propose ALTER/CREATE statements and update models/controllers accordingly.
- Route naming: files named *Routes.ts export Express routers. Services named *Service.ts hold business logic.
- Request tracing: X-Request-ID / req.requestId used across middleware for logging
- Security: helmet, cors, rate-limiter, input sanitization pipeline in middleware/security
- Testing: CI uses redis service; tests may depend on REDIS_URL and NODE_ENV=test. Use --runInBand for CI-like single-process runs.

## Useful env vars (non-exhaustive)
- PORT, NODE_ENV, REDIS_URL, ALLOWED_ORIGINS, RATE_LIMIT_WINDOW_MS, RATE_LIMIT_MAX, METRICS_BEARER_TOKEN

## On asking Copilot/AI agents
- Read ofuture-backend/config/schema.sql before changing DB models.
- Preserve existing HTML/CSS structure; append rather than overwrite (AI_AGENT_TODO.md directive).
- See NOTIFICATIONS_TESTING_GUIDE.md for notification-related test scenarios and debug commands.

---
Created at: ofuture-backend/.github/copilot-instructions.md
References: AI_AGENT_TODO.md, NOTIFICATIONS_TESTING_GUIDE.md, ofuture-backend/config/schema.sql
