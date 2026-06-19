import { describe, it, expect } from 'vitest';
import { buildFallbackBriefing, buildWhoopSection, buildEnergyMatchingBlock, buildBaselineContext, buildPersonalizationPromptBlock, buildBriefingContext, buildPeopleModelBlock } from './briefing';
import type { Fact, PersonModel } from './db';

function makePref(statement: string, id = 1): Fact {
  return { id, user_id: 1, category: 'preference', statement, entity: null, learned_at: '2026-06-13T00:00:00', confidence: 'high', source_briefing_id: null };
}

describe('buildFallbackBriefing', () => {
  it('uses first name only, not full name', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick Fung', '', '');
    expect(result).toContain('Good morning, Derrick');
    expect(result).not.toContain('Fung');
  });

  it('includes calendar events when present', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick', '9 AM: Investor call\n2 PM: Team sync', '1. Fundraising');
    expect(result).toContain('Investor call');
    expect(result).toContain('Team sync');
  });

  it('acknowledges no calendar events gracefully', () => {
    const result = buildFallbackBriefing('Good afternoon', 'Derrick', '', '1. Fundraising');
    expect(result).toMatch(/nothing.*scheduled|no.*events/i);
  });

  it('includes priorities when present', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick', '', '1. Fundraising\n2. Product');
    expect(result).toContain('Fundraising');
    expect(result).toContain('Product');
  });

  it('skips priorities section when none set', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick', '', 'No priorities set for this week.');
    expect(result).not.toContain('priorities this week are');
  });

  it('always ends with a closing question', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick', '', '');
    expect(result).toMatch(/what.s most on your mind|what.s the most important/i);
  });

  it('returns a plain-text string with no markdown', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick', '9 AM: Meeting', '1. Fundraising');
    expect(result).not.toMatch(/[*_#`]|^\d+\./m);
  });
});

describe('buildWhoopSection', () => {
  it('returns null when all inputs are null (not connected)', () => {
    expect(buildWhoopSection(null, null, null)).toBeNull();
  });

  it('includes recovery score when provided', () => {
    const result = buildWhoopSection({ recoveryScore: 34, hrv: 55, restingHeartRate: 58 }, null, null);
    expect(result).toContain('RECOVERY: 34%');
  });

  it('formats sleep duration as spoken hours and minutes', () => {
    // 5h 12m = 312 minutes = 18720000 ms
    const result = buildWhoopSection(null, { durationMs: 18_720_000, performancePct: 82, efficiencyPct: 91 }, null);
    expect(result).toContain('SLEEP: 5 hours 12 minutes (score 82%)');
  });

  it('drops minutes when the duration is a whole number of hours', () => {
    // 6h 05m = 365 minutes = 21900000 ms — spoken, not "6h05m" (misread as "6 H 5 meters")
    const result = buildWhoopSection(null, { durationMs: 21_900_000, performancePct: 88, efficiencyPct: 93 }, null);
    expect(result).toContain('SLEEP: 6 hours 5 minutes (score 88%)');
  });

  it('includes strain when provided', () => {
    const result = buildWhoopSection(null, null, { strain: 14.2, avgHeartRate: 112 });
    expect(result).toContain('STRAIN: 14.2');
  });

  it('joins all three parts with middot separator', () => {
    const result = buildWhoopSection(
      { recoveryScore: 72, hrv: 68, restingHeartRate: 52 },
      { durationMs: 25_200_000, performancePct: 90, efficiencyPct: 94 }, // 7h00m
      { strain: 8.5, avgHeartRate: 98 },
    );
    expect(result).toBe('RECOVERY: 72% · SLEEP: 7 hours (score 90%) · STRAIN: 8.5');
  });

  it('returns just the available parts when some are null', () => {
    const result = buildWhoopSection({ recoveryScore: 55, hrv: 60, restingHeartRate: 60 }, null, { strain: 12.1, avgHeartRate: 105 });
    expect(result).toContain('RECOVERY: 55%');
    expect(result).toContain('STRAIN: 12.1');
    expect(result).not.toContain('SLEEP');
  });
});

