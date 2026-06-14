/**
 * Tests for scheduler resilience:
 * 1. 120-minute catch-up window so a missed exact-minute tick fires late, not never.
 * 2. CallError classification — Vapi and briefing failures surface with a user-facing
 *    reason code instead of an opaque 500.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── hoisted mocks (survive vi.resetAllMocks) ──────────────────────────────────

const MOCK_USER = {
  id: 1, name: 'Derrick', phone_number: '+15550001234',
  call_time: '07:00', timezone: 'America/New_York', onboarding_complete: 1,
};

const h = vi.hoisted(() => ({
  prepareAll:           vi.fn<() => unknown[]>(() => []),
  prepareGet:           vi.fn<() => unknown>(() => undefined),
  findById:             vi.fn<() => unknown>(() => MOCK_USER),
  initiateCall:         vi.fn(async () => ({ id: 'call_123' })),
  generateDailyBriefing: vi.fn(async () => 'Test briefing content'),
  briefingCreate:       vi.fn(() => ({ lastInsertRowid: 1 })),
  briefingUpdate:       vi.fn(),
}));

// ── module mocks ──────────────────────────────────────────────────────────────

vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

vi.mock('./db', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      if (sql.includes('SELECT * FROM users')) return { all: h.prepareAll };
      return { get: h.prepareGet };
    },
  }),
  briefingQueries: { create: h.briefingCreate, update: h.briefingUpdate },
  userQueries: { findById: h.findById },
  priorityQueries: { getThisWeek: vi.fn(() => []), getMostRecent: vi.fn(() => []) },
  factQueries: { getByCategory: vi.fn(() => []) },
  memoryQueries: { getRecent: vi.fn(() => []) },
  effectiveTimezone: (u: { timezone?: string }) => u.timezone ?? 'America/Vancouver',
}));

vi.mock('./vapi', () => ({ initiateCall: h.initiateCall }));
vi.mock('./briefing', () => ({
  generateDailyBriefing: h.generateDailyBriefing,
  getWeekOf: vi.fn(() => '2026-06-09'),
}));

// ── imports (after mock setup) ────────────────────────────────────────────────

import { checkAndInitiateCalls, scheduleBriefingCall, scheduleOpenCall, triggerBriefingCallNow, CallError } from './scheduler';
import { factQueries } from './db';

// ── helpers ───────────────────────────────────────────────────────────────────

/** Build a UTC Date whose wall-clock time in America/New_York (EDT = UTC-4) is hh:mm. */
function nyTime(dateStr: string, hh: number, mm: number): Date {
  const utcHour = hh + 4;
  return new Date(`${dateStr}T${String(utcHour).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`);
}

// ── global beforeEach: reset all mocks then restore defaults ──────────────────

beforeEach(() => {
  vi.resetAllMocks();
  // Restore defaults after reset clears implementations.
  h.prepareAll.mockReturnValue([MOCK_USER]);
  h.prepareGet.mockReturnValue(undefined);
  h.findById.mockReturnValue(MOCK_USER);
  h.initiateCall.mockResolvedValue({ id: 'call_123' });
  h.generateDailyBriefing.mockResolvedValue('Test briefing content');
  h.briefingCreate.mockReturnValue({ lastInsertRowid: 1 });
});

// ── 1. catch-up window ────────────────────────────────────────────────────────

describe('scheduler catch-up window', () => {
  it('fires exactly at call_time', async () => {
    await checkAndInitiateCalls(nyTime('2026-06-11', 7, 0));
    expect(h.briefingCreate).toHaveBeenCalledTimes(1);
  });

  it('fires a few minutes after call_time (missed-tick catch-up)', async () => {
    await checkAndInitiateCalls(nyTime('2026-06-11', 7, 5));
    expect(h.briefingCreate).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire before call_time', async () => {
    await checkAndInitiateCalls(nyTime('2026-06-11', 6, 59));
    expect(h.briefingCreate).not.toHaveBeenCalled();
  });

  it('does NOT fire past the 120-minute grace window', async () => {
    await checkAndInitiateCalls(nyTime('2026-06-11', 9, 0)); // 09:00 = call_time + 120 min
    expect(h.briefingCreate).not.toHaveBeenCalled();
  });

  it('does NOT double-fire when already called today', async () => {
    h.prepareGet.mockReturnValue({ 1: 1 }); // simulate alreadyCalled row
    await checkAndInitiateCalls(nyTime('2026-06-11', 7, 3));
    expect(h.briefingCreate).not.toHaveBeenCalled();
  });

  it('multiple ticks within the window still fire only once', async () => {
    h.prepareGet.mockReturnValueOnce(undefined);        // tick 1: not yet called
    await checkAndInitiateCalls(nyTime('2026-06-11', 7, 1));

    h.prepareGet.mockReturnValueOnce({ 1: 1 });         // tick 2: already called
    await checkAndInitiateCalls(nyTime('2026-06-11', 7, 2));

    expect(h.briefingCreate).toHaveBeenCalledTimes(1);
  });

  it('fires at the last minute of the grace window (07:00 + 119 min = 08:59)', async () => {
    await checkAndInitiateCalls(nyTime('2026-06-11', 8, 59));
    expect(h.briefingCreate).toHaveBeenCalledTimes(1);
  });
});

