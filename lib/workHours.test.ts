import { describe, it, expect } from 'vitest';
import {
  parseWorkSchedule, validateWorkSchedule, isWithinWorkHours, nextWorkDayName,
  formatWorkHours, formatWorkDays, DEFAULT_WORK_SCHEDULE,
} from './workHours';

describe('validateWorkSchedule (R33)', () => {
  it('accepts a valid 9–18 Mon–Fri schedule', () => {
    expect(validateWorkSchedule({ start: 9, end: 18, days: [1, 2, 3, 4, 5] })).toBe(true);
  });
  it('rejects end <= start', () => {
    expect(validateWorkSchedule({ start: 18, end: 9, days: [1] })).toBe(false);
    expect(validateWorkSchedule({ start: 9, end: 9, days: [1] })).toBe(false);
  });
  it('rejects out-of-range start/end', () => {
    expect(validateWorkSchedule({ start: -1, end: 18, days: [1] })).toBe(false);
    expect(validateWorkSchedule({ start: 9, end: 25, days: [1] })).toBe(false);
  });
  it('rejects empty or out-of-range days', () => {
    expect(validateWorkSchedule({ start: 9, end: 18, days: [] })).toBe(false);
    expect(validateWorkSchedule({ start: 9, end: 18, days: [0] })).toBe(false);
    expect(validateWorkSchedule({ start: 9, end: 18, days: [8] })).toBe(false);
  });
  it('rejects non-objects / missing fields', () => {
    expect(validateWorkSchedule(null)).toBe(false);
    expect(validateWorkSchedule({ start: 9 })).toBe(false);
  });
});

describe('parseWorkSchedule (R33)', () => {
  it('returns the default for null/empty/garbage', () => {
    expect(parseWorkSchedule(null)).toEqual(DEFAULT_WORK_SCHEDULE);
    expect(parseWorkSchedule('')).toEqual(DEFAULT_WORK_SCHEDULE);
    expect(parseWorkSchedule('not json')).toEqual(DEFAULT_WORK_SCHEDULE);
  });
  it('returns the default when JSON is structurally invalid', () => {
    expect(parseWorkSchedule('{"start":20,"end":9,"days":[1]}')).toEqual(DEFAULT_WORK_SCHEDULE);
  });
  it('round-trips a valid schedule', () => {
    expect(parseWorkSchedule('{"start":8,"end":16,"days":[1,3,5]}')).toEqual({ start: 8, end: 16, days: [1, 3, 5] });
  });
});

describe('isWithinWorkHours (R33)', () => {
  const sched = { start: 9, end: 18, days: [1, 2, 3, 4, 5] };
  // 2026-06-24 is a Wednesday (a work day).
  it('is true at 2 PM on a work day', () => {
    expect(isWithinWorkHours(sched, new Date('2026-06-24T14:00:00-04:00'), 'America/Toronto')).toBe(true);
  });
  it('is false at 6:14 PM on a work day (the reported bug)', () => {
    expect(isWithinWorkHours(sched, new Date('2026-06-24T18:14:00-04:00'), 'America/Toronto')).toBe(false);
  });
  it('is false before the work day starts (7 AM)', () => {
    expect(isWithinWorkHours(sched, new Date('2026-06-24T07:00:00-04:00'), 'America/Toronto')).toBe(false);
  });
  it('is false on a non-work day (Saturday 2 PM)', () => {
    expect(isWithinWorkHours(sched, new Date('2026-06-27T14:00:00-04:00'), 'America/Toronto')).toBe(false);
  });
});

describe('nextWorkDayName (R33)', () => {
  const sched = { start: 9, end: 18, days: [1, 2, 3, 4, 5] };
  it('from Friday → Monday', () => {
    // 2026-06-26 is a Friday.
    expect(nextWorkDayName(sched, new Date('2026-06-26T19:00:00-04:00'), 'America/Toronto')).toBe('Monday');
  });
  it('from Wednesday → Thursday', () => {
    expect(nextWorkDayName(sched, new Date('2026-06-24T19:00:00-04:00'), 'America/Toronto')).toBe('Thursday');
  });
});

describe('formatting (R33)', () => {
  it('formats Mon–Fri 9–6 for prompts', () => {
    expect(formatWorkHours({ start: 9, end: 18, days: [1, 2, 3, 4, 5] })).toBe('9 AM – 6 PM, Monday–Friday');
  });
  it('formats non-contiguous days', () => {
    expect(formatWorkDays({ start: 9, end: 17, days: [1, 3, 5] })).toBe('Mon, Wed, Fri');
  });
  it('formats all seven days', () => {
    expect(formatWorkDays({ start: 9, end: 17, days: [1, 2, 3, 4, 5, 6, 7] })).toBe('every day');
  });
});
