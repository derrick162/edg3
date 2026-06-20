/**
 * Multi-account Google token routing tests (real in-memory better-sqlite3).
 * Verifies getCalendarTokens / getGmailTokens (incl. fallback) / hasLinkedGmailAccount /
 * persistRefreshedToken target the correct account.
 * (R12 T2: the dedicated-Gmail OAuth flow — saveGmailTokens / disconnectGmailAccount /
 * emailFromIdToken — was removed with the email-drafting feature; gmail_tokens rows are
 * seeded here via gmailTokenQueries.upsert directly.)
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

const ORIGINAL_DB_PATH = process.env.DB_PATH;
process.env.DB_PATH = ':memory:';

const { getDb, calendarQueries, gmailTokenQueries } = await import('./db');
const {
  getCalendarTokens, getGmailTokens, hasLinkedGmailAccount, persistRefreshedToken,
} = await import('./google-auth');

afterAll(() => {
  if (ORIGINAL_DB_PATH === undefined) delete process.env.DB_PATH;
  else process.env.DB_PATH = ORIGINAL_DB_PATH;
});

beforeEach(() => {
  const db = getDb();
  db.prepare('DELETE FROM gmail_tokens').run();
  db.prepare('DELETE FROM calendar_tokens').run();
  db.prepare('DELETE FROM users').run();
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'u@test.com', 'U', 'h', 1)").run();
});

describe('getCalendarTokens', () => {
  it('returns the calendar account with source=calendar', () => {
    calendarQueries.upsert(1, 'cal-access', 'cal-refresh', '100', 'calendar');
    const t = getCalendarTokens(1);
    expect(t).toBeDefined();
    expect(t!.access_token).toBe('cal-access');
    expect(t!.source).toBe('calendar');
  });

  it('returns undefined when no calendar account', () => {
    expect(getCalendarTokens(1)).toBeUndefined();
  });
});

describe('getGmailTokens', () => {
  it('returns the dedicated Gmail account when present (source=gmail)', () => {
    calendarQueries.upsert(1, 'cal-access', 'cal-refresh', '100', 'calendar');
    gmailTokenQueries.upsert(1, 'gmail-access', 'gmail-refresh', '200', 'gmail.readonly', 'me@gmail.com');
    const t = getGmailTokens(1);
    expect(t!.access_token).toBe('gmail-access');
    expect(t!.email).toBe('me@gmail.com');
    expect(t!.source).toBe('gmail');
  });

  it('falls back to the calendar account when no Gmail account row exists', () => {
    calendarQueries.upsert(1, 'cal-access', 'cal-refresh', '100', 'calendar');
    const t = getGmailTokens(1);
    expect(t!.access_token).toBe('cal-access');
    expect(t!.source).toBe('calendar');
  });

  it('returns undefined when neither account exists', () => {
    expect(getGmailTokens(1)).toBeUndefined();
  });
});

describe('hasLinkedGmailAccount', () => {
  it('is false with only a calendar account, true once a Gmail account row exists', () => {
    calendarQueries.upsert(1, 'a', 'r', '1', 's');
    expect(hasLinkedGmailAccount(1)).toBe(false);
    gmailTokenQueries.upsert(1, 'g', 'gr', '1', 'gmail.readonly', 'me@gmail.com');
    expect(hasLinkedGmailAccount(1)).toBe(true);
  });
});

describe('persistRefreshedToken', () => {
  it('writes a refresh back to the gmail account when source=gmail', () => {
    gmailTokenQueries.upsert(1, 'old', 'gr', '1', 'gmail.readonly', 'me@gmail.com');
    persistRefreshedToken(1, 'gmail', { access_token: 'new-gmail', refresh_token: 'gr', expiry: '2' });
    expect(gmailTokenQueries.get(1)!.access_token).toBe('new-gmail');
    expect(gmailTokenQueries.get(1)!.email).toBe('me@gmail.com'); // COALESCE preserved
  });

  it('writes a refresh back to the calendar account when source=calendar', () => {
    calendarQueries.upsert(1, 'old', 'cr', '1', 'calendar');
    persistRefreshedToken(1, 'calendar', { access_token: 'new-cal', refresh_token: 'cr', expiry: '2' });
    expect(calendarQueries.get(1)!.access_token).toBe('new-cal');
  });
});
