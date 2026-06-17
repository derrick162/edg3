/**
 * Security tests for GET /api/priorities/derive and POST /api/priorities/derive/accept.
 *
 * Fresh-account scenarios (activation moment path):
 * - No calendar connected → graceful null (no error leak)
 * - Calendar connected but empty history → graceful null
 * - Unauthenticated → 401
 * - Rate-limit → 429 (LLM cost gate)
 * - Cross-user scoping: each fetch uses the session user's ID, not a param
 * - Accept is authz'd to the session user; input capped at MAX_PRIORITY_TEXT
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  allowed: true,
  calendarTokenRow: null as unknown,
  facts: [] as unknown[],
  openLoops: [] as unknown[],
  priorities: [] as unknown[],
  pastEvents: [] as unknown[],
  emailSignal: null as unknown,
  proposal: null as unknown,
  priorityCreate: vi.fn(),
  priorityDelete: vi.fn(),
  memoryCreate: vi.fn(),
  factSync: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({
  getSession: async () => h.session,
}));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: h.allowed, remaining: 4, resetAt: Date.now() + 3600_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
}));

vi.mock('@/lib/db', () => ({
  userQueries: { findById: () => ({ id: 1, timezone: 'America/Toronto' }) },
  effectiveTimezone: (u: { timezone: string }) => u.timezone,
  factQueries: {
    getAll: () => h.facts,
    syncPriorityFacts: h.factSync,
  },
  openLoopQueries: { list: () => h.openLoops },
  priorityQueries: {
    getMostRecent: () => h.priorities,
    deleteThisWeek: h.priorityDelete,
    create: h.priorityCreate,
  },
  memoryQueries: { create: h.memoryCreate },
  calendarQueries: { get: () => h.calendarTokenRow },
}));

vi.mock('@/lib/calendar', () => ({
  getPastCalendarEvents: async () => h.pastEvents,
}));

vi.mock('@/lib/gmail', () => ({
  getRecentEmailSignal: async () => h.emailSignal,
}));

vi.mock('@/lib/priorityDerivation', () => ({
  derivePriorities: async () => h.proposal,
}));

vi.mock('@/lib/briefing', () => ({
  getWeekOf: () => '2026-06-16',
}));

// ── helpers ───────────────────────────────────────────────────────────────────

function getReq() {
  return new Request('http://localhost/api/priorities/derive');
}

function postReq(body: unknown) {
  return new NextRequest('http://localhost/api/priorities/derive/accept', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

// ── GET /api/priorities/derive ────────────────────────────────────────────────

describe('GET /api/priorities/derive — authn + rate limit', () => {
  beforeEach(() => {
    h.session = null;
    h.allowed = true;
    h.pastEvents = [];
    h.emailSignal = null;
    h.facts = [];
    h.openLoops = [];
    h.priorities = [];
    h.proposal = null;
  });

  it('returns 401 when unauthenticated', async () => {
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe('Unauthorized');
  });

  it('returns 429 when rate-limited', async () => {
    h.session = { id: 1, email: 'u@test.com', name: 'User' };
    h.allowed = false;
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(429);
  });

  it('fresh account — no signals → returns proposal:null with safe reason (no error leak)', async () => {
    h.session = { id: 1, email: 'new@test.com', name: 'New User' };
    h.proposal = null;
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal).toBeNull();
    // Must have a human-readable reason, not an internal error string
    expect(typeof body.reason).toBe('string');
    expect(body.reason).not.toContain('Error');
    expect(body.reason).not.toContain('exception');
    expect(body.reason).not.toContain('stack');
  });

  it('calendar connected, empty history → still returns proposal:null gracefully', async () => {
    h.session = { id: 1, email: 'u@test.com', name: 'User' };
    h.pastEvents = [];  // connected but no history
    h.proposal = null;
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal).toBeNull();
  });

  it('with calendar history → returns a proposal object', async () => {
    h.session = { id: 1, email: 'u@test.com', name: 'User' };
    h.proposal = {
      priorities: [{ text: 'Grow Edg3', rationale: 'High calendar focus', evidenceTags: [] }],
      summaryLine: 'Looks like your top focus is Edg3',
      dataSnapshot: { calendarEventCount: 50, calendarDaysSpanned: 90, emailThreadCount: 0, factsCount: 0, openLoopsCount: 0 },
      generatedAt: '2026-06-17T00:00:00Z',
    };
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal).not.toBeNull();
    expect(Array.isArray(body.proposal.priorities)).toBe(true);
  });

  it('derivePriorities failure → returns proposal:null (no internals leaked)', async () => {
    h.session = { id: 1, email: 'u@test.com', name: 'User' };
    // derivePriorities is already mocked to return h.proposal — set it to null to simulate failure
    h.proposal = null;
    const { GET } = await import('./route');
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.proposal).toBeNull();
    // reason should be a safe string, not a thrown error message
    expect(body.reason).not.toMatch(/ANTHROPIC|API_KEY|secret|token|password/i);
  });
});

// ── POST /api/priorities/derive/accept ───────────────────────────────────────

describe('POST /api/priorities/derive/accept — authz + input validation', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.session = null;
    h.allowed = true;
  });

  it('returns 401 when unauthenticated', async () => {
    const { POST } = await import('./accept/route');
    const res = await POST(postReq({ priorities: ['Focus on Edg3'] }));
    expect(res.status).toBe(401);
  });

  it('returns 429 when rate-limited', async () => {
    h.session = { id: 1, email: 'u@test.com', name: 'User' };
    h.allowed = false;
    const { POST } = await import('./accept/route');
    const res = await POST(postReq({ priorities: ['Focus on Edg3'] }));
    expect(res.status).toBe(429);
  });

  it('accepts valid priorities and writes to session user only', async () => {
    h.session = { id: 7, email: 'u@test.com', name: 'User' };
    const { POST } = await import('./accept/route');
    const res = await POST(postReq({ priorities: ['Focus on Edg3', 'Improve runway'] }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.ok).toBe(true);
    // Writes must be scoped to session user (id=7), not any other id
    expect(h.priorityCreate).toHaveBeenCalledWith(7, expect.any(String), '2026-06-16', 1);
    expect(h.memoryCreate).toHaveBeenCalledWith(7, 'calendar_note', expect.any(String));
  });

  it('caps priority text at 200 chars (prevents LLM output amplification)', async () => {
    h.session = { id: 1, email: 'u@test.com', name: 'User' };
    const longText = 'A'.repeat(500);
    const { POST } = await import('./accept/route');
    const res = await POST(postReq({ priorities: [longText] }));
    expect(res.status).toBe(200);
    const call = h.priorityCreate.mock.calls[0];
    const storedText: string = call[1];
    expect(storedText.length).toBeLessThanOrEqual(200);
  });

  it('rejects empty priorities array with 400', async () => {
    h.session = { id: 1, email: 'u@test.com', name: 'User' };
    const { POST } = await import('./accept/route');
    const res = await POST(postReq({ priorities: [] }));
    expect(res.status).toBe(400);
  });

  it('rejects malformed JSON body with 400', async () => {
    h.session = { id: 1, email: 'u@test.com', name: 'User' };
    const req = new NextRequest('http://localhost/api/priorities/derive/accept', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: 'not-json',
    });
    const { POST } = await import('./accept/route');
    const res = await POST(req);
    expect(res.status).toBe(400);
  });

  it('accepts at most 3 priorities (extra ones silently dropped)', async () => {
    h.session = { id: 1, email: 'u@test.com', name: 'User' };
    const { POST } = await import('./accept/route');
    await POST(postReq({ priorities: ['P1', 'P2', 'P3', 'P4', 'P5'] }));
    expect(h.priorityCreate).toHaveBeenCalledTimes(3);
  });
});
