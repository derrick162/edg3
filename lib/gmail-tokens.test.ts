/**
 * Multi-account Google linking — gmailTokenQueries tests (real in-memory better-sqlite3).
 * Verifies the upsert/get/delete contract + one-row-per-user (UNIQUE) + round-trip through
 * the encrypt-on-write / decrypt-on-read path.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

const { getDb, gmailTokenQueries } = await import('./db');

afterAll(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = ORIGINAL_DB_PATH;
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM gmail_tokens').run();
  db.prepare('DELETE FROM users').run();
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'u@test.com', 'U', 'h', 1)").run();
});

describe('gmailTokenQueries', () => {
  it('returns undefined when no gmail account is linked', () => {
    expect(gmailTokenQueries.get(1)).toBeUndefined();
  });

  it('upserts and reads back tokens (round-trip through encrypt/decrypt)', () => {
    gmailTokenQueries.upsert(1, 'access-123', 'refresh-456', '1700000000000', 'https://www.googleapis.com/auth/gmail.compose', 'gmail@personal.com');
    const row = gmailTokenQueries.get(1);
    expect(row).toBeDefined();
    expect(row!.access_token).toBe('access-123');
    expect(row!.refresh_token).toBe('refresh-456');
    expect(row!.email).toBe('gmail@personal.com');
    expect(row!.scope).toContain('gmail.compose');
  });

  it('keeps one row per user — upsert replaces, not duplicates', () => {
    gmailTokenQueries.upsert(1, 'a1', 'r1', '1', 'scope1', 'a@x.com');
    gmailTokenQueries.upsert(1, 'a2', 'r2', '2', 'scope2', 'b@x.com');
    const count = (getDb().prepare('SELECT COUNT(*) AS n FROM gmail_tokens WHERE user_id = 1').get() as { n: number }).n;
    expect(count).toBe(1);
    expect(gmailTokenQueries.get(1)!.access_token).toBe('a2');
    expect(gmailTokenQueries.get(1)!.email).toBe('b@x.com');
  });

  it('COALESCE preserves prior scope/email when a refresh omits them', () => {
    gmailTokenQueries.upsert(1, 'a1', 'r1', '1', 'gmail.compose', 'keep@x.com');
    // Token refresh: new access token, no scope/email passed.
    gmailTokenQueries.upsert(1, 'a2', 'r2', '2');
    const row = gmailTokenQueries.get(1)!;
    expect(row.access_token).toBe('a2');
    expect(row.scope).toBe('gmail.compose'); // preserved
    expect(row.email).toBe('keep@x.com');    // preserved
  });

  it('delete removes the gmail account row', () => {
    gmailTokenQueries.upsert(1, 'a', 'r', '1', 's', 'e@x.com');
    gmailTokenQueries.delete(1);
    expect(gmailTokenQueries.get(1)).toBeUndefined();
  });

  it('handles a null refresh token', () => {
    gmailTokenQueries.upsert(1, 'a', null, null, 's', 'e@x.com');
    const row = gmailTokenQueries.get(1)!;
    expect(row.access_token).toBe('a');
    expect(row.refresh_token).toBeNull();
  });
});
