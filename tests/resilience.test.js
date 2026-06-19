import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import fs from 'node:fs';
import { postJson, waitForHealth } from './http.js';

function freshDb(file) {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try { fs.unlinkSync(f); } catch {}
  }
  return file;
}

function startServer(port, db, extra = {}) {
  return spawn('node', ['src/server.js'], {
    env: { ...process.env, API_KEY: 'k', PORT: String(port), DATABASE_URL: db, RATE_LIMIT_PER_MIN: '1000', ...extra }
  });
}

const post = (port, idem, userId) =>
  postJson(`http://localhost:${port}/v1/signals`, {
    headers: { 'x-api-key': 'k', 'Idempotency-Key': idem },
    body: { userId, type: 'note', payload: 'x' }
  });

// db fails ~1 in 5 calls; retry/backoff should still push the request through,
// and the same key must not end up creating two rows.
test('retries through transient db failures, no duplicates', async () => {
  const db = freshDb('./data/test-dbfail.db');
  const proc = startServer(9304, db, { DB_FAIL_RATE: '0.2' });
  await waitForHealth('http://localhost:9304');

  const a = await post(9304, 'retry-key', 'u2');
  assert.equal(a.status, 200);
  assert.ok(a.body.id);

  const b = await post(9304, 'retry-key', 'u2');
  assert.equal(b.body.id, a.body.id);

  proc.kill();
});

// idempotency lives in the db, so it has to survive a restart of the process
test('same key returns the same row after a restart', async () => {
  const db = freshDb('./data/test-restart.db');
  let proc = startServer(9305, db);
  await waitForHealth('http://localhost:9305');

  const a = await post(9305, 'persist-key', 'u3');
  assert.ok(a.body.id);
  proc.kill();
  await wait(300);

  proc = startServer(9305, db);
  await waitForHealth('http://localhost:9305');
  const b = await post(9305, 'persist-key', 'u3');
  assert.equal(b.body.id, a.body.id);

  proc.kill();
});