describe('buildEnergyMatchingBlock', () => {
  it('returns null when no preferences', () => {
    expect(buildEnergyMatchingBlock([], null)).toBeNull();
  });

  it('returns null when preferences exist but none are energy-related', () => {
    const prefs = [makePref('User prefers email over Slack for async communication')];
    expect(buildEnergyMatchingBlock(prefs, null)).toBeNull();
  });

  it('returns a block when a preference mentions "peak"', () => {
    const prefs = [makePref('User\'s peak hours are 9–11am for deep creative work')];
    const result = buildEnergyMatchingBlock(prefs, null);
    expect(result).not.toBeNull();
    expect(result).toContain('ENERGY PROFILE');
    expect(result).toContain('peak hours');
  });

  it('includes all matching energy preferences', () => {
    const prefs = [
      makePref('User\'s peak hours are 9–11am', 1),
      makePref('User considers vibe-coding high energy work', 2),
      makePref('User prefers to handle email in the afternoon trough', 3),
      makePref('User prefers Slack for quick questions', 4),
    ];
    const result = buildEnergyMatchingBlock(prefs, null)!;
    expect(result).toContain('peak hours');
    expect(result).toContain('high energy work');
    expect(result).toContain('afternoon trough');
    expect(result).not.toContain('Slack for quick questions');
  });

  it('adds green recovery tier line when recovery is high', () => {
    const prefs = [makePref('User\'s energy peaks 9–11am')];
    const result = buildEnergyMatchingBlock(prefs, { recoveryScore: 80, hrv: 70, restingHeartRate: 50 })!;
    expect(result).toContain('80%');
    expect(result).toContain('full capacity');
  });

  it('adds red recovery tier line when recovery is low', () => {
    const prefs = [makePref('User has a deep work focus block each morning')];
    const result = buildEnergyMatchingBlock(prefs, { recoveryScore: 25, hrv: 40, restingHeartRate: 68 })!;
    expect(result).toContain('25%');
    expect(result).toContain('protect');
  });

  it('omits recovery line when recovery is null', () => {
    const prefs = [makePref('User prefers deep work in the morning peak window')];
    const result = buildEnergyMatchingBlock(prefs, null)!;
    expect(result).not.toContain('Whoop recovery');
  });

  it('matches "admin" keyword', () => {
    const prefs = [makePref('User batches admin tasks into the 2–3pm afternoon window')];
    const result = buildEnergyMatchingBlock(prefs, null);
    expect(result).not.toBeNull();
    expect(result).toContain('admin tasks');
  });
});

describe('buildBaselineContext', () => {
  const recovery = { recoveryScore: 45, hrv: 55, restingHeartRate: 60, date: '2026-06-13' };
  const history7 = [
    { date: '2026-06-12', value: 63 },
    { date: '2026-06-11', value: 70 },
    { date: '2026-06-10', value: 58 },
    { date: '2026-06-09', value: 65 },
    { date: '2026-06-08', value: 72 },
    { date: '2026-06-07', value: 60 },
    { date: '2026-06-06', value: 67 },
  ];
  const SLEEP_7H_MS = 7 * 3_600_000;
  const SLEEP_5H_MS = 5 * 3_600_000;

  it('returns null when no recovery data', () => {
    expect(buildBaselineContext(null, history7, [], null)).toBeNull();
  });

  it('returns null when fewer than 3 history points', () => {
    const thinHistory = [{ date: '2026-06-12', value: 63 }, { date: '2026-06-11', value: 70 }];
    expect(buildBaselineContext(recovery, thinHistory, [], null)).toBeNull();
  });

  it('includes today, 7-day avg, and delta', () => {
    const result = buildBaselineContext(recovery, history7, [], null);
    expect(result).not.toBeNull();
    expect(result).toContain('today 45%');
    expect(result).toContain('7-day avg');
    expect(result).toContain('-');
  });

  it('shows positive delta for above-average recovery', () => {
    const highRecovery = { recoveryScore: 80, hrv: 70, restingHeartRate: 50, date: '2026-06-13' };
    const result = buildBaselineContext(highRecovery, history7, [], null);
    expect(result).toContain('+');
  });

  it('does NOT add composite signal with only one bad signal', () => {
    // Red recovery only, sleep fine, no high strain
    const redRecovery = { recoveryScore: 25, hrv: 35, restingHeartRate: 72, date: '2026-06-13' };
    const goodSleep = Array(5).fill(SLEEP_7H_MS);
    const result = buildBaselineContext(redRecovery, history7, goodSleep, null);
    expect(result).not.toContain('COMPOSITE SIGNAL');
  });

  it('adds composite signal when red recovery + sleep debt compound', () => {
    const redRecovery = { recoveryScore: 25, hrv: 35, restingHeartRate: 72, date: '2026-06-13' };
    const shortSleep = Array(5).fill(SLEEP_5H_MS);
    const result = buildBaselineContext(redRecovery, history7, shortSleep, null);
    expect(result).toContain('COMPOSITE SIGNAL');
    expect(result).toContain('red recovery');
  });

  it('adds composite signal when red recovery + high strain compound', () => {
    const redRecovery = { recoveryScore: 25, hrv: 35, restingHeartRate: 72, date: '2026-06-13' };
    const result = buildBaselineContext(redRecovery, history7, [], 18.5);
    expect(result).toContain('COMPOSITE SIGNAL');
    expect(result).toContain('high strain yesterday');
  });

  it('does not add composite signal when strain is moderate (≤15)', () => {
    const highRecovery = { recoveryScore: 75, hrv: 75, restingHeartRate: 48, date: '2026-06-13' };
    const result = buildBaselineContext(highRecovery, history7, [], 14.9);
    expect(result).not.toContain('COMPOSITE SIGNAL');
  });

  it('adds composite signal when sleep debt + high strain compound (no red recovery)', () => {
    const okRecovery = { recoveryScore: 50, hrv: 55, restingHeartRate: 60, date: '2026-06-13' };
    const shortSleep = Array(5).fill(5 * 3_600_000); // 5h — below 6.5h threshold
    const result = buildBaselineContext(okRecovery, history7, shortSleep, 17.0);
    expect(result).toContain('COMPOSITE SIGNAL');
    expect(result).toContain('sleep averaging');
    expect(result).toContain('high strain yesterday');
  });
});

