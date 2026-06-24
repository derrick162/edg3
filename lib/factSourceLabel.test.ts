import { describe, it, expect } from 'vitest';
import { factSourceLabel } from './factSourceLabel';

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
