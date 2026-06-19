import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { request, waitForHealth } from './helpers.js';

test('same idempotency key returns the same resource', async () => {
  const dbPath = path.join(os.tmpdir(), `signals-idem-${Date.now()}.test.db`);
  const proc = spawn('node', ['src/server.js'], {
    env: { ...process.env, API_KEY: 'k', PORT: '9091', DATABASE_URL: dbPath },
  });

  try {
    const base = 'http://localhost:9091';
    await waitForHealth(base);

    const headers = { 'x-api-key': 'k', 'Idempotency-Key': 'same-key' };
    const body = { userId: 'u1', type: 'note', payload: 'x' };

    const a = await request(`${base}/v1/signals`, { method: 'POST', headers, body });
    const b = await request(`${base}/v1/signals`, { method: 'POST', headers, body });

    assert.equal(a.status, 200);
    assert.equal(a.body.id, b.body.id);
    assert.equal(a.body.idempotencyKey, b.body.idempotencyKey);
  } finally {
    proc.kill();
  }
});
