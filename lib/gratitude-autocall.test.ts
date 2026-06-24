/**
 * R19 T2 — gratitude auto-call must not re-fire every 10 min after a missed/hung-up call.
 *
 * runGratitudeAutoCall self-gates on gratitudeQueries.getByDate(user, today). Previously the
 * gate only became true once the user actually completed the call (recordGratitude wrote a row),
 * so a call that connected and hung up before the user spoke left no row → the job re-called
 * every tick all morning. Fix: reserve a null-item row BEFORE placing the call.
 *
 * Real DB (in-memory). `./scheduler` and `./whoop` are mocked so we can count calls and feed a
 * recovery score without external I/O. Time helpers run for real with an injected `now`.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

process.env.DB_PATH = ':memory:';

const h = vi.hoisted(() => ({ scheduleCalls: [] as number[], scheduleThrows: false }));

vi.mock('./scheduler', () => ({
  scheduleOpenCall: async (userId: number) => {
    h.scheduleCalls.push(userId);
    if (h.scheduleThrows) throw new Error('call failed / hung up');
  },
}));
// Recovery score is "in" for today so the morning gate passes.
vi.mock('./whoop', () => ({ getLatestRecovery: async () => ({ date: TODAY, recoveryScore: 60 }) }));

const { getDb, gratitudeQueries } = await import('./db');
const { todayInTz } = await import('./time');
const { runGratitudeAutoCall } = await import('./proactiveNotifications');

// A morning-window instant (08:00 UTC → hour 8, inside [5,11)). TODAY is that date in UTC.
const NOW = new Date('2026-06-23T08:00:00Z');
const TODAY = todayInTz('UTC', NOW);

afterAll(() => { delete process.env.DB_PATH; });

function makeGratitudeUser(id: number): void {
  getDb().prepare(
    "INSERT INTO users (id, email, name, password_hash, onboarding_complete, timezone, gratitude_mode) VALUES (?, ?, 'Derrick', 'x', 1, 'UTC', 1)",
  ).run(id, `g${id}@e.com`);
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['gratitude_entries', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  h.scheduleCalls = [];
  h.scheduleThrows = false;
});

describe('R19 T2 — gratitude auto-call re-fire guard', () => {
  it('first tick fires the call AND reserves a null-item row; the next tick skips', async () => {
    makeGratitudeUser(1);
    await runGratitudeAutoCall(NOW);
    expect(h.scheduleCalls).toEqual([1]);
    const reserved = gratitudeQueries.getByDate(1, TODAY);
    expect(reserved).toBeTruthy();
    expect(reserved?.item_1).toBeNull();

    // Second tick later the same morning — gate is now satisfied, no second call.
    await runGratitudeAutoCall(new Date('2026-06-23T08:10:00Z'));
    expect(h.scheduleCalls).toEqual([1]); // still just the one
  });

  it('does not re-call even if scheduleOpenCall throws (call failed / hung up)', async () => {
    makeGratitudeUser(1);
    h.scheduleThrows = true;
    await runGratitudeAutoCall(NOW);                       // throws inside, but row already reserved
    await runGratitudeAutoCall(new Date('2026-06-23T08:10:00Z'));
    expect(h.scheduleCalls).toEqual([1]);                 // reserved row blocks the retry
  });

  it('getByDate returns the real-items row once recordGratitude writes it (latest row wins)', async () => {
    makeGratitudeUser(1);
    await runGratitudeAutoCall(NOW);                       // reserves null row
    // Simulate a successful call: recordGratitude inserts the real items as a second row.
    gratitudeQueries.create(1, TODAY, 'family', 'health', 'work');
    const latest = gratitudeQueries.getByDate(1, TODAY);
    expect(latest?.item_1).toBe('family');
    expect(latest?.item_3).toBe('work');
  });

  it('no recovery / out-of-window users are untouched (first-call behavior preserved)', async () => {
    makeGratitudeUser(1);
    // 02:00 UTC is outside the 5–11 morning window → no call, no reservation.
    await runGratitudeAutoCall(new Date('2026-06-23T02:00:00Z'));
    expect(h.scheduleCalls).toEqual([]);
    expect(gratitudeQueries.getByDate(1, TODAY)).toBeUndefined();
  });
});