// ── 2. CallError classification ───────────────────────────────────────────────

describe('scheduleBriefingCall — Vapi error surfacing', () => {
  beforeEach(() => {
    // VAPI_API_KEY must be set so the initiateCall block runs.
    process.env.VAPI_API_KEY = 'test-key';
  });
  afterEach(() => {
    delete process.env.VAPI_API_KEY;
  });

  it('throws CallError(vapi_daily_limit) when Vapi rejects with the daily-limit error', async () => {
    h.initiateCall.mockRejectedValueOnce(new Error('vapi-number-outbound-daily-limit exceeded'));
    await expect(scheduleBriefingCall(1)).rejects.toMatchObject({ code: 'vapi_daily_limit' });
  });

  it('throws CallError(vapi_error) for an unrecognised Vapi failure', async () => {
    h.initiateCall.mockRejectedValueOnce(new Error('connection timeout'));
    await expect(scheduleBriefingCall(1)).rejects.toMatchObject({ code: 'vapi_error' });
  });

  it('sets briefing status to failed when Vapi rejects', async () => {
    h.initiateCall.mockRejectedValueOnce(new Error('timeout'));
    await expect(scheduleBriefingCall(1)).rejects.toBeInstanceOf(CallError);
    expect(h.briefingUpdate).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ status: 'failed' }));
  });
});

describe('scheduleBriefingCall — briefing generation failure', () => {
  it('throws CallError(briefing_gen_failed) when generateDailyBriefing throws', async () => {
    h.generateDailyBriefing.mockRejectedValueOnce(new Error('Anthropic API timeout'));
    await expect(scheduleBriefingCall(1)).rejects.toMatchObject({ code: 'briefing_gen_failed' });
  });
});

describe('scheduleOpenCall — Vapi error surfacing', () => {
  beforeEach(() => { process.env.VAPI_API_KEY = 'test-key'; });
  afterEach(() => { delete process.env.VAPI_API_KEY; });

  it('throws CallError(vapi_daily_limit) when Vapi rejects with the daily-limit error', async () => {
    h.initiateCall.mockRejectedValueOnce(new Error('outbound-daily-limit reached'));
    await expect(scheduleOpenCall(1)).rejects.toMatchObject({ code: 'vapi_daily_limit' });
  });

  it('sets briefing status to failed when Vapi rejects on open call', async () => {
    h.initiateCall.mockRejectedValueOnce(new Error('network error'));
    await expect(scheduleOpenCall(1)).rejects.toBeInstanceOf(CallError);
    expect(h.briefingUpdate).toHaveBeenCalledWith(expect.any(Number), expect.objectContaining({ status: 'failed' }));
  });
});

describe('CallError', () => {
  it('is an instanceof Error (routes that catch Error still catch it)', () => {
    const e = new CallError('Daily cap hit', 'vapi_daily_limit');
    expect(e).toBeInstanceOf(Error);
    expect(e).toBeInstanceOf(CallError);
    expect(e.code).toBe('vapi_daily_limit');
    expect(e.userMessage).toBe('Daily cap hit');
  });
});

// ── preference injection ──────────────────────────────────────────────────────

describe('preference injection into initiateCall', () => {
  beforeEach(() => { process.env.VAPI_API_KEY = 'test-key'; });
  afterEach(() => { delete process.env.VAPI_API_KEY; });

  it('passes empty preferencesText when no preferences are stored', async () => {
    (factQueries.getByCategory as ReturnType<typeof vi.fn>).mockReturnValue([]);
    await scheduleBriefingCall(1);
    // 8th arg (index 7) = preferencesText (''); 9th arg (index 8) = whoopText ('' when Whoop not connected in tests)
    expect(h.initiateCall).toHaveBeenCalledWith(
      expect.any(String), expect.any(String), expect.any(String),
      expect.any(Boolean), expect.any(String), false, expect.any(String), '', '', expect.any(String),
    );
  });

  it('passes formatted preferences when stored preferences exist', async () => {
    (factQueries.getByCategory as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 1, user_id: 1, category: 'preference', statement: 'Prefers boutique gyms', entity: null, learned_at: '2026-06-13' },
      { id: 2, user_id: 1, category: 'preference', statement: 'No early meetings before 9am', entity: null, learned_at: '2026-06-13' },
    ]);
    await scheduleBriefingCall(1);
    const callArgs = (h.initiateCall as ReturnType<typeof vi.fn>).mock.calls[0];
    const preferencesArg = callArgs[7]; // 8th positional arg
    expect(preferencesArg).toContain('Prefers boutique gyms');
    expect(preferencesArg).toContain('No early meetings before 9am');
  });

  it('caps preferences at 10 entries in the injected text', async () => {
    const manyPrefs = Array.from({ length: 15 }, (_, i) => ({
      id: i + 1, user_id: 1, category: 'preference' as const,
      statement: `Preference ${i}`, entity: null, learned_at: '2026-06-13',
    }));
    (factQueries.getByCategory as ReturnType<typeof vi.fn>).mockReturnValue(manyPrefs);
    await scheduleBriefingCall(1);
    const callArgs = (h.initiateCall as ReturnType<typeof vi.fn>).mock.calls[0];
    const preferencesArg: string = callArgs[7];
    expect(preferencesArg.split('\n')).toHaveLength(10);
  });

  it('also injects preferences on open calls', async () => {
    (factQueries.getByCategory as ReturnType<typeof vi.fn>).mockReturnValue([
      { id: 1, user_id: 1, category: 'preference', statement: 'Vegetarian restaurants only', entity: null, learned_at: '2026-06-13' },
    ]);
    await scheduleOpenCall(1);
    const callArgs = (h.initiateCall as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(callArgs[7]).toContain('Vegetarian restaurants only');
  });
});

