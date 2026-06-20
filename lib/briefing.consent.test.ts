/**
 * Consent-gating tests for analyzeUserResponse.
 *
 * Proves that Privacy Mode users do NOT get transcript/insight stored in the memory
 * corpus, and that Improve-consented users DO. The briefing inference itself (LLM calls)
 * runs for both modes — consent only gates the long-term storage writes.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { analyzeUserResponse } from './briefing';

// ── hoisted mock state ────────────────────────────────────────────────────────

const h = vi.hoisted(() => ({
  user: null as null | { id: number; name: string; timezone?: string; data_consent?: string | null },
  memoryCreate: vi.fn(),
  taskCreate: vi.fn(),
  messageCreate: vi.fn(),
}));

// ── module mocks ──────────────────────────────────────────────────────────────

// Anthropic SDK — module-level instance in briefing.ts.
// Must use a regular function (not arrow) so `new Anthropic(...)` works as a constructor.
vi.mock('@anthropic-ai/sdk', () => {
  const MockAnthropic = vi.fn(function () {
    return { messages: { create: h.messageCreate } };
  });
  return { default: MockAnthropic };
});

// Use the SAME import specifiers that lib/briefing.ts uses (relative paths, not @/ aliases),
// so vitest's module ID matching applies the mocks to the actual imports in briefing.ts.
vi.mock('./db', () => ({
  userQueries: { findById: () => h.user },
  memoryQueries: { create: h.memoryCreate },
  taskQueries: { create: h.taskCreate },
  factQueries: { getAll: () => [] },
  priorityQueries: { getMostRecent: () => [] },
  briefingQueries: { findById: vi.fn(), create: vi.fn(), getHistory: vi.fn(), saveUserResponse: vi.fn(), getMostRecentComplete: vi.fn() },
  energyLogQueries: { list: vi.fn() },
  openLoopQueries: { list: vi.fn(() => []) },
  calendarScoreQueries: { get: vi.fn() },
  focusMilestoneQueries: { getAll: vi.fn(() => []) },
  dailyFocusQueries: { getTodayFocus: vi.fn() },
  calendarQueries: { get: vi.fn() },
  effectiveTimezone: () => 'America/Toronto',
}));

vi.mock('./grounding', () => ({
  groundProperNouns: (s: string) => s,
  canonicalNamesFromProfile: () => [],
  extractNamesFromEventTitles: () => [],
}));

vi.mock('./calendar', () => ({
  getCalendarEvents: vi.fn(), getWeekEvents: vi.fn(), getFullWeekEvents: vi.fn(),
  formatEventsForBriefing: vi.fn(() => ''), getFreeTimeSlots: vi.fn(() => []),
  getPastCalendarDays: vi.fn(() => []), getPastCalendarEvents: vi.fn(() => []),
}));
vi.mock('./calendarPatterns', () => ({ detectCalendarPatterns: vi.fn(), formatCalendarPatternsForBriefing: vi.fn(() => '') }));
vi.mock('./timeAllocation', () => ({ computeTimeAllocation: vi.fn(), formatTimeAllocationForBriefing: vi.fn(() => '') }));
vi.mock('./alignment', () => ({ computeAlignment: vi.fn(), detectHygieneFlags: vi.fn(() => null) }));
vi.mock('./streak', () => ({ computeCallStreak: vi.fn(() => 0) }));
vi.mock('./facts', () => ({ linkEventsToFacts: vi.fn(), extractAndUpsertFactsFromEmail: vi.fn() }));
vi.mock('./openLoops', () => ({
  getUrgentOpenLoops: vi.fn(() => []), formatOpenLoopsForBriefing: vi.fn(() => ''),
  extractAndUpsertOpenLoops: vi.fn(), detectRecurringPatterns: vi.fn(() => []),
  formatRecurringPatternsForBriefing: vi.fn(() => ''),
}));
vi.mock('./meetingContext', () => ({ buildMeetingContexts: vi.fn(() => []), formatMeetingContextsForBriefing: vi.fn(() => '') }));
vi.mock('./whoop', () => ({
  getLatestRecovery: vi.fn(() => null), getLastSleep: vi.fn(() => null),
  getRecentStrain: vi.fn(() => null), getRecoveryHistory: vi.fn(() => []),
  getSleepHistory: vi.fn(() => []), getStrainHistory: vi.fn(() => []),
  whoopFreshnessNote: vi.fn(() => ''),
}));
vi.mock('./whoopTrends', () => ({
  computeWhoopTrends: vi.fn(() => null), formatTrendForBriefing: vi.fn(() => null),
  detectRecoveryDrop: vi.fn(() => null), formatRecoveryAlertForBriefing: vi.fn(() => ''),
  computeWhoopBaselines: vi.fn(() => null), buildBaselineDeviationNote: vi.fn(() => ''),
  buildCalendarActionFromRecovery: vi.fn(() => ''),
}));
vi.mock('./whoopCorrelations', () => ({
  computeWhoopCorrelations: vi.fn(() => null), predictTomorrowRecoveryHint: vi.fn(() => null),
}));
vi.mock('./memorySalience', () => ({ topFacts: vi.fn(() => []) }));
vi.mock('./energy', () => ({ deriveEnergySignal: vi.fn(() => null), formatEnergyForBriefing: vi.fn(() => '') }));
vi.mock('./focusProgress', () => ({ buildFocusProgress: vi.fn(() => null), formatFocusScoreboardForBriefing: vi.fn(() => '') }));
vi.mock('./calendarScore', () => ({ computeCalendarFit: vi.fn(() => null) }));
vi.mock('./focusRecommendation', () => ({ recommendFocusAreas: vi.fn(() => []) }));
vi.mock('./gmail', () => ({ getRecentEmailSignal: vi.fn(() => null) }));
vi.mock('./priorityDerivation', () => ({ derivePriorities: vi.fn(() => null) }));

// ── helpers ───────────────────────────────────────────────────────────────────

function memoryTypes(): string[] {
  return (h.memoryCreate.mock.calls as Array<[number, string, string]>).map(([, type]) => type);
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('analyzeUserResponse — consent gating', () => {
  beforeEach(() => {
    // Explicitly clear history without resetting mock implementations.
    // vi.clearAllMocks() in vitest 4.x can also reset mockResolvedValue, so we
    // clear individual fns and always re-set the resolved value.
    h.memoryCreate.mockClear();
    h.taskCreate.mockClear();
    h.messageCreate.mockClear();
    // Both LLM calls return a text response. The tasks-extraction call sees
    // 'Key insight: …' (no JSON array), so taskCreate is never called in basic tests.
    h.messageCreate.mockResolvedValue({
      content: [{ type: 'text', text: 'Key insight: test.' }],
    });
  });

  it('Privacy Mode — does NOT store transcript or insight memories', async () => {
    h.user = { id: 1, name: 'Derrick', data_consent: 'privacy' };
    await analyzeUserResponse(1, 'I want to focus on fundraising this week.');
    expect(memoryTypes()).not.toContain('transcript');
    expect(memoryTypes()).not.toContain('insight');
  });

  it('null consent (new-user default) — treated as Privacy Mode, no transcript/insight', async () => {
    h.user = { id: 2, name: 'Derrick', data_consent: null };
    await analyzeUserResponse(2, "Let's book a call with the VC.");
    expect(memoryTypes()).not.toContain('transcript');
    expect(memoryTypes()).not.toContain('insight');
  });

  it('undefined consent — treated as Privacy Mode, no transcript/insight', async () => {
    h.user = { id: 3, name: 'Derrick', data_consent: undefined };
    await analyzeUserResponse(3, 'Push the gym to next week.');
    expect(memoryTypes()).not.toContain('transcript');
    expect(memoryTypes()).not.toContain('insight');
  });

  it('Improve-consented — stores BOTH transcript AND insight', async () => {
    h.user = { id: 4, name: 'Derrick', data_consent: 'improve' };
    await analyzeUserResponse(4, "I'm going to close the deal this week.");
    expect(memoryTypes()).toContain('transcript');
    expect(memoryTypes()).toContain('insight');
  });

  it('Improve-consented — transcript contains (grounded) user response content', async () => {
    h.user = { id: 5, name: 'Derrick', data_consent: 'improve' };
    await analyzeUserResponse(5, 'Focus on fundraising.');
    const transcriptCall = (h.memoryCreate.mock.calls as Array<[number, string, string]>)
      .find(([uid, type]) => uid === 5 && type === 'transcript');
    expect(transcriptCall).toBeDefined();
    expect(transcriptCall![2]).toContain('Focus on fundraising');
  });

  it('Privacy Mode — tasks are still extracted (not improvement data)', async () => {
    h.user = { id: 6, name: 'Derrick', data_consent: 'privacy' };
    h.messageCreate
      .mockResolvedValueOnce({ content: [{ type: 'text', text: 'Key insight: user wants a call.' }] })
      .mockResolvedValueOnce({ content: [{ type: 'text', text: '["Book a call with VC"]' }] });
    await analyzeUserResponse(6, 'Book a call with the VC for Thursday.');
    expect(h.taskCreate).toHaveBeenCalledWith(6, 'Book a call with VC', expect.any(String), 'edg3');
    // But NO transcript/insight stored
    expect(memoryTypes()).not.toContain('transcript');
    expect(memoryTypes()).not.toContain('insight');
  });
});
