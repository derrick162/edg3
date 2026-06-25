/**
 * C1 — Calendar tool reliability test matrix.
 *
 * Complements mutation-errors.test.ts (which proves API-throw → ERR_* for the four mutating
 * tools). This file adds: happy paths per tool, the 404/410 "already gone" delete behavior
 * (C4), and the read-only / organizer guard paths — so every documented failure mode in
 * content/calendar-tool-audit.md has a regression test.
 *
 * Drives executeTool directly with mock calendar clients; real in-memory DB for dedupe/undo.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

process.env.DB_PATH = ':memory:';

vi.mock('@/lib/db', async () => await import('../../../../lib/db'));
vi.mock('@/lib/calendar', async () => await import('../../../../lib/calendar'));
vi.mock('@/lib/time', async () => await import('../../../../lib/time'));
vi.mock('@/lib/eventMatch', async () => await import('../../../../lib/eventMatch'));
vi.mock('@/lib/gmail', async () => await import('../../../../lib/gmail'));
vi.mock('@/lib/google-auth', async () => await import('../../../../lib/google-auth'));
vi.mock('@/lib/batchSchedule', async () => await import('../../../../lib/batchSchedule'));
vi.mock('@/lib/attendees', async () => await import('../../../../lib/attendees'));
vi.mock('@/lib/calendarQuery', async () => await import('../../../../lib/calendarQuery'));
vi.mock('@/lib/grounding', async () => await import('../../../../lib/grounding'));
vi.mock('@/lib/vapi', async () => await import('../../../../lib/vapi'));
vi.mock('@/lib/calendarScore', async () => await import('../../../../lib/calendarScore'));
vi.mock('@/lib/alignment', async () => await import('../../../../lib/alignment'));
vi.mock('@/lib/energy', async () => await import('../../../../lib/energy'));
vi.mock('@/lib/whoop', async () => await import('../../../../lib/whoop'));
vi.mock('@/lib/calendarPlan', async () => await import('../../../../lib/calendarPlan'));
vi.mock('@/lib/taskMatch', async () => await import('../../../../lib/taskMatch'));
vi.mock('@/lib/factForget', async () => await import('../../../../lib/factForget'));
vi.mock('@/lib/undo', async () => await import('../../../../lib/undo'));
vi.mock('@/lib/idempotency', async () => await import('../../../../lib/idempotency'));
vi.mock('@/lib/calendarWritable', async () => await import('../../../../lib/calendarWritable'));
vi.mock('@/lib/rateLimit', async () => await import('../../../../lib/rateLimit'));
vi.mock('@/lib/notifications', async () => await import('../../../../lib/notifications'));
vi.mock('@/lib/facts', async () => await import('../../../../lib/facts'));
vi.mock('@/lib/calendarToolErrors', async () => await import('../../../../lib/calendarToolErrors'));

const { getDb } = await import('../../../../lib/db');
const { executeTool } = await import('./route');

afterAll(() => { delete process.env.DB_PATH; });

const EVENT = {
  id: 'evt_1',
  summary: 'Dentist',
  start: { dateTime: '2026-06-25T14:00:00-04:00', timeZone: 'America/New_York' },
  end: { dateTime: '2026-06-25T15:00:00-04:00', timeZone: 'America/New_York' },
  organizer: { self: true },
};

// Build an error shaped like a googleapis GaxiosError with a given HTTP status.
const httpErr = (status: number, message = 'API error') => Object.assign(new Error(message), { code: status, response: { status } });

type CalOpts = {
  listItems?: unknown[];
  insert?: (...a: unknown[]) => Promise<unknown>;
  patch?: (...a: unknown[]) => Promise<unknown>;
  del?: (...a: unknown[]) => Promise<unknown>;
  get?: (...a: unknown[]) => Promise<unknown>;
};
function mockCal(opts: CalOpts = {}) {
  return {
    events: {
      list: async () => ({ data: { items: opts.listItems ?? [] } }),
      insert: opts.insert ?? (async () => ({ data: { id: 'new_1' } })),
      patch: opts.patch ?? (async () => ({ data: { id: 'evt_1' } })),
      delete: opts.del ?? (async () => ({ data: {} })),
      get: opts.get ?? (async () => ({ data: EVENT })),
    },
  } as never;
}

function ctx(cal: unknown, calMeta?: Map<string, { accessRole: string; summary: string }>) {
  return {
    cal,
    calIds: ['primary'],
    calMeta: calMeta ?? new Map([['primary', { accessRole: 'owner', summary: 'Primary' }]]),
    userId: 1,
    tz: 'America/New_York',
  } as Parameters<typeof executeTool>[2];
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  try { db.prepare('DELETE FROM users').run(); } catch { /* ignore */ }
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
});

