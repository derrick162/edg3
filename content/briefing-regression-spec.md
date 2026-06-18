# Briefing Accuracy Regression Test Spec
_PM/content spec for PILLAR-TRUST T2-4. Route to Darren (Core) — write `lib/briefing.test.ts` snapshot tests against this spec._

---

## Why this test exists

The briefing builder in `lib/briefing.ts` is the most important function in the codebase — every morning call reads from it. There are no tests that verify the OUTPUT of the briefing context assembler. That means any change to `lib/briefing.ts` could silently degrade briefings: missing facts, wrong section order, stale data injected, personalization floor bypassed.

This spec defines the assertions that `lib/briefing.test.ts` must verify. These are snapshot-style tests: given a fixed set of inputs, verify the assembled context string contains (or excludes) specific content.

---

## Test setup

Use a mock user + mock data (no live API calls). The tests should be deterministic and fast.

```typescript
// Fixture: a user with known data
const USER = { id: 1, name: 'Derrick Fung', timezone: 'America/Toronto', call_time: '07:00' };
const FACTS = [
  { category: 'goal', entity: 'fundraising', statement: 'Raise $500K pre-seed by August', confidence_score: 0.9, learned_at: /* 7 days ago */ },
  { category: 'preference', entity: 'energy', statement: 'Peak focus window is 9am–11am', confidence_score: 0.8, learned_at: /* 14 days ago */ },
  { category: 'person', entity: 'Sarah', statement: 'Lead investor at Tier 1 VC', confidence_score: 0.85, learned_at: /* 5 days ago */ },
  { category: 'fact', entity: 'gym', statement: 'Goes to gym Mon/Wed/Fri at 7am', confidence_score: 0.5, learned_at: /* 95 days ago */ },  // stale
];
const PRIORITIES = [{ text: 'Close the fundraising round', rank: 1 }, { text: 'Get to 130 lbs', rank: 2 }];
const CALENDAR = [
  { summary: 'Investor call — Sarah (Tier 1)', start: { dateTime: '<today>T14:00:00' }, end: { dateTime: '<today>T15:00:00' } },
  { summary: 'Gym', start: { dateTime: '<today>T07:00:00' }, end: { dateTime: '<today>T08:00:00' } },
  { summary: 'Team sync', start: { dateTime: '<today>T10:00:00' }, end: { dateTime: '<today>T10:30:00' } },
];
const TASKS = [
  { text: 'Send term sheet to Sarah', source: 'edg3', completed: false, date: /* yesterday */ },
];
```

---

## Required assertions

### 1. Outstanding commitments appear first

```typescript
it('surfaces yesterday\'s outstanding commitment before calendar or facts', () => {
  const context = buildBriefingContext(USER, { facts: FACTS, priorities: PRIORITIES, calendar: CALENDAR, tasks: TASKS });
  const commitmentIdx = context.indexOf('Send term sheet to Sarah');
  const calendarIdx = context.indexOf('Investor call');
  expect(commitmentIdx).toBeGreaterThan(-1);
  expect(commitmentIdx).toBeLessThan(calendarIdx);  // commitments before calendar
});
```

### 2. Active priorities are injected (by name)

```typescript
it('includes priority text in context', () => {
  const context = buildBriefingContext(USER, { facts: FACTS, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] });
  expect(context).toContain('Close the fundraising round');
  expect(context).toContain('Get to 130 lbs');
});
```

### 3. Stale facts (>90 days, unconfirmed, low confidence) are excluded

```typescript
it('excludes stale facts from default context', () => {
  const context = buildBriefingContext(USER, { facts: FACTS, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] });
  // The gym fact is 95 days old, unconfirmed, confidence 0.5 — should NOT appear
  expect(context).not.toContain('Goes to gym Mon/Wed/Fri');
});
```

### 4. Relationship context injected only for people on today's calendar

```typescript
it('injects Sarah\'s context because she appears on calendar', () => {
  const context = buildBriefingContext(USER, { facts: FACTS, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] });
  expect(context).toContain('Sarah');
  expect(context).toContain('Tier 1 VC');
});

it('does NOT inject people context for people not on today\'s calendar', () => {
  const factsWithExtra = [...FACTS, { category: 'person', entity: 'Marcus', statement: 'CFO at Acme', confidence_score: 0.9, learned_at: /* today */ }];
  const context = buildBriefingContext(USER, { facts: factsWithExtra, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] });
  // Marcus is not on today's calendar, should not be injected
  expect(context).not.toContain('Marcus');
});
```

### 5. Personalization floor: fill-the-gap question when data is thin

```typescript
it('injects fill-the-gap question when fewer than 3 user-specific signals', () => {
  const thinContext = buildBriefingContext(USER, { facts: [], priorities: [], calendar: CALENDAR, tasks: [] });
  expect(thinContext).toContain("what's the most important thing you're working on");
});

it('does NOT inject fill-the-gap question when floor is met', () => {
  const context = buildBriefingContext(USER, { facts: FACTS, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] });
  expect(context).not.toContain("what's the most important thing you're working on");
});
```

### 6. Low-confidence facts get hedged

```typescript
it('hedges facts with confidence < 0.5', () => {
  const lowConfFacts = [{ category: 'goal', entity: 'fundraising', statement: 'Raise $500K', confidence_score: 0.3, learned_at: /* 7 days ago */ }];
  const context = buildBriefingContext(USER, { facts: lowConfFacts, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] });
  // Should include the hedge marker for this fact
  expect(context).toContain('last I heard');
});
```

### 7. Routine events are deprioritized in calendar narration

```typescript
it('does not lead with gym in calendar section', () => {
  const context = buildBriefingContext(USER, { facts: FACTS, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] });
  const gymIdx = context.indexOf('Gym');
  const investorIdx = context.indexOf('Investor call');
  // Investor call should appear before gym (or gym should not appear at all)
  if (gymIdx !== -1) {
    expect(investorIdx).toBeLessThan(gymIdx);
  }
});
```

### 8. Context stays under 4000 tokens (~16000 chars) when truncated

```typescript
it('context string stays under 16000 chars regardless of data volume', () => {
  const manyFacts = Array.from({ length: 200 }, (_, i) => ({
    category: 'fact' as const, entity: `item${i}`, statement: 'Some statement about something '.repeat(5),
    confidence_score: 0.9, learned_at: /* 1 day ago */,
  }));
  const context = buildBriefingContext(USER, { facts: manyFacts, priorities: PRIORITIES, calendar: CALENDAR, tasks: [] });
  expect(context.length).toBeLessThanOrEqual(16000);
});
```

---

## What to export from `lib/briefing.ts`

The test needs a testable function. Currently the briefing context is built inline. Extract:

```typescript
export function buildBriefingContext(
  user: { id: number; name: string; timezone: string },
  data: {
    facts: Fact[];
    priorities: Priority[];
    calendar: CalendarEvent[];
    tasks: Task[];
    whoopRecovery?: { score: number } | null;
    episodes?: Episode[];
  }
): string
```

This function applies all the assembly rules (priority order, stale filter, personalization floor, token cap) and returns the context string. The live briefing calls it after fetching all data. Tests call it with fixture data.

**Important:** Do not fork the logic. The export IS the live path. If it's extracted correctly, tests validate production behavior exactly.

---

## How to run

```
npm run preflight
# or
npx vitest run lib/briefing.test.ts
```

Add to preflight gate so any briefing change that breaks these assertions fails CI.

---

_PM/CTO: Kevin, June 2026. Source: PILLAR-TRUST.md T2-4._
