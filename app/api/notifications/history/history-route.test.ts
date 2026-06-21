/**
 * GET /api/notifications/history — renders notification_log rows for the dashboard panel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  session: null as { id: number } | null,
  rows: [] as Array<{ type: string; payload: string | null; sent_at: string }>,
  listForUser: vi.fn(),
}));

vi.mock('@/lib/auth', () => ({ getSession: async () => h.session }));
vi.mock('@/lib/db', () => ({
  notificationLogQueries: {
    listForUser: (...a: unknown[]) => { h.listForUser(...a); return h.rows; },
  },
}));

const { GET } = await import('./route');

beforeEach(() => {
  vi.clearAllMocks();
  h.session = { id: 42 };
  h.rows = [];
});

describe('GET /api/notifications/history', () => {
  it('401 when unauthenticated', async () => {
    h.session = null;
    expect((await GET()).status).toBe(401);
  });

  it('renders log rows into {type, title, body, sentAt}, user-scoped + limit 10', async () => {
    h.rows = [
      { type: 'low_recovery', payload: '28', sent_at: '2026-06-20T07:30:00Z' },
      { type: 'priority_gap', payload: 'fundraising', sent_at: '2026-06-19T09:00:00Z' },
    ];
    const data = await (await GET()).json();
    expect(h.listForUser).toHaveBeenCalledWith(42, 10);
    expect(data.notifications).toHaveLength(2);
    expect(data.notifications[0]).toMatchObject({ type: 'low_recovery', title: 'Recovery Alert', sentAt: '2026-06-20T07:30:00Z' });
    expect(data.notifications[0].body).toContain('28%');
    expect(data.notifications[1]).toMatchObject({ type: 'priority_gap', title: 'Priority Gap' });
    expect(data.notifications[1].body).toContain('fundraising');
  });

  it('returns an empty array when there are no notifications', async () => {
    h.rows = [];
    const data = await (await GET()).json();
    expect(data.notifications).toEqual([]);
  });

  it('renders an unknown type gracefully', async () => {
    h.rows = [{ type: 'something_new', payload: 'x', sent_at: '2026-06-20T00:00:00Z' }];
    const data = await (await GET()).json();
    expect(data.notifications[0]).toMatchObject({ type: 'something_new', title: 'Notification', body: 'x' });
  });
});
