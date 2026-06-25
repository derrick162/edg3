/**
 * S1 e2e — calendar tool handlers: each returns the correct spoken response on SUCCESS and on
 * FAILURE. Drives the real executeTool dispatcher against the real in-memory DB layer; only the
 * Google calendar client is mocked (success returns ids; failure rejects like googleapis).
 */
import { describe, it, expect, beforeEach, afterAll, vi } from 'vitest';

process.env.DB_PATH = ':memory:';

// The route resolves deps via the `@/` alias, which vitest doesn't map — remap each to its real module.
vi.mock('@/lib/db', async () => await import('../../lib/db'));
vi.mock('@/lib/calendar', async () => await import('../../lib/calendar'));
vi.mock('@/lib/time', async () => await import('../../lib/time'));
vi.mock('@/lib/eventMatch', async () => await import('../../lib/eventMatch'));
vi.mock('@/lib/gmail', async () => await import('../../lib/gmail'));
vi.mock('@/lib/google-auth', async () => await import('../../lib/google-auth'));
vi.mock('@/lib/batchSchedule', async () => await import('../../lib/batchSchedule'));
vi.mock('@/lib/attendees', async () => await import('../../lib/attendees'));
vi.mock('@/lib/calendarQuery', async () => await import('../../lib/calendarQuery'));
vi.mock('@/lib/grounding', async () => await import('../../lib/grounding'));
vi.mock('@/lib/vapi', async () => await import('../../lib/vapi'));
vi.mock('@/lib/calendarScore', async () => await import('../../lib/calendarScore'));
vi.mock('@/lib/alignment', async () => await import('../../lib/alignment'));
vi.mock('@/lib/energy', async () => await import('../../lib/energy'));
vi.mock('@/lib/whoop', async () => await import('../../lib/whoop'));
vi.mock('@/lib/calendarPlan', async () => await import('../../lib/calendarPlan'));
vi.mock('@/lib/taskMatch', async () => await import('../../lib/taskMatch'));
vi.mock('@/lib/factForget', async () => await import('../../lib/factForget'));
vi.mock('@/lib/undo', async () => await import('../../lib/undo'));
vi.mock('@/lib/idempotency', async () => await import('../../lib/idempotency'));
vi.mock('@/lib/calendarWritable', async () => await import('../../lib/calendarWritable'));
vi.mock('@/lib/rateLimit', async () => await import('../../lib/rateLimit'));
vi.mock('@/lib/notifications', async () => await import('../../lib/notifications'));
vi.mock('@/lib/facts', async () => await import('../../lib/facts'));
vi.mock('@/lib/calendarToolErrors', async () => await import('../../lib/calendarToolErrors'));

const { getDb } = await import('../../lib/db');
const { executeTool } = await import('../../app/api/vapi/tool-call/route');

afterAll(() => { delete process.env.DB_PATH; });

const EVENT = {
  id: 'evt_1', summary: 'Dentist',
  start: { dateTime: '2026-06-25T14:00:00-04:00', timeZone: 'America/New_York' },
  end: { dateTime: '2026-06-25T15:00:00-04:00', timeZone: 'America/New_York' },
  organizer: { self: true },
};
const REJECT = async () => { throw new Error('Google 500'); };

// cal mock: list returns the seeded events; mutations either succeed (return an id) or reject.
function cal(opts: { listItems?: unknown[]; mutationsFail?: boolean } = {}) {
  const mut = opts.mutationsFail ? REJECT : async () => ({ data: { id: 'ok_1' } });
  return {
    events: {
      list: async () => ({ data: { items: opts.listItems ?? [] } }),
      insert: opts.mutationsFail ? REJECT : async () => ({ data: { id: 'new_1' } }),
      patch: mut,
      delete: opts.mutationsFail ? REJECT : async () => ({ data: {} }),
      get: async () => ({ data: EVENT }),
    },
  } as never;
}
function ctx(c: unknown) {
  return { cal: c, calIds: ['primary'], calMeta: new Map([['primary', { accessRole: 'owner', summary: 'Primary' }]]), userId: 1, tz: 'America/New_York' } as Parameters<typeof executeTool>[2];
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  try { db.prepare('DELETE FROM users').run(); } catch { /* ignore */ }
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
});

