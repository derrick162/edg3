import { describe, it, expect } from 'vitest';
import { emailableRecipients, formatSlotsForEmail, buildOutreachBody } from './outreach';

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
