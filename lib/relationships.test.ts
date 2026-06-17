import { describe, it, expect } from 'vitest';
import {
  extractAttendeesFromEvent,
  computePersonInteractions,
  formatInteractionContext,
} from './relationships';
import type { calendar_v3 } from 'googleapis';

// ── helpers ───────────────────────────────────────────────────────────────────

function makeEvent(
  id: string,
  startDt: string,
  attendees: { displayName?: string; email: string; self?: boolean }[],
): calendar_v3.Schema$Event {
  return {
    id,
    start: { dateTime: startDt },
    attendees: attendees.map(a => ({
      displayName: a.displayName,
      email: a.email,
      self: a.self ?? false,
    })),
  };
}

const SELF = 'me@example.com';
const NOW = '2026-06-17T12:00:00.000Z'; // fixed "now" for all tests

const pastEvent1 = makeEvent('e1', '2026-06-10T09:00:00Z', [
  { displayName: 'Alice Smith', email: 'alice@co.com' },
  { email: SELF, self: true },
]);
const pastEvent2 = makeEvent('e2', '2026-06-12T14:00:00Z', [
  { displayName: 'Alice Smith', email: 'alice@co.com' },
  { displayName: 'Bob Jones', email: 'bob@co.com' },
  { email: SELF, self: true },
]);
const pastEvent3 = makeEvent('e3', '2026-06-05T10:00:00Z', [
  { displayName: 'Bob Jones', email: 'bob@co.com' },
  { email: SELF, self: true },
]);
const futureEvent = makeEvent('e4', '2026-06-20T09:00:00Z', [
  { displayName: 'Alice Smith', email: 'alice@co.com' },
  { email: SELF, self: true },
]);
const futureEvent2 = makeEvent('e5', '2026-06-25T10:00:00Z', [
  { displayName: 'Bob Jones', email: 'bob@co.com' },
  { email: SELF, self: true },
]);

// ── extractAttendeesFromEvent ─────────────────────────────────────────────────

describe('extractAttendeesFromEvent', () => {
  it('returns external attendees only (filters self=true)', () => {
    const result = extractAttendeesFromEvent(pastEvent1, SELF);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('Alice Smith');
    expect(result[0].email).toBe('alice@co.com');
  });

  it('filters attendee by selfEmail match even without self flag', () => {
    const event = makeEvent('x', '2026-06-10T09:00:00Z', [
      { displayName: 'Alice', email: 'alice@co.com' },
      { displayName: 'Me', email: SELF },
    ]);
    const result = extractAttendeesFromEvent(event, SELF);
    expect(result.map(r => r.email)).not.toContain(SELF);
  });

  it('derives name from email when displayName absent', () => {
    const event = makeEvent('x', '2026-06-10T09:00:00Z', [
      { email: 'john.doe@example.com' },
    ]);
    const result = extractAttendeesFromEvent(event, SELF);
    expect(result).toHaveLength(1);
    expect(result[0].name).toBe('john doe');
  });

  it('returns empty array when no attendees', () => {
    const event = { id: 'x', start: { dateTime: '2026-06-10T09:00:00Z' } };
    expect(extractAttendeesFromEvent(event, SELF)).toEqual([]);
  });

  it('returns empty array when all attendees are self', () => {
    const event = makeEvent('x', '2026-06-10T09:00:00Z', [
      { email: SELF, self: true },
    ]);
    expect(extractAttendeesFromEvent(event, SELF)).toEqual([]);
  });
});

// ── computePersonInteractions ─────────────────────────────────────────────────

