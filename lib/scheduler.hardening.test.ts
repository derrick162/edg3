/**
 * Tests for the DB-flagged retry pickup in checkAndInitiateCalls.
 *
 * The old approach used an in-memory setTimeout(10min) — a server restart during
 * that window would silently drop the retry. The new approach stamps retry_after
 * in the DB (via scheduleRetry in the webhook) and checkAndInitiateCalls picks it
 * up on the next minute-cron tick after the timestamp passes.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hoisted mocks ─────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 1, name: 'Derrick', phone_number: '+15550001234',
  call_time: '07:00', timezone: 'America/New_York', onboarding_complete: 1,
};

// We need to intercept multiple SQL patterns from db.prepare:
// 1. SELECT * FROM users             → usersAll
// 2. SELECT 1 FROM briefings (daily alreadyCalled check) → alreadyCalled
// 3. SELECT id, user_id FROM briefings WHERE status='missed' ... (retry pickup) → retryRows
// 4. UPDATE briefings SET retry_after = NULL ... → retryUpdate
const h = vi.hoisted(() => ({
  usersAll:             vi.fn<() => unknown[]>(() => []),
  alreadyCalled:        vi.fn<() => unknown>(() => undefined),
  retryRows:            vi.fn<() => unknown[]>(() => []),
  retryUpdate:          vi.fn(),
  briefingCreatePending: vi.fn(() => ({ lastInsertRowid: 99 })),
  briefingUpdateContent: vi.fn(),
  briefingUpdate:        vi.fn(),
  findById:              vi.fn(() => MOCK_USER),
  initiateCall:          vi.fn(async () => ({ id: 'call_retry_123' })),
  generateDailyBriefing: vi.fn(async () => 'Retry briefing content'),
  fetchMock:             vi.fn<() => Promise<{ ok: boolean; status: number }>>(() => Promise.resolve({ ok: true, status: 200 })),
}));

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

vi.mock('./db', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      if (sql.includes('SELECT * FROM users'))             return { all: h.usersAll };
      if (sql.includes('retry_after IS NOT NULL'))         return { all: h.retryRows };
      if (sql.includes('SET retry_after = NULL'))          return { run: h.retryUpdate };
      // alreadyCalled check — the SELECT 1 FROM briefings guard
      return { get: h.alreadyCalled };
    },
  }),
  briefingQueries: {
    create:          vi.fn(),
    createPending:   h.briefingCreatePending,
    updateContent:   h.briefingUpdateContent,
    update:          h.briefingUpdate,
    countCompleted:  vi.fn(() => 0),
  },
  userQueries:      { findById: h.findById },
  priorityQueries:  { getThisWeek: vi.fn(() => []), getMostRecent: vi.fn(() => []) },
  factQueries:      { getByCategory: vi.fn(() => []) },
  memoryQueries:    { getRecent: vi.fn(() => []) },
  failedWebhookQueries: { record: vi.fn(), recentCount: vi.fn(() => 0), prune: vi.fn() },
  backgroundJobFailureQueries: { record: vi.fn(), recentCount: vi.fn(() => 0), prune: vi.fn() },
  healthLogQueries: { write: vi.fn(), prune: vi.fn(), getLatest: vi.fn() },
  callAttemptQueries: { record: vi.fn(), failedCount: vi.fn(() => 0), getRecent: vi.fn(() => []), prune: vi.fn() },
  calendarQueries: { get: vi.fn(), recordAuthFailure: vi.fn(), clearAuthFailures: vi.fn(), needsReconnect: vi.fn(() => false) },
  notificationQueries: { create: vi.fn() },
  webhookDedupeQueries: { claim: vi.fn(() => true), prune: vi.fn() },
  toolCallDedupeQueries: { claim: vi.fn(() => true), recordResult: vi.fn(), getCached: vi.fn(() => null), prune: vi.fn() },
  briefingContextPackQueries: { upsert: vi.fn(), prune: vi.fn() },
  episodeQueries: { pruneAll: vi.fn() },
  openLoopQueries: { prune: vi.fn() },
  watchedThreadQueries: { prune: vi.fn() },
  oauthStateQueries: { prune: vi.fn() },
  auditLogQueries: { pruneEmailSubjects: vi.fn() },
  effectiveTimezone: (u: { timezone?: string }) => u.timezone ?? 'America/Vancouver',
}));

vi.mock('./backup', () => ({ maybeDailyBackup: vi.fn().mockResolvedValue(undefined) }));
vi.mock('./vapi',   () => ({ initiateCall: h.initiateCall }));

// Stub global fetch so pingVapiHealth returns true (healthy) by default in all tests.
vi.stubGlobal('fetch', h.fetchMock);
vi.mock('./briefing', () => ({
  generateDailyBriefing: h.generateDailyBriefing,
  getWeekOf: vi.fn(() => '2026-06-17'),
}));

// ── import after mocks ────────────────────────────────────────────────────────

import { checkAndInitiateCalls } from './scheduler';

// ── helpers ───────────────────────────────────────────────────────────────────

/** UTC Date that lands outside any user's call-time window (2am EDT = 6am UTC). */
function idleTime(): Date {
  return new Date('2026-06-17T06:00:00.000Z');
}

