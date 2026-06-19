// Fixed one-minute window per user.
// This is sync (no await), and Node runs one thing at a time, so parallel
// requests can't race the counter here. For multiple instances move the counter
// to Redis (INCR + 60s EXPIRE) since this Map is per-process. See SCALE.md.

const RATE = Number(process.env.RATE_LIMIT_PER_MIN || 5);
const WINDOW_MS = 60_000;

// userId -> { start, count }
const buckets = new Map();

export function checkAndConsume(userId, nowMs = Date.now()) {
  let b = buckets.get(userId);

  // new user, or last window expired -> start a fresh window
  if (!b || nowMs - b.start >= WINDOW_MS) {
    b = { start: nowMs, count: 0 };
    buckets.set(userId, b);
  }

  b.count += 1;

  const ok = b.count <= RATE;
  const remaining = Math.max(RATE - b.count, 0);
  const resetMs = b.start + WINDOW_MS;
  return { ok, remaining, resetMs };
}
