/**
 * C11 — getTradeUpdate voice tool. Honest-failure line when the dashboard is unreachable / env
 * unset; spoken summary (score + delta + mover + positions) on success. Real tradeMonitor module;
 * fetch + env stubbed. Route deps mocked so executeTool imports resolve.
 */
import { describe, it, expect, afterEach, afterAll, vi } from 'vitest';

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
vi.mock('@/lib/tradeMonitor', async () => await import('../../../../lib/tradeMonitor'));

const { executeTool } = await import('./route');

afterAll(() => { delete process.env.DB_PATH; });
afterEach(() => { vi.unstubAllGlobals(); delete process.env.TRADE_MONITOR_URL; delete process.env.TRADE_MONITOR_PASS; });

const ctx = { cal: {} as never, calIds: ['primary'], calMeta: new Map(), userId: 1, tz: 'America/New_York' } as Parameters<typeof executeTool>[2];

describe('getTradeUpdate tool', () => {
  it('returns the honest-failure line when env is unset (dashboard unreachable)', async () => {
    const res = await executeTool('getTradeUpdate', {}, ctx);
    expect(res).toMatch(/couldn't reach your trade dashboard/i);
  });

  it('returns a spoken summary on a successful snapshot fetch', async () => {
    process.env.TRADE_MONITOR_URL = 'https://tm.example.com';
    process.env.TRADE_MONITOR_PASS = 'secret';
    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      json: async () => ({
        tradeScore: { score: 52, prev: 57, components: [{ contrib: -4.1, text: 'credit spreads widened overnight' }] },
        trades: [{ symbol: 'SOXL', direction: 'long', pnlPct: 4.2 }],
      }),
    })));
    const res = await executeTool('getTradeUpdate', {}, ctx);
    expect(res).toContain("trade score's at 52, down 5");
    expect(res).toContain('credit spreads widened overnight');
    expect(res).toContain('SOXL long: +4.2%');
  });
});
