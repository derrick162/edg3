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

/** The calendar date before `date` ("YYYY-MM-DD"). Converts Google's exclusive all-day end to the last inclusive day. */
export function prevDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
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
 * R13 T2 — cap a recurrence at `until` (a UTC instant from rruleUntilUtc).
 * Rewrites each RRULE line: strips any existing UNTIL/COUNT (mutually exclusive
 * with our new UNTIL) and appends `;UNTIL=<until>`. Non-RRULE lines (EXDATE,
 * RDATE, EXRULE) pass through untouched. Returns a new array.
 */
export function applyRruleUntil(recurrence: string[], until: string): string[] {
  return (recurrence ?? []).map(line => {
    if (!line.toUpperCase().startsWith('RRULE:')) return line;
    const body = line.slice(line.indexOf(':') + 1);
    const parts = body.split(';').filter(p => p && !/^UNTIL=/i.test(p) && !/^COUNT=/i.test(p));
    parts.push(`UNTIL=${until}`);
    return `RRULE:${parts.join(';')}`;
  });
}

/**
 * Compute the ISO 8601 local start/end strings for a booked calendar event.
 * `date` is YYYY-MM-DD, `time` is HH:MM (24h), `durationMins` is a positive
 * integer (defaults to 30 if ≤ 0). If the duration crosses midnight, `end`
 * rolls into the next calendar day rather than being silently truncated.
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
  const endMinTotal = h * 60 + m + dur;
  const pad = (n: number) => String(n).padStart(2, '0');
  const endDate = endMinTotal >= 1440 ? nextDay(date) : date;
  const endMinInDay = endMinTotal % 1440;
  return {
    start: `${date}T${time}:00`,
    end: `${endDate}T${pad(Math.floor(endMinInDay / 60))}:${pad(endMinInDay % 60)}:00`,
  };
}

/**
 * Build a timed-event patch that moves an event to a new date while preserving
 * its original wall-clock start time and duration. Used by the moveEvent handler
 * when the model supplies only `newStartDate` (date-only) for a timed event — the
 * old code fell into the all-day patch branch and silently destroyed the event's
 * time.
 *
 * `origStartDateTime` / `origEndDateTime` are RFC 3339 strings (with timezone offset
 * or "Z"). `newDate` is YYYY-MM-DD. `eventTimezone` is the IANA zone the wall clock
 * times should be interpreted in (use the event's own `start.timeZone` if set).
 */
export function timedEventDateMove(
  origStartDateTime: string,
  origEndDateTime: string,
  newDate: string,
  eventTimezone: string,
): { start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } } {
  // Extract the wall-clock time in the event's timezone.
  const origStartUtc = new Date(origStartDateTime);
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: eventTimezone, hourCycle: 'h23',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(origStartUtc);
  const wp: Record<string, number> = {};
  for (const p of parts) if (p.type !== 'literal') wp[p.type] = Number(p.value);
  const pad = (n: number) => String(n).padStart(2, '0');
  const wh = wp.hour ?? 0, wm = wp.minute ?? 0, ws = wp.second ?? 0;

  // Preserve duration; default to 1 h if end is missing.
  const origEndUtc = origEndDateTime ? new Date(origEndDateTime) : null;
  const durMins = origEndUtc
    ? Math.max(1, Math.round((origEndUtc.getTime() - origStartUtc.getTime()) / 60000))
    : 60;

  // Build end: same arithmetic as bookEventTimes — roll into next day if needed.
  const endMinTotal = wh * 60 + wm + durMins;
  const endDate = endMinTotal >= 1440 ? nextDay(newDate) : newDate;
  const endH = Math.floor(endMinTotal / 60) % 24;
  const endM = endMinTotal % 60;

  return {
    start: { dateTime: `${newDate}T${pad(wh)}:${pad(wm)}:${pad(ws)}`, timeZone: eventTimezone },
    end:   { dateTime: `${endDate}T${pad(endH)}:${pad(endM)}:${pad(ws)}`, timeZone: eventTimezone },
  };
}

/**
 * Build the patch body to move an ENTIRE recurring series to a new time-of-day.
 *
 * Keeps the master event's anchor DATE (so the RRULE / BYDAY pattern stays aligned)
 * and the master's timezone — only the clock time changes. Patching a recurring
 * master with an arbitrary absolute date (the old behavior) re-anchors the series
 * and Google rejects it, which is what made "move my gym to 2pm every day" fail.
 *
 * @param masterStartDateTime  master.start.dateTime (RFC3339; date portion is the anchor)
 * @param masterEndDateTime    master.end.dateTime ('' → fall back to a 1 h duration)
 * @param newStartTime         new start clock time, "HH:MM" or "HH:MM:SS"
 * @param newEndTime           new end clock time, "HH:MM"/"HH:MM:SS"; '' → preserve original duration
 * @param timeZone             IANA tz for the patch (the master's tz, preferred)
 */
export function recurringSeriesTimeShift(
  masterStartDateTime: string,
  masterEndDateTime: string,
  newStartTime: string,
  newEndTime: string,
  timeZone: string,
): { start: { dateTime: string; timeZone: string }; end: { dateTime: string; timeZone: string } } {
  const anchorDate = masterStartDateTime.slice(0, 10);
  const norm = (t: string) => (t.length === 5 ? `${t}:00` : t.slice(0, 8));
  const st = norm(newStartTime);

  let endDate = anchorDate;
  let et: string;
  if (/^\d{2}:\d{2}/.test(newEndTime)) {
    et = norm(newEndTime);
    if (et <= st) endDate = nextDay(anchorDate); // end rolls past midnight
  } else {
    // No explicit end time → preserve the master's original duration.
    const durMs = new Date(masterEndDateTime).getTime() - new Date(masterStartDateTime).getTime();
    const dur = Number.isFinite(durMs) && durMs > 0 ? durMs : 3_600_000;
    const endInstant = new Date(new Date(`${anchorDate}T${st}Z`).getTime() + dur);
    endDate = endInstant.toISOString().slice(0, 10);
    et = endInstant.toISOString().slice(11, 19);
  }

  return {
    start: { dateTime: `${anchorDate}T${st}`, timeZone },
    end:   { dateTime: `${endDate}T${et}`,    timeZone },
  };
}

