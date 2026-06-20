import { describe, it, expect } from 'vitest';
import { isWeekend, buildWeekendBrief } from './FocusRecommendationCard';

describe('isWeekend (R9 T7)', () => {
  it('is true on Saturday and Sunday', () => {
    expect(isWeekend(new Date('2026-06-20T12:00:00'))).toBe(true); // Saturday
    expect(isWeekend(new Date('2026-06-21T12:00:00'))).toBe(true); // Sunday
  });

  it('is false on weekdays', () => {
    expect(isWeekend(new Date('2026-06-19T12:00:00'))).toBe(false); // Friday
    expect(isWeekend(new Date('2026-06-22T12:00:00'))).toBe(false); // Monday
  });
});

describe('buildWeekendBrief (R9 T7)', () => {
  it('always returns exactly 3 bullets', () => {
    expect(buildWeekendBrief('green')).toHaveLength(3);
    expect(buildWeekendBrief(null)).toHaveLength(3);
  });

  it('varies the movement bullet by recovery tier', () => {
    expect(buildWeekendBrief('green')[0]).toMatch(/great recovery/i);
    expect(buildWeekendBrief('yellow')[0]).toMatch(/moderate recovery/i);
    expect(buildWeekendBrief('red')[0]).toMatch(/low/i);
    expect(buildWeekendBrief(null)[0]).toMatch(/feels good/i);
  });

  it('keeps the restorative + sweep bullets regardless of tier', () => {
    const b = buildWeekendBrief('red');
    expect(b[1]).toMatch(/sweep/i);
    expect(b[2]).toMatch(/restorative/i);
  });
});
