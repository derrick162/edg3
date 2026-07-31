/**
 * C14 (2) — definitions feed for the trade-monitor watcher. Requires x-trade-alert-key; returns
 * active alert definitions only. Real in-memory DB.
 */
import { describe, it, expect, beforeEach, afterAll, afterEach, vi } from 'vitest';

process.env.DB_PATH = ':memory:';

vi.mock('@/lib/db', async () => await import('../../../../lib/db'));

const { getDb, tradeAlertQueries } = await import('../../../../lib/db');
const { GET } = await import('./route');
const { NextRequest } = await import('next/server');

afterAll(() => { delete process.env.DB_PATH; });
afterEach(() => { delete process.env.TRADE_ALERT_KEY; });

function req(key?: string, qs = '?status=active') {
  return new NextRequest(`http://localhost/api/vapi/trade-alerts${qs}`, {
    headers: key ? { 'x-trade-alert-key': key } : {},
  });
}

beforeEach(() => {
  const db = getDb();
  db.pragma('foreign_keys = OFF');
  for (const t of ['trade_alerts', 'users']) { try { db.prepare(`DELETE FROM ${t}`).run(); } catch { /* ignore */ } }
  db.pragma('foreign_keys = ON');
  db.prepare("INSERT INTO users (id, email, name, password_hash, onboarding_complete) VALUES (1, 'd@e.com', 'Derrick', 'x', 1)").run();
});

describe('GET /api/vapi/trade-alerts', () => {
  it('401 when the key env is unset (never serves without a configured secret)', async () => {
    const res = await GET(req('anything'));
    expect(res.status).toBe(401);
  });

  it('401 on a wrong key', async () => {
    process.env.TRADE_ALERT_KEY = 'real';
    expect((await GET(req('wrong'))).status).toBe(401);
    expect((await GET(req(undefined))).status).toBe(401);
  });

  it('returns active alert definitions on a valid key', async () => {
    process.env.TRADE_ALERT_KEY = 'real';
    tradeAlertQueries.create(1, 'SOXX', 'below', 501.3, 'watch the open');
    const id2 = tradeAlertQueries.create(1, 'QQQ', 'above', 500);
    tradeAlertQueries.cancel(1, id2); // cancelled → excluded
    const res = await GET(req('real'));
    expect(res.status).toBe(200);
    const { alerts } = await res.json();
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ symbol: 'SOXX', direction: 'below', level: 501.3, note: 'watch the open' });
    // Definitions only — no user_id / status / timestamps leaked.
    expect(alerts[0].user_id).toBeUndefined();
    expect(alerts[0].status).toBeUndefined();
  });

  it('non-active status returns an empty list', async () => {
    process.env.TRADE_ALERT_KEY = 'real';
    tradeAlertQueries.create(1, 'SOXX', 'below', 501.3);
    const res = await GET(req('real', '?status=fired'));
    expect((await res.json()).alerts).toEqual([]);
  });
});
