import Database from 'better-sqlite3';
import fs from 'fs';
import path from 'path';

const dbPath = process.env.DATABASE_URL || './data/signals.db';
fs.mkdirSync(path.dirname(dbPath), { recursive: true });
const db = new Database(dbPath);

// Better behaviour under concurrent access: WAL lets reads and a write run at
// the same time, and busy_timeout waits for a brief lock instead of erroring.
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');
db.pragma('busy_timeout = 5000');

// schema
db.exec(`
CREATE TABLE IF NOT EXISTS signals (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  idempotency_key TEXT UNIQUE,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_user_created ON signals(user_id, created_at);
`);

// failure simulation
function maybeFail() {
  const rate = Number(process.env.DB_FAIL_RATE || 0);
  if (rate > 0 && Math.random() < rate) {
    const err = new Error('simulated_db_failure');
    err.code = 'SQLITE_BUSY';
    throw err;
  }
}

export function insertSignal(userId, type, payload, idemKey, nowMs) {
  maybeFail();
  const stmt = db.prepare(
    'INSERT INTO signals (user_id, type, payload, idempotency_key, created_at) VALUES (?,?,?,?,?)'
  );
  return stmt.run(userId, type, String(payload), idemKey || null, nowMs);
}

export function getByIdemKey(idemKey) {
  maybeFail();
  const stmt = db.prepare(
    'SELECT id, user_id as userId, type, payload, idempotency_key as idempotencyKey, created_at as createdAt FROM signals WHERE idempotency_key = ?'
  );
  return stmt.get(idemKey);
}

export function listSignals(userId, limit) {
  maybeFail();
  const stmt = db.prepare(
    'SELECT id, user_id as userId, type, payload, idempotency_key as idempotencyKey, created_at as createdAt FROM signals WHERE user_id = ? ORDER BY created_at DESC LIMIT ?'
  );
  return stmt.all(userId, limit);
}

// True for a UNIQUE constraint clash - two requests raced the same key and one
// lost. We treat that as "already created", not a failure. Different from the
// transient SQLITE_BUSY errors, which are worth retrying.
export function isUniqueViolation(err) {
  if (!err) return false;
  if (err.code === 'SQLITE_CONSTRAINT_UNIQUE') return true;
  return err.code === 'SQLITE_CONSTRAINT' && /UNIQUE/i.test(err.message || '');
}
