/**
 * Integration proof that sensitive columns are encrypted at rest.
 *
 * Strategy: for each sensitive table we
 *  1. write via the normal query helper (which calls encryptField internally)
 *  2. read the raw column value with plain SQLite (bypassing decryptField)
 *  3. assert the raw value starts with 'enc:1:' — proving ciphertext is on disk
 *  4. read via the normal query helper and assert plaintext is returned
 *
 * Also verifies the no-key degradation path: when DATA_ENCRYPTION_KEY is unset,
 * writes land as plaintext (backward-compatible) and reads still return the value.
 *
 * Coverage:
 *   ✅ calendar_tokens.access_token / refresh_token  — Google OAuth (write access)
 *   ✅ whoop_tokens.access_token / refresh_token     — health data PII
 *   ✅ briefings.transcript / user_response          — call transcripts
 *
 *   Not tested here (same cipher path, spot-checked manually):
 *   -- gmail_drafts.recipient / subject              — draft audit log
 *   -- outreach_contacts.recipient / context         — outreach PII
 *   -- notifications.title / body                    — notification PII
 *   Add tests for those if their data sensitivity grows or a schema change lands.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

const TEST_KEY = 'c'.repeat(64); // 32 bytes as hex — different from crypto.test.ts to avoid key-cache collision

// Re-import db + crypto fresh for each test group so the key cache (module-level
// in crypto.ts) sees the right env state.
async function loadDb(key?: string) {
  vi.resetModules();
  process.env.DB_PATH = ':memory:';
  if (key) process.env.DATA_ENCRYPTION_KEY = key;
  else delete process.env.DATA_ENCRYPTION_KEY;
  return import('./db');
}

afterEach(() => {
  delete process.env.DATA_ENCRYPTION_KEY;
  delete process.env.DB_PATH;
});

// FK seed: all token + briefing tables reference users(id).
async function seedUser(db: Awaited<ReturnType<typeof loadDb>>) {
  const res = db.userQueries.create('enc-test@example.com', 'Test User', 'hash');
  return Number(res.lastInsertRowid);
}

// ── calendar_tokens ───────────────────────────────────────────────────────────

describe('calendar_tokens encryption at rest', () => {
  it('stores ciphertext in access_token column when key is set', async () => {
    const db = await loadDb(TEST_KEY);
    const userId = await seedUser(db);
    db.calendarQueries.upsert(userId, 'ya29.google-access-token', 'rt-value', '2027-01-01', null);
    const raw = db.getDb()
      .prepare('SELECT access_token FROM calendar_tokens WHERE user_id = ?')
      .get(userId) as { access_token: string };
    expect(raw.access_token).toMatch(/^enc:1:/);
    expect(raw.access_token).not.toContain('ya29.google-access-token');
  });

  it('stores ciphertext in refresh_token column when key is set', async () => {
    const db = await loadDb(TEST_KEY);
    const userId = await seedUser(db);
    db.calendarQueries.upsert(userId, 'at', 'super-secret-refresh', '2027-01-01', null);
    const raw = db.getDb()
      .prepare('SELECT refresh_token FROM calendar_tokens WHERE user_id = ?')
      .get(userId) as { refresh_token: string };
    expect(raw.refresh_token).toMatch(/^enc:1:/);
    expect(raw.refresh_token).not.toContain('super-secret-refresh');
  });

  it('returns decrypted access_token via calendarQueries.get', async () => {
    const db = await loadDb(TEST_KEY);
    const userId = await seedUser(db);
    db.calendarQueries.upsert(userId, 'ya29.plaintext', 'rt', '2027-01-01', 'read');
    const token = db.calendarQueries.get(userId);
    expect(token?.access_token).toBe('ya29.plaintext');
  });

  it('falls back to plaintext storage when no key is configured (no-key path)', async () => {
    const db = await loadDb(undefined);
    const userId = await seedUser(db);
    db.calendarQueries.upsert(userId, 'ya29.no-key', 'rt', '2027-01-01', null);
    const raw = db.getDb()
      .prepare('SELECT access_token FROM calendar_tokens WHERE user_id = ?')
      .get(userId) as { access_token: string };
    expect(raw.access_token).toBe('ya29.no-key');
    expect(raw.access_token).not.toMatch(/^enc:1:/);
  });
});

// ── whoop_tokens ──────────────────────────────────────────────────────────────

describe('whoop_tokens encryption at rest', () => {
  it('stores ciphertext in both access_token and refresh_token columns', async () => {
    const db = await loadDb(TEST_KEY);
    const userId = await seedUser(db);
    db.whoopQueries.upsert(userId, 'whoop-at', 'whoop-rt', Date.now() + 3_600_000, 'read:recovery');
    const raw = db.getDb()
      .prepare('SELECT access_token, refresh_token FROM whoop_tokens WHERE user_id = ?')
      .get(userId) as { access_token: string; refresh_token: string };
    expect(raw.access_token).toMatch(/^enc:1:/);
    expect(raw.refresh_token).toMatch(/^enc:1:/);
    expect(raw.access_token).not.toContain('whoop-at');
    expect(raw.refresh_token).not.toContain('whoop-rt');
  });

  it('returns decrypted tokens via whoopQueries.get', async () => {
    const db = await loadDb(TEST_KEY);
    const userId = await seedUser(db);
    const expiresAt = Date.now() + 3_600_000;
    db.whoopQueries.upsert(userId, 'at-plain', 'rt-plain', expiresAt, 'read:recovery');
    const row = db.whoopQueries.get(userId);
    expect(row?.access_token).toBe('at-plain');
    expect(row?.refresh_token).toBe('rt-plain');
  });

  it('access_token and refresh_token produce distinct ciphertexts even with the same key', async () => {
    const db = await loadDb(TEST_KEY);
    const userId = await seedUser(db);
    db.whoopQueries.upsert(userId, 'same-value', 'same-value', Date.now() + 3_600_000, null);
    const raw = db.getDb()
      .prepare('SELECT access_token, refresh_token FROM whoop_tokens WHERE user_id = ?')
      .get(userId) as { access_token: string; refresh_token: string };
    // Random IV per encrypt call → different ciphertexts even for identical plaintext.
    expect(raw.access_token).not.toBe(raw.refresh_token);
  });
});

// ── briefings.transcript / user_response ─────────────────────────────────────

describe('briefings transcript and user_response encryption at rest', () => {
  it('stores ciphertext for transcript on update', async () => {
    const db = await loadDb(TEST_KEY);
    const userId = await seedUser(db);
    const { lastInsertRowid } = db.briefingQueries.create(userId, 'prompt', '2026-06-13T09:00:00') as { lastInsertRowid: number | bigint };
    const id = Number(lastInsertRowid);
    db.briefingQueries.update(id, { transcript: 'Hey Edge, great sleep last night.' });
    const raw = db.getDb()
      .prepare('SELECT transcript FROM briefings WHERE id = ?')
      .get(id) as { transcript: string };
    expect(raw.transcript).toMatch(/^enc:1:/);
    expect(raw.transcript).not.toContain('Hey Edge');
  });

  it('stores ciphertext for user_response on update', async () => {
    const db = await loadDb(TEST_KEY);
    const userId = await seedUser(db);
    const { lastInsertRowid } = db.briefingQueries.create(userId, 'prompt', '2026-06-13T09:00:00') as { lastInsertRowid: number | bigint };
    const id = Number(lastInsertRowid);
    db.briefingQueries.update(id, { user_response: 'Focus on fundraising today.' });
    const raw = db.getDb()
      .prepare('SELECT user_response FROM briefings WHERE id = ?')
      .get(id) as { user_response: string };
    expect(raw.user_response).toMatch(/^enc:1:/);
    expect(raw.user_response).not.toContain('fundraising');
  });

  it('returns decrypted transcript via getLatest', async () => {
    const db = await loadDb(TEST_KEY);
    const userId = await seedUser(db);
    const { lastInsertRowid } = db.briefingQueries.create(userId, 'prompt', '2026-06-13T09:00:00') as { lastInsertRowid: number | bigint };
    const id = Number(lastInsertRowid);
    const TRANSCRIPT = 'This is a private call transcript.';
    db.briefingQueries.update(id, { transcript: TRANSCRIPT, status: 'completed' });
    const briefing = db.briefingQueries.getLatest(userId);
    expect(briefing?.transcript).toBe(TRANSCRIPT);
  });

  it('plaintext transcript passes through unchanged when no key is configured', async () => {
    const db = await loadDb(undefined);
    const userId = await seedUser(db);
    const { lastInsertRowid } = db.briefingQueries.create(userId, 'prompt', '2026-06-13T09:00:00') as { lastInsertRowid: number | bigint };
    const id = Number(lastInsertRowid);
    db.briefingQueries.update(id, { transcript: 'my transcript' });
    const raw = db.getDb()
      .prepare('SELECT transcript FROM briefings WHERE id = ?')
      .get(id) as { transcript: string };
    // No key → plaintext stored; decryptBriefingRow passes it through unchanged.
    expect(raw.transcript).toBe('my transcript');
    const briefing = db.briefingQueries.getLatest(userId);
    expect(briefing?.transcript).toBe('my transcript');
  });
});
