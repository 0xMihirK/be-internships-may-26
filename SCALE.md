# Scale Plan

How I'd take this service from the toy SQLite version to something that can take
~10k requests/sec. The app code is already stateless, so most of the work is in
moving the shared state (rate-limit counts, idempotency keys, the data itself)
out of one process and into stores that every instance can share.

## Data model / indexes
- `signals` table as today, but on Postgres for real traffic.
- `UNIQUE(idempotency_key)` — this is the constraint that makes idempotency safe;
  the database, not the app, is the source of truth for "have we seen this key".
- `INDEX(user_id, created_at)` — supports `GET /v1/signals?userId=...` ordered by
  newest, without scanning the whole table.
- At very high volume, partition `signals` by `created_at` (e.g. monthly) so old
  data can be dropped/archived cheaply and indexes stay small.

## Idempotency across instances
- Keep relying on the DB `UNIQUE` constraint: every instance does the same
  insert-and-catch-the-conflict, so two instances racing the same key still end
  up with exactly one row. No check-then-insert gap to lose.
- To save a DB round-trip on the common "client retried" case, put a short-TTL
  cache (Redis `SET key result NX EX 86400`) in front: first writer stores the
  response, later retries read it straight from Redis.

## Rate limiting across instances
- The in-memory limiter only protects one process, so move it to Redis where all
  instances share the counts.
- Simple version: `INCR ratelimit:{userId}:{minute}` with `EXPIRE 60` — fixed
  window, one atomic op per request.
- More accurate version: a sliding-window log in a Redis sorted set (or a small
  Lua script) so bursts at the minute boundary can't sneak through, matching the
  in-memory logic here.

## Observability (logs / metrics / alerts)
- Structured JSON logs (Fastify/pino already gives us this) with a request id so
  a single request can be traced across instances.
- Metrics (Prometheus/OpenTelemetry): requests/sec, p50/p95/p99 latency, 429 rate,
  503 / DB-error rate, DB retry count, idempotency-conflict count.
- Alerts on: error rate (5xx) over threshold, p99 latency climbing, DB pool
  saturation, and Redis being unreachable.

## Failure modes
- Transient DB errors: retry with exponential backoff + jitter (done in
  `signals.js`). Retries are safe because the unique key means a replay can't
  create a duplicate.
- DB down / sustained errors: add a circuit breaker so we fail fast with 503
  instead of piling up retries, and let clients back off.
- Redis down: fall back to letting requests through (fail open) for rate limiting
  rather than rejecting everyone — idempotency still holds because the DB
  constraint is the real guard.
- Partial outage: requests that did commit are still idempotent, so client retries
  are harmless.

## 10k RPS design sketch
- Load balancer in front of N stateless app instances behind an autoscaler (the
  app holds no per-user state once rate limiting moves to Redis).
- Postgres as the primary store with a connection pooler (PgBouncer) so thousands
  of app connections fold into a small pool; read replicas serve the `GET` reads.
- Redis for rate-limit counters and the idempotency-response cache.
- If write throughput becomes the bottleneck, accept the signal, return the
  idempotent id, and push the heavy work onto a queue (Kafka/SQS) for workers to
  drain — the endpoint stays fast and the queue absorbs spikes.
- Rough cost ballpark (cloud, monthly): ~6–10 app containers, one Postgres
  primary + a replica or two, a small Redis cluster, plus a load balancer —
  order of a few thousand dollars/month, scaling with traffic.
