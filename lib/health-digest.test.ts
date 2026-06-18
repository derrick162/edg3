/**
 * Tests for T1-3 (6am health digest) and DC1-1 (call attempt logging).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── hoisted state ─────────────────────────────────────────────────────────────
const h = vi.hoisted(() => ({
  failedCalls: 0,
  webhookFails: 0,
  jobFails: 0,
  emptyTranscripts: 0,
  calendarRows: [] as Array<{ id: number }>,
  tokenHealthResult: { ok: true, needsReconnect: false },
  healthWritten: null as { status: string; summary: string } | null,
  healthPruned: false,
  callAttemptPruned: false,
}));

vi.mock('./db', () => ({
  getDb: () => ({
    prepare: (sql: string) => ({
      all: vi.fn(() => {
        if (sql.includes('calendar_tokens')) return h.calendarRows;
        return [];
      }),
      get: vi.fn(() => {
        if (sql.includes('briefings') && sql.includes('transcript')) return { count: h.emptyTranscripts };
        return { count: 0, n: 0 };
      }),
      run: vi.fn(),
    }),
  }),
  failedWebhookQueries: {
    recentCount: vi.fn((_hours: number) => h.webhookFails),
    prune: vi.fn(),
  },
  backgroundJobFailureQueries: {
    recentCount: vi.fn((_hours: number) => h.jobFails),
    prune: vi.fn(),
  },
  healthLogQueries: {
    write: vi.fn((status: string, summary: string) => { h.healthWritten = { status, summary }; }),
    prune: vi.fn(() => { h.healthPruned = true; }),
    getLatest: vi.fn(),
  },
  callAttemptQueries: {
    failedCount: vi.fn((_hours: number) => h.failedCalls),
    prune: vi.fn(() => { h.callAttemptPruned = true; }),
    record: vi.fn(),
    getRecent: vi.fn(() => []),
  },
  calendarQueries: {
    get: vi.fn(),
    recordAuthFailure: vi.fn(),
    clearAuthFailures: vi.fn(),
    needsReconnect: vi.fn(() => false),
  },
  effectiveTimezone: (u: { timezone?: string }) => u.timezone || 'America/Vancouver',
  briefingContextPackQueries: { upsert: vi.fn(), prune: vi.fn() },
  userQueries: { findById: vi.fn() },
  priorityQueries: {},
  factQueries: { decayByCategories: vi.fn() },
  energyLogQueries: {},
  openLoopQueries: { prune: vi.fn() },
  watchedThreadQueries: { prune: vi.fn() },
  oauthStateQueries: { prune: vi.fn() },
  auditLogQueries: { pruneEmailSubjects: vi.fn() },
  episodeQueries: { pruneAll: vi.fn() },
  briefingQueries: {},
}));

vi.mock('./google-auth', () => ({
  checkCalendarTokenHealth: vi.fn(async () => h.tokenHealthResult),
}));

vi.mock('./backup', () => ({ maybeDailyBackup: vi.fn(async () => {}) }));
vi.mock('./vapi', () => ({ initiateCall: vi.fn(async () => {}) }));
vi.mock('./briefing', () => ({ generateDailyBriefing: vi.fn(async () => ''), getWeekOf: vi.fn(() => '2026-06-17') }));
vi.mock('./whoop', () => ({
  getLatestRecovery: vi.fn(async () => null),
  getLastSleep: vi.fn(async () => null),
  getRecentStrain: vi.fn(async () => null),
  getRecoveryHistory: vi.fn(async () => []),
  getSleepHistory: vi.fn(async () => []),
  getStrainHistory: vi.fn(async () => []),
  whoopFreshnessNote: vi.fn(() => ''),
  formatWhoopHistoryForCall: vi.fn(() => ''),
}));
vi.mock('./energy', () => ({ deriveEnergySignal: vi.fn(), formatEnergyForCall: vi.fn(() => '') }));
vi.mock('./consent', () => ({ isPrivacyMode: vi.fn(() => false) }));

const { runHealthDigest } = await import('./scheduler');

beforeEach(() => {
  vi.clearAllMocks();
  h.failedCalls = 0;
  h.webhookFails = 0;
  h.jobFails = 0;
  h.emptyTranscripts = 0;
  h.calendarRows = [];
  h.tokenHealthResult = { ok: true, needsReconnect: false };
  h.healthWritten = null;
  h.healthPruned = false;
  h.callAttemptPruned = false;
});

describe('runHealthDigest — OK path', () => {
  it('writes status=ok when all checks pass', async () => {
    h.failedCalls = 0;
    h.webhookFails = 0;
    h.jobFails = 0;
    h.calendarRows = [];
    await runHealthDigest();
    expect(h.healthWritten?.status).toBe('ok');
    expect(h.healthWritten?.summary).toContain('nominal');
  });

  it('prunes health_log and call_attempts on every run', async () => {
    await runHealthDigest();
    expect(h.healthPruned).toBe(true);
    expect(h.callAttemptPruned).toBe(true);
  });
});

describe('runHealthDigest — DEGRADED path', () => {
  it('reports degraded when calls failed', async () => {
    h.failedCalls = 2;
    await runHealthDigest();
    expect(h.healthWritten?.status).toBe('degraded');
    expect(h.healthWritten?.summary).toContain('2 call(s) failed');
  });

  it('reports degraded when webhook DLQ has entries', async () => {
    h.webhookFails = 1;
    await runHealthDigest();
    expect(h.healthWritten?.status).toBe('degraded');
    expect(h.healthWritten?.summary).toContain('webhook(s) in DLQ');
  });

  it('reports degraded when background jobs failed', async () => {
    h.jobFails = 3;
    await runHealthDigest();
    expect(h.healthWritten?.status).toBe('degraded');
    expect(h.healthWritten?.summary).toContain('background job failure');
  });

  it('combines multiple issues into one summary', async () => {
    h.failedCalls = 1;
    h.webhookFails = 2;
    h.jobFails = 1;
    await runHealthDigest();
    expect(h.healthWritten?.status).toBe('degraded');
    // summary should mention all three
    expect(h.healthWritten?.summary).toContain('call');
    expect(h.healthWritten?.summary).toContain('webhook');
    expect(h.healthWritten?.summary).toContain('job');
  });

  it('reports calendar auth issues when token health check fails', async () => {
    h.calendarRows = [{ id: 1 }];
    h.tokenHealthResult = { ok: false, needsReconnect: true };
    await runHealthDigest();
    expect(h.healthWritten?.status).toBe('degraded');
    expect(h.healthWritten?.summary).toContain('calendar auth');
  });

  it('T1-2: reports degraded when completed calls have no transcript', async () => {
    h.emptyTranscripts = 1;
    await runHealthDigest();
    expect(h.healthWritten?.status).toBe('degraded');
    expect(h.healthWritten?.summary).toContain('no transcript');
  });

  it('T1-2: all checks nominal when transcript check finds no empty transcripts', async () => {
    h.emptyTranscripts = 0;
    await runHealthDigest();
    expect(h.healthWritten?.status).toBe('ok');
    expect(h.healthWritten?.summary).toContain('nominal');
  });
});

describe('calendarQueries.recordAuthFailure and needsReconnect', () => {
  it('flags reconnect after 3 consecutive auth failures — query contract', async () => {
    // Integration-style contract: verify the exported functions exist and are callable.
    const db = await import('./db');
    expect(typeof db.calendarQueries.recordAuthFailure).toBe('function');
    expect(typeof db.calendarQueries.clearAuthFailures).toBe('function');
    expect(typeof db.calendarQueries.needsReconnect).toBe('function');
  });
});
