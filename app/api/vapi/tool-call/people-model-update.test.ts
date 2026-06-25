/**
 * C7 (M4-4) — when rememberPreference saves a fact about a PERSON mid-call, the person's social
 * model in people_models must update immediately (not wait for the nightly sleep-time pass), so
 * the next briefing reflects what the user just said ("Patrick is going through a hard time").
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

const { getDb, peopleModelQueries } = await import('../../../../lib/db');
const { executeTool } = await import('./route');

afterAll(() => { delete process.env.DB_PATH; });

function ctx() {
  return {
    cal: { events: { list: async () => ({ data: { items: [] } }) } } as never,
    calIds: ['primary'],
    calMeta: new Map([['primary', { accessRole: 'owner', summary: 'Primary' }]]),
    userId: 1,
    tz: 'America/New_York',
  } as Parameters<typeof executeTool>[2];
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  try { db.prepare('DELETE FROM users').run(); } catch { /* ignore */ }
  try { db.prepare('DELETE FROM people_models').run(); } catch { /* ignore */ }
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
});

describe('C7 — rememberPreference updates people_models for person facts', () => {
  it('saving a person fact mid-call upserts that person\'s model immediately', async () => {
    const res = await executeTool('rememberPreference', {
      statement: 'Patrick is going through a hard time right now',
      topic: 'Patrick',
      category: 'person',
    }, ctx());
    expect(res).toMatch(/saved/i);
    const model = peopleModelQueries.getForUser(1, 'Patrick');
    expect(model).toBeTruthy();
    expect(model!.last_interaction).toContain('hard time');
    expect(model!.relationship_state).toContain('hard time');
  });

  it('a non-person preference does NOT create a people_models row', async () => {
    await executeTool('rememberPreference', {
      statement: 'I prefer deep work in the mornings',
      category: 'preference',
    }, ctx());
    expect(peopleModelQueries.listForUser(1)).toHaveLength(0);
  });

  it('a second person fact enriches the same model (goals field picked up)', async () => {
    await executeTool('rememberPreference', { statement: 'Sarah is the CFO at CIBC', topic: 'Sarah', category: 'person' }, ctx());
    await executeTool('rememberPreference', { statement: 'Sarah is trying to close the Q3 round', topic: 'Sarah', category: 'person' }, ctx());
    const model = peopleModelQueries.getForUser(1, 'Sarah');
    expect(model).toBeTruthy();
    expect(model!.goals).toMatch(/close the Q3 round/i);
  });
});
