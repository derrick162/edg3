import Anthropic from '@anthropic-ai/sdk';
import { format, startOfWeek } from 'date-fns';
import { userQueries, priorityQueries, memoryQueries, briefingQueries, taskQueries, factQueries, energyLogQueries, effectiveTimezone, openLoopQueries, calendarScoreQueries, User, type Fact } from './db';
import { getCalendarEvents, getWeekEvents, getFullWeekEvents, formatEventsForBriefing, getFreeTimeSlots, getPastCalendarDays, getPastCalendarEvents } from './calendar';
import { detectCalendarPatterns, formatCalendarPatternsForBriefing } from './calendarPatterns';
import { computeTimeAllocation, formatTimeAllocationForBriefing } from './timeAllocation';
import { checkOutreachReplies } from './replies';
import { computeAlignment, detectHygieneFlags } from './alignment';
import { computeCallStreak } from './streak';
import { linkEventsToFacts, extractAndUpsertFactsFromEmail } from './facts';
import { getUrgentOpenLoops, formatOpenLoopsForBriefing, extractAndUpsertOpenLoops, detectRecurringPatterns, formatRecurringPatternsForBriefing } from './openLoops';
import { buildMeetingContexts, formatMeetingContextsForBriefing } from './meetingContext';
import { getLatestRecovery, getLastSleep, getRecentStrain, getRecoveryHistory, getSleepHistory, getStrainHistory, whoopFreshnessNote, type WhoopRecovery, type WhoopSleep, type WhoopStrain } from './whoop';
import { computeWhoopTrends, formatTrendForBriefing, detectRecoveryDrop, formatRecoveryAlertForBriefing, computeWhoopBaselines, buildBaselineDeviationNote, buildCalendarActionFromRecovery } from './whoopTrends';
import { computeWhoopCorrelations, predictTomorrowRecoveryHint } from './whoopCorrelations';
import { topFacts } from './memorySalience';
import { deriveEnergySignal, formatEnergyForBriefing } from './energy';
import { focusMilestoneQueries, dailyFocusQueries } from './db';
import { buildFocusProgress, formatFocusScoreboardForBriefing } from './focusProgress';
import { computeCalendarFit } from './calendarScore';
import { recommendFocusAreas, type FocusRecommendation } from './focusRecommendation';
import { getRecentEmailSignal } from './gmail';
import { derivePriorities, type DerivedPriorityProposal } from './priorityDerivation';
import { isImproveConsented } from './consent';
import { buildRelationshipContextBlock, syncPeopleProfiles } from './relationships';
import { peopleProfileQueries, patternCacheQueries } from './db';
import {
  detectProductiveDayPattern,
  detectLightDayPattern,
  detectMeetingLoadRecoveryPattern,
  detectFocusWindowPattern,
  pickBestPattern,
  formatPatternForBriefing,
} from './patternMemory';
import { buildAccountabilitySnapshot, formatAccountabilityForBriefing, accountabilityBriefingInstruction } from './accountabilityMemory';
import { buildEpisodeMemoryBlock } from './episodeStore';

async function getWeatherSummary(timezone: string): Promise<string> {
  try {
    // Extract city from timezone e.g. "America/Vancouver" → "Vancouver"
    const city = timezone.split('/').pop()?.replace(/_/g, '+') || 'Vancouver';
    const res = await fetch(`https://wttr.in/${city}?format=j1`, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return '';
    const data = await res.json();
    const current = data.current_condition?.[0];
    if (!current) return '';
    const desc = current.weatherDesc?.[0]?.value || '';
    const tempC = current.temp_C;
    const feelsC = current.FeelsLikeC;
    return `${desc}, ${tempC}°C (feels like ${feelsC}°C) in ${city.replace(/\+/g, ' ')}`;
  } catch {
    return '';
  }
}

function extractCommitments(briefings: { user_response: string | null; scheduled_for: string }[]): string {
  const withResponses = briefings.filter(b => b.user_response).slice(0, 3);
  if (!withResponses.length) return '';
  return withResponses
    .map(b => `[${format(new Date(b.scheduled_for), 'MMM d')}] They said: "${b.user_response}"`)
    .join('\n');
}

// All anthropic.messages.create() calls in this file send user data to Anthropic for
// INFERENCE ONLY (required to power the briefing service). No data is submitted for
// training or improvement via these calls.
//
// IMPROVEMENT-DATA ENFORCEMENT: the only post-call storage path that accumulates user
// data for potential future improvement use is analyzeUserResponse() — specifically the
// 'transcript' and 'insight' memory writes. Those are now gated on isImproveConsented().
// Privacy Mode users still receive a full briefing (all inference paths run) but their
// call data is not written to the long-term memory corpus.
// See content/security-audit.md §"Data consent and Privacy Mode".
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

async function sanitizeCalendarReferences(
  briefingText: string,
  todayEvents: any[],
  weekEvents: any[],
  timezone: string
): Promise<string> {
  // Build a set of real event titles (normalised)
  const allEvents = [...todayEvents, ...weekEvents];
  const realTitles = new Set(
    allEvents.map(e => (e.summary || '').replace(/^⚡\s*/, '').toLowerCase().trim())
  );

  // Ask Claude to remove any specific calendar event references that don't exist
  const anthropic_check = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const checkResult = await anthropic_check.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 1000,
    messages: [{
      role: 'user',
      content: `Review this briefing and remove any references to specific calendar events that are NOT in the provided event list. Replace with something neutral or just remove the sentence entirely.

ACTUAL CALENDAR EVENTS (these are the only real ones):
${realTitles.size > 0 ? Array.from(realTitles).map(t => `- ${t}`).join('\n') : 'No events today.'}

BRIEFING TO REVIEW:
${briefingText}

Rules:
- If the briefing mentions a specific event (e.g. "grocery prep", "meal prep", "morning walk", "drive to X") that is NOT in the event list above → remove that reference
- Keep all other content intact
- Do not change tone, structure, or any non-calendar content
- Return ONLY the corrected briefing text, nothing else`,
    }],
  });

  const checked = checkResult.content[0];
  if (checked.type !== 'text') return briefingText;

  const sanitized = checked.text.trim();
  if (sanitized.length < briefingText.length * 0.5) {
    // If too much was removed, something went wrong — return original
    console.log('[briefing] Sanitization removed too much, using original');
    return briefingText;
  }

  console.log('[briefing] Calendar references sanitized');
  return sanitized;
}

/**
 * Minimal spoken briefing returned when the main Anthropic generation call fails or times out.
 * Pure function — no DB or API calls — so it always succeeds and the scheduler call still goes out.
 */
export function buildFallbackBriefing(greeting: string, userName: string, calendarText: string, prioritiesText: string): string {
  const firstName = (userName || '').split(' ')[0] || userName;
  const calSection = calendarText.trim()
    ? `Here's what I have on your calendar: ${calendarText.trim().replace(/\n/g, ', ')}.`
    : "I don't see any events on your calendar for today.";
  const prioSection = prioritiesText.trim() && prioritiesText !== 'No priorities set for this week.'
    ? `Your priorities this week are: ${prioritiesText.replace(/^\d+\.\s*/gm, '').trim().replace(/\n/g, ', ')}.`
    : '';
  return `${greeting}, ${firstName}. I had a little trouble loading your full briefing today — let me give you the essentials. ${calSection}${prioSection ? ' ' + prioSection : ''} I'll have everything ready on tomorrow's call. What's the most important thing I should know before then?`;
}