// ── T2-4 Briefing accuracy regression tests ───────────────────────────────────
// Guard against regressions in brand language, removed features, and prompt structure.

describe('T2-4 briefing accuracy regression', () => {
  it('fallback briefing never references the removed async note box', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick', '9 AM: Call', '1. Fundraising');
    expect(result).not.toMatch(/chat with edge|async note|send a note|message box/i);
  });

  it('fallback briefing uses "Edg3" not "Edge" for the assistant brand', () => {
    const result = buildFallbackBriefing('Good morning', 'Derrick', '', '');
    // Should not contain the old "Edge" brand (standalone word) — must be "Edg3"
    // Allow "Edge" only inside "Edg3" (the brand) or in context like "knowledge"
    const hasOldBrand = /\bEdge\b/.test(result) && !/Edg3/.test(result);
    expect(hasOldBrand).toBe(false);
  });

  it('buildWhoopSection formats recovery score as percentage', () => {
    const result = buildWhoopSection({ recoveryScore: 67, hrv: 60, restingHeartRate: 55 }, null, null);
    expect(result).toContain('67%');
    expect(result).not.toContain('67 percent'); // must use % symbol
  });

  it('buildWhoopSection formats 6h 0m as "6 hours" (no trailing zero minutes)', () => {
    const result = buildWhoopSection(null, { durationMs: 6 * 3_600_000, performancePct: 85, efficiencyPct: 90 }, null);
    expect(result).toContain('6 hours');
    expect(result).not.toContain('6 hours 0 minutes');
  });

  it('buildBaselineContext always includes today and delta line', () => {
    const r = { recoveryScore: 72, hrv: 68, restingHeartRate: 52, date: '2026-06-17' };
    const h = [
      { date: '2026-06-16', value: 65 },
      { date: '2026-06-15', value: 70 },
      { date: '2026-06-14', value: 68 },
    ];
    const result = buildBaselineContext(r, h, [], null)!;
    expect(result).toContain('today 72%');
    expect(result).toMatch(/7-day avg \d+%/);
    expect(result).toMatch(/[+-]\d+ pts/);
  });
});

// ── DC2-2: Personalization signal — minimum 3 facts floor ──────────────────
describe('DC2-2 buildPersonalizationPromptBlock', () => {
  it('returns null when 3 or more facts exist (personalized path)', () => {
    expect(buildPersonalizationPromptBlock(3)).toBeNull();
    expect(buildPersonalizationPromptBlock(10)).toBeNull();
    expect(buildPersonalizationPromptBlock(20)).toBeNull();
  });

  it('returns an instruction block when 0 facts (new user)', () => {
    const result = buildPersonalizationPromptBlock(0);
    expect(result).not.toBeNull();
    expect(result).toContain('PERSONALIZATION SIGNAL');
    expect(result).toContain('0 stored facts');
    expect(result).toContain('replaces the standard closing question');
  });

  it('returns an instruction block when 1 fact (singular grammar)', () => {
    const result = buildPersonalizationPromptBlock(1);
    expect(result).not.toBeNull();
    expect(result).toContain('1 stored fact');
    expect(result).not.toContain('1 stored facts');
  });

  it('returns an instruction block when 2 facts (boundary)', () => {
    const result = buildPersonalizationPromptBlock(2);
    expect(result).not.toBeNull();
    expect(result).toContain('2 stored facts');
    expect(result).toContain('PERSONALIZATION SIGNAL');
  });

  it('asks a personal-context question, not a calendar/focus question', () => {
    const result = buildPersonalizationPromptBlock(0)!;
    expect(result).toMatch(/challenge|stuck on|understand you better|should know about/i);
  });
});