// Walk a deleteEvent confirm-token handshake and return the final result.
async function deleteWithConfirm(cal: unknown, args: Record<string, unknown>, meta?: Map<string, { accessRole: string; summary: string }>) {
  const first = await executeTool('deleteEvent', args, ctx(cal, meta));
  const token = first.match(/confirmToken set to "([^"]+)"/)?.[1] ?? first.match(/confirmToken: "([^"]+)"/)?.[1];
  if (!token) return first; // didn't reach the confirm gate (read-only, no match, scope question)
  return executeTool('deleteEvent', { ...args, confirmToken: token }, ctx(cal, meta));
}

describe('C1 — createEvent', () => {
  it('happy path → confirmed, no ERROR', async () => {
    const res = await executeTool('createEvent', {
      title: 'Deep work', startDateTime: '2026-06-25T09:00:00', endDateTime: '2026-06-25T10:30:00',
      timezone: 'America/New_York', overrideConflicts: true,
    }, ctx(mockCal()));
    expect(res).not.toContain('ERROR');
    expect(res).toContain('Created and confirmed');
  });

  it('insert returns no id → ERR_CREATE (no false confirm)', async () => {
    const res = await executeTool('createEvent', {
      title: 'Ghost', startDateTime: '2026-06-25T09:00:00', endDateTime: '2026-06-25T10:00:00',
      timezone: 'America/New_York', overrideConflicts: true,
    }, ctx(mockCal({ insert: async () => ({ data: {} }) })));
    expect(res).toContain('ERROR: Event was NOT created');
  });

  it('C2 — confirmation is grounded in the calendar echo, not input args', async () => {
    // Google normalizes/echoes the saved event; the spoken time must reflect what was stored.
    const cal = mockCal({ insert: async () => ({ data: { id: 'new_1', start: { dateTime: '2026-06-26T09:15:00-04:00' } } }) });
    const res = await executeTool('createEvent', {
      title: 'Grounded block', startDateTime: '2026-06-26T09:00:00', endDateTime: '2026-06-26T10:30:00',
      timezone: 'America/New_York', overrideConflicts: true,
    }, ctx(cal));
    expect(res).toContain('at 09:15'); // echoed time, not the 09:00 request
  });

  it('C2 — primary calendar not writable → ERR_CREATE (no Google 403 leak)', async () => {
    const meta = new Map([['primary', { accessRole: 'reader', summary: 'Primary (read-only)' }]]);
    let inserted = false;
    const cal = mockCal({ insert: async () => { inserted = true; return { data: { id: 'x' } }; } });
    const res = await executeTool('createEvent', {
      title: 'X', startDateTime: '2026-06-25T09:00:00', endDateTime: '2026-06-25T10:00:00',
      timezone: 'America/New_York', overrideConflicts: true,
    }, ctx(cal, meta));
    expect(inserted).toBe(false);
    expect(res).toContain('ERROR: Event was NOT created');
  });

  it('conflict (no override) → warns, does not write', async () => {
    let inserted = false;
    const cal = mockCal({
      listItems: [{ ...EVENT, summary: 'Existing meeting' }],
      insert: async () => { inserted = true; return { data: { id: 'x' } }; },
    });
    const res = await executeTool('createEvent', {
      title: 'New thing', startDateTime: '2026-06-25T14:00:00', endDateTime: '2026-06-25T14:30:00',
      timezone: 'America/New_York',
    }, ctx(cal));
    expect(inserted).toBe(false);
    expect(res).not.toContain('Created and confirmed');
  });
});

describe('C1 — editEvent', () => {
  it('happy path → updated + confirmed', async () => {
    const res = await executeTool('editEvent', {
      title: 'Dentist', date: '2026-06-25', currentTime: '2pm', location: '123 Main St',
    }, ctx(mockCal({ listItems: [EVENT] })));
    expect(res).not.toContain('ERROR');
    expect(res).toContain('Updated and confirmed');
  });

  it('read-only calendar → honest refusal, no patch', async () => {
    const meta = new Map([['primary', { accessRole: 'reader', summary: 'Shared cal' }]]);
    const res = await executeTool('editEvent', {
      title: 'Dentist', date: '2026-06-25', currentTime: '2pm', location: 'X',
    }, ctx(mockCal({ listItems: [EVENT] }), meta));
    expect(res).toMatch(/read-only/i);
    expect(res).not.toContain('Updated and confirmed');
  });
});

