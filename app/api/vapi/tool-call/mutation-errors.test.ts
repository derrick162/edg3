/**
 * R21 T1 — the four mutating tool handlers must return explicit "ERROR:" strings on any Google
 * API failure, so the model can never read a failed call as success ("Done. Locked it in" for an
 * event that was never created). Drives executeTool directly with a mock calendar client whose
 * mutations throw; real in-memory DB for the dedupe/undo helpers.
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

process.env.DB_PATH = ':memory:';

// The route imports its deps via the `@/` alias, which vitest doesn't resolve — remap each to
// its real module (relative path) so executeTool runs against the real helpers + in-memory DB.
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

const { getDb } = await import('../../../../lib/db');
const { executeTool } = await import('./route');

afterAll(() => { delete process.env.DB_PATH; });

// A calendar event "on the day" so delete/move/edit resolve a target before the mutation throws.
const EVENT = {
  id: 'evt_1',
  summary: 'Dentist',
  start: { dateTime: '2026-06-25T14:00:00-04:00', timeZone: 'America/New_York' },
  end: { dateTime: '2026-06-25T15:00:00-04:00', timeZone: 'America/New_York' },
  organizer: { self: true },
};

// Reject asynchronously — googleapis returns a promise that rejects, which is what the handlers'
// `.catch(...)` is written against (a synchronous throw would model the client wrong).
const THROW = async () => { throw new Error('Google 500'); };

// Minimal calendar_v3.Calendar mock — list returns our event; all mutations throw.
function mockCal(opts: { listItems?: unknown[] } = {}) {
  const list = async () => ({ data: { items: opts.listItems ?? [] } });
  return {
    events: {
      list,
      insert: THROW,
      patch: THROW,
      delete: THROW,
      get: async () => ({ data: EVENT }),
    },
  } as never;
}

function ctx(cal: unknown) {
  return { cal, calIds: ['primary'], calMeta: new Map([['primary', { accessRole: 'owner', summary: 'Primary' }]]), userId: 1, tz: 'America/New_York' } as Parameters<typeof executeTool>[2];
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  try { db.prepare('DELETE FROM users').run(); } catch { /* ignore */ }
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
});

describe('R21 T1 — mutating handlers return ERROR strings on Google failure', () => {
  it('createEvent: insert throws → "ERROR: Event was NOT created"', async () => {
    const res = await executeTool('createEvent', {
      title: 'Strategy block', startDateTime: '2026-06-25T11:00:00', endDateTime: '2026-06-25T12:30:00',
      timezone: 'America/New_York', overrideConflicts: true,
    }, ctx(mockCal()));
    expect(res).toContain('ERROR: Event was NOT created');
  });

  it('editEvent: patch throws → "ERROR: Event was NOT updated"', async () => {
    const res = await executeTool('editEvent', {
      title: 'Dentist', date: '2026-06-25', currentTime: '2pm', location: '123 Main St',
    }, ctx(mockCal({ listItems: [EVENT] })));
    expect(res).toContain('ERROR: Event was NOT updated');
  });

  it('moveEvent: patch throws → "ERROR: Event was NOT moved"', async () => {
    const res = await executeTool('moveEvent', {
      title: 'Dentist', date: '2026-06-25', currentTime: '2pm',
      newStartDateTime: '2026-06-25T16:00:00', newEndDateTime: '2026-06-25T17:00:00', timezone: 'America/New_York',
    }, ctx(mockCal({ listItems: [EVENT] })));
    expect(res).toContain('ERROR: Event was NOT moved');
  });

  it('deleteEvent: delete throws → "ERROR: Event was NOT deleted" (after confirm-token handshake)', async () => {
    const cal = mockCal({ listItems: [EVENT] });
    // First call issues a confirmToken in the message; parse it and confirm.
    const first = await executeTool('deleteEvent', { title: 'Dentist', date: '2026-06-25', currentTime: '2pm' }, ctx(cal));
    const token = first.match(/confirmToken set to "([^"]+)"/)?.[1];
    expect(token).toBeTruthy();
    const res = await executeTool('deleteEvent', { title: 'Dentist', date: '2026-06-25', currentTime: '2pm', confirmToken: token }, ctx(cal));
    expect(res).toContain('ERROR: Event was NOT deleted');
  });

  it('success path is unaffected: createEvent with a working insert confirms normally', async () => {
    const okCal = {
      events: { list: async () => ({ data: { items: [] } }), insert: async () => ({ data: { id: 'new_1' } }) },
    } as never;
    const res = await executeTool('createEvent', {
      title: 'Deep work', startDateTime: '2026-06-25T09:00:00', endDateTime: '2026-06-25T10:30:00',
      timezone: 'America/New_York', overrideConflicts: true,
    }, ctx(okCal));
    expect(res).not.toContain('ERROR:');
    expect(res).toContain('Created and confirmed');
  });
});
