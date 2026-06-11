import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ create: vi.fn() }));

vi.mock('@anthropic-ai/sdk', () => ({
  default: class {
    messages = { create: h.create };
  },
}));

import { computeAlignment, detectHygieneFlags, type AlignmentResult } from './alignment';
import type { Priority } from './db';

// ── Helpers ──────────────────────────────────────────────────────────────────

function priority(text: string, rank: number): Priority {
  return { id: rank, user_id: 1, text, rank, week_of: '2026-06-09', created_at: '2026-06-09' };
}

function timedEvent(title: string, durationHours: number) {
  const start = new Date('2026-06-10T10:00:00Z');
  const end = new Date(start.getTime() + durationHours * 3600_000);
  return { summary: title, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
}

function classifyResponse(pairs: { event: string; priority: string }[]) {
  return { content: [{ type: 'text', text: JSON.stringify(pairs) }] };
}

beforeEach(() => vi.clearAllMocks());

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('computeAlignment', () => {
  it('returns null when there are no priorities', async () => {
    const result = await computeAlignment([], [timedEvent('Team sync', 1)], 'America/Vancouver');
    expect(result).toBeNull();
    expect(h.create).not.toHaveBeenCalled();
  });

  it('returns zero hours for all priorities when there are no events', async () => {
    const result = await computeAlignment(
      [priority('fundraising', 1), priority('hiring', 2)],
      [],
      'America/Vancouver',
    );
    expect(result).not.toBeNull();
    expect(h.create).not.toHaveBeenCalled();
    expect(result!.perPriority).toEqual([
      { priority: 'fundraising', hours: 0, blocked: false },
      { priority: 'hiring', hours: 0, blocked: false },
    ]);
    expect(result!.unalignedHours).toBe(0);
  });

  it('flags priorities with 0h as not blocked; blocked:true when hours > 0', async () => {
    // Classifier assigns the event to priority 2 ("hiring"); priority 1 ("fundraising") gets 0h.
    h.create.mockResolvedValue(classifyResponse([{ event: 'Interview loop', priority: '2' }]));

    const result = await computeAlignment(
      [priority('fundraising', 1), priority('hiring', 2)],
      [timedEvent('Interview loop', 2)],
      'America/Vancouver',
    );

    expect(result).not.toBeNull();
    const fundraising = result!.perPriority.find(p => p.priority === 'fundraising')!;
    expect(fundraising.hours).toBe(0);
    expect(fundraising.blocked).toBe(false);

    const hiring = result!.perPriority.find(p => p.priority === 'hiring')!;
    expect(hiring.hours).toBe(2);
    expect(hiring.blocked).toBe(true);
  });

  it('sums unaligned hours and ranks topUnaligned by size', async () => {
    h.create.mockResolvedValue(classifyResponse([
      { event: 'Team sync', priority: 'none' },
      { event: 'Misc admin', priority: 'none' },
      { event: 'Investor call', priority: '1' },
    ]));

    const result = await computeAlignment(
      [priority('fundraising', 1)],
      [timedEvent('Team sync', 2), timedEvent('Misc admin', 0.5), timedEvent('Investor call', 1)],
      'America/Vancouver',
    );

    expect(result!.unalignedHours).toBe(2.5);
    expect(result!.topUnaligned[0].title).toBe('Team sync');   // largest first
    expect(result!.topUnaligned[0].hours).toBe(2);
    expect(result!.topUnaligned[1].title).toBe('Misc admin');
    expect(result!.perPriority[0].hours).toBe(1);
    expect(result!.perPriority[0].blocked).toBe(true);
  });

  it('degrades to null when the classifier returns no JSON array', async () => {
    h.create.mockResolvedValue({ content: [{ type: 'text', text: 'I cannot classify these events.' }] });

    const result = await computeAlignment(
      [priority('fundraising', 1)],
      [timedEvent('Team sync', 1)],
      'America/Vancouver',
    );
    expect(result).toBeNull();
  });

  it('degrades to null when the Anthropic call throws', async () => {
    h.create.mockRejectedValue(new Error('network failure'));

    const result = await computeAlignment(
      [priority('fundraising', 1)],
      [timedEvent('Team sync', 1)],
      'America/Vancouver',
    );
    expect(result).toBeNull();
  });

  it('gracefully ignores classifier entries whose event title does not match', async () => {
    // Classifier hallucinates a title that wasn't in the events list.
    h.create.mockResolvedValue(classifyResponse([
      { event: 'HALLUCINATED EVENT', priority: '1' },
      { event: 'Real meeting', priority: 'none' },
    ]));

    const result = await computeAlignment(
      [priority('fundraising', 1)],
      [timedEvent('Real meeting', 1.5)],
      'America/Vancouver',
    );

    // Hallucinated entry is skipped; real event is unaligned
    expect(result!.perPriority[0].hours).toBe(0);
    expect(result!.unalignedHours).toBe(1.5);
  });

  it('caps event input at 40 and still returns a result', async () => {
    const manyEvents = Array.from({ length: 50 }, (_, i) => timedEvent(`Event ${i}`, 0.5));
    h.create.mockResolvedValue(classifyResponse([])); // empty classification → all unaligned, but only 40 sent

    const result = await computeAlignment([priority('work', 1)], manyEvents, 'UTC');
    expect(result).not.toBeNull();
    // Verify only 40 events were included in the prompt
    const promptArg = h.create.mock.calls[0][0].messages[0].content as string;
    const listed = (promptArg.match(/"Event \d+"/g) ?? []).length;
    expect(listed).toBeLessThanOrEqual(40);
  });
});

// ── detectHygieneFlags tests ──────────────────────────────────────────────────

function meeting(title: string, startIso: string, durationMin: number) {
  const start = new Date(startIso);
  const end = new Date(start.getTime() + durationMin * 60_000);
  return { summary: title, start: { dateTime: start.toISOString() }, end: { dateTime: end.toISOString() } };
}

const TZ = 'America/Vancouver'; // UTC-7

describe('detectHygieneFlags', () => {
  it('returns null when there are no events', () => {
    expect(detectHygieneFlags([], TZ)).toBeNull();
  });

  it('returns null when events are all-day (no dateTime)', () => {
    const allDay = [{ summary: 'Conference', start: { date: '2026-06-10' }, end: { date: '2026-06-11' } }];
    expect(detectHygieneFlags(allDay, TZ)).toBeNull();
  });

  it('detects back-to-back overload when 3 meetings have < 15 min gaps', () => {
    const events = [
      meeting('Standup',    '2026-06-10T09:00:00-07:00', 30),
      meeting('1-on-1',     '2026-06-10T09:35:00-07:00', 30), // 5 min gap → back-to-back
      meeting('Team review', '2026-06-10T10:10:00-07:00', 30), // 5 min gap → 3rd in streak
    ];
    const result = detectHygieneFlags(events, TZ);
    expect(result).not.toBeNull();
    expect(result).toMatch(/back-to-back/);
    expect(result).toMatch(/Wednesday/);
  });

  it('does NOT flag when gaps are >= 15 min between consecutive meetings', () => {
    const events = [
      meeting('Standup',  '2026-06-10T09:00:00-07:00', 30),
      meeting('1-on-1',   '2026-06-10T09:45:00-07:00', 30), // 15 min gap — just ok
      meeting('Strategy', '2026-06-10T10:30:00-07:00', 30), // 15 min gap — just ok
    ];
    expect(detectHygieneFlags(events, TZ)).toBeNull();
  });

  it('does NOT flag back-to-back when streak resets after a long gap', () => {
    const events = [
      meeting('A', '2026-06-10T09:00:00-07:00', 30),
      meeting('B', '2026-06-10T09:35:00-07:00', 30), // 5 min gap → streak 2
      meeting('C', '2026-06-10T11:00:00-07:00', 30), // 55 min gap → streak resets to 1
      meeting('D', '2026-06-10T11:35:00-07:00', 30), // 5 min gap → streak 2 (not 3)
    ];
    expect(detectHygieneFlags(events, TZ)).toBeNull();
  });

  it('detects no-focus-week when all busy days are wall-to-wall', () => {
    // 3 days each with 2 meetings and < 90 min gap
    const events = [
      meeting('A', '2026-06-09T09:00:00-07:00', 60),
      meeting('B', '2026-06-09T10:30:00-07:00', 60), // 30 min gap — < 90
      meeting('C', '2026-06-10T09:00:00-07:00', 60),
      meeting('D', '2026-06-10T10:30:00-07:00', 60), // 30 min gap — < 90
      meeting('E', '2026-06-11T09:00:00-07:00', 60),
      meeting('F', '2026-06-11T10:30:00-07:00', 60), // 30 min gap — < 90
    ];
    const result = detectHygieneFlags(events, TZ);
    expect(result).not.toBeNull();
    expect(result).toMatch(/packed/);
  });

  it('does NOT flag no-focus-week when at least one day has a 90+ min gap', () => {
    const events = [
      meeting('A', '2026-06-09T09:00:00-07:00', 60),
      meeting('B', '2026-06-09T10:30:00-07:00', 60), // 30 min gap — packed
      meeting('C', '2026-06-10T09:00:00-07:00', 60),
      meeting('D', '2026-06-10T10:30:00-07:00', 60), // 30 min gap — packed
      meeting('E', '2026-06-11T09:00:00-07:00', 60),
      meeting('F', '2026-06-11T11:30:00-07:00', 60), // 90 min gap → focus exists
    ];
    expect(detectHygieneFlags(events, TZ)).toBeNull();
  });

  it('prioritises back-to-back over no-focus-week (returns first finding)', () => {
    // Wednesday has back-to-back; no day has 90 min gap
    const events = [
      meeting('A', '2026-06-10T09:00:00-07:00', 30),
      meeting('B', '2026-06-10T09:35:00-07:00', 30), // 5 min → streak 2
      meeting('C', '2026-06-10T10:10:00-07:00', 30), // 5 min → streak 3 ← flagged
      meeting('D', '2026-06-09T09:00:00-07:00', 60),
      meeting('E', '2026-06-09T10:30:00-07:00', 60), // 30 min gap
      meeting('F', '2026-06-11T09:00:00-07:00', 60),
      meeting('G', '2026-06-11T10:30:00-07:00', 60), // 30 min gap
    ];
    const result = detectHygieneFlags(events, TZ);
    expect(result).not.toBeNull();
    expect(result).toMatch(/back-to-back/); // back-to-back wins
  });
});
