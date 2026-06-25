import { describe, it, expect } from 'vitest';
import { factSourceLabel, parseDbTimestamp } from './factSourceLabel';

describe('parseDbTimestamp (R41 T0 — SQLite UTC timestamps)', () => {
  it('treats a bare "YYYY-MM-DD HH:MM:SS" string as UTC (not local)', () => {
    // 02:00 UTC = the instant a 10 PM EDT save lands. Must parse as that UTC instant.
    expect(parseDbTimestamp('2026-06-25 02:00:00').toISOString()).toBe('2026-06-25T02:00:00.000Z');
  });
  it('respects an explicit Z / offset (idempotent)', () => {
    expect(parseDbTimestamp('2026-06-20T08:00:00Z').toISOString()).toBe('2026-06-20T08:00:00.000Z');
    expect(parseDbTimestamp('2026-06-20T08:00:00-04:00').toISOString()).toBe('2026-06-20T12:00:00.000Z');
  });
  it('returns an Invalid Date for empty input (no throw)', () => {
    expect(Number.isNaN(parseDbTimestamp('').getTime())).toBe(true);
  });
});

describe('factSourceLabel (R25 T5 — call source provenance)', () => {
  it('labels a fact from an open/gratitude call "from your open call"', () => {
    const r = factSourceLabel({ learned_at: '2026-06-20T08:00:00Z', source_briefing_id: 42, source_is_open_call: 1 });
    expect(r.text).toBe('learned Jun 20 · from your open call');
    expect(r.href).toBe('/dashboard?briefing=42');
  });

  it('labels a fact from a morning briefing "from your morning call"', () => {
    const r = factSourceLabel({ learned_at: '2026-06-20T08:00:00Z', source_briefing_id: 42, source_is_open_call: 0 });
    expect(r.text).toBe('learned Jun 20 · from your morning call');
    expect(r.href).toBe('/dashboard?briefing=42');
  });

  it('leaves a fact with no briefing source unchanged (no call label, no href)', () => {
    const r = factSourceLabel({ learned_at: '2026-06-20T08:00:00Z' });
    expect(r.text).toBe('learned Jun 20');
    expect(r.href).toBeNull();
  });

  it('still honors non-call sources (email/priorities) over the call label', () => {
    expect(factSourceLabel({ learned_at: '2026-06-20T08:00:00Z', source: 'email' }).text)
      .toBe('learned Jun 20 · from your inbox');
    expect(factSourceLabel({ learned_at: '2026-06-20T08:00:00Z', source: 'priority-sync' }).text)
      .toBe('learned Jun 20 · from your priorities');
  });
});