/**
 * Format Whoop recovery/sleep/strain into a compact briefing section string.
 * Returns null when all inputs are null (not connected or fetch failed) — callers
 * omit the health section entirely rather than injecting an empty block.
 * Pure function; exported for unit tests.
 */
export function buildWhoopSection(
  recovery: WhoopRecovery | null,
  sleep: WhoopSleep | null,
  strain: WhoopStrain | null,
): string | null {
  const parts: string[] = [];
  if (recovery !== null) parts.push(`RECOVERY: ${recovery.recoveryScore}%`);
  if (sleep !== null) {
    const totalMin = Math.round(sleep.durationMs / 60000);
    const h = Math.floor(totalMin / 60);
    const m = totalMin % 60;
    // Spell out hours/minutes — this is spoken on the call, and "8h59m" gets misread
    // by the voice engine as "8 H 59 meters". Include WHOOP's sleep performance % —
    // that's the "sleep score" users ask for, distinct from time in bed.
    const dur = m === 0 ? `${h} hours` : `${h} hours ${m} minutes`;
    parts.push(`SLEEP: ${dur} (score ${sleep.performancePct}%)`);
  }
  if (strain !== null) parts.push(`STRAIN: ${strain.strain}`);
  return parts.length ? parts.join(' · ') : null;
}

/**
 * Baseline-relative Whoop context for the briefing prompt.
 * Returns null when fewer than 3 history points are available (no meaningful average yet).
 * When multiple signals compound (red recovery + sleep debt + high strain), flags it explicitly
 * so the model can surface a concrete deferral action — not generic pacing advice.
 * Pure — no I/O.
 */
export function buildBaselineContext(
  recovery: WhoopRecovery | null,
  recoveryHistory: { date: string; value: number }[],
  recentSleepMs: number[],   // sleep durations in ms, any order; sliced to 7 internally
  recentStrain: number | null, // latest strain score on Whoop's 0–21 scale
): string | null {
  if (!recovery || recoveryHistory.length < 3) return null;

  const sorted = [...recoveryHistory]
    .sort((a, b) => b.date.localeCompare(a.date))
    .slice(0, 7);
  const avg7d = Math.round(sorted.reduce((s, p) => s + p.value, 0) / sorted.length);
  const today = recovery.recoveryScore;
  const delta = today - avg7d;
  const sign = delta >= 0 ? '+' : '';

  const lines: string[] = [
    `Recovery vs baseline: today ${today}% · 7-day avg ${avg7d}% · ${sign}${delta} pts`,
  ];

  const badSignals: string[] = [];
  if (today < 34) badSignals.push('red recovery');
  const sleepSlice = recentSleepMs.slice(0, 7);
  if (sleepSlice.length >= 3) {
    const avgSleepH = sleepSlice.reduce((s, v) => s + v, 0) / sleepSlice.length / 3_600_000;
    if (avgSleepH < 6.5) badSignals.push(`recent sleep averaging ${avgSleepH.toFixed(1)} h`);
  }
  if (recentStrain !== null && recentStrain > 15) {
    badSignals.push(`high strain yesterday (${recentStrain.toFixed(1)} / 21)`);
  }

  if (badSignals.length >= 2) {
    lines.push(
      `COMPOSITE SIGNAL: ${badSignals.join(' + ')} — compounding deficit. ` +
      `Identify the single heaviest deferrable calendar block and offer to move or shrink it. ` +
      `Frame as coaching grounded in numbers — never make medical claims.`,
    );
  }

  return lines.join('\n');
}

// Keywords that identify energy-profile preference facts (peak/trough hours,
// high/low-energy activity types). Module-level so the function stays pure.
const ENERGY_PREF_KEYWORDS = [
  'peak', 'trough', 'energy', 'deep work', 'deep-work', 'focus block',
  'productive', 'morning person', 'best work', 'creative work', 'flow state',
  'high-energy', 'low-energy', 'high energy', 'low energy',
  'afternoon dip', 'afternoon lull', 'afternoon slump', 'winding down',
  'admin', 'chronotype', 'difficult tasks', 'challenging work',
  'sprint window', 'power hour', 'maker schedule',
];

/**
 * Build an ENERGY MATCHING context block for the briefing prompt.
 * Scans preference facts for energy-profile keywords and combines with today's
 * Whoop recovery as the daily modulator. Returns null when no energy preferences
 * exist — callers degrade silently (never blocks the briefing).
 * Pure function; exported for unit tests.
 */
export function buildEnergyMatchingBlock(
  preferences: Fact[],
  recovery: WhoopRecovery | null,
): string | null {
  const energyPrefs = preferences.filter(p => {
    const s = p.statement.toLowerCase();
    return ENERGY_PREF_KEYWORDS.some(k => s.includes(k));
  });

  if (!energyPrefs.length) return null;

  const lines = ['ENERGY PROFILE (user-stated — use for time-block recommendations in sections 3 and 5):'];
  for (const p of energyPrefs) lines.push(`- ${p.statement}`);

  if (recovery !== null) {
    const tierLabel = recovery.recoveryScore >= 67
      ? 'high — full capacity for deep/creative work'
      : recovery.recoveryScore >= 34
      ? 'moderate — proceed normally, don\'t over-extend'
      : 'low — protect the peak window; lean toward lighter tasks and admin today';
    lines.push(`Whoop recovery today: ${recovery.recoveryScore}% (${tierLabel}). Recovery is a DAILY modulator — never claim Whoop measured energy at a specific hour.`);
  }

  return '\n' + lines.join('\n') + '\n';
}

