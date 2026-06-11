/**
 * Tests for scheduler catch-up window (#scheduler-resilience).
 *
 * The fix replaces an exact-minute match with a 120-minute grace window so a
 * missed tick (server restart) fires a few minutes late instead of never.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── mocks ─────────────────────────────────────────────────────────────────────

const MOCK_USER = {
  id: 1, name: 'Derrick', phone_number: '+15550001234',
  call_time: '07:00', timezone: 'America/New_York', onboarding_complete: 1,
};

const h = vi.hoisted(() => ({
  prepareAll: vi.fn<() => unknown[]>(() => []),
  prepareGet: vi.fn<() => unknown>(() => undefined),
  findById: vi.fn<() => unknown>(() => ({
    id: 1, name: 'Derrick', phone_number: '+15550001234',
    call_time: '07:00', timezone: 'America/New_York', onboarding_complete: 1,
  })),
}));

// Suppress node-cron so startScheduler() doesn't start a real cron loop.
vi.mock('node-cron', () => ({ default: { schedule: vi.fn() } }));

vi.mock('./db', () => ({
  getDb: () => ({
    prepare: (sql: string) => {
      if (sql.includes('SELECT * FROM users')) return { all: h.prepareAll };
      return { get: h.prepareGet }; // alreadyCalled check
    },
  }),
  briefingQueries: { create: vi.fn(() => ({ lastInsertRowid: 1 })), update: vi.fn() },
  userQueries: { findById: h.findById },
  priorityQueries: { getThisWeek: vi.fn(() => []), getMostRecent: vi.fn(() => []) },
  memoryQueries: { getRecent: vi.fn(() => []) },
  effectiveTimezone: (u: { timezone?: string }) => u.timezone ?? 'America/Vancouver',
}));

vi.mock('./vapi', () => ({ initiateCall: vi.fn(async () => ({ id: 'call_123' })) }));
vi.mock('./briefing', () => ({
  generateDailyBriefing: vi.fn(async () => 'Test briefing content'),
  getWeekOf: vi.fn(() => '2026-06-09'),
}));

import { checkAndInitiateCalls } from './scheduler';

// ── fixture helpers ───────────────────────────────────────────────────────────

/** Build a UTC Date whose wall-clock time in America/New_York is hh:mm. */
function nyTime(dateStr: string, hh: number, mm: number): Date {
  // America/New_York is UTC-4 in summer (EDT).
  // We construct the UTC equivalent so toLocaleString in the scheduler sees hh:mm ET.
  const utcHour = hh + 4; // EDT offset
  return new Date(`${dateStr}T${String(utcHour).padStart(2, '0')}:${String(mm).padStart(2, '0')}:00.000Z`);
}

beforeEach(() => {
  vi.resetAllMocks();
  // Default: user list returns MOCK_USER; no prior call today.
  h.prepareAll.mockReturnValue([MOCK_USER]);
  h.prepareGet.mockReturnValue(undefined); // not called yet today
});

// ── tests ─────────────────────────────────────────────────────────────────────

describe('scheduler catch-up window', () => {
  it('fires exactly at call_time', async () => {
    const { briefingQueries } = await import('./db');
    const now = nyTime('2026-06-11', 7, 0); // exactly 07:00 ET
    await checkAndInitiateCalls(now);
    expect(briefingQueries.create).toHaveBeenCalledTimes(1);
  });

  it('fires a few minutes after call_time (missed-tick catch-up)', async () => {
    const { briefingQueries } = await import('./db');
    const now = nyTime('2026-06-11', 7, 5); // 07:05 ET — restart window
    await checkAndInitiateCalls(now);
    expect(briefingQueries.create).toHaveBeenCalledTimes(1);
  });

  it('does NOT fire before call_time', async () => {
    const { briefingQueries } = await import('./db');
    const now = nyTime('2026-06-11', 6, 59); // 06:59 ET
    await checkAndInitiateCalls(now);
    expect(briefingQueries.create).not.toHaveBeenCalled();
  });

  it('does NOT fire past the 120-minute grace window', async () => {
    const { briefingQueries } = await import('./db');
    const now = nyTime('2026-06-11', 9, 0); // 09:00 ET — 120 min after 07:00
    await checkAndInitiateCalls(now);
    expect(briefingQueries.create).not.toHaveBeenCalled();
  });

  it('does NOT double-fire when already called today', async () => {
    const { briefingQueries } = await import('./db');
    h.prepareGet.mockReturnValue({ 1: 1 }); // simulate alreadyCalled row
    const now = nyTime('2026-06-11', 7, 3); // within window
    await checkAndInitiateCalls(now);
    expect(briefingQueries.create).not.toHaveBeenCalled();
  });

  it('multiple ticks within the window still fire only once', async () => {
    const { briefingQueries } = await import('./db');

    // First tick at 07:01 — no prior call.
    h.prepareGet.mockReturnValueOnce(undefined);
    await checkAndInitiateCalls(nyTime('2026-06-11', 7, 1));

    // Second tick at 07:02 — alreadyCalled returns a row now.
    h.prepareGet.mockReturnValueOnce({ 1: 1 });
    await checkAndInitiateCalls(nyTime('2026-06-11', 7, 2));

    expect(briefingQueries.create).toHaveBeenCalledTimes(1);
  });

  it('fires at the last minute of the grace window (07:00 + 119 min = 08:59)', async () => {
    const { briefingQueries } = await import('./db');
    const now = nyTime('2026-06-11', 8, 59); // 08:59 ET — last minute in window
    await checkAndInitiateCalls(now);
    expect(briefingQueries.create).toHaveBeenCalledTimes(1);
  });
});
