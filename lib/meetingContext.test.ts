import { describe, it, expect } from 'vitest';
import { extractKeywords, eventTokens, buildMeetingContext, buildMeetingContexts, formatMeetingContextsForBriefing } from './meetingContext';
import type { calendar_v3 } from 'googleapis';
import type { EmailSignalItem } from './gmail';
import type { Fact, OpenLoop } from './db';

// ── Helpers ───────────────────────────────────────────────────────────────────

function event(
  summary: string,
  startTime: string,
  attendees: Array<{ displayName?: string; email: string; self?: boolean }> = [],
): calendar_v3.Schema$Event {
  return {
    id: `evt-${summary}`,
    summary,
    start: { dateTime: startTime },
    end: { dateTime: startTime },
    attendees,
  };
}

function emailItem(sender: string, subject: string, snippet = ''): EmailSignalItem {
  return { threadId: `t-${subject}`, sender, subject, snippet, date: '2026-06-15', isUnread: true, isImportant: false };
}

function fact(category: 'person' | 'goal' | 'project' | 'preference' | 'fact', entity: string | null, statement: string): Fact {
  return { id: 1, user_id: 1, category, statement, entity, learned_at: '2026-06-01', confidence: 'high', source_briefing_id: null };
}

function loop(description: string, type: OpenLoop['type'] = 'commitment_made'): OpenLoop {
  return { id: 1, userId: 1, description, type, source: 'call', dueDate: null, status: 'open', createdAt: '2026-06-15', resolvedAt: null, snoozedUntil: null };
}

// ── extractKeywords ───────────────────────────────────────────────────────────

describe('extractKeywords', () => {
  it('returns meaningful words >= 4 chars', () => {
    const kws = extractKeywords('Investor call with Faiza');
    expect(kws).toContain('faiza');
    expect(kws).not.toContain('with'); // stop word
    expect(kws).not.toContain('call'); // stop word
  });

  it('filters short words', () => {
    const kws = extractKeywords('CIBC deal review');
    expect(kws).toContain('cibc');
    expect(kws).toContain('deal');
    expect(kws).toContain('review');
    expect(kws).not.toContain('of');
  });

  it('returns [] for stop-word-only text', () => {
    expect(extractKeywords('call with the team')).toEqual([]);
  });
});

// ── eventTokens ───────────────────────────────────────────────────────────────

describe('eventTokens', () => {
  it('includes attendee first name', () => {
    const e = event('Strategy call', '2026-06-15T14:00:00Z', [
      { displayName: 'Faiza Khan', email: 'faiza@cibc.com' },
    ]);
    const tokens = eventTokens(e);
    expect(tokens).toContain('faiza');
    expect(tokens).toContain('khan');
  });

  it('includes email prefix when no displayName', () => {
    const e = event('Meeting', '2026-06-15T14:00:00Z', [
      { email: 'john.smith@bank.com' },
    ]);
    const tokens = eventTokens(e);
    expect(tokens).toContain('john');
    expect(tokens).toContain('smith');
  });

  it('includes keywords from event title', () => {
    const e = event('CIBC proposal review', '2026-06-15T14:00:00Z');
    const tokens = eventTokens(e);
    expect(tokens).toContain('cibc');
    expect(tokens).toContain('proposal');
  });

  it('excludes self attendees', () => {
    const e = event('Meeting', '2026-06-15T14:00:00Z', [
      { displayName: 'Derrick Fung', email: 'derrick@me.com', self: true },
      { displayName: 'Faiza Khan', email: 'faiza@cibc.com' },
    ]);
    const tokens = eventTokens(e);
    expect(tokens).not.toContain('derrick');
    expect(tokens).toContain('faiza');
  });

  it('returns [] for event with no attendees and stop-word-only title', () => {
    const e = event('Call with the team', '2026-06-15T14:00:00Z');
    expect(eventTokens(e)).toEqual([]);
  });
});

// ── buildMeetingContext ───────────────────────────────────────────────────────

