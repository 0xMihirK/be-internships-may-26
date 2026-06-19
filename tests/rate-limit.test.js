import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { request, waitForHealth } from './helpers.js';

test('rate limit: 5 allowed per minute, 6th is 429', async () => {
  const dbPath = path.join(os.tmpdir(), `signals-rate-${Date.now()}.test.db`);
  const proc = spawn('node', ['src/server.js'], {
    env: { ...process.env, API_KEY: 'k', PORT: '9092', RATE_LIMIT_PER_MIN: '5', DATABASE_URL: dbPath },
  });

  try {
    const base = 'http://localhost:9092';
    await waitForHealth(base);

    const statuses = [];
    for (let i = 0; i < 6; i++) {
      const res = await request(`${base}/v1/signals`, {
        method: 'POST',
        headers: { 'x-api-key': 'k' },
        body: { userId: 'u1', type: 'note', payload: String(i) },
      });
      statuses.push(res.status);
    }

    const counts = statuses.reduce((acc, c) => ((acc[c] = (acc[c] || 0) + 1), acc), {});
    assert.ok(counts[200] >= 5, `expected >=5 ok, got ${JSON.stringify(counts)}`);
    assert.ok(counts[429] >= 1, `expected >=1 blocked, got ${JSON.stringify(counts)}`);
  } finally {
    proc.kill();
  }
});
