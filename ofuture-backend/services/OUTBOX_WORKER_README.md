Outbox worker

Run the outbox worker with:

  node services/outboxWorker.js

This process polls the outbox_events table and performs external gateway operations (charge, transfer, refund).
Ensure database migrations have been applied and the worker runs as a separate process (pm2/systemd) in production.