describe('buildMeetingContext', () => {
  it('returns null when no summary', () => {
    const e = event('', '2026-06-15T14:00:00Z');
    expect(buildMeetingContext(e, [], [], [])).toBeNull();
  });

  it('returns null when no token overlap with any source', () => {
    const e = event('CIBC proposal review', '2026-06-15T14:00:00Z');
    const emails = [emailItem('someone@other.com', 'Weekly newsletter')];
    expect(buildMeetingContext(e, emails, [], [])).toBeNull();
  });

  it('returns null when tokens extracted but no events or facts match', () => {
    const e = event('Yoga class', '2026-06-15T07:00:00Z');
    const emails = [emailItem('bank@cibc.com', 'Payment overdue')];
    expect(buildMeetingContext(e, emails, [], [])).toBeNull();
  });

  it('matches email by sender name overlap', () => {
    const e = event('Call with Faiza', '2026-06-15T14:00:00Z', [
      { displayName: 'Faiza Khan', email: 'faiza@cibc.com' },
    ]);
    const emails = [emailItem('Faiza Khan <faiza@cibc.com>', 'CIBC deal update', 'Here are the latest terms')];
    const ctx = buildMeetingContext(e, emails, [], []);
    expect(ctx).not.toBeNull();
    expect(ctx!.relatedEmails).toHaveLength(1);
    expect(ctx!.relatedEmails[0].sender).toContain('Faiza');
  });

  it('ranks emails by overlap score', () => {
    const e = event('CIBC negotiation', '2026-06-15T14:00:00Z', [
      { displayName: 'Faiza Khan', email: 'faiza@cibc.com' },
    ]);
    const emails = [
      emailItem('someone@other.com', 'CIBC proposal update'),             // 1 match: cibc
      emailItem('Faiza Khan <faiza@cibc.com>', 'CIBC negotiation terms'), // 3 matches: faiza, cibc, negotiation
      emailItem('newsletter@news.com', 'Weekly roundup'),                  // 0 matches
    ];
    const ctx = buildMeetingContext(e, emails, [], []);
    expect(ctx).not.toBeNull();
    // Highest scoring email first
    expect(ctx!.relatedEmails[0].sender).toContain('Faiza');
  });

  it('caps related emails at 3', () => {
    const e = event('CIBC investor meeting', '2026-06-15T14:00:00Z');
    const emails = Array.from({ length: 6 }, (_, i) =>
      emailItem(`person${i}@cibc.com`, `CIBC update ${i}`),
    );
    const ctx = buildMeetingContext(e, emails, [], []);
    expect(ctx!.relatedEmails.length).toBeLessThanOrEqual(3);
  });

  it('matches facts by entity', () => {
    const e = event('Call with Faiza', '2026-06-15T14:00:00Z', [
      { displayName: 'Faiza Khan', email: 'faiza@cibc.com' },
    ]);
    const facts = [
      fact('person', 'Faiza Khan', 'Decision-maker at CIBC for the debt negotiation'),
      fact('goal', null, 'Raise runway'), // no entity → skip
    ];
    const ctx = buildMeetingContext(e, [], facts, []);
    expect(ctx).not.toBeNull();
    expect(ctx!.relatedFacts).toHaveLength(1);
    expect(ctx!.relatedFacts[0].entity).toBe('Faiza Khan');
  });

  it('caps related facts at 4', () => {
    const e = event('CIBC meeting', '2026-06-15T14:00:00Z');
    const facts = Array.from({ length: 8 }, (_, i) =>
      fact('person', `CIBC contact ${i}`, `Statement about cibc ${i}`),
    );
    const ctx = buildMeetingContext(e, [], facts, []);
    expect(ctx!.relatedFacts.length).toBeLessThanOrEqual(4);
  });

  it('matches open loops by description', () => {
    const e = event('CIBC call', '2026-06-15T14:00:00Z');
    const loops = [
      loop('Send CIBC proposal by Friday'),
      loop('Reply to gym membership inquiry'),  // no match
    ];
    const ctx = buildMeetingContext(e, [], [], loops);
    expect(ctx).not.toBeNull();
    expect(ctx!.relatedLoops).toHaveLength(1);
    expect(ctx!.relatedLoops[0].description).toContain('CIBC');
  });

  it('returns attendeeNames without self', () => {
    const e = event('Investor call', '2026-06-15T14:00:00Z', [
      { displayName: 'Derrick Fung', email: 'me@me.com', self: true },
      { displayName: 'Investor Alice', email: 'alice@fund.com' },
    ]);
    const emails = [emailItem('alice@fund.com', 'Investor update alice fund')];
    const ctx = buildMeetingContext(e, emails, [], []);
    expect(ctx!.attendeeNames).toEqual(['Investor Alice']);
  });
});

