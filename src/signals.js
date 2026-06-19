import { insertSignal, getByIdemKey, listSignals, isUniqueViolation } from './db.js';
import { checkAndConsume } from './rateLimit.js';

function nowMs() {
  return Date.now();
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

const MAX_RETRIES = 3;

// Retry a DB call on transient errors (the DB_FAIL_RATE sim throws SQLITE_BUSY).
// A unique violation isn't transient, so rethrow it. Backoff grows, with jitter
// so retries don't all fire at once.
async function withRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return fn();
    } catch (err) {
      if (isUniqueViolation(err)) throw err;
      lastErr = err;
      if (attempt === MAX_RETRIES) break;
      const backoff = 50 * 2 ** attempt; // 50, 100, 200 ms
      await sleep(backoff + Math.floor(Math.random() * 50));
    }
  }
  throw lastErr;
}

export async function postSignal(req, reply) {
  const idem = req.headers['idempotency-key'] || null;
  const { userId, type, payload } = req.body || {};
  if (!userId || !type || typeof payload === 'undefined') {
    return reply.code(400).send({ error: 'invalid_body' });
  }

  // Already stored this key? return the same row. Done before the rate-limit
  // check so a client retrying isn't charged a token. A transient read error
  // here is fine - fall through and let the insert settle it.
  if (idem) {
    try {
      const existing = await withRetry(() => getByIdemKey(idem));
      if (existing) return existing;
    } catch (err) {
      req.log.warn({ err, ctx: 'idempotency_lookup' });
    }
  }

  const { ok, remaining, resetMs } = checkAndConsume(userId, nowMs());
  if (!ok) return reply.code(429).send({ error: 'rate_limited', remaining, resetMs });

  const createdAt = nowMs();
  try {
    const info = await withRetry(() => insertSignal(userId, type, payload, idem, createdAt));
    return {
      id: info.lastInsertRowid,
      userId,
      type,
      payload: String(payload),
      idempotencyKey: idem,
      createdAt,
    };
  } catch (err) {
    // Lost the race - another request inserted this key first. The UNIQUE
    // constraint is what keeps us duplicate-free across requests/instances;
    // fetch and return the row that won.
    if (idem && isUniqueViolation(err)) {
      try {
        const existing = await withRetry(() => getByIdemKey(idem));
        if (existing) return existing;
      } catch (lookupErr) {
        // The winning row exists, we just couldn't read it back right now.
        // Report it as transient so the client retries instead of getting a 500.
        req.log.error({ err: lookupErr, ctx: 'idempotency_recover' });
        return reply.code(503).send({ error: 'db_unavailable' });
      }
    }
    req.log.error({ err, ctx: 'insertSignal' });
    return reply.code(503).send({ error: 'db_unavailable' });
  }
}

export async function getSignals(req, reply) {
  const { userId, limit = 20 } = req.query || {};
  if (!userId) return reply.code(400).send({ error: 'missing_userId' });
  const lim = Math.min(Number(limit) || 20, 100);
  try {
    const rows = await withRetry(() => listSignals(userId, lim));
    return { items: rows };
  } catch (err) {
    req.log.error({ err, ctx: 'listSignals' });
    return reply.code(503).send({ error: 'db_unavailable' });
  }
}
