# Signals Challenge (SOLVED)

Build a minimal production-leaning service that can **handle load**, **rate limit**, and **avoid duplicates** via idempotency.

## Endpoints (to keep)
- `POST /v1/signals`
  - body: `{ "userId": "string", "type": "string", "payload": "string" }`
  - headers: `X-API-Key`, `Idempotency-Key` (optional)
  - behaviors:
    - **Rate limit** per `userId`: `RATE_LIMIT_PER_MIN` per minute (default 5).
    - **Idempotency**: same `Idempotency-Key` should not create duplicates.
- `GET /v1/signals?userId=...&limit=...`
- `GET /healthz`

## Your Tasks
1. **Implement a robust rate limiter** in `src/rateLimit.js`.
2. **Make idempotency safe across scale** in `src/signals.js`.
3. **Handle DB failure** gracefully with retry/backoff.
4. **Think for 10k RPS.** Add a `SCALE.md`.
5. **Finish the tests** in `tests/*.test.js`.

## Deliverables
- Working service, passing tests, updated README, SCALE.md.
- Optional deploy link.
---

## Extra Production Constraints (must pass)

- **Atomic Idempotency:** Survive concurrent requests and restarts. Avoid check-then-insert races; use a DB-level unique constraint or atomic upsert pattern. Return the same resource for identical `Idempotency-Key`.
- **Concurrency-Safe Rate Limit:** Must behave correctly under burst and parallel calls. Naive in-memory counters that race will fail hidden checks. Explain how this becomes multi-instance safe.
- **Transient DB Failures:** Implement retry/backoff (with jitter) or circuit breaker when DB errors occur (we simulate via `DB_FAIL_RATE`). No duplicates on retry.
- **Scale Plan (10k RPS):** Fill `SCALE.md` with a clear, concise approach (indexes, pooling, caching, queues, horizontal scale, idempotency store).

> We will run additional **hidden concurrency/multi-instance tests** during evaluation.

---

## Running it

```bash
npm install
cp .env.example .env   # set API_KEY etc.
npm run dev            # starts on PORT (default 8080)
npm test               # runs the tests
```

Quick check once it's running:

```bash
# create a signal
curl -s -XPOST localhost:8080/v1/signals \
  -H 'x-api-key: change-me' -H 'idempotency-key: abc' \
  -H 'content-type: application/json' \
  -d '{"userId":"u1","type":"note","payload":"hello"}'

# same idempotency-key returns the same row, doesn't create a duplicate
curl -s localhost:8080/v1/signals?userId=u1 -H 'x-api-key: change-me'
```

## How I solved it

- **Rate limiting (`src/rateLimit.js`)** — per-user sliding window: keep the
  timestamps of allowed requests in the last minute, block once
  `RATE_LIMIT_PER_MIN` are used. In-memory for one process; comments note the
  Redis version for multiple instances.
- **Idempotency (`src/signals.js` + `src/db.js`)** — rely on the
  `UNIQUE(idempotency_key)` constraint instead of check-then-insert. On a clash I
  return the existing row, so concurrent requests can't make duplicates. A quick
  lookup runs first (before the rate-limit check) so retries aren't charged a token.
- **Transient DB failures** — `withRetry` backs off with jitter on `SQLITE_BUSY`
  (simulated by `DB_FAIL_RATE`); unique violations aren't retried.
- **Scale** — see `SCALE.md`.
- **Tests** — each uses its own temp DB; `concurrency.test.js` fires 20 parallel
  same-key requests and checks only one row is created.
