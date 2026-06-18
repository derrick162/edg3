/**
 * T0-1 §4 — Automated restore drill (real better-sqlite3, no mocks).
 *
 * "Backups you've never restored are not backups." Every other backup test mocks
 * better-sqlite3, so the actual create→snapshot→reopen→data-survives path is unproven.
 * This test runs it for real:
 *   1. Build a real DB (full schema) at a temp path, insert known rows.
 *   2. createBackup() — the SAME online-backup call the 3am cron uses.
 *   3. verifyBackup() — integrity_check ok + row counts.
 *   4. Reopen the snapshot read-only and confirm the ACTUAL data survived (not just counts).
 *
 * This is the closest a unit test can get to the manual Railway restore drill.
 */
import { describe, it, expect, afterAll } from 'vitest';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs';
import Database from 'better-sqlite3';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
const ORIGINAL_BACKUP_DIR = process.env.BACKUP_DIR;

const TMP = path.join(os.tmpdir(), 'edg3-restore-drill');
const DB_FILE = path.join(TMP, 'edg3.db');
const BACKUP_DIR = path.join(TMP, 'backups');

fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(TMP, { recursive: true });
process.env.DB_PATH = DB_FILE;
process.env.BACKUP_DIR = BACKUP_DIR;

const { getDb } = await import('./db');
const { createBackup, verifyBackup } = await import('./backup');

afterAll(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DB_PATH; else process.env.DB_PATH = ORIGINAL_DB_PATH;
  if (ORIGINAL_BACKUP_DIR === undefined) delete process.env.BACKUP_DIR; else process.env.BACKUP_DIR = ORIGINAL_BACKUP_DIR;
  try { getDb().close(); } catch { /* ignore */ }
  fs.rmSync(TMP, { recursive: true, force: true });
});

describe('T0-1 restore drill — backup is genuinely restorable', () => {
  it('snapshots a live DB and the data survives a read-only reopen', async () => {
    const db = getDb();
    // Known seed data across a couple of tables.
    db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'a@test.com', 'Alice', 'h', 1)").run();
    db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (2, 'b@test.com', 'Bob', 'h', 1)").run();
    db.prepare("INSERT INTO tasks (user_id, text, date, source) VALUES (1, 'ship it', '2026-06-18', 'manual')").run();

    // The real online-backup call (handles WAL) the cron uses.
    const info = await createBackup();
    expect(info.file).toMatch(/^edg3-.*\.db$/);
    expect(info.sizeBytes).toBeGreaterThan(0);

    // verifyBackup: integrity ok + the right user count.
    const verified = verifyBackup(info.file);
    expect(verified.valid).toBe(true);
    expect(verified.integrityOk).toBe(true);
    expect(verified.rowCounts.users).toBe(2);
    expect(verified.rowCounts.tasks).toBe(1);

    // The real proof: reopen the snapshot independently and read the ACTUAL rows back.
    const snap = new Database(path.join(BACKUP_DIR, info.file), { readonly: true });
    try {
      const emails = (snap.prepare('SELECT email FROM users ORDER BY id').all() as Array<{ email: string }>).map(r => r.email);
      expect(emails).toEqual(['a@test.com', 'b@test.com']);
      const task = snap.prepare('SELECT text FROM tasks WHERE user_id = 1').get() as { text: string };
      expect(task.text).toBe('ship it');
    } finally {
      snap.close();
    }
  });

  it('verifyBackup integrity_check passes on a freshly created snapshot', async () => {
    const info = await createBackup();
    const verified = verifyBackup(info.file);
    expect(verified.integrityOk).toBe(true);
  });
});
