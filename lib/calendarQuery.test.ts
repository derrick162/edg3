import { describe, it, expect } from 'vitest';
import { dedupeSortEvents, formatEventForSpeech, findOverlappingEvents, type CalEventLike } from './calendarQuery';

const tz = 'America/Toronto';
const ev = (id: string, summary: string, startDt: string | null, endDt?: string | null): CalEventLike => ({
  id, summary,
  start: startDt ? { dateTime: startDt } : { date: '2026-06-20' },
  end: endDt ? { dateTime: endDt } : undefined,
});

describe('dedupeSortEvents (R15)', () => {
  it('dedups by id and sorts ascending by start', () => {
    const out = dedupeSortEvents([
      ev('b', 'Late', '2026-06-20T20:00:00Z'),
      ev('a', 'Early', '2026-06-20T13:00:00Z'),
      ev('a', 'Early dup', '2026-06-20T13:00:00Z'),
    ]);
    expect(out.map(e => e.id)).toEqual(['a', 'b']);
  });
});

describe('formatEventForSpeech (R15)', () => {
  it('formats timed event without date by default', () => {
    expect(formatEventForSpeech(ev('1', '⚡ Gym', '2026-06-20T11:00:00Z'), tz)).toBe('Gym at 7:00 AM');
  });
  it('includes the date with withDate', () => {
    expect(formatEventForSpeech(ev('1', 'Dentist', '2026-06-20T18:00:00Z'), tz, { withDate: true })).toBe('Dentist on Jun 20 at 2:00 PM');
  });
  it('handles all-day events', () => {
    expect(formatEventForSpeech({ summary: 'Holiday', start: { date: '2026-06-20' } }, tz, { withDate: true })).toBe('Holiday (all day Jun 20)');
  });
});

describe('findOverlappingEvents (R15)', () => {
  const at = (h: string) => `2026-06-20T${h}:00Z`;
  const events = [
    ev('1', 'Meeting', at('18:00'), at('19:00')), // 2–3pm Toronto
    ev('2', 'All day', null),
  ];
  it('detects an overlapping timed event', () => {
    const startMs = Date.parse(at('18:30')), endMs = Date.parse(at('19:30'));
    expect(findOverlappingEvents(events, startMs, endMs).map(e => e.id)).toEqual(['1']);
  });
  it('returns nothing for a free window', () => {
    const startMs = Date.parse(at('20:00')), endMs = Date.parse(at('21:00'));
    expect(findOverlappingEvents(events, startMs, endMs)).toEqual([]);
  });
  it('ignores all-day events', () => {
    const startMs = Date.parse(at('00:00')), endMs = Date.parse(at('23:59'));
    expect(findOverlappingEvents(events, startMs, endMs).map(e => e.id)).toEqual(['1']);
  });
});
