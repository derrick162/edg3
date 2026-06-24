/**
 * R19 T3 — time-of-day greeting boundaries.
 * Evening starts at 17 (5 PM), not 18. Single source of truth for all greeting sites.
 */
import { describe, it, expect } from 'vitest';
import { dayPeriod, greetingEn, greetingYue } from './greeting';

describe('dayPeriod boundaries', () => {
  it('17 (5 PM) → evening', () => expect(dayPeriod(17)).toBe('evening'));
  it('16 (4 PM) → afternoon', () => expect(dayPeriod(16)).toBe('afternoon'));
  it('12 (noon) → afternoon', () => expect(dayPeriod(12)).toBe('afternoon'));
  it('11 (11 AM) → morning', () => expect(dayPeriod(11)).toBe('morning'));
  it('0 (midnight) → morning', () => expect(dayPeriod(0)).toBe('morning'));
  it('23 (11 PM) → evening', () => expect(dayPeriod(23)).toBe('evening'));
});

describe('greetingEn', () => {
  it('17 → Good evening', () => expect(greetingEn(17)).toBe('Good evening'));
  it('16 → Good afternoon', () => expect(greetingEn(16)).toBe('Good afternoon'));
  it('11 → Good morning', () => expect(greetingEn(11)).toBe('Good morning'));
  it('0 → Good morning', () => expect(greetingEn(0)).toBe('Good morning'));
});

describe('greetingYue', () => {
  it('17 → 晚上好', () => expect(greetingYue(17)).toBe('晚上好'));
  it('16 → 下午好', () => expect(greetingYue(16)).toBe('下午好'));
  it('11 → 早晨', () => expect(greetingYue(11)).toBe('早晨'));
});
