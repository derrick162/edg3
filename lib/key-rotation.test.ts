/**
 * R11 T3 — DATA_ENCRYPTION_KEY rotation (reEncryptAllUserData) — real in-memory better-sqlite3.
 * Verifies: round-trip (encrypt with A → rotate A→B → decrypt with B), dry-run writes nothing,
 * resumable re-run tolerates already-rotated cells, and the ENCRYPTED_COLUMNS inventory matches
 * the live schema (a typo or missing column there would brick data on a real rotation).
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { encryptWithKey, decryptWithKey, reEncryptAllUserData } from './crypto';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

const { getDb, ENCRYPTED_COLUMNS } = await import('./db');

const KEY_A = 'a'.repeat(64); // 32 bytes of 0xAA (valid hex key)
const KEY_B = 'b'.repeat(64); // 32 bytes of 0xBB

afterAll(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = ORIGINAL_DB_PATH;
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM memories').run();
  db.prepare('DELETE FROM support_messages').run();
  db.prepare('DELETE FROM users').run();
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'u@test.com', 'U', 'h', 1)").run();
});

describe('reEncryptAllUserData', () => {
  it('round-trips: encrypt with A → rotate A→B → decrypts with B (not A)', async () => {
    const db = getDb();
    db.prepare("INSERT INTO memories (user_id, type, content) VALUES (1, 'insight', ?)")
      .run(encryptWithKey('loves deep work', KEY_A));
    db.prepare("INSERT INTO support_messages (user_id, type, message) VALUES (1, 'feedback', ?)")
      .run(encryptWithKey('great product', KEY_A));

    const summary = await reEncryptAllUserData(KEY_A, KEY_B);
    expect(summary.cellsReKeyed).toBe(2);
    expect(summary.byColumn['memories.content']).toBe(1);
    expect(summary.byColumn['support_messages.message']).toBe(1);

    const mem = db.prepare('SELECT content FROM memories WHERE user_id = 1').get() as { content: string };
    const sup = db.prepare('SELECT message FROM support_messages WHERE user_id = 1').get() as { message: string };
    // Readable with the NEW key…
    expect(decryptWithKey(mem.content, KEY_B)).toBe('loves deep work');
    expect(decryptWithKey(sup.message, KEY_B)).toBe('great product');
    // …and NOT with the old key (it was genuinely re-keyed).
    expect(() => decryptWithKey(mem.content, KEY_A)).toThrow();
  });

  it('dryRun writes nothing — data still decrypts with the OLD key', async () => {
    const db = getDb();
    const before = encryptWithKey('untouched', KEY_A);
    db.prepare("INSERT INTO memories (user_id, type, content) VALUES (1, 'insight', ?)").run(before);

    const summary = await reEncryptAllUserData(KEY_A, KEY_B, { dryRun: true });
    expect(summary.dryRun).toBe(true);
    expect(summary.cellsReKeyed).toBe(1); // would re-key 1…

    const row = db.prepare('SELECT content FROM memories WHERE user_id = 1').get() as { content: string };
    expect(row.content).toBe(before);                       // …but wrote nothing
    expect(decryptWithKey(row.content, KEY_A)).toBe('untouched');
  });

  it('is resumable: a cell already on the new key is counted as already-rotated, not corrupted', async () => {
    const db = getDb();
    // Simulate a partially-completed prior run: this cell is already KEY_B.
    db.prepare("INSERT INTO memories (user_id, type, content) VALUES (1, 'insight', ?)")
      .run(encryptWithKey('already moved', KEY_B));

    const summary = await reEncryptAllUserData(KEY_A, KEY_B);
    expect(summary.cellsReKeyed).toBe(0);
    expect(summary.cellsAlreadyRotated).toBe(1);
    const row = db.prepare('SELECT content FROM memories WHERE user_id = 1').get() as { content: string };
    expect(decryptWithKey(row.content, KEY_B)).toBe('already moved');
  });

  it('aborts (throws) if a cell decrypts with neither key — never silently drops data', async () => {
    const db = getDb();
    db.prepare("INSERT INTO memories (user_id, type, content) VALUES (1, 'insight', ?)")
      .run(encryptWithKey('garbled', 'c'.repeat(64))); // encrypted with a THIRD, unknown key
    await expect(reEncryptAllUserData(KEY_A, KEY_B)).rejects.toThrow(/neither/);
  });

  it('skips null / legacy-plaintext values', async () => {
    const db = getDb();
    db.prepare("INSERT INTO memories (user_id, type, content) VALUES (1, 'insight', 'legacy plaintext')").run();
    const summary = await reEncryptAllUserData(KEY_A, KEY_B);
    expect(summary.cellsReKeyed).toBe(0);
    expect(summary.cellsSkipped).toBeGreaterThanOrEqual(1);
    const row = db.prepare('SELECT content FROM memories WHERE user_id = 1').get() as { content: string };
    expect(row.content).toBe('legacy plaintext'); // untouched
  });

  it('requires both keys', async () => {
    await expect(reEncryptAllUserData('', KEY_B)).rejects.toThrow();
    await expect(reEncryptAllUserData(KEY_A, '')).rejects.toThrow();
  });
});

describe('ENCRYPTED_COLUMNS inventory ↔ schema (drift guard)', () => {
  it('every inventoried table + column exists in the live schema and is user-scoped', () => {
    const db = getDb();
    for (const spec of ENCRYPTED_COLUMNS) {
      const cols = db.prepare(`PRAGMA table_info(${spec.table})`).all() as Array<{ name: string }>;
      expect(cols.length, `table ${spec.table} should exist`).toBeGreaterThan(0);
      const names = new Set(cols.map(c => c.name));
      expect(names.has('user_id'), `${spec.table} must have user_id (rotation scopes per user)`).toBe(true);
      expect(names.has(spec.idColumn), `${spec.table}.${spec.idColumn} (idColumn) must exist`).toBe(true);
      for (const col of spec.columns) {
        expect(names.has(col), `${spec.table}.${col} (encrypted column) must exist`).toBe(true);
      }
    }
  });
});
