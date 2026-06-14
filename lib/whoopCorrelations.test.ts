import { describe, it, expect } from 'vitest';
import { computeWhoopCorrelations, type CalendarDay } from './whoopCorrelations';

// Helper: generate a sequence of recovery points starting from a base date
function recoveries(startDate: string, scores: number[]): { date: string; value: number }[] {
  return scores.map((value, i) => {
    const d = new Date(`${startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), value };
  });
}

// Helper: generate calendar days (half with late meetings, half without)
function calDays(startDate: string, days: number, lateOnEvenDays: boolean): CalendarDay[] {
  return Array.from({ length: days }, (_, i) => {
    const d = new Date(`${startDate}T00:00:00Z`);
    d.setUTCDate(d.getUTCDate() + i);
    const date = d.toISOString().slice(0, 10);
    // Even-indexed days get late meetings (22:00), odd get early ones (17:00)
    const isLate = lateOnEvenDays ? i % 2 === 0 : false;
    return { date, latestEndHour: isLate ? 22 : 17 };
  });
}

describe('computeWhoopCorrelations', () => {
  it('returns null when recovery history is fewer than 10 days', () => {
    const rec = recoveries('2026-06-01', [70, 68, 72]);
    const cal = calDays('2026-05-31', 14, true);
    expect(computeWhoopCorrelations(rec, cal)).toBeNull();
  });

  it('returns null when calendar history is fewer than 10 days', () => {
    const rec = recoveries('2026-06-01', Array(14).fill(70));
    const cal = calDays('2026-06-01', 5, true);
    expect(computeWhoopCorrelations(rec, cal)).toBeNull();
  });

  it('returns null when difference < 5 points (no meaningful signal)', () => {
    // All same recovery regardless of previous evening
    const scores = Array(14).fill(65);
    const rec = recoveries('2026-06-01', scores);
    const cal = calDays('2026-05-31', 14, true);
    expect(computeWhoopCorrelations(rec, cal)).toBeNull();
  });

  it('detects a late-meeting pattern when recovery is ≥5 pts lower after late evenings', () => {
    // Build 14 recovery days; days after late evenings → 45%, days after clean evenings → 72%
    // Calendar: day 0–13 as "previous" days; recovery measured on days 1–14
    // Pattern: every other "previous" day has a late meeting → next-day recovery is lower
    const calStart = '2026-06-01';
    const recStart = '2026-06-02'; // recovery measured from day 2 onward

    const calEntries: CalendarDay[] = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(`${calStart}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return {
        date: d.toISOString().slice(0, 10),
        latestEndHour: i % 2 === 0 ? 21 : 17, // even days → late meeting (21h)
      };
    });

    const recEntries: { date: string; value: number }[] = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(`${recStart}T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return {
        date: d.toISOString().slice(0, 10),
        value: i % 2 === 0 ? 45 : 72, // day after late evening → 45%; after clean evening → 72%
      };
    });

    const result = computeWhoopCorrelations(recEntries, calEntries);
    expect(result).not.toBeNull();
    expect(result!.pattern).toContain('7 PM');
    expect(result!.sampleDays).toBeGreaterThanOrEqual(10);
  });

  it('returns null when late-meeting group has fewer than 3 days', () => {
    // 14 recovery days, but only 1 paired "previous day" has a late meeting
    const calEntries: CalendarDay[] = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(`2026-06-01T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return {
        date: d.toISOString().slice(0, 10),
        latestEndHour: i === 5 ? 21 : 17, // only one late evening
      };
    });
    const recEntries = recoveries('2026-06-02', Array(14).fill(65));
    expect(computeWhoopCorrelations(recEntries, calEntries)).toBeNull();
  });

  it('returns null when no-late-meeting group has fewer than 3 days', () => {
    // All previous days have late meetings
    const calEntries: CalendarDay[] = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(`2026-06-01T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return { date: d.toISOString().slice(0, 10), latestEndHour: 22 };
    });
    const recEntries = recoveries('2026-06-02', Array(14).fill(65));
    expect(computeWhoopCorrelations(recEntries, calEntries)).toBeNull();
  });

  it('returns null when only null calendar days (no events at all)', () => {
    // All days have no events → no "late" group → only "without-late" group ≥ 3
    const calEntries: CalendarDay[] = Array.from({ length: 14 }, (_, i) => {
      const d = new Date(`2026-06-01T00:00:00Z`);
      d.setUTCDate(d.getUTCDate() + i);
      return { date: d.toISOString().slice(0, 10), latestEndHour: null };
    });
    const recEntries = recoveries('2026-06-02', Array(14).fill(65));
    expect(computeWhoopCorrelations(recEntries, calEntries)).toBeNull();
  });
});
