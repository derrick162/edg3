// Relationship Memory (M2) — Core-owned.
//
// Builds evolving people profiles from calendar attendees:
// who the user meets, how often, and when.
//
// Pure computation layer: computePersonInteractions() is pure (no I/O).
// syncPeopleProfiles() writes to DB — call fire-and-forget from any enrichment path.
//
// Not encrypted at rest in v1 (Security to add in their lane per ROADMAP.md §3).

import type { calendar_v3 } from 'googleapis';
import { peopleProfileQueries } from './db';
import { matchesSelfName } from './selfName';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface PersonInteraction {
  canonicalName: string;    // display name from calendar (title-cased best effort)
  email: string | null;     // attendee email if available
  interactionCount: number; // number of past shared events
  lastInteraction: string | null;     // ISO date (YYYY-MM-DD) of most recent past event
  upcomingInteraction: string | null; // ISO date of next future event with this person
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isoDate(isoString: string): string {
  return isoString.slice(0, 10);
}

function normalizeKey(name: string): string {
  return name.trim().toLowerCase();
}

/**
 * Extract attendees from a single event, excluding the user.
 * The user is filtered three ways — the `self` flag, an email match, and a
 * NAME match (selfName) — because solo/personal events often list the user as
 * an ordinary attendee with no `self` flag, which previously leaked the user
 * into their own "people you meet with" list.
 * Returns [{name, email}] or [] when the event has no external attendees.
 */
export function extractAttendeesFromEvent(
  event: calendar_v3.Schema$Event,
  selfEmail?: string | null,
  selfName?: string | null,
): { name: string; email: string | null }[] {
  const attendees = event.attendees ?? [];
  return attendees
    .filter(a => !a.self)
    .filter(a => !selfEmail || a.email?.toLowerCase() !== selfEmail.toLowerCase())
    .map(a => ({
      name: (a.displayName ?? a.email?.split('@')[0]?.replace(/[._-]/g, ' ') ?? '').trim(),
      email: a.email ?? null,
    }))
    .filter(a => a.name.length >= 2)
    .filter(a => !matchesSelfName(a.name, selfName));
}

// ── Core pure function ────────────────────────────────────────────────────────

/**
 * Compute per-person interaction data from a set of calendar events.
 *
 * - pastEvents: events that have already happened (start < now) — count as interactions.
 * - upcomingEvents: events in the future — used for upcomingInteraction date only.
 * - selfEmail: the user's own email, used to exclude themselves from attendee lists.
 * - nowIso: override for "now" (for testability); defaults to current UTC ISO string.
 *
 * Returns profiles sorted by interactionCount DESC, then lastInteraction DESC.
 * Minimum threshold: only returns people seen in at least 1 past event.
 */
export function computePersonInteractions(
  pastEvents: calendar_v3.Schema$Event[],
  upcomingEvents: calendar_v3.Schema$Event[],
  selfEmail?: string | null,
  nowIso?: string,
  selfName?: string | null,
): PersonInteraction[] {
  const now = nowIso ?? new Date().toISOString();

  // Accumulate past interaction data
  const byKey = new Map<string, {
    canonicalName: string;
    email: string | null;
    pastDates: string[];  // ISO dates of past events with this person
  }>();

  for (const event of pastEvents) {
    const startStr = event.start?.dateTime ?? event.start?.date;
    if (!startStr) continue;
    if (startStr >= now) continue; // skip future events even if in pastEvents

    const attendees = extractAttendeesFromEvent(event, selfEmail, selfName);
    for (const { name, email } of attendees) {
      const key = normalizeKey(name);
      if (!key) continue;
      const existing = byKey.get(key);
      if (existing) {
        existing.pastDates.push(isoDate(startStr));
        if (!existing.email && email) existing.email = email;
      } else {
        byKey.set(key, { canonicalName: name, email, pastDates: [isoDate(startStr)] });
      }
    }
  }

  // Find upcoming events per person
  const upcomingByKey = new Map<string, string>(); // key → earliest upcoming ISO date
  for (const event of upcomingEvents) {
    const startStr = event.start?.dateTime ?? event.start?.date;
    if (!startStr) continue;
    if (startStr < now) continue; // only future events

    const attendees = extractAttendeesFromEvent(event, selfEmail, selfName);
    for (const { name } of attendees) {
      const key = normalizeKey(name);
      if (!key) continue;
      const existing = upcomingByKey.get(key);
      const date = isoDate(startStr);
      if (!existing || date < existing) upcomingByKey.set(key, date);
    }
  }

  // Build result array
  const results: PersonInteraction[] = [];
  for (const [key, data] of byKey) {
    const sortedDates = [...data.pastDates].sort().reverse(); // newest first
    results.push({
      canonicalName: data.canonicalName,
      email: data.email,
      interactionCount: sortedDates.length,
      lastInteraction: sortedDates[0] ?? null,
      upcomingInteraction: upcomingByKey.get(key) ?? null,
    });
  }

  return results.sort((a, b) => {
    if (b.interactionCount !== a.interactionCount) return b.interactionCount - a.interactionCount;
    if (a.lastInteraction && b.lastInteraction) return b.lastInteraction.localeCompare(a.lastInteraction);
    return 0;
  });
}

// ── Sync (I/O) ────────────────────────────────────────────────────────────────

/**
 * Compute people profiles from calendar events and upsert them to the DB.
 * Fire-and-forget safe — any error is caught and logged, never propagated.
 * Cap at top 50 people by interaction count to keep the table lean.
 */
export async function syncPeopleProfiles(
  userId: number,
  pastEvents: calendar_v3.Schema$Event[],
  upcomingEvents: calendar_v3.Schema$Event[],
  selfEmail?: string | null,
  selfName?: string | null,
): Promise<void> {
  try {
    const profiles = computePersonInteractions(pastEvents, upcomingEvents, selfEmail, undefined, selfName);
    for (const p of profiles.slice(0, 50)) {
      peopleProfileQueries.upsert(
        userId,
        p.canonicalName,
        p.email,
        p.interactionCount,
        p.lastInteraction,
        p.upcomingInteraction,
      );
    }
    if (profiles.length > 0) {
      console.log(`[relationships] Synced ${Math.min(profiles.length, 50)} people profiles for user ${userId}`);
    }
  } catch (err) {
    console.error('[relationships] syncPeopleProfiles failed:', err);
  }
}

// ── Formatting ─────────────────────────────────────────────────────────────────

/**
 * Format interaction context for a specific person for briefing injection.
 * Returns a compact string like "met 5× · last Jun 10" or null if no data.
 */
export function formatInteractionContext(profile: {
  interactionCount: number;
  lastInteraction: string | null;
  upcomingInteraction: string | null;
} | null | undefined): string | null {
  if (!profile || profile.interactionCount === 0) return null;
  const parts: string[] = [];
  parts.push(`met ${profile.interactionCount}×`);
  if (profile.lastInteraction) {
    try {
      const label = new Date(profile.lastInteraction + 'T12:00:00Z').toLocaleDateString('en-US', {
        month: 'short', day: 'numeric', timeZone: 'UTC',
      });
      parts.push(`last ${label}`);
    } catch { /* skip */ }
  }
  return parts.join(' · ');
}

/**
 * Build a RELATIONSHIP CONTEXT block for the briefing prompt.
 *
 * Given a list of upcoming events and stored people profiles, surfaces
 * interaction history for attendees the user is meeting soon.
 * Filters to attendees with ≥2 past interactions (to keep it signal-dense).
 * Returns empty string when no useful data is available.
 */
export function buildRelationshipContextBlock(
  upcomingEvents: calendar_v3.Schema$Event[],
  profiles: { canonical_name: string; interaction_count: number; last_interaction: string | null }[],
  selfEmail?: string | null,
  selfName?: string | null,
): string {
  if (!profiles.length || !upcomingEvents.length) return '';

  const profileByKey = new Map<string, typeof profiles[0]>();
  for (const p of profiles) {
    profileByKey.set(normalizeKey(p.canonical_name), p);
  }

  // Collect upcoming attendees with history, deduped across events
  const seen = new Set<string>();
  const lines: string[] = [];
  for (const event of upcomingEvents) {
    const attendees = extractAttendeesFromEvent(event, selfEmail, selfName);
    for (const { name } of attendees) {
      const key = normalizeKey(name);
      if (seen.has(key)) continue;
      seen.add(key);
      const profile = profileByKey.get(key);
      if (!profile || profile.interaction_count < 2) continue;
      const context = formatInteractionContext({
        interactionCount: profile.interaction_count,
        lastInteraction: profile.last_interaction,
        upcomingInteraction: null,
      });
      if (context) lines.push(`  ${name}: ${context}`);
    }
  }

  if (!lines.length) return '';
  return `RELATIONSHIP CONTEXT (people in your upcoming events):\n${lines.join('\n')}`;
}
