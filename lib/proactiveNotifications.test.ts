/**
 * R14 T2 — proactive notification jobs (low recovery + priority gap). db/push/whoop/
 * alignment/calendar mocked; injectable `now` for deterministic local-time dispatch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  users: [] as Array<{ id: number; timezone: string }>,
  completed: true,
  recovery: null as { recoveryScore: number } | null,
  hasRecent: {} as Record<string, boolean>,
  priorities: [] as Array<{ text: string }>,
  alignment: null as { perPriority: Array<{ priority: string; hours: number; blocked: boolean }> } | null,
  pushed: [] as Array<{ uid: number; n: { title: string; body: string } }>,
  logged: [] as Array<{ uid: number; type: string; payload?: string | null }>,
}));

vi.mock('./db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (_uid?: number) => (sql.includes('FROM briefings') ? (h.completed ? { 1: 1 } : undefined) : undefined),
      all: () => h.users,
    }),
  }),
  userQueries: {},
  priorityQueries: { getMostRecent: (_id: number) => h.priorities },
  notificationLogQueries: {
    hasRecentEntry: (_uid: number, type: string) => !!h.hasRecent[type],
    record: (uid: number, type: string, payload?: string | null) => h.logged.push({ uid, type, payload }),
  },
  effectiveTimezone: () => 'UTC',
  backgroundJobFailureQueries: { record: vi.fn() },
}));
vi.mock('./push', () => ({ sendPushToUser: async (uid: number, n: { title: string; body: string }) => { h.pushed.push({ uid, n }); } }));
vi.mock('./whoop', () => ({ getLatestRecovery: async (_id: number) => h.recovery }));
vi.mock('./alignment', () => ({ computeAlignment: async () => h.alignment }));
vi.mock('./calendar', () => ({ getWeekEvents: async () => [] }));

const { maybeLowRecoveryAlert, maybePriorityGapAlert, runProactiveNotifications } = await import('./proactiveNotifications');

const USER = { id: 1, timezone: 'UTC' };

beforeEach(() => {
  h.users = [USER];
  h.completed = true;
  h.recovery = null;
  h.hasRecent = {};
  h.priorities = [];
  h.alignment = null;
  h.pushed = [];
  h.logged = [];
});

describe('maybeLowRecoveryAlert', () => {
  it('sends when recovery ≤ 40, user has called, not already sent today', async () => {
    h.recovery = { recoveryScore: 28 };
    expect(await maybeLowRecoveryAlert(USER as never)).toBe(true);
    expect(h.pushed).toHaveLength(1);
    expect(h.pushed[0].n.title).toBe('Recovery Alert');
    expect(h.pushed[0].n.body).toContain('28%');
    expect(h.logged[0]).toMatchObject({ type: 'low_recovery' });
  });

  it('skips when recovery > 40', async () => {
    h.recovery = { recoveryScore: 65 };
    expect(await maybeLowRecoveryAlert(USER as never)).toBe(false);
    expect(h.pushed).toHaveLength(0);
  });

  it('skips when Whoop returns null (not connected / no data)', async () => {
    h.recovery = null;
    expect(await maybeLowRecoveryAlert(USER as never)).toBe(false);
    expect(h.pushed).toHaveLength(0);
  });

  it('skips when the user has no completed call', async () => {
    h.recovery = { recoveryScore: 20 };
    h.completed = false;
    expect(await maybeLowRecoveryAlert(USER as never)).toBe(false);
    expect(h.pushed).toHaveLength(0);
  });

  it('skips when already sent today (notification_log gate)', async () => {
    h.recovery = { recoveryScore: 20 };
    h.hasRecent = { low_recovery: true };
    expect(await maybeLowRecoveryAlert(USER as never)).toBe(false);
    expect(h.pushed).toHaveLength(0);
  });
});

describe('maybePriorityGapAlert', () => {
  it('sends when a priority has 0 hours this week', async () => {
    h.priorities = [{ text: 'fundraising' }];
    h.alignment = { perPriority: [{ priority: 'fundraising', hours: 0, blocked: false }] };
    expect(await maybePriorityGapAlert(USER as never)).toBe(true);
    expect(h.pushed[0].n.title).toBe('Priority Gap');
    expect(h.pushed[0].n.body).toContain('fundraising');
    expect(h.logged[0]).toMatchObject({ type: 'priority_gap', payload: 'fundraising' });
  });

  it('skips when every priority has calendar hours', async () => {
    h.priorities = [{ text: 'fundraising' }];
    h.alignment = { perPriority: [{ priority: 'fundraising', hours: 4, blocked: true }] };
    expect(await maybePriorityGapAlert(USER as never)).toBe(false);
    expect(h.pushed).toHaveLength(0);
  });

  it('skips when one was already sent this week', async () => {
    h.priorities = [{ text: 'fundraising' }];
    h.alignment = { perPriority: [{ priority: 'fundraising', hours: 0, blocked: false }] };
    h.hasRecent = { priority_gap: true };
    expect(await maybePriorityGapAlert(USER as never)).toBe(false);
    expect(h.pushed).toHaveLength(0);
  });
});

describe('runProactiveNotifications — local-time dispatch', () => {
  it('fires the priority-gap job at 9:00 on a Tuesday', async () => {
    h.priorities = [{ text: 'fundraising' }];
    h.alignment = { perPriority: [{ priority: 'fundraising', hours: 0, blocked: false }] };
    await runProactiveNotifications(new Date('2026-06-16T09:00:00Z')); // Tue 09:00 UTC
    expect(h.pushed.some(p => p.n.title === 'Priority Gap')).toBe(true);
  });

  it('does NOT fire the priority-gap job on a Monday (Mon/Fri excluded)', async () => {
    h.priorities = [{ text: 'fundraising' }];
    h.alignment = { perPriority: [{ priority: 'fundraising', hours: 0, blocked: false }] };
    await runProactiveNotifications(new Date('2026-06-15T09:00:00Z')); // Mon 09:00 UTC
    expect(h.pushed).toHaveLength(0);
  });

  it('fires the low-recovery job at 7:30 local', async () => {
    h.recovery = { recoveryScore: 22 };
    await runProactiveNotifications(new Date('2026-06-16T07:30:00Z')); // 07:30
    expect(h.pushed.some(p => p.n.title === 'Recovery Alert')).toBe(true);
  });

  it('fires nothing at an off-hour (e.g. 14:00)', async () => {
    h.recovery = { recoveryScore: 22 };
    h.priorities = [{ text: 'fundraising' }];
    h.alignment = { perPriority: [{ priority: 'fundraising', hours: 0, blocked: false }] };
    await runProactiveNotifications(new Date('2026-06-16T14:00:00Z'));
    expect(h.pushed).toHaveLength(0);
  });
});
