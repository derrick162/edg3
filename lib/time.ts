// Canonical timezone handling for EDG3.
//
// Every piece of calendar/briefing time math should go through this module. Before this
// existed, the codebase had four different hand-rolled timezone strategies (a `new Date(Date Z)`
// suffix, a `new Date(new Date().toLocaleString(...))` round-trip, manual offset math, and
// `${date}T00:00:00Z` day windows) — each wrong in a different case, which is what caused the
// "wheels up in 2 hours", past-free-time, and false-conflict bugs.
//
// The core primitive is `wallTimeToUtc`: it turns a wall-clock local datetime in a given IANA
// timezone into the correct UTC instant, handling DST. Everything else builds on it.

/**
 * Offset, in minutes, of `timeZone` at the given UTC `instant`, such that:
 *   localWallClock = utcInstant + offset.
 * Positive east of UTC, negative west. e.g. America/Toronto in summer (EDT) = -240.
 */
export function zoneOffsetMinutes(timeZone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(instant);
  const m: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') m[p.type] = Number(p.value);
  // The same wall-clock reading, interpreted as if it were UTC.
  const asUtc = Date.UTC(m.year, m.month - 1, m.day, m.hour, m.minute, m.second);
  return (asUtc - instant.getTime()) / 60000;
}

/**
 * Convert a wall-clock local datetime ("YYYY-MM-DDTHH:MM:SS", no offset) in `timeZone`
 * to the correct UTC instant. DST-safe (refines across a fall-back/spring-forward boundary).
 */
export function wallTimeToUtc(localDateTime: string, timeZone: string): Date {
  const guess = new Date(`${localDateTime}Z`); // treat wall time as if UTC, then correct
  if (isNaN(guess.getTime())) return new Date(localDateTime);
  const off1 = zoneOffsetMinutes(timeZone, guess);
  let utc = new Date(guess.getTime() - off1 * 60000);
  const off2 = zoneOffsetMinutes(timeZone, utc);
  if (off2 !== off1) utc = new Date(guess.getTime() - off2 * 60000);
  return utc;
}

/** The local calendar date ("YYYY-MM-DD") in `timeZone` at the given instant (default: now). */
export function todayInTz(timeZone: string, at: Date = new Date()): string {
  return at.toLocaleDateString('en-CA', { timeZone });
}

/**
 * Wall-clock parts in `timeZone` at the given instant (default: now). `weekday` is 0=Sun..6=Sat,
 * matching Date.getDay(). Useful for greetings, day-of-week logic, and date references.
 */
export function nowParts(timeZone: string, at: Date = new Date()): {
  year: number; month: number; day: number; hour: number; minute: number;
  weekday: number; date: string;
} {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone, hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short',
  }).formatToParts(at);
  const m: Record<string, string> = {};
  for (const p of parts) m[p.type] = p.value;
  const weekdays: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  return {
    year: Number(m.year), month: Number(m.month), day: Number(m.day),
    hour: Number(m.hour), minute: Number(m.minute),
    weekday: weekdays[m.weekday] ?? 0,
    date: `${m.year}-${m.month}-${m.day}`,
  };
}

/**
 * Start and end UTC instants of a local day in `timeZone`. Defaults to today (in that zone).
 * `start` is 00:00:00 local, `end` is 23:59:59 local — the correct window for "events on this day".
 */
export function dayRangeUtc(timeZone: string, date?: string, at: Date = new Date()): { start: Date; end: Date } {
  const d = date || todayInTz(timeZone, at);
  return {
    start: wallTimeToUtc(`${d}T00:00:00`, timeZone),
    end: wallTimeToUtc(`${d}T23:59:59`, timeZone),
  };
}

/** Format an instant in `timeZone` with the given Intl options. */
export function formatInTz(instant: Date, timeZone: string, opts: Intl.DateTimeFormatOptions): string {
  return instant.toLocaleString('en-US', { ...opts, timeZone });
}

/** True only if `tz` is a usable IANA timezone (e.g. "America/Toronto"). Guards against garbage. */
export function isValidTimeZone(tz: string | null | undefined): boolean {
  if (!tz || typeof tz !== 'string' || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/** The calendar date after `date` ("YYYY-MM-DD"). Used for all-day events, whose end date is exclusive. */
export function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * RRULE UNTIL value (UTC, "YYYYMMDDTHHMMSSZ") for the END of `endDate` in `timeZone`.
 * Using end-of-day keeps the final day inclusive — a bare-date UNTIL (midnight) drops the
 * last occurrence of a daytime recurring event (e.g. "Tue to Thu" loses Thursday).
 */
export function rruleUntilUtc(endDate: string, timeZone: string): string {
  return wallTimeToUtc(`${endDate}T23:59:59`, timeZone)
    .toISOString().replace(/[-:]/g, '').replace(/\.\d{3}Z$/, 'Z');
}

/**
 * Compute the ISO 8601 local start/end strings for a booked calendar event.
 * `date` is YYYY-MM-DD, `time` is HH:MM (24h), `durationMins` is a positive
 * integer (defaults to 30 if ≤ 0). The end time is clamped to 23:59 so it
 * always stays within the same calendar day (near-midnight edge case).
 * Returns bare local datetimes — append a timezone when passing to the
 * Google Calendar API.
 */
export function bookEventTimes(
  date: string,
  time: string,
  durationMins: number,
): { start: string; end: string } {
  const [h, m] = time.split(':').map(Number);
  const dur = durationMins > 0 ? durationMins : 30;
  const endMin = Math.min(h * 60 + m + dur, 1439);
  const pad = (n: number) => String(n).padStart(2, '0');
  return {
    start: `${date}T${time}:00`,
    end: `${date}T${pad(Math.floor(endMin / 60))}:${pad(endMin % 60)}:00`,
  };
}