describe('S1 e2e — calendar tools (success + failure)', () => {
  it('createEvent: success confirms; failure returns ERROR', async () => {
    const ok = await executeTool('createEvent', { title: 'Deep work', startDateTime: '2026-06-25T09:00:00', endDateTime: '2026-06-25T10:30:00', timezone: 'America/New_York', overrideConflicts: true }, ctx(cal()));
    expect(ok).toContain('Created and confirmed');
    const fail = await executeTool('createEvent', { title: 'Deep work', startDateTime: '2026-06-25T11:00:00', endDateTime: '2026-06-25T12:00:00', timezone: 'America/New_York', overrideConflicts: true }, ctx(cal({ mutationsFail: true })));
    expect(fail).toContain('ERROR: Event was NOT created');
  });

  it('editEvent: success confirms; failure returns ERROR', async () => {
    const ok = await executeTool('editEvent', { title: 'Dentist', date: '2026-06-25', currentTime: '2pm', location: '123 Main St' }, ctx(cal({ listItems: [EVENT] })));
    expect(ok).toContain('Updated and confirmed');
    const fail = await executeTool('editEvent', { title: 'Dentist', date: '2026-06-25', currentTime: '2pm', location: 'X' }, ctx(cal({ listItems: [EVENT], mutationsFail: true })));
    expect(fail).toContain('ERROR: Event was NOT updated');
  });

  it('moveEvent: success confirms; failure returns ERROR', async () => {
    const ok = await executeTool('moveEvent', { title: 'Dentist', date: '2026-06-25', currentTime: '2pm', newStartDateTime: '2026-06-25T16:00:00', newEndDateTime: '2026-06-25T17:00:00', timezone: 'America/New_York' }, ctx(cal({ listItems: [EVENT] })));
    expect(ok).toContain('Moved and confirmed');
    const fail = await executeTool('moveEvent', { title: 'Dentist', date: '2026-06-25', currentTime: '2pm', newStartDateTime: '2026-06-25T16:00:00', newEndDateTime: '2026-06-25T17:00:00', timezone: 'America/New_York' }, ctx(cal({ listItems: [EVENT], mutationsFail: true })));
    expect(fail).toContain('ERROR: Event was NOT moved');
  });

  it('deleteEvent: success confirms (after confirm token); failure returns ERROR', async () => {
    const c = cal({ listItems: [EVENT] });
    const first = await executeTool('deleteEvent', { title: 'Dentist', date: '2026-06-25', currentTime: '2pm' }, ctx(c));
    const token = first.match(/confirmToken set to "([^"]+)"/)?.[1];
    const ok = await executeTool('deleteEvent', { title: 'Dentist', date: '2026-06-25', currentTime: '2pm', confirmToken: token }, ctx(c));
    expect(ok).toContain('Deleted:');

    const cf = cal({ listItems: [EVENT], mutationsFail: true });
    const f1 = await executeTool('deleteEvent', { title: 'Dentist', date: '2026-06-25', currentTime: '2pm' }, ctx(cf));
    const t2 = f1.match(/confirmToken set to "([^"]+)"/)?.[1];
    const fail = await executeTool('deleteEvent', { title: 'Dentist', date: '2026-06-25', currentTime: '2pm', confirmToken: t2 }, ctx(cf));
    expect(fail).toContain('ERROR: Event was NOT deleted');
  });

  it('createEvent failure path does not leave a phantom undo (honest failure)', async () => {
    const fail = await executeTool('createEvent', { title: 'Ghost', startDateTime: '2026-06-26T09:00:00', endDateTime: '2026-06-26T10:00:00', timezone: 'America/New_York', overrideConflicts: true }, ctx(cal({ mutationsFail: true })));
    expect(fail).toContain('ERROR:');
    expect(fail).not.toContain('Created');
  });
});
