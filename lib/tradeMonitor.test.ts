/**
 * C11 — Trade Monitor: env-gated fetcher (degrade-to-null) + pure formatters.
 * The honesty guard is load-bearing: formatters cite the snapshot's own numbers/notes and never
 * invent direction. fetch is mocked; no network.
 */
import { describe, it, expect, afterEach, vi } from 'vitest';
import {
  getTradeSnapshot,
  formatTradeMonitorForBriefing,
  formatTradeUpdateForVoice,
  topMoverTexts,
  earningsNames,
  TRADE_UNAVAILABLE,
  type TradeSnapshot,
} from './tradeMonitor';

const SNAPSHOT: TradeSnapshot = {
  generatedAt: '2026-07-30T13:00:00Z',
  asOf: '2026-07-30',
  tradeScore: {
    score: 52,
    prev: 57,
    components: [
      { name: 'credit', weight: 0.2, contrib: -4.1, text: 'credit spreads widened overnight' },
      { name: 'trend', weight: 0.2, contrib: 2.0, text: 'trend still constructive' },
      { name: 'vol', weight: 0.1, contrib: -0.3, text: 'vol muted' },
      { name: 'breadth', weight: 0.15, contrib: 3.5, text: 'breadth improving' },
    ],
  },
  morningRead: { d: '2026-07-30', text: 'Risk is balanced today. Watch the open.' },
  trades: [
    { symbol: 'SOXL', direction: 'long', pnlPct: 4.2 },
    { symbol: 'QQQ', direction: 'short', pnlPct: -1.3 },
  ],
  catalysts: { earningsUpcoming: ['AAPL', { symbol: 'MSFT' }] },
};

afterEach(() => { vi.unstubAllGlobals(); delete process.env.TRADE_MONITOR_URL; delete process.env.TRADE_MONITOR_PASS; });

describe('getTradeSnapshot (env-gated, degrade-to-null)', () => {
  it('returns null when env vars are unset (never fetches)', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    expect(await getTradeSnapshot()).toBeNull();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns the parsed snapshot on a successful fetch (with Basic auth header)', async () => {
    process.env.TRADE_MONITOR_URL = 'https://tm.example.com';
    process.env.TRADE_MONITOR_PASS = 'secret';
    let sawAuth = '';
    vi.stubGlobal('fetch', vi.fn(async (_url: string, init: { headers?: Record<string, string> }) => {
      sawAuth = init?.headers?.Authorization ?? '';
      return { ok: true, json: async () => SNAPSHOT };
    }));
    const snap = await getTradeSnapshot();
    expect(snap?.tradeScore?.score).toBe(52);
    expect(sawAuth.startsWith('Basic ')).toBe(true);
  });

  it('returns null on a non-ok response', async () => {
    process.env.TRADE_MONITOR_URL = 'https://tm.example.com';
    process.env.TRADE_MONITOR_PASS = 'secret';
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, json: async () => ({}) })));
    expect(await getTradeSnapshot()).toBeNull();
  });

  it('returns null when the fetch throws / times out', async () => {
    process.env.TRADE_MONITOR_URL = 'https://tm.example.com';
    process.env.TRADE_MONITOR_PASS = 'secret';
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('aborted'); }));
    expect(await getTradeSnapshot()).toBeNull();
  });
});

describe('topMoverTexts / earningsNames', () => {
  it('ranks component texts by |contrib| (biggest first)', () => {
    expect(topMoverTexts(SNAPSHOT.tradeScore!.components, 2)).toEqual(['credit spreads widened overnight', 'breadth improving']);
  });
  it('extracts earnings names from mixed string/object entries', () => {
    expect(earningsNames(SNAPSHOT.catalysts!.earningsUpcoming)).toEqual(['AAPL', 'MSFT']);
    expect(earningsNames(undefined)).toEqual([]);
  });
});

describe('formatTradeMonitorForBriefing', () => {
  it('builds a TRADE MONITOR block with score, movers, positions, earnings', () => {
    const block = formatTradeMonitorForBriefing(SNAPSHOT)!;
    expect(block).toContain('TRADE MONITOR');
    expect(block).toContain('Trade score: 52 (prev 57, -5)');
    expect(block).toContain('credit spreads widened overnight');
    expect(block).toContain('SOXL long: +4.2%');
    expect(block).toContain('QQQ short: -1.3%');
    expect(block).toContain('AAPL, MSFT');
    // Honesty: only the dashboard's own component text — no invented direction words.
    expect(block).not.toMatch(/bullish|bearish/i);
  });

  it('returns null when snapshot is null or has no score', () => {
    expect(formatTradeMonitorForBriefing(null)).toBeNull();
    expect(formatTradeMonitorForBriefing({ tradeScore: {} })).toBeNull();
  });
});

describe('formatTradeUpdateForVoice', () => {
  it('produces a spoken summary: score + delta + top mover + positions + fresh morningRead', () => {
    const out = formatTradeUpdateForVoice(SNAPSHOT, '2026-07-30');
    expect(out).toContain("trade score's at 52, down 5");
    expect(out).toContain('credit spreads widened overnight');
    expect(out).toContain('SOXL long: +4.2%');
    expect(out).toContain('Risk is balanced today.'); // first sentence of a same-day morningRead
  });

  it('omits the morningRead when it is not from today (stale)', () => {
    const out = formatTradeUpdateForVoice(SNAPSHOT, '2026-07-31');
    expect(out).not.toContain('Risk is balanced today');
    expect(out).toContain("trade score's at 52");
  });

  it('returns the honest-failure line for a null snapshot', () => {
    expect(formatTradeUpdateForVoice(null)).toBe(TRADE_UNAVAILABLE);
  });
});
