import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { request, waitForHealth } from './helpers.js';

// Fire many identical requests at once and make sure the same idempotency key
// only ever creates one row. Rate limit is set high so it doesn't interfere.
test('concurrent requests with the same key create only one row', async () => {
  const dbPath = path.join(os.tmpdir(), `signals-conc-${Date.now()}.test.db`);
  const proc = spawn('node', ['src/server.js'], {
    env: { ...process.env, API_KEY: 'k', PORT: '9093', RATE_LIMIT_PER_MIN: '1000', DATABASE_URL: dbPath },
  });

  try {
    const base = 'http://localhost:9093';
    await waitForHealth(base);

    const headers = { 'x-api-key': 'k', 'Idempotency-Key': 'race-key' };
    const body = { userId: 'u1', type: 'note', payload: 'x' };

    const results = await Promise.all(
      Array.from({ length: 20 }, () =>
        request(`${base}/v1/signals`, { method: 'POST', headers, body })
      )
    );

    const ids = new Set(results.map((r) => r.body.id));
    assert.equal(ids.size, 1, `expected one id, got ${[...ids].join(',')}`);

    const list = await request(`${base}/v1/signals?userId=u1`, { headers: { 'x-api-key': 'k' } });
    assert.equal(list.body.items.length, 1);
  } finally {
    proc.kill();
  }
});
