/**
 * Event-creation idempotency guard (Security lane, ticket #3).
 *
 * Prevents duplicate calendar events when Vapi retries a tool call on transient errors
 * (which it does — the retry arrives within seconds) or when a user double-taps
 * "Book it" in the notification center.
 *
 * Design: short-TTL (5 min) dedupe keys stored in SQLite via an atomic
 * INSERT OR IGNORE + changes-check. On a duplicate within the TTL window we skip
 * the insert entirely and return success — the first call's event already exists on the
 * calendar.
 *
 * Callers:
 *   - app/api/vapi/tool-call/route.ts  (createEvent / createRecurringEvent / copyDayEvents)
 *   - app/api/calendar/book/route.ts   ("Book it" quick-book button)
 */

import { eventDedupeQueries, deleteConfirmQueries } from './db';

/** 5 minutes — long enough to absorb Vapi retry storms and double-taps. */
const TTL_MS = 5 * 60 * 1000;

/**
 * Build a normalized dedupe key for a single-event or all-day event creation.
 *
 * Strips the leading "⚡ " prefix Core adds so voice and web paths share the same
 * key space. Uses minute-level precision on start time so minor rounding differences
 * between callers don't produce false cache-misses.
 *
 * @param title      Raw event title (with or without the "⚡ " prefix).
 * @param startISOish  ISO-ish datetime or date string (only the first 16 chars are used,
 *                   so "2026-06-10T14:30:00" and "2026-06-10T14:30" both yield the same key;
 *                   a date-only "2026-06-10" works for all-day events).
 */
export function buildEventDedupeKey(title: string, startISOish: string): string {
  const normalTitle = title.toLowerCase().replace(/^⚡\s*/, '').trim().slice(0, 60);
  const startKey = startISOish.slice(0, 16); // YYYY-MM-DDTHH:MM  or  YYYY-MM-DD for all-day
  return `event:${normalTitle}:${startKey}`;
}

// ── Hard delete-confirmation tokens (#9) ──────────────────────────────────────

/** 2 minutes — ample time for the user to respond on a voice call. */
const DELETE_TOKEN_TTL_MS = 2 * 60 * 1000;

/**
 * Issue a one-time server-generated confirmation token for a destructive delete.
 * The caller should embed the token in the response message so the model can relay
 * it back on the next call. The model cannot mint a valid token; it must present
 * one it received from the server.
 */
export function issueDeleteToken(userId: number): string {
  return deleteConfirmQueries.issue(userId, Date.now(), DELETE_TOKEN_TTL_MS);
}

/**
 * Consume a confirmation token. Returns true if the token is valid (correct user,
 * not expired, not previously used) and marks it used. Returns false otherwise.
 * Callers should refuse the delete and re-issue a fresh token on false.
 */
export function consumeDeleteToken(userId: number, token: string): boolean {
  try {
    return deleteConfirmQueries.consume(token, userId, Date.now());
  } catch {
    return false;
  }
}

/**
 * Attempt to claim a dedupe key for the current request.
 *
 * Returns:
 *   true  — first call for this (user, key) pair in the TTL window → proceed with the insert.
 *   false — duplicate within the window → skip the insert (event already created).
 *
 * Fails open: if the dedupe table is unavailable for any reason, returns true so a real
 * event-creation attempt is never blocked by an infrastructure fault.
 */
export function claimEventCreate(userId: number, key: string): boolean {
  try {
    return eventDedupeQueries.claim(userId, key, Date.now(), TTL_MS);
  } catch {
    // Fail open — never let a dedupe fault block a legitimate calendar write.
    return true;
  }
}
