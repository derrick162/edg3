/**
 * Time-of-day greeting boundaries — single source of truth.
 *
 * R19 T3: the evening boundary was duplicated as `hour >= 18` across scheduler.ts and the
 * inbound webhook handler (4 copies), which let it drift and say "Good evening" too late.
 * Centralize it here so every greeting site shares one boundary.
 *
 * Boundaries: 0–11 morning · 12–16 afternoon · 17+ evening.
 */
export type DayPeriod = 'morning' | 'afternoon' | 'evening';

export function dayPeriod(hour: number): DayPeriod {
  return hour >= 17 ? 'evening' : hour >= 12 ? 'afternoon' : 'morning';
}

/** English greeting, e.g. "Good evening". */
export function greetingEn(hour: number): string {
  return { morning: 'Good morning', afternoon: 'Good afternoon', evening: 'Good evening' }[dayPeriod(hour)];
}

/** Cantonese greeting, e.g. "晚上好". */
export function greetingYue(hour: number): string {
  return { morning: '早晨', afternoon: '下午好', evening: '晚上好' }[dayPeriod(hour)];
}