export async function generateDailyBriefing(userId: number): Promise<string> {
  const user = userQueries.findById(userId);
  if (!user) throw new Error('User not found');

  const userTimezone = effectiveTimezone(user);
  const now = new Date();
  // Compute "today" in the USER's timezone, not the server's (Railway runs UTC). Otherwise a
  // late-evening call rolls the date forward and tomorrow's events get briefed as today's.
  const today = now.toLocaleDateString('en-CA', { timeZone: userTimezone });
  const todayLabel = now.toLocaleDateString('en-US', { timeZone: userTimezone, weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' });
  const localTime = now.toLocaleTimeString('en-US', { timeZone: userTimezone, hour: 'numeric', minute: '2-digit', hour12: true });
  const localHour = parseInt(now.toLocaleString('en-US', { timeZone: userTimezone, hour: 'numeric', hour12: false }));
  const greeting = localHour >= 18 ? 'Good evening' : localHour >= 12 ? 'Good afternoon' : 'Good morning';
  const firstName = (user.name || '').split(' ')[0] || user.name;
  const weekOf = format(startOfWeek(new Date()), 'yyyy-MM-dd');

  // Gather context
  const priorities = priorityQueries.getThisWeek(userId, weekOf);
  const recentMemories = memoryQueries.getWeighted(userId, 20);
  const recentBriefings = briefingQueries.getRecent(userId, 30);

  // Load + rank all facts once, early — used by meeting context + event-linked memory below.
  const allRawFacts = (() => { try { return factQueries.getAll(userId); } catch { return []; } })();
  const salientFactsEarly = topFacts(allRawFacts, priorities, today, { max: 20, maxPerCategory: 6 });

  const [calendarEvents, weekEvents, fullWeekEvents, whoopRecovery, whoopSleep, whoopStrain, recoveryHistory, sleepHistory, strainHistory, pastCalendarDays, emailSignal, pastCalendarHistory] = await Promise.all([
    getCalendarEvents(userId).catch(() => []),
    getWeekEvents(userId).catch(() => []),
    getFullWeekEvents(userId, userTimezone).catch(() => []),
    getLatestRecovery(userId).catch(() => null),
    getLastSleep(userId).catch(() => null),
    getRecentStrain(userId).catch(() => null),
    getRecoveryHistory(userId).catch(() => []),
    getSleepHistory(userId).catch(() => []),
    getStrainHistory(userId).catch(() => []),
    getPastCalendarDays(userId, 14, userTimezone).catch(() => []),
    getRecentEmailSignal(userId, { days: 14, max: 20 }).catch(() => null),
    getPastCalendarEvents(userId, 180).catch(() => []),
  ]);
  // Build energy signal from Whoop recovery for focus recommendation modulation.
  const focusEnergySignal = whoopRecovery
    ? {
        tier: (whoopRecovery.recoveryScore >= 67 ? 'green' : whoopRecovery.recoveryScore >= 34 ? 'yellow' : 'red') as 'green' | 'yellow' | 'red',
        recoveryScore: whoopRecovery.recoveryScore,
        source: 'whoop' as const,
      }
    : null;
  const focusDate = new Intl.DateTimeFormat('en-CA', { timeZone: userTimezone }).format(new Date());
  // Always recommend focus areas — this drives the hero loop on every briefing.
  // When priorities are set, pass them as anchors so each recommendation ladders to a real goal.
  // Derive durable facts from inbox digest (fire-and-forget — never blocks the briefing).
  if (emailSignal && !emailSignal.scopeMissing) {
    extractAndUpsertFactsFromEmail(userId, emailSignal, user.name).catch(() => {});
    // Also extract open loops from the inbox (fire-and-forget).
    extractAndUpsertOpenLoops(userId, { emailSignal, today }).catch(() => {});
  }
  // Refresh people profiles from calendar history (fire-and-forget — never blocks the briefing).
  syncPeopleProfiles(userId, pastCalendarHistory, calendarEvents, user.email).catch(() => {});
  // Compute and cache behavioral patterns (fire-and-forget).
  try {
    const recoveryHistoryPoints = recoveryHistory.map(r => ({ date: r.date, recoveryScore: r.recoveryScore }));
    const bestPattern = pickBestPattern([
      detectProductiveDayPattern(pastCalendarHistory, userTimezone),
      detectLightDayPattern(pastCalendarHistory, userTimezone),
      detectMeetingLoadRecoveryPattern(pastCalendarHistory, recoveryHistoryPoints, userTimezone),
      detectFocusWindowPattern(pastCalendarHistory, userTimezone),
    ]);
    patternCacheQueries.upsert(userId, JSON.stringify(bestPattern ? [bestPattern] : []));
  } catch { /* never block briefing */ }

  // Urgent open loops — pure DB read, fetch before focus rec so they can modulate recommendations.
  const urgentLoopsEarly = (() => { try { return getUrgentOpenLoops(userId, focusDate); } catch { return []; } })();
  const focusRec: FocusRecommendation | null = await recommendFocusAreas(userId, {
    energySignal: focusEnergySignal,
    todayEvents: calendarEvents,
    anchors: priorities.length > 0 ? priorities : undefined,
    date: focusDate,
    emailSignal: emailSignal ?? undefined,
    openLoops: urgentLoopsEarly.length > 0 ? urgentLoopsEarly : undefined,
  }).catch(() => null);
  // Pre-warm the dashboard cache so the first post-call dashboard load is instant
  // (no LLM/Google re-fetch). Never clobber an existing row (a confirmed focus or a
  // prior generation) — upsert resets confirmed=0. Fire-and-forget, never blocks.
  if (focusRec && focusRec.areas.length > 0) {
    try {
      const existing = dailyFocusQueries.getToday(userId, focusDate);
      if (!existing) {
        dailyFocusQueries.upsert(userId, focusDate, JSON.stringify(focusRec.areas), focusRec.generatedAt);
      }
    } catch { /* non-fatal */ }
  }
  const recoveryHistoryPoints = recoveryHistory.map(d => ({ date: d.date, value: d.recoveryScore }));
  const whoopTrend = computeWhoopTrends(
    recoveryHistoryPoints,
    sleepHistory.map(d => ({ date: d.date, value: d.durationMs })),
    strainHistory.map(d => ({ date: d.date, value: d.strain })),
  );
  const whoopTrendLine = whoopTrend ? formatTrendForBriefing(whoopTrend) : null;
  // Part A: proactive recovery defense — fires on red tier OR sharp drop vs trailing avg.
  // Pass prior history only (excludes today); degrade to null on thin data.
  const recoveryAlert = whoopRecovery
    ? detectRecoveryDrop(whoopRecovery.recoveryScore, recoveryHistoryPoints)
    : null;
  // Part B: calendar ↔ recovery correlation (≥10 days data required).
  const strainHistoryPoints = strainHistory.map(d => ({ date: d.date, value: d.strain }));
  const correlationInsight = computeWhoopCorrelations(recoveryHistoryPoints, pastCalendarDays, strainHistoryPoints);
  // Part C: personal baselines (30-day rolling avg) + deviation from baseline + calendar action.
  const whoopBaselines = computeWhoopBaselines(
    recoveryHistoryPoints,
    sleepHistory.map(d => ({ date: d.date, value: d.durationMs })),
    strainHistoryPoints,
  );
  const baselineDeviationNote = buildBaselineDeviationNote(
    whoopRecovery?.recoveryScore ?? null,
    whoopSleep?.durationMs ?? null,
    whoopBaselines,
  );
  const calendarActionFromRecovery = whoopRecovery
    ? buildCalendarActionFromRecovery(whoopRecovery.recoveryScore)
    : null;
  const tomorrowRecoveryHint = predictTomorrowRecoveryHint(
    whoopStrain?.strain ?? null,
    whoopBaselines.strain30dAvg,
  );
  const incompleteTasks = taskQueries.getIncomplete(userId);
  // Accountability: the most recent Edge-captured commitment from yesterday (not today's tasks).
  // source='edg3' tasks come from extractTasksFromTranscript at call end.
  const edg3Commitment = incompleteTasks
    .filter(t => t.source === 'edg3' && t.date < today)
    .at(-1) ?? null;
  // M4 Accountability Snapshot: all commitments (tasks + open_loops) over past 7 days with outcomes.
  const accountabilitySnapshot = (() => {
    try {
      const recentTasks = taskQueries.getRecent(userId, 7);
      const loops = [
        ...openLoopQueries.list(userId, 'open'),
        ...openLoopQueries.list(userId, 'done'),
      ];
      return buildAccountabilitySnapshot(recentTasks, loops, today, 7);
    } catch { return null; }
  })();
  const accountabilityBlock = accountabilitySnapshot ? formatAccountabilityForBriefing(accountabilitySnapshot) : '';
  const accountabilityInstruction = accountabilitySnapshot ? accountabilityBriefingInstruction(accountabilitySnapshot) : '';
  // Email-reply tracking: new replies to the outreach Edge drafted (only its own threads).
  // Degrades to [] if Gmail read access isn't granted yet or anything errors.
  const outreachReplies = await checkOutreachReplies(userId).catch(() => []);
  // Priority↔calendar alignment: ONE Haiku call maps events to priorities so the briefing can
  // state concrete facts ("0h on fundraising") rather than a vague aside. Degrades to null.
  const alignment = await computeAlignment(priorities, fullWeekEvents, userTimezone).catch(() => null);
  // Calendar hygiene: pure local analysis — no LLM call. Degrades to null.
  const hygieneFlag = detectHygieneFlags(fullWeekEvents, userTimezone);
  // Call streak: count consecutive days with completed briefings.
  const callStreak = computeCallStreak(recentBriefings, userTimezone);
  // Open Loops: already fetched above for focus rec — reuse.
  const urgentLoops = urgentLoopsEarly;
  const openLoopsBlock = formatOpenLoopsForBriefing(urgentLoops);
  // Recurring-pattern detection: look across ALL loops (any status) for systemic friction.
  const allLoopsForRecurring = (() => {
    try { return openLoopQueries.list(userId, undefined, { includeSnoozed: true }); } catch { return []; }
  })();
  const recurringBlock = formatRecurringPatternsForBriefing(detectRecurringPatterns(allLoopsForRecurring, 3));
  // Calendar patterns: analyze 180-day history for routines, focus windows, and meeting load.
  const calendarPatternsBlock = formatCalendarPatternsForBriefing(
    detectCalendarPatterns(pastCalendarHistory, { timezone: userTimezone }),
  );
  // Time-allocation trends: how time has split across priorities over recent weeks.
  const allPrioritiesForAllocation = priorities.length > 0 ? priorities : priorityQueries.getMostRecent(userId);
  const timeAllocationBlock = formatTimeAllocationForBriefing(
    computeTimeAllocation(pastCalendarHistory, allPrioritiesForAllocation, { weeksBack: 8 }),
  );
  // Meeting prep: surface related email + facts + open-loops for today's upcoming events.
  const meetingContextBlock = (() => {
    try {
      const allOpenLoops = getUrgentOpenLoops(userId, focusDate);
      const contexts = buildMeetingContexts(
        calendarEvents,
        emailSignal?.items ?? [],
        salientFactsEarly,
        allOpenLoops,
        { lookAheadHours: 12, now: new Date().toISOString() },
      );
      return formatMeetingContextsForBriefing(contexts, userTimezone);
    } catch { return ''; }
  })();
  // Relationship context: historical interaction data for today's meeting attendees.
  const relationshipContextBlock = (() => {
    try {
      const profiles = peopleProfileQueries.listForUser(userId);
      return buildRelationshipContextBlock(calendarEvents, profiles, user.email);
    } catch { return ''; }
  })();
  // Pattern memory: best behavioral pattern detected from calendar + Whoop history.
  const patternMemoryBlock = (() => {
    try {
      const recoveryForPatterns = recoveryHistory.map(r => ({ date: r.date, recoveryScore: r.recoveryScore }));
      const best = pickBestPattern([
        detectProductiveDayPattern(pastCalendarHistory, userTimezone),
        detectLightDayPattern(pastCalendarHistory, userTimezone),
        detectMeetingLoadRecoveryPattern(pastCalendarHistory, recoveryForPatterns, userTimezone),
        detectFocusWindowPattern(pastCalendarHistory, userTimezone),
      ]);
      return formatPatternForBriefing(best);
    } catch { return ''; }
  })();
  // Whoop: format and build pacing context block — degrades to empty string if not connected.
  const whoopSection = buildWhoopSection(whoopRecovery, whoopSleep, whoopStrain);
  const baselineContext = buildBaselineContext(
    whoopRecovery,
    recoveryHistoryPoints,
    sleepHistory
      .sort((a, b) => b.date.localeCompare(a.date))
      .map(d => d.durationMs),
    whoopStrain?.strain ?? null,
  );
  const whoopContextBlock = (() => {
    if (!whoopSection) return '';
    const lines = [`HEALTH DATA (WHOOP):\n${whoopSection}`];
    const freshness = whoopFreshnessNote(whoopRecovery?.date, whoopSleep?.date, today);
    if (freshness) lines.push(freshness);
    if (whoopRecovery !== null) {
      const tier = whoopRecovery.recoveryScore >= 67
        ? 'green (strong — push hard on the top priority today)'
        : whoopRecovery.recoveryScore >= 34
        ? 'yellow (moderate — proceed as planned, don\'t over-extend)'
        : 'red (keep today lighter; defer deep work to a better-recovery day)';
      lines.push(`Recovery tier: ${tier}. Weave one brief pacing note into section 1 and factor into section 3 (which priority to push vs. defer).`);
    }
    if (baselineContext) {
      lines.push(`BASELINE (use these numbers when coaching pacing — grounded in data, not medical advice):\n${baselineContext}`);
    }
    if (baselineDeviationNote) {
      lines.push(`BASELINE DEVIATION: ${baselineDeviationNote} Reference this when coaching pacing — it grounds the observation in the user's own history.`);
    }
    if (whoopTrendLine) {
      lines.push(`WHOOP TREND (past ~2 weeks): ${whoopTrendLine} Surface this as one honest line in section 1 — no additional commentary.`);
    }
    if (recoveryAlert) {
      lines.push(formatRecoveryAlertForBriefing(recoveryAlert));
    }
    if (calendarActionFromRecovery) {
      lines.push(calendarActionFromRecovery);
    }
    if (correlationInsight) {
      lines.push(`WHOOP CORRELATION (${correlationInsight.sampleDays}-day pattern, honest — do NOT fabricate): ${correlationInsight.pattern} Surface at most once, naturally, in the closing or alignment section if relevant.`);
    }
    if (tomorrowRecoveryHint) {
      lines.push(`TOMORROW RECOVERY HINT: ${tomorrowRecoveryHint} Mention this naturally at the end of the call — only once.`);
    }
    return '\n' + lines.join('\n') + '\n';
  })();
  const whoopConnected = whoopSection !== null;
  // Priority staleness: if the most-recent week_of is > 7 days old, nudge once.
  const latestPriorities = priorities.length ? priorities : priorityQueries.getMostRecent(userId);
  const prioritiesWeekOf = latestPriorities[0]?.week_of ?? null;
  const prioritiesStaleAge = prioritiesWeekOf
    ? Math.floor((Date.now() - new Date(prioritiesWeekOf + 'T00:00:00Z').getTime()) / 86400000)
    : 0;

  // Episode Memory: past episodes whose topics overlap with today's priorities or events.
  const episodeMemoryBlock = (() => {
    try {
      const todayTitles = calendarEvents.map(e => e.summary ?? '').filter(Boolean);
      return buildEpisodeMemoryBlock(userId, latestPriorities.map(p => p.text), todayTitles);
    } catch { return ''; }
  })();

  // Derived priority proposal: run when priorities are absent or stale (>7d).
  // Non-blocking: a null from derivePriorities just means the section is omitted.
  const needsDerival = latestPriorities.length === 0 || prioritiesStaleAge > 7;
  const derivedProposal: DerivedPriorityProposal | null = needsDerival
    ? await derivePriorities({
        pastEvents: pastCalendarHistory,
        emailSignal,
        facts: allRawFacts,
        openLoops: urgentLoopsEarly,
        memories: recentMemories,
        currentPriorities: latestPriorities,
      }).catch(() => null)
    : null;

  // Only kudos for tasks completed since the last briefing
  const lastBriefing = recentBriefings[0];
  const lastBriefingTime = lastBriefing ? new Date(lastBriefing.created_at) : null;
  const recentlyCompletedTasks = taskQueries.getRecent(userId, 3).filter(t => {
    if (!t.completed || !t.completed_at) return false;
    if (!lastBriefingTime) return true;
    return new Date(t.completed_at) > lastBriefingTime;
  });

  const calendarText = formatEventsForBriefing(calendarEvents, userTimezone);
  const freeTimeText = getFreeTimeSlots([...calendarEvents, ...weekEvents], userTimezone, 7);
  const weekCalendarText = weekEvents.length
    ? weekEvents.map(e => {
        let start: string;
        if (e.start?.dateTime) {
          start = new Date(e.start.dateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: userTimezone });
        } else if (e.start?.date) {
          // All-day event — format the date clearly with day of week
          start = new Date(e.start.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' (all day)';
        } else {
          start = 'All day';
        }
        return `- ${start}: ${e.summary || 'Untitled'}`;
      }).join('\n')
    : 'No upcoming events this week.';

  const prioritiesText = priorities.length
    ? priorities.map((p, i) => `${i + 1}. ${p.text}`).join('\n')
    : 'No priorities set for this week.';

  const repliesText = outreachReplies.length
    ? outreachReplies.map(r => `- ${r.recipient}${r.eventTitle ? ` (re: ${r.eventTitle})` : ''}: ${r.summary} → Suggested next step: ${r.suggestedAction}`).join('\n')
    : 'No new replies to your outreach.';

  const alignmentText = alignment
    ? [
        ...alignment.perPriority.map((p, i) =>
          `P${i + 1} '${p.priority}' = ${p.hours.toFixed(1)}h this week${!p.blocked ? ' (⚠ none scheduled)' : ''}`
        ),
        `Unaligned calendar time = ${alignment.unalignedHours.toFixed(1)}h${
          alignment.topUnaligned.length
            ? ` (biggest: ${alignment.topUnaligned.map(e => `'${e.title}' ${e.hours.toFixed(1)}h`).join(', ')})`
            : ''
        }`,
      ].join('\n')
    : null;

  const memoriesText = recentMemories.length
    ? recentMemories.map(m => `[${m.type} - ${format(new Date(m.created_at), 'MMM d')}]: ${m.content}`).join('\n')
    : 'No prior conversation memory.';

  const previousBriefingsText = recentBriefings
    .filter(b => b.user_response)
    .slice(0, 3)
    .map(b => `[${format(new Date(b.scheduled_for), 'MMM d')}] User said: "${b.user_response}"`)
    .join('\n') || 'No prior call responses.';

  const commitmentsText = extractCommitments(recentBriefings);
  const lastCallResponse = recentBriefings.find(b => b.user_response);

  const isFirstCall = recentMemories.length === 0;

  // Reuse the already-ranked salient facts (loaded early for meeting context).
  const salientFacts = salientFactsEarly;
  // Event-linked memory — degrade to [] if thrown on malformed input.
  const linkedMemory = (() => { try { return linkEventsToFacts([...calendarEvents, ...weekEvents], salientFacts); } catch { return []; } })();
  // Energy matching (V2): energy-profile preferences + recovery modulator.
  // Degrades silently to null when no energy preferences are stored yet.
  const preferencesFacts = salientFacts.filter(f => f.category === 'preference');
  const energyMatchingBlock = buildEnergyMatchingBlock(preferencesFacts, whoopRecovery);
  // Energy OS: derive today's energy signal (Whoop auto or stored manual/override).
  const todayEnergyLog = (() => { try { return energyLogQueries.getToday(userId, today); } catch { return undefined; } })();
  const energySignal = deriveEnergySignal(todayEnergyLog, whoopRecovery?.recoveryScore ?? null);
  const energyBlock = formatEnergyForBriefing(energySignal, priorities, user.name.split(' ')[0]);

  // Calendar Fit scores: Focus (alignment) + Energy (Whoop sleep + recovery).
  const calendarFit = computeCalendarFit(alignment, priorities, recoveryHistory, whoopSleep);

  // Focus Scoreboard: per-area progress + milestone celebrations.
  const allMilestones = (() => { try { return focusMilestoneQueries.listForUser(userId); } catch { return []; } })();
  const focusProgress = buildFocusProgress(priorities, alignment, allMilestones);
  // "Recent" = done in the last 26 hours (generous window so it catches yesterday evening + this morning).
  const recentCutoff = new Date(Date.now() - 26 * 60 * 60 * 1000).toISOString();
  const recentlyDoneMilestones = allMilestones.filter(m => m.done === 1 && m.completed_at && m.completed_at >= recentCutoff);
  const focusScoreboardBlock = formatFocusScoreboardForBriefing(focusProgress, recentlyDoneMilestones);

  // Progress hook: call count + Edge Score delta vs last stored score (prior day)
  const callCount = recentBriefings.length + 1;
  const ordSuffix = (n: number) => (n === 11 || n === 12 || n === 13) ? 'th' : n % 10 === 1 ? 'st' : n % 10 === 2 ? 'nd' : n % 10 === 3 ? 'rd' : 'th';
  const callCountLabel = `${callCount}${ordSuffix(callCount)}`;
  const prevScoreRows = (() => {
    try {
      const weekAgo = format(new Date(Date.now() - 7 * 86400000), 'yyyy-MM-dd');
      const yesterday = format(new Date(Date.now() - 86400000), 'yyyy-MM-dd');
      return calendarScoreQueries.getRange(userId, weekAgo, yesterday);
    } catch { return []; }
  })();
  const prevEdgeScore = prevScoreRows.length > 0 ? prevScoreRows[prevScoreRows.length - 1].edge_score : null;
  const scoreDelta = prevEdgeScore !== null ? calendarFit.edgeScore - prevEdgeScore : null;
  const scoreDeltaStr = scoreDelta !== null && Math.abs(scoreDelta) >= 3
    ? (scoreDelta > 0 ? `, up ${scoreDelta} from yesterday` : `, down ${Math.abs(scoreDelta)} from yesterday`)
    : '';
  // Compact energy/sleep line for the greeting hook
  const progressEnergyStr = (() => {
    const parts: string[] = [];
    if (whoopSleep) parts.push(`sleep ${(whoopSleep.durationMs / 3_600_000).toFixed(1)}h`);
    if (whoopRecovery) {
      const tier = whoopRecovery.recoveryScore >= 67 ? 'green' : whoopRecovery.recoveryScore >= 34 ? 'yellow' : 'red';
      parts.push(`recovery ${whoopRecovery.recoveryScore}% (${tier})`);
    }
    return parts.join(', ');
  })();

  const systemPrompt = `You are EDG3, an AI Chief of Staff. You are proactive, direct, and deeply strategic.
The user's local time is currently ${localTime} in ${userTimezone}. All time references must use their local timezone.
IMPORTANT: Always open with "${greeting}, [name]." — never say "Good morning" if it is afternoon or evening.
${isFirstCall ? 'IMPORTANT: This is the first briefing. Lead with and address every stated weekly priority directly — do not substitute your own judgment for what matters most.' : ''}
You speak like Jarvis from Iron Man — confident, sharp, and always one step ahead. You are a trusted advisor, not a critic.
You know this person better than they know themselves. You believe in them deeply.
Your job is not to be a productivity app. Your job is to help them decide what deserves their attention today.
TONE: Be warm, direct, and encouraging — never harsh, never preachy, never critical of the person's character or patterns in a negative way. Do NOT say things like "you tend to..." or "you have a pattern of..." or "you often..." in a critical tone. If there is misalignment, acknowledge it briefly with empathy ("I notice your calendar is light on X — worth a thought") and move on immediately. One sentence max. Never dwell, never lecture. Always frame as possibility, never as failure. Leave them feeling capable and energized.
MAX 220 words total — every sentence earns its place. Tight, punchy, get-to-the-point. No filler, no preamble, no listing events for its own sake.
Speak in first person to the user. Be warm but authoritative.
IMPORTANT: Write times naturally as they would be spoken. "1:30 PM" → "one thirty PM". "9:00 AM" → "nine AM". "10:53 AM" → "ten fifty-three AM". Never round times — say the exact time. Never spell out time digits individually. For money: "two hundred fifty thousand dollars". For percentages: "thirty percent". For weights: "lbs" → "pounds", "kg" → "kilograms". For other numbers: spell out fully. Never write bare digits or abbreviations that won't be spoken correctly.
IMPORTANT: Always write full day names — never abbreviate. "Mon" → "Monday", "Tue" → "Tuesday", "Wed" → "Wednesday", "Thu" → "Thursday", "Fri" → "Friday", "Sat" → "Saturday", "Sun" → "Sunday".
IMPORTANT: Use memory context to make the briefing relevant and personal, but do NOT open with references to previous calls or what was said last time. Get straight to today.
IMPORTANT — MEMORY: You have full memory of every previous conversation with this person. It is provided to you in the briefing data. Never say you "don't have memory", "start fresh", or "can't remember" previous calls. If asked, say "I have everything from our previous calls — it's all here." You remember everything they've told you.
IMPORTANT — CALENDAR CAPABILITIES: You can read, create, edit, move, and delete calendar events. When the user asks you to make calendar changes during the call, confirm you'll handle it and it will be done after the call. Never say you "can't edit" or "don't have access" to their calendar. You have full calendar access.
IMPORTANT: The user's name is ${user.name.split(' ')[0]} — always address them by this name and no other.
IMPORTANT: The product is spelled "Edg3" but should be pronounced "Edge" — always write it as "Edge" in the text so it is spoken correctly.`;

  const userPrompt = `Generate today's (${todayLabel}) morning briefing for ${user.name}.

USER PROFILE:
${user.profile_summary || 'No profile summary available.'}

THIS WEEK'S TOP PRIORITIES:
${prioritiesText}
${focusRec && focusRec.areas.length > 0 ? `
FOCUS RECOMMENDATION — Edge analyzed ${focusRec.basedOn.join(', ')} and recommends today's focus:
${focusRec.areas.map((a, i) => `${i + 1}. "${a.title}" [${a.confidence}]${a.anchor ? ` → ${a.anchor}` : ''} — ${a.rationale}`).join('\n')}
INSTRUCTION — THE HERO LOOP (do this every call, in order):
STEP 1 — EDGE SCORE: Start with the score as instructed below.
STEP 2 — ENERGY: State energy tier or ask if unknown (see ENERGY STATE below).
STEP 3 — FOCUS PROPOSAL: Immediately after energy, propose: "Based on your last six months and our calls, here's what I'd focus you on today: [title 1], [title 2], [title 3]. Sound right?" On yes → call confirmFocus(areas) with those titles. On tweak → adjust titles, then confirmFocus. Keep it one breath — don't read the full rationale text.
STEP 4 — RESHAPE OFFER: Right after confirming focus, say: "Want me to reshape your day around these? I can add a deep-work block and move the one event that's fighting your energy." On yes → call applyCalendarPlan() (no confirmToken yet — it returns a plan summary). Read the plan out loud. On explicit yes → call applyCalendarPlan again WITH the returned confirmToken to execute. Report the new Edge Score.
This sequence IS the product's magic moment. Do not skip steps 3–4 or bury them at the end.
` : ''}
PROGRESS HOOK (use in Part 1 of the briefing — the opening hook, in order):
Call number: ${callCountLabel} morning
Edge Score today: ${calendarFit.edgeScore}/100${scoreDeltaStr}
${progressEnergyStr ? `Energy/sleep: ${progressEnergyStr}` : '(No Whoop data — skip energy/sleep sentence in greeting)'}

CALENDAR FIT — EDGE SCORE (the ONE number; open with: "Your Edge Score is ${calendarFit.edgeScore} out of 100 — ${calendarFit.edgeScore >= 70 ? 'calendar looks solid' : calendarFit.edgeScore >= 40 ? 'a few things to fix' : 'calendar needs reshaping'}. Here's why and here's the one move that helps most"):
Edge Score: ${calendarFit.edgeScore}/100${calendarFit.calibrating ? ' (energy calibrating — set your energy level to sharpen this)' : ''}
Focus: ${calendarFit.focusScore.score}% — ${calendarFit.focusScore.drivers.join(' ')}${calendarFit.focusScore.topFix ? ` → ${calendarFit.focusScore.topFix.description}` : ''}
Energy: ${calendarFit.calibrating ? 'calibrating (no signal yet)' : `${calendarFit.energyScore.score}% — ${calendarFit.energyScore.drivers.join(' ')}${calendarFit.energyScore.topFix ? ` → ${calendarFit.energyScore.topFix.description}` : ''}`}

${energyBlock}

TODAY'S CALENDAR:
${calendarText}

UPCOMING THIS WEEK:
${weekCalendarText}

FREE TIME SLOTS (next 7 days, 8am–8pm):
${freeTimeText}

REPLIES TO YOUR OUTREACH (Edge drafted these emails for the user and they were sent; these are the contacts' replies. If any are present, RAISE them in the briefing and OFFER to take the suggested next step — e.g. "Wilmec replied, they can come Thursday at two PM — want me to book it?". If "No new replies", do not mention this section at all.):
${repliesText}
${alignmentText ? `
ALIGNMENT DATA — real calendar hours mapped to stated priorities (source of truth for section 3 below — do NOT invent numbers):
${alignmentText}
` : ''}${timeAllocationBlock ? `
${timeAllocationBlock}
Use TIME ALLOCATION in section 3 (ALIGNMENT CHECK) only — surface the biggest misalignment concretely (e.g. "60% of your calendar time has been going to meetings, while fundraising — your top priority — has only gotten 8% in the last 8 weeks"). One observation max. Do not repeat it elsewhere.
` : ''}${focusScoreboardBlock ? `
${focusScoreboardBlock}
` : ''}${whoopContextBlock}${energyMatchingBlock ? energyMatchingBlock : (whoopConnected ? `
ENERGY PROFILE: Not set yet. Since Whoop is connected, add ONE brief invite at the very end of the closing section (after any other nudges): "One more thing — if you tell me your high-energy windows, I can start matching your schedule to your energy. Morning peak? Afternoon dip?" Only add this if it feels natural; skip if there are already two or more other end-of-briefing nudges.
` : '')}${hygieneFlag ? `
CALENDAR HYGIENE FLAG (one concrete overload pattern — surface this in section 4):
${hygieneFlag}
` : ''}${accountabilityBlock ? `
${accountabilityBlock}
${accountabilityInstruction}
` : edg3Commitment ? `
YESTERDAY'S COMMITMENT (Edge captured this from the last call — the user said they'd do it):
- ${edg3Commitment.text}
` : ''}${episodeMemoryBlock ? `
${episodeMemoryBlock}
` : ''}${openLoopsBlock ? `
${openLoopsBlock}
When Edge detects an open loop: name the loop specifically ("you told CIBC you'd send the proposal by Friday") and offer to help close it (draft an email, block time, or just acknowledge — whatever fits). Surface at most 2 loops naturally in section 4 (Action Items) or section 6 (Closing). Never anxiety-inducing — calm and helpful.
` : ''}${recurringBlock ? `
${recurringBlock}
Use RECURRING OPEN LOOPS only if one matches today's context — mention it briefly and suggest a permanent fix ("that one keeps coming back — want to schedule a standing 30 minutes for it?"). One mention max, in section 4. Skip if the urgent loops already cover it.
` : ''}${meetingContextBlock ? `
${meetingContextBlock}
Use MEETING PREP as a jumping-off point — in section 2 or 3, weave in ONE specific observation for the most important upcoming meeting: relevant email thread, a fact you know about the person, or an open loop they should close before walking in. Keep it to one sentence per event — don't read every bullet. Only reference meetings that actually appear in the calendar data.
` : ''}${relationshipContextBlock ? `
${relationshipContextBlock}
Use RELATIONSHIP CONTEXT to make ONE warm, specific observation about a person you're meeting today — "you've worked with Alice seven times" or "last time you connected with Bob was two months ago — might be worth an update." One line only; weave it into section 2 or 3 naturally. Never read the full list.
` : ''}${patternMemoryBlock ? `
${patternMemoryBlock}
Use PATTERN INSIGHT in section 5 (CALENDAR BLOCKS) — reference the pattern naturally when it strengthens a scheduling suggestion (e.g. "Tuesdays tend to be your clearest — want to protect this Tuesday morning for deep work?"). One mention only; never read the stats aloud.
` : ''}${calendarPatternsBlock ? `
${calendarPatternsBlock}
Use CALENDAR PATTERNS in section 5 (CALENDAR BLOCKS) — suggest time blocks that align with the inferred focus window and avoid the historically-packed meeting window. Reference patterns only when they strengthen a recommendation (e.g. "Tuesday mornings are usually light for you — good slot for deep work"). Do not read the whole block aloud.
` : ''}${callStreak >= 2 ? `
CALL STREAK: ${callStreak} consecutive days of morning calls. Acknowledge this warmly in the GREETING — one specific, energizing line (e.g. "five mornings straight — you're building real momentum here").
` : ''}${(latestPriorities.length === 0 || prioritiesStaleAge > 7) && derivedProposal ? `
DERIVED PRIORITY PROPOSAL (from ${derivedProposal.dataSnapshot.calendarEventCount} calendar events + ${derivedProposal.dataSnapshot.emailThreadCount} email threads):
${derivedProposal.priorities.map((p, i) => `${i + 1}. "${p.text}" — ${p.rationale}${p.evidenceTags.length ? ` [${p.evidenceTags.join(', ')}]` : ''}`).join('\n')}
${derivedProposal.summaryLine ? `Summary: ${derivedProposal.summaryLine}` : ''}
Use DERIVED PRIORITY PROPOSAL when priorities are missing or stale: say "I looked at your calendar and inbox over the past few weeks and I think I can see what actually matters to you right now — want me to share?" If yes, share the 2–3 items above in plain language. Each item = one sentence (the text) + one supporting sentence (the rationale). Invite them to confirm or reject: "Does that feel right, or is something else pulling harder?" If confirmed, tell them their priorities are now set and they'll be posted in the dashboard.${prioritiesStaleAge > 7 ? ` PRIORITY DRIFT ALERT: priorities were last set ${prioritiesStaleAge} days ago.` : ''}
` : prioritiesStaleAge > 7 ? `
PRIORITY DRIFT ALERT: Priorities were last set ${prioritiesStaleAge} days ago. Add ONE gentle nudge at the END of the closing section: "By the way — your priorities were last refreshed ${prioritiesStaleAge >= 14 ? `${Math.round(prioritiesStaleAge / 7)} weeks ago` : 'a week ago'} — worth a quick update on our next call?"
` : ''}${linkedMemory.length > 0 ? `
EVENT-LINKED MEMORY (real events from the calendar annotated with relevant structured facts — use to make ONE sharp dot-connecting moment; NEVER invent events; NEVER use this to claim an event is on the calendar unless it also appears in TODAY'S CALENDAR or UPCOMING THIS WEEK above):
${linkedMemory.map(lm => {
  const learnedDate = lm.fact.learned_at ? new Date(lm.fact.learned_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '';
  return `- "${lm.eventTitle}" → ${lm.fact.statement} (${lm.fact.category}${learnedDate ? `, learned ${learnedDate}` : ''})`;
}).join('\n')}
` : ''}
MEMORY & PRIOR CONVERSATIONS:
${memoriesText}

INCOMPLETE TASKS FROM PREVIOUS DAYS:
${incompleteTasks.length ? incompleteTasks.map(t => `- [${t.date}] ${t.text}`).join('\n') : 'None.'}

RECENTLY COMPLETED TASKS:
${recentlyCompletedTasks.length ? recentlyCompletedTasks.map(t => `- [${t.date}] ${t.text}`).join('\n') : 'None.'}

Generate a crisp spoken briefing — MAX 220 words. No filler. Every sentence earns its place. No markdown.

CRITICAL RULE — CALENDAR VERIFICATION: The ONLY source of truth for what is on the calendar is TODAY'S CALENDAR and UPCOMING THIS WEEK sections above. If an event does not appear there, do NOT mention it. Treat memory references to calendar events as historical only — not current facts.

BRIEFING STRUCTURE — 3 parts, in order:

PART 1 — GREETING + HOOK (2–3 sentences MAX):
Say: "${greeting}, ${firstName}. This is your ${callCountLabel} morning — your Edge Score is ${calendarFit.edgeScore} out of 100${scoreDeltaStr}." Then ONE energy/sleep sentence using PROGRESS HOOK data — if recovery is GREEN (≥67%), tie the encouragement to a SPECIFIC real event on TODAY'S CALENDAR (e.g. "Recovery's solid — push hard on that investor prep this morning."), not a generic "solid day ahead." If recovery is RED (≤33%), name the heaviest deferrable block: "Recovery's low at X% — I'd protect your morning and defer [specific event] if possible." If no Whoop data, skip energy sentence entirely. Then ONE sentence ONLY if there is a genuinely meaningful event today (not breakfast, gym, meals, or routine blocks). If TODAY'S CALENDAR shows a personal all-day event (birthday, anniversary, holiday — e.g. "Dad's Birthday"), acknowledge it warmly in one sentence with a small offer ("Today's [Name]'s birthday — want me to block time for a call or draft a quick note?"). If nothing meaningful: skip.${callStreak >= 2 ? ` Weave in ONE warm streak line naturally.` : ''}${linkedMemory.length > 0 ? ` If EVENT-LINKED MEMORY has a genuinely relevant connection to today, add ONE dot-connecting sentence.` : ''}

PART 2 — FOCUS + ACTION (4–5 sentences MAX):
${edg3Commitment ? `Open with ONE accountability line: "Yesterday you committed to '${edg3Commitment.text}' — did that happen?" ` : ''}${focusRec && focusRec.areas.length > 0 ? `Propose focus: "For today, I'd focus you on: [area 1], [area 2], [area 3]. Sound right?" Then name what to DO first this morning, anchored to their top focus area and a specific calendar event where one connects. If ALIGNMENT DATA shows a gap, include one sentence: the biggest mismatch + a specific blocking offer using a slot from FREE TIME SLOTS (e.g. "Want me to block Tuesday at two PM for fundraising?"). If FREE TIME SLOTS shows an open afternoon window (3pm+) and the user has multiple priorities, offer a choice: "You've got a free window this afternoon — would you rather push on [priority 1] or [priority 2]?" One choice, then let them respond.` : `Name the top 2 concrete things to DO today anchored to priorities. No listing events — name ACTIONS.`}${hygieneFlag ? ` Surface the CALENDAR HYGIENE FLAG in one punchy sentence with offer to fix.` : ''}${energyMatchingBlock ? ' ENERGY MATCHING: use the ENERGY PROFILE above — place highest-priority deep/creative work in the stated peak window; batch admin in the trough. Scale to today\'s recovery tier. Direct offer.' : ''}

PART 3 — CLOSING (2–3 sentences MAX):
ONE specific, focus-driven question tied to TODAY's top focus area or a meaningful upcoming event. NEVER ask "what's the most important thing before tomorrow's briefing" — banned. Example: "One question before I let you go — on [focus area], [specific actionable question]?" Then: "I'll capture your answer in the calendar." Then add ONE brief forward-looking line about tomorrow if there is a meaningful event or free window worth noting (e.g. "Tomorrow you've got a clear morning — I'll protect it for deep work."). Skip the forward-look if tomorrow is empty or nothing stands out.${prioritiesStaleAge > 7 ? ` Add ONE gentle nudge at the very end: "By the way — your priorities were last refreshed ${prioritiesStaleAge >= 14 ? `${Math.round(prioritiesStaleAge / 7)} weeks ago` : 'a week ago'} — worth a quick update on our next call?"` : ''}

Write as flowing spoken language.`;

  // Main briefing generation: 30-second timeout guard so a slow/hanging Anthropic call
  // can never block the scheduler from placing the call.
  let briefingText: string;
  try {
    const message = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 320,
      system: systemPrompt,
      messages: [{ role: 'user', content: userPrompt }],
    }, { signal: AbortSignal.timeout(30_000) });
    const content = message.content[0];
    briefingText = content.type === 'text' ? content.text : buildFallbackBriefing(greeting, user.name, calendarText, prioritiesText);
  } catch (err) {
    console.error('[briefing] generateDailyBriefing main call failed — falling back to basics:', err);
    briefingText = buildFallbackBriefing(greeting, user.name, calendarText, prioritiesText);
  }

  // Post-process: verify calendar references. Degrade gracefully if this step fails.
  try {
    return await sanitizeCalendarReferences(briefingText, calendarEvents, weekEvents, userTimezone);
  } catch (err) {
    console.error('[briefing] sanitizeCalendarReferences failed — returning raw briefing:', err);
    return briefingText;
  }
}

export async function generatePreviewBriefing(userId: number): Promise<string> {
  const user = userQueries.findById(userId);
  if (!user) throw new Error('User not found');
  if (!user.onboarding_complete) throw new Error('Onboarding not complete');

  const userTimezone = effectiveTimezone(user);
  const weekOf = format(startOfWeek(new Date()), 'yyyy-MM-dd');
  const firstName = user.name.split(' ')[0];

  const priorities = priorityQueries.getMostRecent(userId);
  const prioritiesText = priorities.length
    ? priorities.map((p, i) => `${i + 1}. ${p.text}`).join('\n')
    : 'No priorities set yet.';

  // Calendar is optional — degrade gracefully if not connected or fetch fails.
  let calendarText = '';
  try {
    const events = await getWeekEvents(userId);
    if (events.length) {
      calendarText = events.slice(0, 8).map(e => {
        let start: string;
        if (e.start?.dateTime) {
          start = new Date(e.start.dateTime).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: userTimezone });
        } else if (e.start?.date) {
          start = new Date(e.start.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' }) + ' (all day)';
        } else {
          start = 'All day';
        }
        return `- ${start}: ${e.summary || 'Untitled'}`;
      }).join('\n');
    }
  } catch {
    // No calendar connected or fetch failed — priorities-only mode.
  }

  const systemPrompt = `You are Edge, an AI Chief of Staff. You are warm, confident, and direct.
Write this as natural spoken text — no markdown headers, no bullet-point sections, flowing paragraphs.
Keep it to 150–200 words. This is a "Day-1 preview" moment — the user just finished onboarding and is seeing Edge for the first time. Make it feel like Edge already knows them and is ready to help them win their week.`;

  const userPrompt = `Generate a Day-1 preview briefing for ${firstName}.

THEIR TOP PRIORITIES:
${prioritiesText}

THEIR UPCOMING CALENDAR THIS WEEK:
${calendarText || 'Calendar not connected yet — no events available.'}

Write a short, personal, energizing preview (150–200 words) that:
1. Opens by addressing ${firstName} by name and acknowledging they've just set up Edge
2. Directly references their stated priorities — show you already know what matters to them
3. If calendar is available: briefly mention 1–2 upcoming events that relate to their priorities
4. If no calendar: acknowledge it's not connected yet and offer a teaser of what Edge will do once it is
5. Closes with warmth and a forward-looking line — e.g. "Your first briefing call is scheduled for [call_time]. I'll have everything ready." (use their call time: ${user.call_time ?? '07:00'} ${userTimezone})

Do NOT use headers. Do NOT format as bullet points. Write like you're speaking — flowing, personal, confident.`;

  const message = await anthropic.messages.create({
    model: 'claude-haiku-4-5-20251001',
    max_tokens: 300,
    system: systemPrompt,
    messages: [{ role: 'user', content: userPrompt }],
  });

  const content = message.content[0];
  if (content.type !== 'text') throw new Error('Unexpected response type');
  return content.text;
}

