/**
 * R14 T2 — proactive notification jobs (low recovery + priority gap). db/push/whoop/
 * alignment/calendar mocked; injectable `now` for deterministic local-time dispatch.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  users: [] as Array<{ id: number; timezone: string }>,
  completed: true,
  recovery: null as { recoveryScore: number } | null,
  recoveryThrows: false,
  hasRecent: {} as Record<string, boolean>,
  priorities: [] as Array<{ text: string }>,
  alignment: null as { perPriority: Array<{ priority: string; hours: number; blocked: boolean }> } | null,
  pushed: [] as Array<{ uid: number; n: { title: string; body: string } }>,
  logged: [] as Array<{ uid: number; type: string; payload?: string | null }>,
  bgFailures: [] as Array<{ job: string; uid: number | null; err: string }>,
  pushThrowsForUser: null as number | null,
}));

vi.mock('./db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      get: (_uid?: number) => (sql.includes('FROM briefings') ? (h.completed ? { 1: 1 } : undefined) : undefined),
      all: () => h.users, // the eligibility JOIN query just returns the configured users
    }),
  }),
  userQueries: {},
  priorityQueries: { getMostRecent: (_id: number) => h.priorities },
  notificationLogQueries: {
    hasRecentEntry: (_uid: number, type: string) => !!h.hasRecent[type],
    record: (uid: number, type: string, payload?: string | null) => h.logged.push({ uid, type, payload }),
  },
  effectiveTimezone: () => 'UTC',
  backgroundJobFailureQueries: { record: (job: string, uid: number | null, err: string) => h.bgFailures.push({ job, uid, err }) },
}));
vi.mock('./push', () => ({ sendPushToUser: async (uid: number, n: { title: string; body: string }) => { if (h.pushThrowsForUser === uid) throw new Error('push fail'); h.pushed.push({ uid, n }); } }));
vi.mock('./whoop', () => ({ getLatestRecovery: async (_id: number) => { if (h.recoveryThrows) throw new Error('whoop boom'); return h.recovery; } }));
vi.mock('./alignment', () => ({ computeAlignment: async () => h.alignment }));
vi.mock('./calendar', () => ({ getWeekEvents: async () => [] }));

const TUE = new Date('2026-06-16T12:00:00Z'); // a Tuesday (Job B weekday gate passes)

const { maybeLowRecoveryAlert, maybePriorityGapAlert, runProactiveNotifications } = await import('./proactiveNotifications');

const USER = { id: 1, timezone: 'UTC' };

beforeEach(() => {
  h.users = [USER];
  h.completed = true;
  h.recovery = null;
  h.recoveryThrows = false;
  h.hasRecent = {};
  h.priorities = [];
  h.alignment = null;
  h.pushed = [];
  h.logged = [];
  h.bgFailures = [];
  h.pushThrowsForUser = null;
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
  it('sends when a priority has 0 hours this week (Tue–Thu)', async () => {
    h.priorities = [{ text: 'fundraising' }];
    h.alignment = { perPriority: [{ priority: 'fundraising', hours: 0, blocked: false }] };
    expect(await maybePriorityGapAlert(USER as never, TUE)).toBe(true);
    expect(h.pushed[0].n.title).toBe('Priority Gap');
    expect(h.pushed[0].n.body).toContain('fundraising');
    expect(h.logged[0]).toMatchObject({ type: 'priority_gap', payload: 'fundraising' });
  });

  it('skips on Mon/Fri (weekday self-gate)', async () => {
    h.priorities = [{ text: 'fundraising' }];
    h.alignment = { perPriority: [{ priority: 'fundraising', hours: 0, blocked: false }] };
    expect(await maybePriorityGapAlert(USER as never, new Date('2026-06-15T09:00:00Z'))).toBe(false); // Mon
    expect(await maybePriorityGapAlert(USER as never, new Date('2026-06-19T09:00:00Z'))).toBe(false); // Fri
    expect(h.pushed).toHaveLength(0);
  });

  it('skips when every priority has calendar hours', async () => {
    h.priorities = [{ text: 'fundraising' }];
    h.alignment = { perPriority: [{ priority: 'fundraising', hours: 4, blocked: true }] };
    expect(await maybePriorityGapAlert(USER as never, TUE)).toBe(false);
    expect(h.pushed).toHaveLength(0);
  });

  it('skips when one was already sent this week', async () => {
    h.priorities = [{ text: 'fundraising' }];
    h.alignment = { perPriority: [{ priority: 'fundraising', hours: 0, blocked: false }] };
    h.hasRecent = { priority_gap: true };
    expect(await maybePriorityGapAlert(USER as never, TUE)).toBe(false);
    expect(h.pushed).toHaveLength(0);
  });
});

describe('runProactiveNotifications — R17 sweep', () => {
  it('calls BOTH jobs for an eligible user (both pushes fire when conditions are met)', async () => {
    h.recovery = { recoveryScore: 22 };                                              // → low-recovery push
    h.priorities = [{ text: 'fundraising' }];
    h.alignment = { perPriority: [{ priority: 'fundraising', hours: 0, blocked: false }] }; // → priority-gap push
    await runProactiveNotifications(TUE);
    expect(h.pushed.some(p => p.n.title === 'Recovery Alert')).toBe(true);
    expect(h.pushed.some(p => p.n.title === 'Priority Gap')).toBe(true);
  });

  it('catches a per-user error and continues to the next user (sweep never throws)', async () => {
    h.users = [{ id: 1, timezone: 'UTC' }, { id: 2, timezone: 'UTC' }];
    h.pushThrowsForUser = 1;                  // user 1's push throws
    h.recovery = { recoveryScore: 22 };       // both users would get a low-recovery push
    await expect(runProactiveNotifications(TUE)).resolves.toBeUndefined(); // never throws
    expect(h.bgFailures.some(f => f.job === 'proactive_notifications' && f.uid === 1)).toBe(true); // user 1 logged
    expect(h.pushed.some(p => p.uid === 2 && p.n.title === 'Recovery Alert')).toBe(true);          // user 2 still processed
  });
});
