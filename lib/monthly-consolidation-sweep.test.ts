/**
 * R22 — monthly memory consolidation cron. runMonthlyConsolidationSweep fires every Sunday (the
 * '0 4 * * 0' cron) but self-gates to the FIRST Sunday of the month (UTC), then loops active users
 * calling Core's runLifetimeSynthesis. Per-user failure is recorded and never aborts the sweep.
 *
 * 2026-06: Sundays fall on the 7th, 14th, 21st, 28th — so the 7th is the first Sunday.
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

vi.mock('./facts', () => ({
  runLifetimeSynthesis: async (userId: number) => {
    if (h.throwForUser === userId) throw new Error('lifetime boom');
    h.calls.push(userId);
    return true;
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

const { runMonthlyConsolidationSweep } = await import('./scheduler');

const FIRST_SUNDAY = new Date('2026-06-07T04:00:00Z'); // Sunday, date 7 → first Sunday
const SECOND_SUNDAY = new Date('2026-06-14T04:00:00Z'); // Sunday, date 14 → NOT first
const A_MONDAY = new Date('2026-06-08T04:00:00Z'); // not Sunday

beforeEach(() => {
  h.users = [{ id: 1 }, { id: 2 }, { id: 3 }];
  h.calls = [];
  h.throwForUser = null;
  h.jobFailures = [];
});

describe('R22 — runMonthlyConsolidationSweep first-Sunday gate', () => {
  it('runs on the first Sunday of the month: one call per active user', async () => {
    await runMonthlyConsolidationSweep(FIRST_SUNDAY);
    expect(h.calls).toEqual([1, 2, 3]);
  });

  it('no-ops on a later Sunday (not the first of the month)', async () => {
    await runMonthlyConsolidationSweep(SECOND_SUNDAY);
    expect(h.calls).toEqual([]);
  });

  it('no-ops on a non-Sunday', async () => {
    await runMonthlyConsolidationSweep(A_MONDAY);
    expect(h.calls).toEqual([]);
  });

  it('a per-user failure is recorded and does not abort the sweep', async () => {
    h.throwForUser = 2;
    await runMonthlyConsolidationSweep(FIRST_SUNDAY);
    expect(h.calls).toEqual([1, 3]);
    expect(h.jobFailures).toEqual([{ job: 'monthly_consolidation', uid: 2, err: 'Error: lifetime boom' }]);
  });
});