// ── tests ─────────────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.resetAllMocks();
  // Defaults: no users in the per-call-time loop; no pending retries.
  h.usersAll.mockReturnValue([]);
  h.alreadyCalled.mockReturnValue(undefined);
  h.retryRows.mockReturnValue([]);
  h.briefingCreatePending.mockReturnValue({ lastInsertRowid: 99 });
  h.initiateCall.mockResolvedValue({ id: 'call_retry_123' });
  h.generateDailyBriefing.mockResolvedValue('Retry briefing content');
  h.findById.mockReturnValue(MOCK_USER);
  h.fetchMock.mockResolvedValue({ ok: true, status: 200 });
  process.env.VAPI_API_KEY = 'test-key';
});

afterEach(() => { delete process.env.VAPI_API_KEY; });

describe('DB-flagged retry pickup', () => {
  it('calls scheduleBriefingCall when a pending retry row exists', async () => {
    h.retryRows.mockReturnValue([{ id: 42, user_id: 1 }]);
    await checkAndInitiateCalls(idleTime());
    // scheduleBriefingCall internally calls findById + createPending + generateDailyBriefing + initiateCall
    expect(h.initiateCall).toHaveBeenCalledOnce();
  });

  it('clears retry_after (runs the UPDATE) before firing the call', async () => {
    h.retryRows.mockReturnValue([{ id: 42, user_id: 1 }]);
    await checkAndInitiateCalls(idleTime());
    expect(h.retryUpdate).toHaveBeenCalledWith(42);
  });

  it('does NOT fire when there are no pending retry rows', async () => {
    h.retryRows.mockReturnValue([]);
    await checkAndInitiateCalls(idleTime());
    expect(h.initiateCall).not.toHaveBeenCalled();
    expect(h.retryUpdate).not.toHaveBeenCalled();
  });

  it('fires multiple retries for different users', async () => {
    h.retryRows.mockReturnValue([
      { id: 10, user_id: 1 },
      { id: 11, user_id: 2 },
    ]);
    await checkAndInitiateCalls(idleTime());
    expect(h.initiateCall).toHaveBeenCalledTimes(2);
    expect(h.retryUpdate).toHaveBeenCalledTimes(2);
  });

  it('does not throw when scheduleBriefingCall fails — continues processing other retries', async () => {
    h.retryRows.mockReturnValue([
      { id: 10, user_id: 1 },
      { id: 11, user_id: 2 },
    ]);
    // First retry fails; second should still run.
    h.initiateCall
      .mockRejectedValueOnce(new Error('Vapi timeout'))
      .mockResolvedValueOnce({ id: 'call_ok' });
    await expect(checkAndInitiateCalls(idleTime())).resolves.toBeUndefined();
    expect(h.retryUpdate).toHaveBeenCalledWith(10); // cleared before the failed call
    expect(h.retryUpdate).toHaveBeenCalledWith(11);
  });
});