export async function analyzeUserResponse(userId: number, response: string): Promise<void> {
  const user = userQueries.findById(userId);
  const name = user?.name || 'the user';

  const [insight, tasksResult] = await Promise.all([
    anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Extract the key insight or information from this response. Refer to the person by name as "${name}", never as "the user" or "they".
Be concise (1-2 sentences). Focus on what matters most.
${name} said: "${response}"
Key insight:`
      }]
    }),
    anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{
        role: 'user',
        content: `Extract any action items or tasks ${name} is requesting from their AI Chief of Staff.
Return ONLY a JSON array of short task strings (max 8 words each). Only include explicit requests, not general conversation.
If no tasks requested, return [].
${name} said: "${response}"
Tasks:`
      }]
    }),
  ]);

  const insightContent = insight.content[0];
  if (insightContent.type === 'text') {
    // T4: Canonicalize STT homophones in user response before storing as call note.
    let groundedResponse = response;
    try {
      const { groundProperNouns, canonicalNamesFromProfile } = await import('@/lib/grounding');
      const nameTokens = user?.name ? canonicalNamesFromProfile(user.name) : [];
      const personFacts = factQueries.getAll(userId)
        .filter(f => f.category === 'person' && f.entity?.trim())
        .map(f => f.entity as string);
      const allNames = [...new Set([...nameTokens, ...personFacts])];
      if (allNames.length) groundedResponse = groundProperNouns(groundedResponse, allNames);
    } catch { /* grounding is best-effort */ }
    if (user && isImproveConsented(user)) {
      memoryQueries.create(userId, 'transcript', groundedResponse.slice(0, 2000));
      memoryQueries.create(userId, 'insight', insightContent.text.slice(0, 500));
    }
  }

  const tasksContent = tasksResult.content[0];
  if (tasksContent.type === 'text') {
    try {
      const match = tasksContent.text.match(/\[[\s\S]*\]/);
      if (match) {
        const tasks: string[] = JSON.parse(match[0]);
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.toLocaleDateString('en-CA');
        for (const text of tasks.slice(0, 5)) {
          if (text?.trim()) taskQueries.create(userId, text.trim().slice(0, 500), tomorrowStr, 'edg3');
        }
      }
    } catch {
      // ignore parse errors
    }
  }
}

export function getWeekOf(): string {
  return format(startOfWeek(new Date()), 'yyyy-MM-dd');
}
