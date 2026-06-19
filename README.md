# Signals Challenge (Solved)

> **Status: solved.** All tasks below are implemented and `npm test` passes. See [How it works](#how-it-works) for the approach.

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

## How it works

**Rate limiting** (`src/rateLimit.js`) — a fixed one-minute window per user, kept
in memory. It's synchronous, so requests in one process can't race the counter.
For multiple instances the same logic moves to Redis (`INCR` + `EXPIRE`); see
`SCALE.md`.

**Idempotency** (`src/signals.js`) — relies on the `UNIQUE(idempotency_key)`
index. We try to insert; if two requests race and one hits the unique constraint,
we read the key back and return the row that was actually stored. So the same key
always returns the same resource, even across instances or a restart.

**DB failures** — transient errors (`SQLITE_BUSY`, simulated via `DB_FAIL_RATE`)
are retried with exponential backoff + jitter. A unique-constraint error isn't
retried; it's handled as the idempotency case above. A failed write never
half-commits, so retries don't create duplicates.

## Run

```
cp .env.example .env     # set API_KEY etc.
npm install
npm run dev              # listens on PORT (default 8080)
```

## Test

```
npm test
```

Covers rate limiting, idempotency (single, concurrent, two instances, and after a
restart), and retrying through simulated DB failures.
