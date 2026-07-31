import { describe, it, expect } from 'vitest';
import { parseAlertDirection, formatAlertPrice, describeTradeAlert, matchTradeAlerts } from './tradeAlerts';

describe('parseAlertDirection', () => {
  it('maps above-phrasings to "above"', () => {
    for (const s of ['above', 'over', 'breaks', 'break', 'hits', 'reaches', 'crosses above', 'exceeds', 'tops', '>', 'up to']) {
      expect(parseAlertDirection(s)).toBe('above');
    }
  });
  it('maps below-phrasings to "below"', () => {
    for (const s of ['below', 'under', 'drops', 'falls', 'dips', 'breaks down', 'loses', '<', 'down to']) {
      expect(parseAlertDirection(s)).toBe('below');
    }
  });
  it('returns null for ambiguous/empty', () => {
    expect(parseAlertDirection('')).toBeNull();
    expect(parseAlertDirection(null)).toBeNull();
    expect(parseAlertDirection('sideways')).toBeNull();
  });
});

describe('formatAlertPrice', () => {
  it('bare integer, else 2 decimals', () => {
    expect(formatAlertPrice(500)).toBe('500');
    expect(formatAlertPrice(501.3)).toBe('501.30');
    expect(formatAlertPrice(4.567)).toBe('4.57');
  });
});

describe('describeTradeAlert', () => {
  it('renders "SYMBOL direction price"', () => {
    expect(describeTradeAlert({ symbol: 'SOXX', direction: 'below', level: 501.3 })).toBe('SOXX below 501.30');
    expect(describeTradeAlert({ symbol: 'QQQ', direction: 'above', level: 500 })).toBe('QQQ above 500');
  });
});

describe('matchTradeAlerts', () => {
  const alerts = [
    { id: 1, symbol: 'SOXX', direction: 'below' as const, level: 501.3 },
    { id: 2, symbol: 'SOXX', direction: 'above' as const, level: 520 },
    { id: 3, symbol: 'QQQ', direction: 'above' as const, level: 500 },
  ];
  it('filters by symbol', () => {
    expect(matchTradeAlerts(alerts, { symbol: 'soxx' }).map(a => a.id)).toEqual([1, 2]);
  });
  it('filters by symbol + level (±0.01 tolerance)', () => {
    expect(matchTradeAlerts(alerts, { symbol: 'SOXX', level: 501.3 }).map(a => a.id)).toEqual([1]);
    expect(matchTradeAlerts(alerts, { symbol: 'SOXX', level: 501.305 }).map(a => a.id)).toEqual([1]);
  });
  it('filters by level alone', () => {
    expect(matchTradeAlerts(alerts, { level: 500 }).map(a => a.id)).toEqual([3]);
  });
  it('no filter → all', () => {
    expect(matchTradeAlerts(alerts, {})).toHaveLength(3);
  });
  it('no match → empty', () => {
    expect(matchTradeAlerts(alerts, { symbol: 'NVDA' })).toEqual([]);
  });
});