// ── buildMeetingContexts ──────────────────────────────────────────────────────

describe('buildMeetingContexts', () => {
  const now = '2026-06-15T10:00:00Z';

  it('returns empty when no events within lookAheadHours', () => {
    const events = [event('CIBC meeting', '2026-06-15T22:00:00Z')];  // 12h away
    const emails = [emailItem('faiza@cibc.com', 'CIBC update')];
    expect(buildMeetingContexts(events, emails, [], [], { lookAheadHours: 8, now })).toEqual([]);
  });

  it('filters to events within lookAheadHours', () => {
    const events = [
      event('CIBC meeting soon', '2026-06-15T14:00:00Z'),  // 4h away — in window
      event('Meeting later', '2026-06-15T22:00:00Z'),       // 12h away — skip
    ];
    const emails = [emailItem('faiza@cibc.com', 'CIBC proposal')];
    const contexts = buildMeetingContexts(events, emails, [], [], { lookAheadHours: 8, now });
    expect(contexts.length).toBeGreaterThanOrEqual(1);
    expect(contexts[0].eventSummary).toContain('CIBC');
  });

  it('skips all-day events (no dateTime)', () => {
    const allDay: calendar_v3.Schema$Event = {
      summary: 'CIBC all day',
      start: { date: '2026-06-15' },
      end: { date: '2026-06-16' },
    };
    const emails = [emailItem('faiza@cibc.com', 'CIBC update')];
    expect(buildMeetingContexts([allDay], emails, [], [], { lookAheadHours: 8, now })).toEqual([]);
  });

  it('caps at max contexts', () => {
    const events = Array.from({ length: 6 }, (_, i) =>
      event(`CIBC event ${i}`, `2026-06-15T1${i}:00:00Z`),
    );
    const emails = Array.from({ length: 6 }, (_, i) =>
      emailItem(`p${i}@cibc.com`, `CIBC update ${i}`),
    );
    const contexts = buildMeetingContexts(events, emails, [], [], { lookAheadHours: 8, now, max: 2 });
    expect(contexts.length).toBeLessThanOrEqual(2);
  });
});

// ── formatMeetingContextsForBriefing ─────────────────────────────────────────

describe('formatMeetingContextsForBriefing', () => {
  it('returns empty string for no contexts', () => {
    expect(formatMeetingContextsForBriefing([])).toBe('');
  });

  it('includes event summary in output', () => {
    const e = event('CIBC investor call', '2026-06-15T14:00:00Z', [
      { displayName: 'Faiza Khan', email: 'faiza@cibc.com' },
    ]);
    const emails = [emailItem('Faiza Khan <faiza@cibc.com>', 'CIBC deal closing', 'Ready to close')];
    const ctx = buildMeetingContext(e, emails, [], []);
    const result = formatMeetingContextsForBriefing([ctx!]);
    expect(result).toContain('CIBC investor call');
    expect(result).toContain('Faiza Khan');
    expect(result).toContain('[EMAIL]');
    expect(result).toContain('CIBC deal closing');
  });

  it('includes facts with category tag', () => {
    const e = event('CIBC call', '2026-06-15T14:00:00Z');
    const facts = [fact('person', 'CIBC contact', 'Decision-maker at CIBC')];
    const ctx = buildMeetingContext(e, [], facts, []);
    const result = formatMeetingContextsForBriefing([ctx!]);
    expect(result).toContain('[PERSON]');
    expect(result).toContain('Decision-maker at CIBC');
  });

  it('includes open loops with commitment tag', () => {
    const e = event('CIBC call', '2026-06-15T14:00:00Z');
    const loops = [loop('Send CIBC proposal', 'commitment_made')];
    const ctx = buildMeetingContext(e, [], [], loops);
    const result = formatMeetingContextsForBriefing([ctx!]);
    expect(result).toContain('[YOU COMMITTED]');
    expect(result).toContain('Send CIBC proposal');
  });
});
