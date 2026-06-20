/**
 * Tests for data export (GET /api/account/export) and
 * self-service account deletion (DELETE /api/account).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { NextRequest } from 'next/server';

// ── hoisted mock values ────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  session: null as { id: number; email: string; name: string } | null,
  user: null as Record<string, unknown> | null,
  priorities: [] as unknown[],
  memories: [] as unknown[],
  facts: [] as unknown[],
  tasks: [] as unknown[],
  briefings: [] as unknown[],
  drafts: [] as unknown[],
  activity: [] as unknown[],
  people: [] as unknown[],
  peopleModels: [] as unknown[],
  dbRun: vi.fn(),
  dbGet: vi.fn<() => unknown>(() => undefined),
  dbAll: vi.fn<() => unknown[]>(() => []),
  preparedSqls: [] as string[],
  deleteUserData: vi.fn(),
}));

// ── module mocks ───────────────────────────────────────────────────────────────

vi.mock('@/lib/auth', () => ({
  getSession: async () => h.session,
  clearSessionCookie: () => ({ name: 'session', value: '', maxAge: 0 }),
}));

vi.mock('@/lib/db', () => ({
  getDb: () => ({
    prepare: (sql: string) => { h.preparedSqls.push(sql); return { run: h.dbRun, get: h.dbGet, all: h.dbAll }; },
  }),
  deleteUserData: (userId: number) => h.deleteUserData(userId),
  userQueries: {
    findById: (_id: number) => h.user,
  },
  priorityQueries: {
    getMostRecent: (_id: number) => h.priorities,
  },
  memoryQueries: {
    getRecent: (_id: number, _lim: number) => h.memories,
  },
  factQueries: {
    getAll: (_id: number) => h.facts,
  },
  taskQueries: {
    getRecent: (_id: number, _days: number) => h.tasks,
  },
  briefingQueries: {
    getRecent: (_id: number, _lim: number) => h.briefings,
  },
  decryptBriefingRow: (r: unknown) => r,
  energyProfileQueries: {
    get: (_id: number) => undefined,
  },
  openLoopQueries: {
    list: (_id: number) => [],
  },
  auditLogQueries: {
    recent: (_id: number, _lim: number) => h.activity,
  },
  peopleProfileQueries: {
    listForUser: (_id: number) => h.people,
  },
  peopleModelQueries: {
    listForUser: (_id: number) => h.peopleModels,
  },
}));

vi.mock('@/lib/crypto', () => ({
  decryptField: (v: string) => `decrypted:${v}`,
  safeDecryptField: (v: string | null | undefined) => (v == null ? '' : `safe:${v}`),
}));

vi.mock('@/lib/rateLimit', () => ({
  checkRateLimit: () => ({ allowed: true, remaining: 4, resetAt: Date.now() + 3600_000 }),
  rateLimitResponse: () => new Response(JSON.stringify({ error: 'Too many requests' }), { status: 429 }),
}));

// ── import routes AFTER mocks ──────────────────────────────────────────────────

const { GET: exportGET } = await import('./export/route');
const { DELETE: accountDELETE } = await import('./route');

// ── helpers ────────────────────────────────────────────────────────────────────

function makeReq(method = 'GET', body?: unknown): NextRequest {
  return new NextRequest('http://localhost/api/account', {
    method,
    body: body != null ? JSON.stringify(body) : undefined,
    headers: body != null ? { 'content-type': 'application/json' } : {},
  });
}

const MOCK_USER = {
  id: 1, name: 'Derrick', email: 'derrick@test.com',
  timezone: 'America/Vancouver', call_time: '07:00',
  phone_number: '+15550001234', profile_summary: 'Founder',
  password_hash: 'SHOULD_NOT_APPEAR', onboarding_complete: 1,
};

beforeEach(() => {
  vi.resetAllMocks();
  h.session = null;
  h.user = null;
  h.priorities = [];
  h.memories = [];
  h.facts = [];
  h.tasks = [];
  h.briefings = [];
  h.drafts = [];
  h.activity = [];
  h.people = [];
  h.peopleModels = [];
  h.preparedSqls = [];
  h.deleteUserData.mockReset();
  h.dbAll.mockReturnValue([]);
});

// ── GET /api/account/export ────────────────────────────────────────────────────

describe('GET /api/account/export — auth guard', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await exportGET(makeReq());
    expect(res.status).toBe(401);
  });
});

describe('GET /api/account/export — response shape', () => {
  beforeEach(() => {
    h.session = { id: 1, email: 'derrick@test.com', name: 'Derrick' };
    h.user = MOCK_USER;
    h.priorities = [{ text: 'Ship EDG3', rank: 1, week_of: '2026-06-09' }];
    h.memories = [{ type: 'insight', content: 'Loves deep work', created_at: '2026-06-10' }];
    h.facts = [{ category: 'preference', entity: null, statement: 'Prefers mornings', learned_at: '2026-06-10' }];
    h.tasks = [{ text: 'Review deck', date: '2026-06-13', source: 'manual', completed: 0, completed_at: null }];
    h.briefings = [{
      scheduled_for: '2026-06-13T07:00:00Z', status: 'completed',
      content: 'Morning briefing', transcript: 'Hello Derrick',
      user_response: 'Let me block time', calendar_actions: null, edge_promises: null,
    }];
    h.dbAll.mockReturnValue([
      { recipient: 'enc:1:r', subject: 'enc:1:s', created_at: 1718268000 },
    ]);
  });

  it('returns 200 with JSON export', async () => {
    const res = await exportGET(makeReq());
    expect(res.status).toBe(200);
  });

  it('sets Content-Disposition attachment header', async () => {
    const res = await exportGET(makeReq());
    expect(res.headers.get('content-disposition')).toContain('attachment');
    expect(res.headers.get('content-disposition')).toContain('edg3-data-export.json');
  });

  it('includes all expected top-level sections', async () => {
    const res = await exportGET(makeReq());
    const data = await res.json();
    expect(data).toHaveProperty('exportedAt');
    expect(data).toHaveProperty('version', '3');
    expect(data).toHaveProperty('profile');
    expect(data).toHaveProperty('priorities');
    expect(data).toHaveProperty('memories');
    expect(data).toHaveProperty('facts');
    expect(data).toHaveProperty('tasks');
    expect(data).toHaveProperty('briefings');
    expect(data).toHaveProperty('emailDraftHistory');
    expect(data).toHaveProperty('dailyFocus');
    expect(data).toHaveProperty('calendarScores');
    expect(data).toHaveProperty('energyProfile');
    expect(data).toHaveProperty('eventEnergyTags');
    expect(data).toHaveProperty('openLoops');
    expect(data).toHaveProperty('activityLog');
    expect(data).toHaveProperty('people');
    expect(data).toHaveProperty('peopleModels');
    // R10 T1 — four previously-deferred tables, now included.
    expect(data).toHaveProperty('episodes');
    expect(data).toHaveProperty('factHistory');
    expect(data).toHaveProperty('focusMilestones');
    expect(data).toHaveProperty('supportMessages');
  });

  it('includes the four R10 tables with decrypted (readable) content, not ciphertext', async () => {
    // The shared dbAll mock returns this row for every direct query; each new section maps the
    // columns it needs. We assert the encrypted fields come back decrypted via safeDecryptField.
    h.dbAll.mockReturnValue([{
      // episodes
      source: 'call', occurred_at: '2026-06-18T07:00:00Z',
      content_raw: 'enc:1:we discussed the raise', topics: '["fundraising"]', commitments: '["email Sarah"]',
      // fact_history
      fact_id: 7, statement: 'enc:1:old goal text', entity: 'CIBC', category: 'goal',
      retired_at: '2026-06-17T00:00:00Z', reason: 'superseded',
      // focus_milestones
      title: 'enc:1:draft the deck', done: 1, completed_at: '2026-06-18T00:00:00Z', priority_id: 3,
      // support_messages
      type: 'feedback', message: 'enc:1:love the product', created_at: '2026-06-16T00:00:00Z',
    }]);

    const res = await exportGET(makeReq());
    const data = await res.json();

    expect(data.episodes[0]).toMatchObject({
      source: 'call', occurredAt: '2026-06-18T07:00:00Z',
      contentSummary: 'safe:enc:1:we discussed the raise',
      topics: ['fundraising'], commitments: ['email Sarah'],
    });
    expect(data.factHistory[0]).toMatchObject({
      factId: 7, statement: 'safe:enc:1:old goal text', category: 'goal', retiredAt: '2026-06-17T00:00:00Z', reason: 'superseded',
    });
    expect(data.focusMilestones[0]).toMatchObject({
      title: 'safe:enc:1:draft the deck', done: true, doneAt: '2026-06-18T00:00:00Z', priorityId: 3,
    });
    expect(data.supportMessages[0]).toMatchObject({
      type: 'feedback', message: 'safe:enc:1:love the product', createdAt: '2026-06-16T00:00:00Z',
    });
  });

  it('includes social mental models (people_models), decrypted', async () => {
    h.peopleModels = [
      { person_name: 'Sarah', goals: 'close Series A', communication_style: 'direct', relationship_state: 'warm', last_interaction: '2026-06-18', health_score: 0.8, updated_at: '2026-06-18' },
    ];
    const res = await exportGET(makeReq());
    const { peopleModels } = await res.json();
    expect(peopleModels).toHaveLength(1);
    expect(peopleModels[0]).toMatchObject({ personName: 'Sarah', goals: 'close Series A', communicationStyle: 'direct', relationshipState: 'warm', healthScore: 0.8 });
  });

  it('includes the activity log (parsed args, no internal snapshot blobs)', async () => {
    h.activity = [
      { action: 'createEvent', args_json: '{"title":"Investor sync"}', result_text: "Added 'Investor sync'", ok: 1, briefing_id: null, created_at: '2026-06-18T07:05:00Z', snapshot_after: 'enc:1:SHOULD_NOT_APPEAR' },
    ];
    const res = await exportGET(makeReq());
    const { activityLog } = await res.json();
    expect(activityLog).toHaveLength(1);
    expect(activityLog[0]).toMatchObject({ action: 'createEvent', ok: true, result: "Added 'Investor sync'" });
    expect(activityLog[0].args).toEqual({ title: 'Investor sync' });
    // Internal/encrypted snapshot fields must not leak into the export.
    expect(JSON.stringify(activityLog[0])).not.toContain('SHOULD_NOT_APPEAR');
  });

  it('omits password_hash from profile', async () => {
    const res = await exportGET(makeReq());
    const { profile } = await res.json();
    expect(profile).not.toHaveProperty('password_hash');
    expect(profile.name).toBe('Derrick');
    expect(profile.email).toBe('derrick@test.com');
  });

  it('decrypts gmail draft recipient and subject', async () => {
    const res = await exportGET(makeReq());
    const { emailDraftHistory } = await res.json();
    expect(emailDraftHistory[0].recipient).toBe('decrypted:enc:1:r');
    expect(emailDraftHistory[0].subject).toBe('decrypted:enc:1:s');
  });

  it('includes briefing content and transcript', async () => {
    const res = await exportGET(makeReq());
    const { briefings } = await res.json();
    expect(briefings[0].content).toBe('Morning briefing');
    expect(briefings[0].transcript).toBe('Hello Derrick');
  });

  it('includes priorities with rank and weekOf', async () => {
    const res = await exportGET(makeReq());
    const { priorities } = await res.json();
    expect(priorities[0]).toMatchObject({ text: 'Ship EDG3', rank: 1, weekOf: '2026-06-09' });
  });
});

// ── DELETE /api/account ────────────────────────────────────────────────────────

describe('DELETE /api/account — auth guard', () => {
  it('returns 401 when not authenticated', async () => {
    const res = await accountDELETE(makeReq('DELETE', { confirm: 'delete my account' }));
    expect(res.status).toBe(401);
  });
});

describe('DELETE /api/account — confirm contract', () => {
  beforeEach(() => {
    h.session = { id: 1, email: 'derrick@test.com', name: 'Derrick' };
  });

  it('returns 400 when confirm phrase is missing', async () => {
    const res = await accountDELETE(makeReq('DELETE', {}));
    expect(res.status).toBe(400);
  });

  it('returns 400 when confirm phrase is wrong', async () => {
    const res = await accountDELETE(makeReq('DELETE', { confirm: 'yes please delete me' }));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain('delete my account');
  });

  it('returns 400 when body is empty', async () => {
    const req = new NextRequest('http://localhost/api/account', { method: 'DELETE' });
    const res = await accountDELETE(req);
    expect(res.status).toBe(400);
  });
});

describe('DELETE /api/account — deletion', () => {
  beforeEach(() => {
    h.session = { id: 1, email: 'derrick@test.com', name: 'Derrick' };
  });

  it('returns 200 with success true on correct confirm phrase', async () => {
    const res = await accountDELETE(makeReq('DELETE', { confirm: 'delete my account' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.success).toBe(true);
  });

  it('delegates deletion to deleteUserData with the session user id', async () => {
    // The actual table-by-table cascade (incl. completeness/drift) is verified against a
    // real DB in lib/db-account-deletion.test.ts; here we only assert the route wiring.
    await accountDELETE(makeReq('DELETE', { confirm: 'delete my account' }));
    expect(h.deleteUserData).toHaveBeenCalledWith(1);
  });

  it('returns 500 (not 200) if deleteUserData throws', async () => {
    h.deleteUserData.mockImplementationOnce(() => { throw new Error('FK constraint'); });
    const res = await accountDELETE(makeReq('DELETE', { confirm: 'delete my account' }));
    expect(res.status).toBe(500);
  });

  it('clears the session cookie on success', async () => {
    const res = await accountDELETE(makeReq('DELETE', { confirm: 'delete my account' }));
    const setCookie = res.headers.get('set-cookie') ?? '';
    expect(setCookie).toBeTruthy();
  });
});
