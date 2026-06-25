/**
 * M4-5 cron wiring (Security) — runWeeklySynthesisSweep loops all active users and calls Core's
 * per-user runWeeklySynthesis once each; a per-user failure is recorded and never aborts the sweep.
 * Degrades to a logged no-op if the export is ever absent.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  users: [] as Array<{ id: number }>,
  calls: [] as number[],
  throwForUser: null as number | null,
  jobFailures: [] as Array<{ job: string; uid: number | null; err: string }>,
}));

vi.mock('./db', () => ({
  getDb: () => ({ prepare: (_sql: string) => ({ all: () => h.users }) }),
  briefingQueries: {}, userQueries: {}, priorityQueries: {}, factQueries: {}, energyLogQueries: {},
  openLoopQueries: {}, watchedThreadQueries: {}, oauthStateQueries: {}, auditLogQueries: {},
  episodeQueries: {}, briefingContextPackQueries: {}, failedWebhookQueries: {},
  backgroundJobFailureQueries: { record: (job: string, uid: number | null, err: string) => h.jobFailures.push({ job, uid, err }) },
  healthLogQueries: {}, callAttemptQueries: {}, calendarQueries: {}, notificationQueries: {},
  webhookDedupeQueries: {}, toolCallDedupeQueries: {}, schedulerLockQueries: {},
  effectiveTimezone: (u: { timezone?: string }) => u.timezone ?? 'UTC',
}));

// runWeeklySynthesis returns true when a narrative is written; throw for one user to test isolation.
vi.mock('./facts', () => ({
  runWeeklySynthesis: async (userId: number) => {
    if (h.throwForUser === userId) throw new Error('haiku boom');
    h.calls.push(userId);
    return userId % 2 === 1; // odd users "write" a narrative, even ones gate out
  },
}));

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('./vapi', () => ({ initiateCall: vi.fn(), buildGratitudeSystemPrompt: vi.fn() }));
vi.mock('./briefing', () => ({ generateDailyBriefing: vi.fn(), getWeekOf: vi.fn(() => '2026-06-24') }));
vi.mock('./weather', () => ({ getWeatherForecast: vi.fn(), getWeatherToday: vi.fn() }));
vi.mock('./callMemory', () => ({ currentOpenCallMemoryText: vi.fn() }));
vi.mock('./whoop', () => ({ getLatestRecovery: vi.fn(), getLastSleep: vi.fn(), getRecentStrain: vi.fn(), getRecoveryHistory: vi.fn(), getSleepHistory: vi.fn(), getStrainHistory: vi.fn(), whoopFreshnessNote: vi.fn(), formatWhoopHistoryForCall: vi.fn() }));
vi.mock('./consent', () => ({ isPrivacyMode: vi.fn(() => false) }));
vi.mock('./greeting', () => ({ greetingEn: vi.fn(), greetingYue: vi.fn(), dayPeriod: vi.fn() }));
vi.mock('./energy', () => ({ deriveEnergySignal: vi.fn(), formatEnergyForCall: vi.fn() }));
vi.mock('./backup', () => ({ maybeDailyBackup: vi.fn() }));

const { runWeeklySynthesisSweep } = await import('./scheduler');

beforeEach(() => {
  h.users = [];
  h.calls = [];
  h.throwForUser = null;
  h.jobFailures = [];
});

describe('M4-5 — runWeeklySynthesisSweep', () => {
  it('calls runWeeklySynthesis once per active user', async () => {
    h.users = [{ id: 1 }, { id: 2 }, { id: 3 }];
    await runWeeklySynthesisSweep();
    expect(h.calls).toEqual([1, 2, 3]);
  });

  it('a per-user failure is recorded and does not abort the sweep', async () => {
    h.users = [{ id: 1 }, { id: 2 }, { id: 3 }];
    h.throwForUser = 2;
    await runWeeklySynthesisSweep();
    expect(h.calls).toEqual([1, 3]); // 2 threw, 1 and 3 still ran
    expect(h.jobFailures).toEqual([{ job: 'weekly_synthesis', uid: 2, err: 'Error: haiku boom' }]);
  });

  it('no active users → no calls, no throw', async () => {
    await expect(runWeeklySynthesisSweep()).resolves.toBeUndefined();
    expect(h.calls).toEqual([]);
  });
});
