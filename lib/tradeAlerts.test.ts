import { describe, it, expect } from 'vitest';
import { parseAlertDirection, parseAlertType, formatAlertPrice, describeTradeAlert, matchTradeAlerts, VOLUME_BAR_DEFAULT_LEVEL, SIGNAL_GRADE_DEFAULT_LEVEL } from './tradeAlerts';

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

describe('parseAlertType (C14b)', () => {
  it('maps phrases to types, defaulting to price', () => {
    expect(parseAlertType(undefined)).toBe('price');
    expect(parseAlertType('price')).toBe('price');
    expect(parseAlertType('volume_bar')).toBe('volume_bar');
    expect(parseAlertType('a big volume bar')).toBe('volume_bar');
    expect(parseAlertType('million and a half shares')).toBe('volume_bar');
    expect(parseAlertType('institutions are back')).toBe('volume_bar');
    expect(parseAlertType('signal_grade')).toBe('signal_grade');
    expect(parseAlertType('if the setup grades an eight')).toBe('signal_grade');
  });
});

describe('describeTradeAlert', () => {
  it('price → "SYMBOL direction price"', () => {
    expect(describeTradeAlert({ symbol: 'SOXX', type: 'price', direction: 'below', level: 501.3 })).toBe('SOXX below 501.30');
    expect(describeTradeAlert({ symbol: 'QQQ', direction: 'above', level: 500 })).toBe('QQQ above 500'); // type defaults to price
  });
  it('volume_bar → shares phrasing with grouping', () => {
    expect(describeTradeAlert({ symbol: 'SOXX', type: 'volume_bar', level: VOLUME_BAR_DEFAULT_LEVEL })).toBe('a volume bar on SOXX at or above 1,500,000 shares');
  });
  it('signal_grade → grade phrasing', () => {
    expect(describeTradeAlert({ symbol: 'SOXX', type: 'signal_grade', level: SIGNAL_GRADE_DEFAULT_LEVEL })).toBe('a SOXX setup grade of 8 or higher');
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
