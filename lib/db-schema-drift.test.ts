/**
 * Regression tests for the production schema-drift incident (2026-07-02): three write paths
 * broken in prod because the tables predate CHECK/column changes and SQLite can't ALTER a CHECK.
 * The migration runner swallowed every failure, so it was invisible.
 *
 *   S9b — briefings.status CHECK lacked 'missed'  → declined/short-call streak gate threw.
 *   S9a — facts.last_confirmed_at column missing  → memory-freshness upsert threw.
 *   S9c — facts.category CHECK lacked new categories → pattern/commitment inserts threw.
 *
 * Strategy: seed a DB with the *legacy prod* schema (old CHECKs, missing columns), run the real
 * initSchema/applyMigrations, and assert it converges to the current schema WITHOUT losing rows,
 * FKs, or indexes. CHECK drift is version-independent, so this reproduces the prod failure locally
 * even though this machine's SQLite happens to accept the non-constant-default ALTER.
 *
 * Uses real better-sqlite3 — no mocks.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations, initSchema } from './db';

function cols(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);
}
function indexNames(db: Database.Database): Set<string> {
  return new Set((db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all() as Array<{ name: string }>).map(r => r.name));
}
function tableSql(db: Database.Database, table: string): string {
  return (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table) as { sql: string }).sql;
}

// A DB shaped like legacy prod: users + briefings (old 4-status CHECK) + facts (old 5-category
// CHECK, no last_confirmed_at). Seeds one real row in each, with a facts→briefings FK reference.
function seedLegacyProd(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT UNIQUE NOT NULL, name TEXT NOT NULL, password_hash TEXT NOT NULL)`);
  db.exec(`CREATE TABLE briefings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    content TEXT NOT NULL,
    vapi_call_id TEXT,
    status TEXT DEFAULT 'pending' CHECK(status IN ('pending','calling','completed','failed')),
    scheduled_for TEXT NOT NULL,
    transcript TEXT,
    user_response TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`);
  db.exec(`CREATE TABLE facts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL REFERENCES users(id),
    category TEXT NOT NULL CHECK(category IN ('person','project','goal','preference','fact')),
    statement TEXT NOT NULL,
    entity TEXT,
    learned_at TEXT NOT NULL DEFAULT (datetime('now')),
    confidence TEXT NOT NULL DEFAULT 'high',
    source_briefing_id INTEGER REFERENCES briefings(id),
    valid_from TEXT,
    valid_until TEXT,
    confidence_score REAL NOT NULL DEFAULT 1.0
  )`);
  db.prepare(`INSERT INTO users (id, email, name, password_hash) VALUES (1, 'd@e.com', 'Derrick', 'x')`).run();
  db.prepare(`INSERT INTO briefings (id, user_id, content, scheduled_for, status) VALUES (7, 1, 'morning call', '2026-07-01', 'completed')`).run();
  db.prepare(`INSERT INTO facts (id, user_id, category, statement, source_briefing_id, learned_at) VALUES (3, 1, 'fact', 'Derrick has a dog named Jamie', 7, '2026-06-01')`).run();
  return db;
}

describe('schema-drift rebuild — the legacy state fails BEFORE migration (proves the test is real)', () => {
  it('cannot insert status=missed or category=pattern on the legacy schema', () => {
    const db = seedLegacyProd();
    expect(() => db.prepare(`INSERT INTO briefings (user_id, content, scheduled_for, status) VALUES (1, 'x', '2026-07-02', 'missed')`).run())
      .toThrow(/CHECK constraint failed/);
    expect(() => db.prepare(`INSERT INTO facts (user_id, category, statement) VALUES (1, 'pattern', 'x')`).run())
      .toThrow(/CHECK constraint failed/);
    expect(cols(db, 'facts')).not.toContain('last_confirmed_at');
  });
});

describe('applyMigrations — converges legacy prod to the current schema', () => {
  it('S9b: briefings accepts status=missed after migration', () => {
    const db = seedLegacyProd();
    applyMigrations(db);
    expect(tableSql(db, 'briefings')).toContain("'missed'");
    expect(() => db.prepare(`INSERT INTO briefings (user_id, content, scheduled_for, status) VALUES (1, 'x', '2026-07-02', 'missed')`).run()).not.toThrow();
  });

  it('S9c: facts accepts the new categories after migration', () => {
    const db = seedLegacyProd();
    applyMigrations(db);
    for (const cat of ['pattern', 'commitment', 'weekly_summary', 'lifetime_profile', 'user_note']) {
      expect(() => db.prepare(`INSERT INTO facts (user_id, category, statement) VALUES (1, ?, 'x')`).run(cat), cat).not.toThrow();
    }
  });

  it('S9a: last_confirmed_at exists AND carries its DEFAULT (insert without it is non-null)', () => {
    const db = seedLegacyProd();
    applyMigrations(db);
    expect(cols(db, 'facts')).toContain('last_confirmed_at');
    const info = db.prepare(`INSERT INTO facts (user_id, category, statement) VALUES (1, 'goal', 'ship it')`).run();
    const row = db.prepare('SELECT last_confirmed_at FROM facts WHERE id = ?').get(info.lastInsertRowid) as { last_confirmed_at: string | null };
    expect(row.last_confirmed_at).toBeTruthy(); // DEFAULT (datetime('now')) fired — not NULL
  });

  it('preserves existing rows through the rebuild', () => {
    const db = seedLegacyProd();
    applyMigrations(db);
    const b = db.prepare('SELECT content, status FROM briefings WHERE id = 7').get() as { content: string; status: string };
    expect(b).toEqual({ content: 'morning call', status: 'completed' });
    const f = db.prepare('SELECT statement, category, source_briefing_id FROM facts WHERE id = 3').get() as { statement: string; category: string; source_briefing_id: number };
    expect(f).toEqual({ statement: 'Derrick has a dog named Jamie', category: 'fact', source_briefing_id: 7 });
  });

  it('backfills last_confirmed_at from learned_at for pre-existing rows (freshness semantics)', () => {
    const db = seedLegacyProd();
    applyMigrations(db);
    const f = db.prepare('SELECT last_confirmed_at FROM facts WHERE id = 3').get() as { last_confirmed_at: string };
    expect(f.last_confirmed_at).toBe('2026-06-01'); // == learned_at, not "now"
  });

  it('keeps the facts→briefings FK intact after both tables are rebuilt', () => {
    const db = seedLegacyProd();
    applyMigrations(db);
    db.pragma('foreign_keys = ON');
    const violations = db.pragma('foreign_key_check') as unknown[];
    expect(violations).toEqual([]);
    // The seeded fact still resolves to its briefing.
    const joined = db.prepare('SELECT b.content FROM facts f JOIN briefings b ON b.id = f.source_briefing_id WHERE f.id = 3').get() as { content: string };
    expect(joined.content).toBe('morning call');
  });

  it('recreates the indexes dropped with the old tables', () => {
    const db = seedLegacyProd();
    applyMigrations(db);
    const idx = indexNames(db);
    expect(idx).toContain('idx_briefings_user_id');
    expect(idx).toContain('idx_briefings_vapi_call_id');
    expect(idx).toContain('idx_facts_user');
    expect(idx).toContain('idx_facts_active'); // deferred index, on the rebuilt facts table
  });

  it('is idempotent — a second run does not throw, churn rows, or re-rebuild', () => {
    const db = seedLegacyProd();
    applyMigrations(db);
    // After convergence the guards must short-circuit (CHECK already current) — no rebuild.
    expect(() => applyMigrations(db)).not.toThrow();
    expect((db.prepare('SELECT COUNT(*) c FROM briefings').get() as { c: number }).c).toBe(1);
    expect((db.prepare('SELECT COUNT(*) c FROM facts').get() as { c: number }).c).toBe(1);
  });
});

describe('initSchema — full end-to-end init against legacy prod', () => {
  it('upgrades briefings + facts and leaves both writable with the new CHECKs', () => {
    const db = seedLegacyProd();
    expect(() => initSchema(db)).not.toThrow();
    expect(() => db.prepare(`INSERT INTO briefings (user_id, content, scheduled_for, status) VALUES (1, 'x', '2026-07-02', 'missed')`).run()).not.toThrow();
    expect(() => db.prepare(`INSERT INTO facts (user_id, category, statement) VALUES (1, 'commitment', 'call the bank')`).run()).not.toThrow();
    expect(cols(db, 'facts')).toContain('last_confirmed_at');
  });

  it('a fresh DB (current CREATE schema) is NOT rebuilt — no churn on the common path', () => {
    const db = new Database(':memory:');
    initSchema(db); // builds the current schema directly
    // A second init must be a pure no-op for the drift guards (fresh CREATE already has 'missed'
    // and 'user_note'); if a guard misfired it would throw or drop rows.
    db.prepare(`INSERT INTO users (email, name, password_hash) VALUES ('a@b.com','A','x')`).run();
    expect(() => initSchema(db)).not.toThrow();
    expect((db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c).toBe(1);
    expect(tableSql(db, 'briefings')).toContain("'missed'");
    expect(tableSql(db, 'facts')).toContain("'user_note'");
  });
});
