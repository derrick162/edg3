import { describe, it, expect } from 'vitest';
import { emailableRecipients, formatSlotsForEmail, buildOutreachBody, recipientsFromNotes } from './outreach';

describe('emailableRecipients', () => {
  it('keeps valid emails and skips missing / "not found"', () => {
    const { ok, skipped } = emailableRecipients([
      { name: 'Alice', email: 'alice@plumb.co' },
      { name: 'Bob', email: 'Email: not found' },
      { name: 'Carol' },
      { name: 'Dave', email: 'not-an-email' },
    ]);
    expect(ok).toEqual([{ name: 'Alice', email: 'alice@plumb.co' }]);
    expect(skipped).toEqual(['Bob', 'Carol', 'Dave']);
  });

  it('trims whitespace and tolerates empty input', () => {
    const { ok } = emailableRecipients([{ name: '  Eve  ', email: '  eve@x.io  ' }]);
    expect(ok).toEqual([{ name: 'Eve', email: 'eve@x.io' }]);
    expect(emailableRecipients([]).ok).toEqual([]);
    expect(emailableRecipients(undefined as never).skipped).toEqual([]);
  });
});

describe('formatSlotsForEmail', () => {
  it('strips header, "min free" suffix, and the "…and N more" trailer', () => {
    const input = [
      'Open time (at least 30 minutes, 8am–8pm):',
      'Mon, Jun 9: 9:00 AM–11:00 AM (90 min free)',
      'Tue, Jun 10: 1:00 PM–3:00 PM (120 min free)',
      '…and 4 more.',
    ].join('\n');
    expect(formatSlotsForEmail(input)).toEqual([
      'Mon, Jun 9: 9:00 AM–11:00 AM',
      'Tue, Jun 10: 1:00 PM–3:00 PM',
    ]);
  });

  it('returns [] for the no-availability and error messages', () => {
    expect(formatSlotsForEmail('No open blocks of at least 30 minutes between 2026-06-09 and 2026-06-13 (within 8am–8pm).')).toEqual([]);
    expect(formatSlotsForEmail('I need a valid start and end date to check availability.')).toEqual([]);
    expect(formatSlotsForEmail('')).toEqual([]);
  });
});

describe('recipientsFromNotes', () => {
  const RESEARCH_BLOCK = `
Acme Plumbing
Phone: 604-555-0100
Email: fix@acmeplumbing.com
Website: acmeplumbing.com

Bob's Pipes
Email: not found
Phone: 604-555-0200

City Drains Ltd
Email: hello@citydrains.ca
`.trim();

  it('extracts contacts with valid emails, skipping "not found" entries', () => {
    const result = recipientsFromNotes(RESEARCH_BLOCK);
    expect(result).toHaveLength(2);
    expect(result[0]).toEqual({ name: 'Acme Plumbing', email: 'fix@acmeplumbing.com' });
    expect(result[1]).toEqual({ name: 'City Drains Ltd', email: 'hello@citydrains.ca' });
  });

  it('deduplicates emails (case-insensitive)', () => {
    const notes = `
Alpha
Email: a@test.com

Alpha duplicate
Email: A@TEST.COM
`.trim();
    expect(recipientsFromNotes(notes)).toHaveLength(1);
  });

  it('strips the Edge research delimiter lines before parsing', () => {
    const withDelimiters = `--- Edge research (latest) ---\n${RESEARCH_BLOCK}\n--- end Edge research ---`;
    const result = recipientsFromNotes(withDelimiters);
    expect(result).toHaveLength(2);
  });

  it('returns [] for empty / no-email notes', () => {
    expect(recipientsFromNotes('')).toEqual([]);
    expect(recipientsFromNotes('Some notes with no email lines here.')).toEqual([]);
  });

  it('uses the first non-label line in the block as the contact name', () => {
    const notes = `
Website: widgetco.com
Widget Co Inc
Email: info@widgetco.com
`.trim();
    // "Website: ..." is a label line, so "Widget Co Inc" should be picked as the name
    const result = recipientsFromNotes(notes);
    expect(result[0].name).toBe('Widget Co Inc');
  });
});

describe('buildOutreachBody', () => {
  it('includes greeting, ask, slots, and sign-off when slots exist', () => {
    const body = buildOutreachBody({
      recipientName: 'Alice',
      senderName: 'Derrick',
      ask: 'When could you come by this week?',
      slots: ['Mon, Jun 9: 9:00 AM–11:00 AM', 'Tue, Jun 10: 1:00 PM–3:00 PM'],
    });
    expect(body).toMatch(/^Hi Alice,/);
    expect(body).toContain('When could you come by this week?');
    expect(body).toContain('  - Mon, Jun 9: 9:00 AM–11:00 AM');
    expect(body).toContain('  - Tue, Jun 10: 1:00 PM–3:00 PM');
    expect(body.trimEnd().endsWith('Derrick')).toBe(true);
  });

  it('falls back to a generic availability line and "Hello," when no name/slots', () => {
    const body = buildOutreachBody({ senderName: 'Derrick', ask: 'Are you available this week?', slots: [] });
    expect(body).toMatch(/^Hello,/);
    expect(body).toContain("Let me know what times work for you");
    expect(body).not.toContain('  - ');
  });
});
