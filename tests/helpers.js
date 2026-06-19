// Shared helpers for the tests: one thin HTTP wrapper, plus a readiness check
// so we wait for the spawned server to actually be up instead of guessing with
// a fixed sleep.
import http from 'node:http';
import { setTimeout as wait } from 'node:timers/promises';

// Make an HTTP request and resolve with { status, body }. JSON in, JSON out.
export function request(url, { method = 'GET', headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const data = body ? JSON.stringify(body) : null;
    const opts = { method, headers: { ...headers } };
    if (data) opts.headers['content-type'] = 'application/json';

    const req = http.request(url, opts, (res) => {
      let chunks = '';
      res.on('data', (d) => (chunks += d));
      res.on('end', () => resolve({ status: res.statusCode, body: chunks ? JSON.parse(chunks) : {} }));
    });
    req.on('error', reject);
    if (data) req.write(data);
    req.end();
  });
}

// Poll /healthz until the server answers, so tests don't start before it's ready.
export async function waitForHealth(base) {
  for (let i = 0; i < 50; i++) {
    try {
      const res = await request(`${base}/healthz`);
      if (res.status === 200) return;
    } catch {
      // not listening yet - keep trying
    }
    await wait(100);
  }
  throw new Error('server did not become healthy in time');
}
