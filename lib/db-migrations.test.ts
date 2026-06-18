/**
 * Regression tests for the migration runner (production incident 2026-06-18:
 * "no such column: valid_until" / "no such column: retry_after" on deploy).
 *
 * Root cause: a CREATE INDEX referencing facts.valid_until (a migration-added column) lived
 * in the pre-migration schema block, so on an existing DB whose facts table predated the
 * column, the index creation threw and aborted schema init BEFORE the migration loop ran —
 * leaving valid_until / retry_after / etc. unapplied. The index is now deferred to AFTER
 * the migrations (DEFERRED_INDEXES), and applyMigrations is exported so this is testable.
 *
 * Uses real better-sqlite3 (no mocks) against a DB seeded to look like the old production schema.
 */
import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { applyMigrations, initSchema, SCHEMA_MIGRATIONS, DEFERRED_INDEXES } from './db';

function cols(db: Database.Database, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>).map(c => c.name);
}

// A DB created before the new columns existed: facts + briefings with only their original columns.
function seedOldSchema(): Database.Database {
  const db = new Database(':memory:');
  db.exec(`CREATE TABLE facts (id INTEGER PRIMARY KEY, user_id INTEGER, category TEXT, statement TEXT)`);
  db.exec(`CREATE TABLE briefings (id INTEGER PRIMARY KEY, user_id INTEGER, content TEXT)`);
  return db;
}

describe('applyMigrations — existing-DB upgrade', () => {
  it('adds the columns from the prod error without aborting the run', () => {
    const db = seedOldSchema();
    expect(() => applyMigrations(db)).not.toThrow();

    const factCols = cols(db, 'facts');
    expect(factCols).toContain('valid_until');   // the exact column in the prod error
    expect(factCols).toContain('valid_from');
    expect(factCols).toContain('confidence_score');
    expect(factCols).toContain('last_confirmed_at');

    const briefingCols = cols(db, 'briefings');
    expect(briefingCols).toContain('retry_after'); // the other prod error
    expect(briefingCols).toContain('learning_status');
  });

  it('creates idx_facts_active AFTER valid_until is added (the deferred index)', () => {
    const db = seedOldSchema();
    applyMigrations(db);
    const idx = db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_facts_active'").get();
    expect(idx).toBeTruthy();
  });

  it('is idempotent — a second run (every deploy) does not throw', () => {
    const db = seedOldSchema();
    applyMigrations(db);
    expect(() => applyMigrations(db)).not.toThrow();
    // columns still present, not duplicated/dropped
    expect(cols(db, 'facts')).toContain('valid_until');
  });

  it('one failing migration never blocks the others (independence)', () => {
    // facts exists but briefings does NOT → all briefings ALTERs throw "no such table",
    // yet the facts columns must still be added.
    const db = new Database(':memory:');
    db.exec(`CREATE TABLE facts (id INTEGER PRIMARY KEY, user_id INTEGER, category TEXT)`);
    expect(() => applyMigrations(db)).not.toThrow();
    expect(cols(db, 'facts')).toContain('valid_until');
  });
});

describe('initSchema — full init against a pre-existing (old-schema) DB', () => {
  // This is the strongest "never again" guard: it runs the ENTIRE schema init (the big
  // CREATE TABLE/INDEX block + migrations + deferred indexes) against a DB whose facts/
  // briefings tables predate the migration columns — i.e. exactly the production state that
  // broke. It would fail if ANY pre-migration statement references a migration-added column,
  // not just idx_facts_active.
  it('upgrades an old DB end-to-end without throwing, and applies all migration columns', () => {
    const db = new Database(':memory:');
    // Minimal "old" facts/briefings (no valid_until / retry_after). CREATE TABLE IF NOT EXISTS
    // in initSchema will then be a no-op for these, forcing the migration path.
    db.exec(`CREATE TABLE facts (id INTEGER PRIMARY KEY, user_id INTEGER, category TEXT, statement TEXT)`);
    db.exec(`CREATE TABLE briefings (id INTEGER PRIMARY KEY, user_id INTEGER, content TEXT, vapi_call_id TEXT, status TEXT, scheduled_for TEXT)`);

    expect(() => initSchema(db)).not.toThrow();

    expect(cols(db, 'facts')).toContain('valid_until');
    expect(cols(db, 'briefings')).toContain('retry_after');
    // Deferred index created after the column exists.
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='index' AND name='idx_facts_active'").get()).toBeTruthy();
    // New tables from the CREATE block also exist (e.g. gmail_tokens shipped this session).
    expect(db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gmail_tokens'").get()).toBeTruthy();
  });

  it('is safe to run twice (every deploy re-runs initSchema)', () => {
    const db = new Database(':memory:');
    // Realistic "old" briefings carries its original CREATE-TABLE columns (incl. vapi_call_id,
    // which the pre-migration idx_briefings_vapi_call_id correctly indexes).
    db.exec(`CREATE TABLE facts (id INTEGER PRIMARY KEY, user_id INTEGER, category TEXT, statement TEXT)`);
    db.exec(`CREATE TABLE briefings (id INTEGER PRIMARY KEY, user_id INTEGER, content TEXT, vapi_call_id TEXT, status TEXT, scheduled_for TEXT)`);
    initSchema(db);
    expect(() => initSchema(db)).not.toThrow();
  });
});

describe('SCHEMA_MIGRATIONS hygiene', () => {
  it('has no duplicate ADD COLUMN for the same table.column (would mask intent / signal sloppiness)', () => {
    const seen = new Set<string>();
    const dupes: string[] = [];
    for (const m of SCHEMA_MIGRATIONS) {
      const match = /ALTER TABLE (\w+) ADD COLUMN (\w+)/.exec(m);
      if (!match) continue;
      const key = `${match[1]}.${match[2]}`;
      if (seen.has(key)) dupes.push(key);
      seen.add(key);
    }
    expect(dupes, `duplicate migration columns: ${dupes.join(', ')}`).toEqual([]);
  });

  it('no deferred index leaks back into a pre-migration position (all are in DEFERRED_INDEXES)', () => {
    // idx_facts_active must be the canonical home for any valid_until-referencing index.
    expect(DEFERRED_INDEXES.some(i => i.includes('idx_facts_active') && i.includes('valid_until'))).toBe(true);
  });
});
