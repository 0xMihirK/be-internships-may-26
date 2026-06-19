// Per-user rate limiter, sliding window.
// We keep the timestamps of the allowed requests in the last minute and let a
// new one through only while fewer than RATE are still in the window. It's
// in-memory, so it covers a single process; for multiple instances this would
// move to Redis (INCR + EXPIRE, or a sorted set for a sliding window).

const RATE = Number(process.env.RATE_LIMIT_PER_MIN || 5);
const WINDOW_MS = 60_000;

const hits = new Map(); // userId -> timestamps[]

export function checkAndConsume(userId, nowMs = Date.now()) {
  const windowStart = nowMs - WINDOW_MS;
  const recent = (hits.get(userId) || []).filter((ts) => ts > windowStart);

  // at the limit -> reject, and don't record the attempt
  if (recent.length >= RATE) {
    hits.set(userId, recent);
    return { ok: false, remaining: 0, resetMs: recent[0] + WINDOW_MS };
  }

  recent.push(nowMs);
  hits.set(userId, recent);
  return { ok: true, remaining: RATE - recent.length, resetMs: recent[0] + WINDOW_MS };
}

// drop idle users every so often so the map doesn't grow forever
const cleanup = setInterval(() => {
  const cutoff = Date.now() - WINDOW_MS;
  for (const [userId, ts] of hits) {
    if (ts.every((t) => t <= cutoff)) hits.delete(userId);
  }
}, WINDOW_MS);
cleanup.unref();
