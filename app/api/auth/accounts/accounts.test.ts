/**
 * R13 T2 — GET /api/auth/accounts reports calendar.hasGmailScope from the gmail.readonly grant.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { id: number } | null,
  cal: undefined as { scope: string | null; email?: string | null } | undefined,
  gmail: undefined as { email: string | null } | undefined,
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/db', () => ({
  calendarQueries: { get: (_id: number) => h.cal },
  gmailTokenQueries: { get: (_id: number) => h.gmail },
}));
// Faithful re-impl of hasGmailReadScope (scope substring match) — the real one is unit-tested
// in lib/google-auth.test.ts; app-dir route tests mock all @/lib imports.
vi.mock('@/lib/google-auth', () => ({
  hasGmailReadScope: (scope?: string | null) => (scope || '').split(/\s+/).includes('https://www.googleapis.com/auth/gmail.readonly'),
}));

const { GET } = await import('./route');
const READONLY = 'https://www.googleapis.com/auth/gmail.readonly';

beforeEach(() => {
  h.session = { id: 1 };
  h.cal = undefined;
  h.gmail = undefined;
});

describe('GET /api/auth/accounts — calendar.hasGmailScope', () => {
  it('401 when unauthenticated', async () => {
    h.session = null;
    expect((await GET()).status).toBe(401);
  });

  it('hasGmailScope=true when the calendar grant carries gmail.readonly', async () => {
    h.cal = { scope: `https://www.googleapis.com/auth/calendar.events ${READONLY}` };
    const data = await (await GET()).json();
    expect(data.calendar.connected).toBe(true);
    expect(data.calendar.hasGmailScope).toBe(true);
  });

  it('hasGmailScope=false for a calendar-only grant', async () => {
    h.cal = { scope: 'https://www.googleapis.com/auth/calendar.events' };
    const data = await (await GET()).json();
    expect(data.calendar.connected).toBe(true);
    expect(data.calendar.hasGmailScope).toBe(false);
  });

  it('hasGmailScope=false when no calendar account is connected', async () => {
    h.cal = undefined;
    const data = await (await GET()).json();
    expect(data.calendar.connected).toBe(false);
    expect(data.calendar.hasGmailScope).toBe(false);
  });

  // R18 T3 — surface the connected Google account email (null on rows linked before it shipped).
  it('returns calendar.email when stored, null otherwise', async () => {
    h.cal = { scope: READONLY, email: 'derrick@example.com' };
    expect((await (await GET()).json()).calendar.email).toBe('derrick@example.com');
    h.cal = { scope: READONLY };
    expect((await (await GET()).json()).calendar.email).toBeNull();
  });
});
