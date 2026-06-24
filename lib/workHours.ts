// R33 — user work hours. Pure helpers (no I/O) so parsing, validation, the after-hours check, and
// prompt formatting are all unit-testable. Edge uses these to avoid suggesting work blocks outside
// the user's hours (e.g. it offered to book at 6:14 PM, past Derrick's day).

export interface WorkSchedule {
  start: number;   // hour the work day starts, 0–23
  end: number;     // hour the work day ends, 1–24 (exclusive-ish; "6 PM" = 18)
  days: number[];  // ISO weekdays that are work days: 1=Mon … 7=Sun
}

export const DEFAULT_WORK_SCHEDULE: WorkSchedule = { start: 9, end: 18, days: [1, 2, 3, 4, 5] };

const DAY_NAMES = ['', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

// Parse the stored JSON column into a WorkSchedule, falling back to the default on any malformed
// input. Always returns a valid schedule — callers never have to guard.
export function parseWorkSchedule(raw: string | null | undefined): WorkSchedule {
  if (!raw) return { ...DEFAULT_WORK_SCHEDULE };
  try {
    const o = JSON.parse(raw) as Partial<WorkSchedule>;
    const candidate = { start: o.start, end: o.end, days: o.days };
    return validateWorkSchedule(candidate) ? (candidate as WorkSchedule) : { ...DEFAULT_WORK_SCHEDULE };
  } catch {
    return { ...DEFAULT_WORK_SCHEDULE };
  }
}

// True when the object is a well-formed schedule: start 0–23, end 1–24, end > start, days a
// non-empty subset of 1–7 (no duplicates required, but all in range).
export function validateWorkSchedule(s: unknown): s is WorkSchedule {
  if (!s || typeof s !== 'object') return false;
  const { start, end, days } = s as Record<string, unknown>;
  if (typeof start !== 'number' || !Number.isInteger(start) || start < 0 || start > 23) return false;
  if (typeof end !== 'number' || !Number.isInteger(end) || end < 1 || end > 24) return false;
  if (end <= start) return false;
  if (!Array.isArray(days) || days.length === 0) return false;
  if (!days.every(d => Number.isInteger(d) && (d as number) >= 1 && (d as number) <= 7)) return false;
  return true;
}

// ISO weekday (1=Mon … 7=Sun) for a Date in a given IANA timezone.
export function isoWeekdayInTz(date: Date, timeZone: string): number {
  const wd = new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short' }).format(date);
  const map: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
  return map[wd] ?? 1;
}

// Hour-of-day (0–23) for a Date in a given IANA timezone.
export function hourInTz(date: Date, timeZone: string): number {
  return parseInt(new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', hour12: false }).format(date), 10) % 24;
}

// Is `date` (in the user's tz) within their work hours — both an on-day check and the hour window?
export function isWithinWorkHours(schedule: WorkSchedule, date: Date, timeZone: string): boolean {
  const day = isoWeekdayInTz(date, timeZone);
  if (!schedule.days.includes(day)) return false;
  const hour = hourInTz(date, timeZone);
  return hour >= schedule.start && hour < schedule.end;
}

// The next work day's name relative to `date` (the next day in schedule.days, today excluded).
export function nextWorkDayName(schedule: WorkSchedule, date: Date, timeZone: string): string {
  const today = isoWeekdayInTz(date, timeZone);
  for (let i = 1; i <= 7; i++) {
    const d = ((today - 1 + i) % 7) + 1;
    if (schedule.days.includes(d)) return DAY_NAMES[d];
  }
  return DAY_NAMES[schedule.days[0]];
}

// "9 AM – 6 PM" for a schedule.
export function formatHourRange(schedule: WorkSchedule): string {
  const h12 = (h: number) => {
    const hh = h % 24;
    const period = hh < 12 || hh === 24 ? 'AM' : 'PM';
    const display = hh % 12 === 0 ? 12 : hh % 12;
    return `${display} ${period}`;
  };
  return `${h12(schedule.start)} – ${h12(schedule.end)}`;
}

// Compact, readable summary of the days, e.g. "Monday–Friday" or "Mon, Wed, Fri".
export function formatWorkDays(schedule: WorkSchedule): string {
  const sorted = [...new Set(schedule.days)].sort((a, b) => a - b);
  const isMonFri = sorted.length === 5 && sorted.every((d, i) => d === i + 1);
  if (isMonFri) return 'Monday–Friday';
  const isEveryDay = sorted.length === 7;
  if (isEveryDay) return 'every day';
  const short = ['', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  return sorted.map(d => short[d]).join(', ');
}

// One-line summary for prompts: "9 AM – 6 PM, Monday–Friday".
export function formatWorkHours(schedule: WorkSchedule): string {
  return `${formatHourRange(schedule)}, ${formatWorkDays(schedule)}`;
}
