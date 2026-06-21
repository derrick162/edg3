/**
 * R16 T2 — GET /api/user/export (GDPR self-export). auth + db mocked.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { id: number } | null,
  user: null as Record<string, unknown> | null,
  whoop: undefined as Record<string, unknown> | undefined,
  subs: [] as unknown[],
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/db', () => ({
  userQueries: { findById: (_id: number) => h.user },
  factQueries: { getAll: (_id: number) => [{ category: 'goal', entity: null, statement: 'ship edg3', learned_at: '2026-06-10' }] },
  memoryQueries: { getRecent: (_id: number, _l: number) => [{ type: 'insight', content: 'likes mornings', created_at: '2026-06-10' }] },
  taskQueries: { getRecent: (_id: number, _d: number) => [{ text: 'review deck', date: '2026-06-13', source: 'manual', completed: 0, completed_at: null }] },
  callFeedbackQueries: { recent: (_id: number, _l: number) => [{ briefing_id: 'b1', rating: 5, note: 'great', created_at: '2026-06-12' }] },
  notificationLogQueries: { listForUser: (_id: number, _l: number) => [{ type: 'low_recovery', payload: '28', sent_at: '2026-06-20' }] },
  whoopQueries: { get: (_id: number) => h.whoop },
  pushSubscriptionQueries: { getAll: (_id: number) => h.subs },
}));

const { GET } = await import('./route');

const MOCK_USER = {
  id: 1, name: 'Derrick', email: 'd@test.com', timezone: 'America/Vancouver', call_time: '07:00',
  phone_number: '+15550001234', profile_summary: 'Founder', data_consent: 'full',
  created_at: '2026-01-01', password_hash: 'SHOULD_NOT_APPEAR',
};

beforeEach(() => {
  h.session = { id: 1 };
  h.user = MOCK_USER;
  h.whoop = undefined;
  h.subs = [];
});

describe('GET /api/user/export', () => {
  it('401 when unauthenticated', async () => {
    h.session = null;
    expect((await GET()).status).toBe(401);
  });

  it('200 with all expected top-level keys', async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect(res.headers.get('content-disposition')).toContain('attachment');
    const data = await res.json();
    for (const k of ['exportedAt', 'profile', 'facts', 'memories', 'tasks', 'callFeedback', 'notificationLog', 'whoopConnected', 'pushSubscriptionsCount']) {
      expect(data).toHaveProperty(k);
    }
    expect(data.profile.name).toBe('Derrick');
    expect(data.pushSubscriptionsCount).toBe(0);
  });

  it('whoopConnected is true when a Whoop token row exists', async () => {
    h.whoop = { user_id: 1, access_token: 'WH_TOKEN', refresh_token: 'WH_REFRESH' };
    const data = await (await GET()).json();
    expect(data.whoopConnected).toBe(true);
  });

  it('never leaks secret values (password hash / whoop token) in the body', async () => {
    h.whoop = { user_id: 1, access_token: 'WH_SECRET_TOKEN', refresh_token: 'WH_SECRET_REFRESH' };
    h.subs = [{ endpoint: 'e', p256dh: 'p', auth: 'a' }];
    const raw = await (await GET()).text();
    expect(raw).not.toContain('SHOULD_NOT_APPEAR');   // password_hash
    expect(raw).not.toContain('WH_SECRET_TOKEN');      // whoop access token
    expect(raw).not.toContain('WH_SECRET_REFRESH');
    // push subs reported as a count, not the raw subscription
    const data = JSON.parse(raw);
    expect(data.pushSubscriptionsCount).toBe(1);
    expect(raw).not.toContain('"endpoint"');
  });
});
