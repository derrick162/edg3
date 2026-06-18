/**
 * Route tests for multi-account Google linking — accounts status + gmail disconnect.
 * (The connect/callback routes drive a live Google OAuth round-trip and are exercised
 * at the lib layer via emailFromIdToken / token routing tests.)
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { id: number } | null,
  cal: undefined as unknown,
  gmail: undefined as unknown,
  disconnected: [] as number[],
  audit: [] as string[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/db', () => ({
  calendarQueries: { get: (_id: number) => h.cal },
  gmailTokenQueries: { get: (_id: number) => h.gmail },
  auditLogQueries: { record: (e: { action: string }) => h.audit.push(e.action) },
}));
vi.mock('@/lib/google-auth', () => ({
  hasGmailScope: (scope?: string | null) => !!scope && scope.includes('gmail.compose'),
  disconnectGmailAccount: (id: number) => h.disconnected.push(id),
}));
vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: true, resetAt: Date.now() + 1000 }),
  rateLimitResponse: () => new Response('rate', { status: 429 }),
}));

const { GET: accountsGET } = await import('../../accounts/route');
const { POST: disconnectPOST } = await import('./disconnect/route');

beforeEach(() => {
  h.session = null;
  h.cal = undefined;
  h.gmail = undefined;
  h.disconnected = [];
  h.audit = [];
});

describe('GET /api/auth/accounts', () => {
  it('401 when unauthenticated', async () => {
    const res = await accountsGET();
    expect(res.status).toBe(401);
  });

  it('reports neither account connected for a fresh user', async () => {
    h.session = { id: 1 };
    const data = await (await accountsGET()).json();
    expect(data.calendar.connected).toBe(false);
    expect(data.gmail.connected).toBe(false);
  });

  it('reports calendar connected + hasGmailScope, gmail account with email', async () => {
    h.session = { id: 1 };
    h.cal = { scope: 'calendar gmail.compose' };
    h.gmail = { email: 'me@gmail.com' };
    const data = await (await accountsGET()).json();
    expect(data.calendar).toEqual({ connected: true, email: null, hasGmailScope: true });
    expect(data.gmail).toEqual({ connected: true, email: 'me@gmail.com' });
  });
});

describe('POST /api/auth/google/gmail/disconnect', () => {
  it('401 when unauthenticated', async () => {
    const res = await disconnectPOST();
    expect(res.status).toBe(401);
  });

  it('disconnects the gmail account and audit-logs it', async () => {
    h.session = { id: 7 };
    const res = await disconnectPOST();
    expect(res.status).toBe(200);
    expect(h.disconnected).toEqual([7]);
    expect(h.audit).toContain('gmailAccountDisconnect');
  });
});
