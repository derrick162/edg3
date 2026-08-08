/**
 * R19 T4 — the once-a-day guard must ignore completed OPEN/gratitude calls.
 *
 * findTodaysBlockingBriefing decides whether a morning briefing should be suppressed because a
 * call already happened today. A completed gratitude call (is_open_call = 1) writes a completed
 * briefings row for today, but it must NOT block the morning briefing — that bug silently
 * suppressed Derrick's briefing on 2026-06-24. Tested against a real in-memory DB so the actual
 * SQL (not a mock) is exercised.
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';

process.env.DB_PATH = ':memory:';

const { getDb, findTodaysBlockingBriefing } = await import('./scheduler').then(async (m) => ({
  findTodaysBlockingBriefing: m.findTodaysBlockingBriefing,
  getDb: (await import('./db')).getDb,
}));

const TODAY = '2026-06-24';
// Cutoffs in the past so a fresh 'calling'/'pending' row (scheduled_for >= cutoff) would block.
const PAST = '2000-01-01T00:00:00.000Z';

afterAll(() => { delete process.env.DB_PATH; });

function seed(opts: { status: string; isOpenCall: number | null; errorCode?: string | null; at?: string }): void {
  getDb().prepare(
    'INSERT INTO briefings (user_id, content, status, scheduled_for, is_open_call, error_code) VALUES (1, ?, ?, ?, ?, ?)',
  ).run('brief', opts.status, `${opts.at ?? `${TODAY}T07:00:00`}`, opts.isOpenCall, opts.errorCode ?? null);
}

function makeUser(): void {
  getDb().prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
}

function block() {
  return findTodaysBlockingBriefing(getDb(), 1, TODAY, PAST, PAST);
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['briefings', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  makeUser();
});

describe('R19 T4 — findTodaysBlockingBriefing open-call filter', () => {
  it('completed OPEN call (is_open_call=1) today does NOT block the morning briefing', () => {
    seed({ status: 'completed', isOpenCall: 1 });
    expect(block()).toBeUndefined();
  });

  it('completed morning briefing (is_open_call=0) today DOES block (unchanged)', () => {
    seed({ status: 'completed', isOpenCall: 0 });
    expect(block()).toMatchObject({ status: 'completed' });
  });

  it('legacy NULL is_open_call is treated as a morning briefing → still blocks (conservative)', () => {
    seed({ status: 'completed', isOpenCall: null });
    expect(block()).toMatchObject({ status: 'completed' });
  });

  it('open call completed AND no morning briefing → slot is free (briefing will fire)', () => {
    seed({ status: 'completed', isOpenCall: 1 });
    seed({ status: 'completed', isOpenCall: 1, at: `${TODAY}T06:30:00` });
    expect(block()).toBeUndefined();
  });

  it('open call completed + a real morning briefing also present → blocks on the morning row', () => {
    seed({ status: 'completed', isOpenCall: 1 });
    seed({ status: 'completed', isOpenCall: 0 });
    expect(block()).toMatchObject({ status: 'completed' });
  });

  it('vapi_daily_limit failure on a morning row blocks; on an open-call row does not', () => {
    seed({ status: 'failed', isOpenCall: 1, errorCode: 'vapi_daily_limit' });
    expect(block()).toBeUndefined();
    seed({ status: 'failed', isOpenCall: 0, errorCode: 'vapi_daily_limit' });
    expect(block()).toMatchObject({ status: 'failed', error_code: 'vapi_daily_limit' });
  });
});

// 2026-08-08 INCIDENT GUARD — 'missed' rows never blocked the sweep, so instant pipeline
// failures (ElevenLabs voice down) machine-gunned Derrick every minute of his call window.
// After MAX_DAILY_BRIEFING_ATTEMPTS morning rows in a day, the sweep is blocked no matter
// what status the rows have.
describe('daily attempt cap (2026-08-08 robocall incident guard)', () => {
  it('two missed morning rows do NOT block (statuses themselves are non-blocking)', () => {
    seed({ status: 'missed', isOpenCall: 0 });
    seed({ status: 'missed', isOpenCall: 0, at: `${TODAY}T07:01:00` });
    expect(block()).toBeUndefined();
  });

  it('three missed morning rows hit the cap and block with attempt_cap', () => {
    seed({ status: 'missed', isOpenCall: 0 });
    seed({ status: 'missed', isOpenCall: 0, at: `${TODAY}T07:01:00` });
    seed({ status: 'missed', isOpenCall: 0, at: `${TODAY}T07:02:00` });
    expect(block()).toMatchObject({ status: 'attempt_cap' });
  });

  it('mixed missed/failed rows count toward the cap regardless of status', () => {
    seed({ status: 'missed', isOpenCall: 0 });
    seed({ status: 'failed', isOpenCall: 0, at: `${TODAY}T07:01:00` });
    seed({ status: 'missed', isOpenCall: null, at: `${TODAY}T07:02:00` });
    expect(block()).toMatchObject({ status: 'attempt_cap' });
  });

  it('open-call rows do NOT count toward the cap', () => {
    seed({ status: 'completed', isOpenCall: 1 });
    seed({ status: 'completed', isOpenCall: 1, at: `${TODAY}T06:30:00` });
    seed({ status: 'missed', isOpenCall: 0, at: `${TODAY}T07:00:00` });
    expect(block()).toBeUndefined();
  });

  it("yesterday's rows do NOT count toward today's cap", () => {
    seed({ status: 'missed', isOpenCall: 0, at: '2026-06-23T07:00:00' });
    seed({ status: 'missed', isOpenCall: 0, at: '2026-06-23T07:05:00' });
    seed({ status: 'missed', isOpenCall: 0, at: '2026-06-23T07:10:00' });
    expect(block()).toBeUndefined();
  });
});
