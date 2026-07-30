import { describe, it, expect } from 'vitest';
import { buildJournalSystemPrompt } from './vapi';

describe('buildJournalSystemPrompt', () => {
  const prompt = buildJournalSystemPrompt('Derrick', 'Monday June 22', 'morning', '');

  it('identifies as a journaling session, not a briefing/gratitude call', () => {
    expect(prompt).toContain('JOURNALING session');
    expect(prompt).toMatch(/think(ing)? out loud/i);
  });

  it('uses the first name and date in the opener', () => {
    expect(prompt).toContain('Derrick');
    expect(prompt).toContain('Monday June 22');
  });

  it('steers away from cheerleading, toward questions/insight (call-feedback ask)', () => {
    expect(prompt).toMatch(/NOT a cheerleader/i);
    expect(prompt).toMatch(/QUESTION or a SHARP OBSERVATION/i);
  });

  it('tells Edge to listen first and tolerate silence', () => {
    expect(prompt).toMatch(/LISTEN FIRST/i);
    expect(prompt).toMatch(/pauses are fine/i);
  });

  it('permits a short filler while processing (natural-pace ask)', () => {
    expect(prompt).toMatch(/hmm/i);
  });

  it('confirms the entry is saved at close, without re-summarizing', () => {
    expect(prompt).toMatch(/saved to your journal/i);
    expect(prompt).toMatch(/Don't re-summarize/i);
  });

  it('includes a memory block only when memory text is provided', () => {
    expect(prompt).not.toContain('MEMORY —');
    const withMem = buildJournalSystemPrompt('Derrick', 'Monday June 22', 'morning', 'Owns a cottage up north.');
    expect(withMem).toContain('MEMORY —');
    expect(withMem).toContain('cottage up north');
  });
});