describe('C1 — moveEvent', () => {
  it('happy path → moved + confirmed', async () => {
    const res = await executeTool('moveEvent', {
      title: 'Dentist', date: '2026-06-25', currentTime: '2pm',
      newStartDateTime: '2026-06-25T16:00:00', newEndDateTime: '2026-06-25T17:00:00', timezone: 'America/New_York',
    }, ctx(mockCal({ listItems: [EVENT] })));
    expect(res).not.toContain('ERROR');
    expect(res).toContain('Moved and confirmed');
  });

  it('C3 — confirmation echoes the patch result time, not the requested time', async () => {
    // Google echoes the stored event; the spoken confirmation must reflect that, not input args.
    const cal = mockCal({
      listItems: [EVENT],
      patch: async () => ({ data: { id: 'evt_1', start: { dateTime: '2026-06-25T16:30:00-04:00', timeZone: 'America/New_York' } } }),
    });
    const res = await executeTool('moveEvent', {
      title: 'Dentist', date: '2026-06-25', currentTime: '2pm',
      newStartDateTime: '2026-06-25T16:00:00', newEndDateTime: '2026-06-25T17:00:00', timezone: 'America/New_York',
    }, ctx(cal));
    expect(res).toContain('Moved and confirmed');
    expect(res).toContain('16:30'); // result time, not the requested 16:00
  });

  it('non-organizer event → honest refusal, no patch', async () => {
    const foreign = { ...EVENT, organizer: { email: 'faiza@cibc.com', displayName: 'Faiza' }, guestsCanModify: false };
    let patched = false;
    const cal = mockCal({ listItems: [foreign], patch: async () => { patched = true; return { data: { id: 'x' } }; } });
    const res = await executeTool('moveEvent', {
      title: 'Dentist', date: '2026-06-25', currentTime: '2pm',
      newStartDateTime: '2026-06-25T16:00:00', newEndDateTime: '2026-06-25T17:00:00', timezone: 'America/New_York',
    }, ctx(cal));
    expect(patched).toBe(false);
    expect(res).toMatch(/organizer/i);
    expect(res).not.toContain('Moved and confirmed');
  });

  it('recurring event without scope → asks before moving', async () => {
    const recurring = { ...EVENT, recurringEventId: 'series_1' };
    let patched = false;
    const cal = mockCal({ listItems: [recurring], patch: async () => { patched = true; return { data: { id: 'x' } }; } });
    const res = await executeTool('moveEvent', {
      title: 'Dentist', date: '2026-06-25', currentTime: '2pm',
      newStartDateTime: '2026-06-25T16:00:00', newEndDateTime: '2026-06-25T17:00:00', timezone: 'America/New_York',
    }, ctx(cal));
    expect(patched).toBe(false);
    expect(res).toMatch(/recurring/i);
  });
});

describe('C1/C4 — deleteEvent', () => {
  it('happy path → deleted', async () => {
    const res = await deleteWithConfirm(mockCal({ listItems: [EVENT] }), { title: 'Dentist', date: '2026-06-25', currentTime: '2pm' });
    expect(res).toContain('Deleted: Dentist');
    expect(res).not.toContain('ERROR');
  });

  it('no match → honest "no event"', async () => {
    const res = await deleteWithConfirm(mockCal({ listItems: [] }), { title: 'Nonexistent', date: '2026-06-25' });
    expect(res).toMatch(/No event matching/i);
  });

  it('404 already-deleted → "already removed", NOT a hard error', async () => {
    const cal = mockCal({ listItems: [EVENT], del: async () => { throw httpErr(404, 'Not Found'); } });
    const res = await deleteWithConfirm(cal, { title: 'Dentist', date: '2026-06-25', currentTime: '2pm' });
    expect(res).toMatch(/already removed/i);
    expect(res).not.toContain('ERROR: Event was NOT deleted');
    expect(res).not.toMatch(/still on your calendar/i);
  });

  it('410 Gone → treated as already removed', async () => {
    const cal = mockCal({ listItems: [EVENT], del: async () => { throw httpErr(410, 'Resource has been deleted'); } });
    const res = await deleteWithConfirm(cal, { title: 'Dentist', date: '2026-06-25', currentTime: '2pm' });
    expect(res).toMatch(/already removed/i);
    expect(res).not.toContain('ERROR: Event was NOT deleted');
  });

  it('real 500 failure → ERR_DELETE (still honest about failure)', async () => {
    const cal = mockCal({ listItems: [EVENT], del: async () => { throw httpErr(500, 'Backend Error'); } });
    const res = await deleteWithConfirm(cal, { title: 'Dentist', date: '2026-06-25', currentTime: '2pm' });
    expect(res).toContain('ERROR: Event was NOT deleted');
  });
});