describe('computePersonInteractions', () => {
  it('returns empty array when no past events', () => {
    const result = computePersonInteractions([], [], SELF, NOW);
    expect(result).toEqual([]);
  });

  it('counts interactions per person correctly', () => {
    const result = computePersonInteractions(
      [pastEvent1, pastEvent2, pastEvent3],
      [],
      SELF, NOW,
    );
    const alice = result.find(p => p.canonicalName === 'Alice Smith');
    const bob = result.find(p => p.canonicalName === 'Bob Jones');
    expect(alice?.interactionCount).toBe(2);
    expect(bob?.interactionCount).toBe(2);
  });

  it('captures lastInteraction as most recent past date', () => {
    const result = computePersonInteractions(
      [pastEvent1, pastEvent2, pastEvent3],
      [],
      SELF, NOW,
    );
    const alice = result.find(p => p.canonicalName === 'Alice Smith');
    expect(alice?.lastInteraction).toBe('2026-06-12'); // Jun 12 > Jun 10
    const bob = result.find(p => p.canonicalName === 'Bob Jones');
    expect(bob?.lastInteraction).toBe('2026-06-12'); // Jun 12 > Jun 05
  });

  it('sets upcomingInteraction to earliest future event with that person', () => {
    const result = computePersonInteractions(
      [pastEvent1, pastEvent2],
      [futureEvent, futureEvent2],
      SELF, NOW,
    );
    const alice = result.find(p => p.canonicalName === 'Alice Smith');
    expect(alice?.upcomingInteraction).toBe('2026-06-20');
  });

  it('upcomingInteraction is null when person has no future events', () => {
    const result = computePersonInteractions(
      [pastEvent3],
      [futureEvent], // only Alice in future, not Bob
      SELF, NOW,
    );
    const bob = result.find(p => p.canonicalName === 'Bob Jones');
    expect(bob?.upcomingInteraction).toBeNull();
  });

  it('sorts by interactionCount DESC as primary key', () => {
    // Alice: 2 past events, Bob: 1
    const result = computePersonInteractions(
      [pastEvent1, pastEvent2, pastEvent3],
      [],
      SELF, NOW,
    );
    // Bob appears 2x total (e2 + e3), Alice 2x (e1 + e2) — both equal count
    // But if we only give Bob 1 event...
    const result2 = computePersonInteractions(
      [pastEvent1, pastEvent2], // Alice×2, Bob×1
      [],
      SELF, NOW,
    );
    expect(result2[0].canonicalName).toBe('Alice Smith');
    expect(result2[1].canonicalName).toBe('Bob Jones');
  });

  it('ignores future-dated events in pastEvents array', () => {
    const result = computePersonInteractions(
      [pastEvent1, futureEvent], // futureEvent start > NOW
      [],
      SELF, NOW,
    );
    const alice = result.find(p => p.canonicalName === 'Alice Smith');
    // Only pastEvent1 should count — futureEvent is skipped
    expect(alice?.interactionCount).toBe(1);
  });

  it('excludes attendees whose email matches selfEmail even without self=true flag', () => {
    const event = makeEvent('x', '2026-06-10T09:00:00Z', [
      { displayName: 'Self Person', email: SELF },
    ]);
    const result = computePersonInteractions([event], [], SELF, NOW);
    expect(result).toHaveLength(0);
  });

  it('persists email from first seen occurrence', () => {
    const result = computePersonInteractions(
      [pastEvent1, pastEvent2],
      [],
      SELF, NOW,
    );
    const alice = result.find(p => p.canonicalName === 'Alice Smith');
    expect(alice?.email).toBe('alice@co.com');
  });
});

// ── formatInteractionContext ──────────────────────────────────────────────────

describe('formatInteractionContext', () => {
  it('returns null for null input', () => {
    expect(formatInteractionContext(null)).toBeNull();
  });

  it('returns null when interactionCount is 0', () => {
    expect(formatInteractionContext({ interactionCount: 0, lastInteraction: null, upcomingInteraction: null })).toBeNull();
  });

  it('formats count and last interaction date', () => {
    const result = formatInteractionContext({
      interactionCount: 5,
      lastInteraction: '2026-06-10',
      upcomingInteraction: null,
    });
    expect(result).toBe('met 5× · last Jun 10');
  });

  it('includes only count when lastInteraction is null', () => {
    const result = formatInteractionContext({
      interactionCount: 3,
      lastInteraction: null,
      upcomingInteraction: null,
    });
    expect(result).toBe('met 3×');
  });
});
