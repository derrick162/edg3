/**
 * R19 T5 — nightly Edg3 Score computation cron job.
 * runNightlyScores loops all onboarding_complete users and calls computeAndSaveScore once each,
 * so the score sparkline stays continuous on days the user never loads the dashboard. A per-user
 * failure is recorded and never aborts the sweep. Degrades to a no-op until Core exports the fn.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({
  users: [] as Array<{ id: number }>,
  scoreCalls: [] as number[],
  throwForUser: null as number | null,
  hasComputeFn: true,
  jobFailures: [] as Array<{ job: string; uid: number | null; err: string }>,
}));

vi.mock('./db', () => ({
  getDb: () => ({ prepare: (_sql: string) => ({ all: () => h.users }) }),
  // unused-but-imported queries in scheduler.ts module scope:
  briefingQueries: {}, userQueries: {}, priorityQueries: {}, factQueries: {}, energyLogQueries: {},
  openLoopQueries: {}, watchedThreadQueries: {}, oauthStateQueries: {}, auditLogQueries: {},
  episodeQueries: {}, briefingContextPackQueries: {}, failedWebhookQueries: {},
  backgroundJobFailureQueries: { record: (job: string, uid: number | null, err: string) => h.jobFailures.push({ job, uid, err }) },
  healthLogQueries: {}, callAttemptQueries: {}, calendarQueries: {}, notificationQueries: {},
  webhookDedupeQueries: {}, toolCallDedupeQueries: {}, schedulerLockQueries: {},
  effectiveTimezone: (u: { timezone?: string }) => u.timezone ?? 'UTC',
}));

vi.mock('./scores', () => ({
  computeAndSaveScore: h.hasComputeFn
    ? async (userId: number) => { if (h.throwForUser === userId) throw new Error('score boom'); h.scoreCalls.push(userId); }
    : undefined,
}));

// Keep the rest of scheduler.ts's heavy imports inert.
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));
vi.mock('./vapi', () => ({ initiateCall: vi.fn(), buildGratitudeSystemPrompt: vi.fn() }));
vi.mock('./briefing', () => ({ generateDailyBriefing: vi.fn(), getWeekOf: vi.fn(() => '2026-06-24') }));
vi.mock('./weather', () => ({ getWeatherForecast: vi.fn(), getWeatherToday: vi.fn() }));
vi.mock('./callMemory', () => ({ currentOpenCallMemoryText: vi.fn() }));
vi.mock('./whoop', () => ({ getLatestRecovery: vi.fn(), getLastSleep: vi.fn(), getRecentStrain: vi.fn(), getRecoveryHistory: vi.fn(), getSleepHistory: vi.fn(), getStrainHistory: vi.fn(), whoopFreshnessNote: vi.fn(), formatWhoopHistoryForCall: vi.fn() }));
vi.mock('./consent', () => ({ isPrivacyMode: vi.fn(() => false) }));
vi.mock('./greeting', () => ({ greetingEn: vi.fn(), greetingYue: vi.fn() }));
vi.mock('./energy', () => ({ deriveEnergySignal: vi.fn(), formatEnergyForCall: vi.fn() }));
vi.mock('./backup', () => ({ maybeDailyBackup: vi.fn() }));

const { runNightlyScores } = await import('./scheduler');

beforeEach(() => {
  h.users = [];
  h.scoreCalls = [];
  h.throwForUser = null;
  h.jobFailures = [];
});

describe('R19 T5 — runNightlyScores', () => {
  it('calls computeAndSaveScore once per active user', async () => {
    h.users = [{ id: 1 }, { id: 2 }, { id: 3 }];
    await runNightlyScores();
    expect(h.scoreCalls).toEqual([1, 2, 3]);
  });

  it('a per-user failure is recorded and does not abort the sweep', async () => {
    h.users = [{ id: 1 }, { id: 2 }, { id: 3 }];
    h.throwForUser = 2;
    await runNightlyScores();
    expect(h.scoreCalls).toEqual([1, 3]); // 2 threw, 1 and 3 still ran
    expect(h.jobFailures).toEqual([{ job: 'nightly_scores', uid: 2, err: 'Error: score boom' }]);
  });

  it('no active users → no calls, no throw', async () => {
    h.users = [];
    await expect(runNightlyScores()).resolves.toBeUndefined();
    expect(h.scoreCalls).toEqual([]);
  });
});