// ── 3. Idempotency guard in scheduleBriefingCall ─────────────────────────────

describe('scheduleBriefingCall — idempotency guard', () => {
  beforeEach(() => { process.env.VAPI_API_KEY = 'test-key'; });
  afterEach(() => { delete process.env.VAPI_API_KEY; });

  it('throws CallError(already_called) when a completed call exists today', async () => {
    // The mock's .get() returns a truthy row for the idempotency check.
    h.prepareGet.mockReturnValue({ status: 'completed' });
    await expect(scheduleBriefingCall(1)).rejects.toMatchObject({ code: 'already_called' });
    // Must NOT create a new briefing or call Vapi.
    expect(h.briefingCreate).not.toHaveBeenCalled();
    expect(h.initiateCall).not.toHaveBeenCalled();
  });

  it('throws CallError(already_called) when a call is in progress today', async () => {
    h.prepareGet.mockReturnValue({ status: 'calling' });
    await expect(scheduleBriefingCall(1)).rejects.toMatchObject({ code: 'already_called' });
    expect(h.briefingCreate).not.toHaveBeenCalled();
  });

  it('proceeds normally when no calling/completed call exists today', async () => {
    h.prepareGet.mockReturnValue(undefined); // default — no blocking row
    await expect(scheduleBriefingCall(1)).resolves.toBeTypeOf('number');
    expect(h.briefingCreate).toHaveBeenCalledTimes(1);
  });

  it('persists error_code in update when Vapi fails', async () => {
    h.prepareGet.mockReturnValue(undefined);
    h.initiateCall.mockRejectedValueOnce(new Error('outbound-daily-limit reached'));
    await expect(scheduleBriefingCall(1)).rejects.toMatchObject({ code: 'vapi_daily_limit' });
    expect(h.briefingUpdate).toHaveBeenCalledWith(
      expect.any(Number),
      expect.objectContaining({ status: 'failed', error_code: 'vapi_daily_limit' }),
    );
  });
});

// ── 4. triggerBriefingCallNow — safe re-trigger ───────────────────────────────

describe('triggerBriefingCallNow', () => {
  beforeEach(() => { process.env.VAPI_API_KEY = 'test-key'; });
  afterEach(() => { delete process.env.VAPI_API_KEY; });

  it('returns { ok: true, briefingId } on success', async () => {
    h.prepareGet.mockReturnValue(undefined);
    h.briefingCreate.mockReturnValue({ lastInsertRowid: 42 });
    const result = await triggerBriefingCallNow(1);
    expect(result).toEqual({ ok: true, briefingId: 42 });
  });

  it('returns { ok: false, code: already_called } when call already completed today', async () => {
    h.prepareGet.mockReturnValue({ status: 'completed' });
    const result = await triggerBriefingCallNow(1);
    expect(result).toMatchObject({ ok: false, code: 'already_called' });
    expect(h.initiateCall).not.toHaveBeenCalled();
  });

  it('returns { ok: false, code: vapi_daily_limit } when Vapi cap is hit', async () => {
    h.prepareGet.mockReturnValue(undefined);
    h.initiateCall.mockRejectedValueOnce(new Error('vapi-number-outbound-daily-limit exceeded'));
    const result = await triggerBriefingCallNow(1);
    expect(result).toMatchObject({ ok: false, code: 'vapi_daily_limit' });
  });

  it('returns { ok: false, code: unknown } for unexpected errors', async () => {
    h.prepareGet.mockReturnValue(undefined);
    h.generateDailyBriefing.mockRejectedValueOnce(new TypeError('network error'));
    // briefing_gen_failed is a CallError, so it should surface its code
    const result = await triggerBriefingCallNow(1);
    expect(result).toMatchObject({ ok: false, code: 'briefing_gen_failed' });
  });
});
