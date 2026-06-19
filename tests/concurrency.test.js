import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import { postJson, getJson, waitForHealth } from './http.js';

// use a separate db per test so rows don't carry over between runs
function freshDb(file) {
  for (const f of [file, `${file}-wal`, `${file}-shm`]) {
    try { fs.unlinkSync(f); } catch {}
  }
  return file;
}

function startServer(port, db) {
  return spawn('node', ['src/server.js'], {
    env: { ...process.env, API_KEY: 'k', PORT: String(port), DATABASE_URL: db, RATE_LIMIT_PER_MIN: '1000', DB_FAIL_RATE: '0' }
  });
}

const post = (port, idem) =>
  postJson(`http://localhost:${port}/v1/signals`, {
    headers: { 'x-api-key': 'k', 'Idempotency-Key': idem },
    body: { userId: 'u1', type: 'note', payload: 'x' }
  });

// many requests at once, same key -> only one signal should be created
test('idempotency under concurrent requests', async () => {
  const db = freshDb('./data/test-concurrency.db');
  const proc = startServer(9301, db);
  await waitForHealth('http://localhost:9301');

  const results = await Promise.all(Array.from({ length: 12 }, () => post(9301, 'race-key')));

  const ids = new Set(results.map((r) => r.body.id));
  assert.equal(ids.size, 1, `expected one id, got ${[...ids]}`);

  const list = await getJson('http://localhost:9301/v1/signals?userId=u1', { headers: { 'x-api-key': 'k' } });
  assert.equal(list.body.items.length, 1);

  proc.kill();
});

// two instances sharing one db (like two servers behind a load balancer). An
// in-memory check can't catch this - only the db UNIQUE index can.
test('idempotency across two instances', async () => {
  const db = freshDb('./data/test-multi.db');
  const a = startServer(9302, db);
  const b = startServer(9303, db);
  await waitForHealth('http://localhost:9302');
  await waitForHealth('http://localhost:9303');

  const results = await Promise.all(
    Array.from({ length: 12 }, (_, i) => post(i % 2 ? 9303 : 9302, 'multi-key'))
  );

  const ids = new Set(results.map((r) => r.body.id));
  assert.equal(ids.size, 1, `expected one id across instances, got ${[...ids]}`);

  const list = await getJson('http://localhost:9302/v1/signals?userId=u1', { headers: { 'x-api-key': 'k' } });
  assert.equal(list.body.items.length, 1);

  a.kill();
  b.kill();
});
