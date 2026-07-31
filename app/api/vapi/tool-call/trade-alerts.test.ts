/**
 * C14 — setTradeAlert / listTradeAlerts / cancelTradeAlert voice tools. Real in-memory DB
 * (exercises tradeAlertQueries end-to-end); route deps mocked so executeTool imports resolve.
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
vi.mock('@/lib/tradeAlerts', async () => await import('../../../../lib/tradeAlerts'));

const { getDb, tradeAlertQueries } = await import('../../../../lib/db');
const { executeTool } = await import('./route');

afterAll(() => { delete process.env.DB_PATH; });

const ctx = { cal: {} as never, calIds: ['primary'], calMeta: new Map(), userId: 1, tz: 'America/New_York' } as Parameters<typeof executeTool>[2];

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['trade_alerts', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
});

describe('setTradeAlert', () => {
  it('saves an alert and echoes the parsed condition back', async () => {
    const res = await executeTool('setTradeAlert', { symbol: 'soxx', direction: 'breaks', level: 501.3 }, ctx);
    expect(res).toContain('SOXX above 501.30');
    const active = tradeAlertQueries.listActive(1);
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ symbol: 'SOXX', direction: 'above', level: 501.3, status: 'active' });
  });

  it('asks for direction when it cannot parse one', async () => {
    const res = await executeTool('setTradeAlert', { symbol: 'SOXX', direction: 'sideways', level: 501.3 }, ctx);
    expect(res).toMatch(/above or below/i);
    expect(tradeAlertQueries.listActive(1)).toHaveLength(0);
  });

  it('asks for a price when level is missing/invalid', async () => {
    const res = await executeTool('setTradeAlert', { symbol: 'SOXX', direction: 'below', level: 'x' }, ctx);
    expect(res).toMatch(/what price/i);
  });

  it('C14b — volume_bar defaults level to 1,500,000 and stores no direction', async () => {
    const res = await executeTool('setTradeAlert', { symbol: 'SOXX', type: 'volume_bar' }, ctx);
    expect(res).toContain('1,500,000 shares');
    const a = tradeAlertQueries.listActive(1)[0];
    expect(a).toMatchObject({ type: 'volume_bar', level: 1500000, direction: null });
  });

  it('C14b — signal_grade defaults level to 8 and symbol to SOXX', async () => {
    const res = await executeTool('setTradeAlert', { type: 'signal_grade' }, ctx);
    expect(res).toContain('SOXX setup grade of 8');
    const a = tradeAlertQueries.listActive(1)[0];
    expect(a).toMatchObject({ type: 'signal_grade', symbol: 'SOXX', level: 8, direction: null });
  });

  it('C14b — price alert still stores type=price + direction', async () => {
    await executeTool('setTradeAlert', { symbol: 'SOXX', direction: 'below', level: 501.3 }, ctx);
    expect(tradeAlertQueries.listActive(1)[0]).toMatchObject({ type: 'price', direction: 'below', level: 501.3 });
  });
});

describe('listTradeAlerts', () => {
  it('empty state', async () => {
    expect(await executeTool('listTradeAlerts', {}, ctx)).toMatch(/don't have any active/i);
  });
  it('summarizes active alerts', async () => {
    tradeAlertQueries.create(1, 'SOXX', 'below', 501.3);
    tradeAlertQueries.create(1, 'QQQ', 'above', 500);
    const res = await executeTool('listTradeAlerts', {}, ctx);
    expect(res).toContain('2 active alerts');
    expect(res).toContain('SOXX below 501.30');
    expect(res).toContain('QQQ above 500');
  });
});

describe('cancelTradeAlert', () => {
  it('cancels a single match by symbol', async () => {
    tradeAlertQueries.create(1, 'SOXX', 'below', 501.3);
    const res = await executeTool('cancelTradeAlert', { symbol: 'SOXX' }, ctx);
    expect(res).toMatch(/cancelled/i);
    expect(tradeAlertQueries.listActive(1)).toHaveLength(0);
  });

  it('disambiguates when several match', async () => {
    tradeAlertQueries.create(1, 'SOXX', 'below', 501.3);
    tradeAlertQueries.create(1, 'SOXX', 'above', 520);
    const res = await executeTool('cancelTradeAlert', { symbol: 'SOXX' }, ctx);
    expect(res).toMatch(/which one/i);
    expect(tradeAlertQueries.listActive(1)).toHaveLength(2); // nothing cancelled yet
  });

  it('narrows by level to cancel the right one', async () => {
    tradeAlertQueries.create(1, 'SOXX', 'below', 501.3);
    tradeAlertQueries.create(1, 'SOXX', 'above', 520);
    const res = await executeTool('cancelTradeAlert', { symbol: 'SOXX', level: 520 }, ctx);
    expect(res).toMatch(/cancelled/i);
    const active = tradeAlertQueries.listActive(1);
    expect(active).toHaveLength(1);
    expect(active[0].level).toBe(501.3);
  });

  it('honest when nothing matches', async () => {
    expect(await executeTool('cancelTradeAlert', { symbol: 'NVDA' }, ctx)).toMatch(/couldn't find an active alert|don't have any active/i);
  });
});
