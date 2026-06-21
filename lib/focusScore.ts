// R16 T2 — daily Focus Score: one synthesized 0–100 number anchoring the morning call.
// Pure, zero-I/O. Blends Whoop recovery (40%), schedule quality (35%), and task
// follow-through (25%). Distinct from lib/calendarScore.ts's calendar-alignment score —
// this is the spoken "how set up for a focused day are you" anchor.

export interface FocusScoreInput {
  recoveryScore: number | null;       // 0–100 from Whoop; null if not connected
  priorityHoursThisWeek: number;      // from the alignment check
  hasBreathingRoom: boolean;          // ≥1 gap of 30+ min today
  followThroughRate: number | null;   // completed / (completed + overdue) last 7d; null if <3 data points
}

export interface FocusScore {
  score: number;
  tier: 'high' | 'medium' | 'low';
  headline: string;
  breakdown: { recovery: number; schedule: number; followThrough: number };
}

function recoveryPoints(r: number | null): number {
  if (r === null) return 20;        // neutral when no Whoop
  if (r >= 67) return 40;
  if (r >= 34) return 24;
  return 10;
}

function schedulePoints(priorityHours: number, breathingRoom: boolean): number {
  const hasHours = priorityHours >= 2;
  if (hasHours && breathingRoom) return 35;
  if (hasHours || breathingRoom) return 20;
  return 8;
}

function followThroughPoints(rate: number | null): number {
  if (rate === null) return 18;     // neutral when too little data
  if (rate >= 0.8) return 25;
  if (rate >= 0.5) return 15;
  return 5;
}

export function computeFocusScore(input: FocusScoreInput): FocusScore {
  const recovery = recoveryPoints(input.recoveryScore);
  const schedule = schedulePoints(input.priorityHoursThisWeek, input.hasBreathingRoom);
  const followThrough = followThroughPoints(input.followThroughRate);
  const score = recovery + schedule + followThrough;
  const tier: FocusScore['tier'] = score >= 70 ? 'high' : score >= 45 ? 'medium' : 'low';
  return {
    score,
    tier,
    headline: buildHeadline(score, tier, input, { recovery, schedule, followThrough }),
    breakdown: { recovery, schedule, followThrough },
  };
}

function buildHeadline(
  score: number,
  tier: FocusScore['tier'],
  input: FocusScoreInput,
  pts: { recovery: number; schedule: number; followThrough: number },
): string {
  // Lead with the weakest real lever so the sentence is actionable.
  const recLabel = input.recoveryScore === null ? '' : input.recoveryScore >= 67 ? "recovery's strong" : input.recoveryScore >= 34 ? "recovery's moderate" : "recovery's low";
  const schedLabel = pts.schedule >= 35 ? 'priorities have time' : pts.schedule >= 20 ? 'the schedule has some room' : "the schedule's tight";
  const ftLabel = input.followThroughRate === null ? '' : pts.followThrough >= 25 ? "your follow-through's been solid" : pts.followThrough >= 15 ? 'follow-through is holding' : 'follow-through has slipped';

  if (tier === 'high') {
    const parts = [recLabel, schedLabel, ftLabel].filter(Boolean);
    return `Focus Score ${score} — ${parts.join(', ')}.`;
  }
  if (tier === 'low') {
    const weak = [input.recoveryScore !== null && input.recoveryScore <= 33 ? "recovery's low" : '', pts.schedule <= 8 ? "the schedule's tight" : ''].filter(Boolean);
    return `Focus Score ${score} — ${weak.length ? weak.join(' and ') : 'a lot is working against focus today'}; worth protecting your energy.`;
  }
  // medium — name the single biggest gap
  const gap = pts.schedule <= 20 ? "priorities haven't had a real block" : pts.followThrough <= 15 && input.followThroughRate !== null ? 'follow-through has dipped' : recLabel || 'a couple of things need attention';
  return `Focus Score ${score} — ${recLabel ? `${recLabel} but ` : ''}${gap}.`;
}

/** One spoken sentence for the briefing opener. */
export function formatFocusScoreForBriefing(score: FocusScore): string {
  return score.headline;
}