// ── T2-4 buildBriefingContext — spec-driven regression assertions ──────────────
// Source: content/briefing-regression-spec.md
// Given fixed fixture data, verifies the assembled context string is correct.
// These assertions guard the live 7am briefing path against silent regressions.

const BC_TODAY = '2026-06-17';

function bcDaysAgo(n: number): string {
  const d = new Date(`${BC_TODAY}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

describe('buildBriefingContext — regression', () => {
  const USER = { id: 1, name: 'Derrick Fung', timezone: 'America/Toronto' };

  const FACTS = [
    { category: 'goal', entity: 'fundraising', statement: 'Raise $500K pre-seed by August', confidence_score: 0.9, learned_at: bcDaysAgo(7), last_confirmed_at: null },
    { category: 'preference', entity: 'energy', statement: 'Peak focus window is 9am–11am', confidence_score: 0.8, learned_at: bcDaysAgo(14), last_confirmed_at: null },
    { category: 'person', entity: 'Sarah', statement: 'Lead investor at Tier 1 VC', confidence_score: 0.85, learned_at: bcDaysAgo(5), last_confirmed_at: null },
    // stale: >90 days AND confidence < 0.7 AND unconfirmed — must be filtered out
    { category: 'fact', entity: 'gym', statement: 'Goes to gym Mon/Wed/Fri at 7am', confidence_score: 0.5, learned_at: bcDaysAgo(95), last_confirmed_at: null },
  ];

  const PRIORITIES = [
    { text: 'Close the fundraising round', rank: 1 },
    { text: 'Get to 130 lbs', rank: 2 },
  ];

  const CALENDAR = [
    { summary: 'Investor call — Sarah (Tier 1)', start: { dateTime: `${BC_TODAY}T14:00:00` } },
    { summary: 'Gym', start: { dateTime: `${BC_TODAY}T07:00:00` } },
    { summary: 'Team sync', start: { dateTime: `${BC_TODAY}T10:00:00` } },
  ];

  const TASKS = [
    { text: 'Send term sheet to Sarah', source: 'edg3', completed: false, date: bcDaysAgo(1) },
  ];

  it('surfaces outstanding commitment before calendar entries', () => {
    const ctx = buildBriefingContext(USER, { facts: FACTS, priorities: PRIORITIES, calendar: CALENDAR, tasks: TASKS }, BC_TODAY);
    const commitIdx = ctx.indexOf('Send term sheet to Sarah');
    const calIdx = ctx.indexOf('Investor call');
    expect(commitIdx).toBeGreaterThan(-1);
    expect(commitIdx).toBeLessThan(calIdx);
  });

  it('includes active priority text in context', () => {
    const ctx = buildBriefingContext(USER, { facts: FACTS, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] }, BC_TODAY);
    expect(ctx).toContain('Close the fundraising round');
    expect(ctx).toContain('Get to 130 lbs');
  });

  it('excludes stale facts (>90 days, low confidence, unconfirmed)', () => {
    const ctx = buildBriefingContext(USER, { facts: FACTS, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] }, BC_TODAY);
    expect(ctx).not.toContain('Goes to gym Mon/Wed/Fri');
  });

  it('injects relationship context for people appearing on today\'s calendar', () => {
    const ctx = buildBriefingContext(USER, { facts: FACTS, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] }, BC_TODAY);
    expect(ctx).toContain('Sarah');
    expect(ctx).toContain('Tier 1 VC');
  });

  it('does not inject people context for people absent from today\'s calendar', () => {
    const factsWithMarcus = [
      ...FACTS,
      { category: 'person', entity: 'Marcus', statement: 'CFO at Acme', confidence_score: 0.9, learned_at: bcDaysAgo(2), last_confirmed_at: null },
    ];
    const ctx = buildBriefingContext(USER, { facts: factsWithMarcus, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] }, BC_TODAY);
    expect(ctx).not.toContain('Marcus');
  });

  it('injects fill-the-gap question when fewer than 3 personalization signals', () => {
    const ctx = buildBriefingContext(USER, { facts: [], priorities: [], calendar: CALENDAR, tasks: [] }, BC_TODAY);
    expect(ctx).toContain("what's the most important thing you're working on");
  });

  it('omits fill-the-gap question when personalization floor is met', () => {
    const ctx = buildBriefingContext(USER, { facts: FACTS, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] }, BC_TODAY);
    expect(ctx).not.toContain("what's the most important thing you're working on");
  });

  it('hedges facts with confidence < 0.5 with "last I heard"', () => {
    const lowConfFacts = [
      { category: 'goal', entity: 'fundraising', statement: 'Raise $500K', confidence_score: 0.3, learned_at: bcDaysAgo(7), last_confirmed_at: null },
    ];
    const ctx = buildBriefingContext(USER, { facts: lowConfFacts, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] }, BC_TODAY);
    expect(ctx).toContain('last I heard');
  });

  it('orders non-routine events before routine ones (gym last in calendar section)', () => {
    const ctx = buildBriefingContext(USER, { facts: FACTS, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] }, BC_TODAY);
    const gymIdx = ctx.indexOf('Gym');
    const investorIdx = ctx.indexOf('Investor call');
    if (gymIdx !== -1) {
      expect(investorIdx).toBeLessThan(gymIdx);
    }
  });

  it('truncates context to ≤16000 chars when data volume is very large', () => {
    const manyFacts = Array.from({ length: 200 }, (_, i) => ({
      category: 'fact',
      entity: `item${i}`,
      statement: 'Some statement about something '.repeat(5),
      confidence_score: 0.9,
      learned_at: bcDaysAgo(1),
      last_confirmed_at: null,
    }));
    const ctx = buildBriefingContext(USER, { facts: manyFacts, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] }, BC_TODAY);
    expect(ctx.length).toBeLessThanOrEqual(16_000);
  });
});

describe('buildPeopleModelBlock (M4-4)', () => {
  function model(over: Partial<PersonModel>): PersonModel {
    return {
      id: 1, user_id: 1, person_name: 'Sarah Chen',
      goals: null, communication_style: null, relationship_state: null,
      last_interaction: null, health_score: 1.0, updated_at: '2026-06-19T00:00:00Z', ...over,
    };
  }
  const ev = (summary: string, attendees?: { displayName?: string; email?: string }[]) => ({
    summary, start: { dateTime: '2026-06-19T15:00:00Z' }, end: { dateTime: '2026-06-19T16:00:00Z' },
    ...(attendees ? { attendees } : {}),
  });

  it('returns empty string when no models or no events', () => {
    expect(buildPeopleModelBlock([], [model({})])).toBe('');
    expect(buildPeopleModelBlock([ev('Standup')], [])).toBe('');
  });

  it('injects a model when the person name is in an event title', () => {
    const block = buildPeopleModelBlock(
      [ev('1:1 with Sarah Chen')],
      [model({ person_name: 'Sarah Chen', goals: 'closing a Series A', communication_style: 'prefers async' })],
    );
    expect(block).toContain('Sarah Chen');
    expect(block).toContain('closing a Series A');
    expect(block).toContain('prefers async');
  });

  it('matches on attendee display name and on first name', () => {
    const byAttendee = buildPeopleModelBlock(
      [ev('Strategy sync', [{ displayName: 'Sarah Chen', email: 'sarah@acme.com' }])],
      [model({ person_name: 'Sarah Chen', goals: 'raising a round' })],
    );
    expect(byAttendee).toContain('raising a round');

    const byFirst = buildPeopleModelBlock(
      [ev('Coffee with Sarah')],
      [model({ person_name: 'Sarah Chen', goals: 'raising a round' })],
    );
    expect(byFirst).toContain('Sarah Chen');
  });

  it('does NOT inject a model when the person is not on the calendar', () => {
    expect(buildPeopleModelBlock([ev('Team standup')], [model({ person_name: 'Sarah Chen', goals: 'x' })])).toBe('');
  });

  it('caps at 3 people', () => {
    const events = [ev('A with Alice'), ev('B with Bob'), ev('C with Carol'), ev('D with Dave')];
    const models = [
      model({ id: 1, person_name: 'Alice', goals: 'g1' }),
      model({ id: 2, person_name: 'Bob', goals: 'g2' }),
      model({ id: 3, person_name: 'Carol', goals: 'g3' }),
      model({ id: 4, person_name: 'Dave', goals: 'g4' }),
    ];
    const block = buildPeopleModelBlock(events, models);
    const lineCount = block.split('\n').filter(l => l.startsWith('- ')).length;
    expect(lineCount).toBe(3);
  });

  it('skips a matched model with no usable fields', () => {
    expect(buildPeopleModelBlock([ev('1:1 Sarah Chen')], [model({ person_name: 'Sarah Chen' })])).toBe('');
  });
});
