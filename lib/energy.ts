// Energy OS — pure helpers for the daily energy signal.
//
// Tiered so it works for everyone: auto-derive from Whoop recovery, manual override
// from a call or dashboard, or ask on-call if unknown. Pure — no I/O.

import type { EnergyLog, Priority } from './db';

export type EnergyLevel = 'red' | 'yellow' | 'green';

export interface EnergySignal {
  level: EnergyLevel;
  source: 'whoop' | 'manual' | 'override';
}

/** Map Whoop recovery score to energy tier (mirrors the existing Whoop tier mapping). */
export function whoopTierToLevel(score: number): EnergyLevel {
  if (score >= 67) return 'green';
  if (score >= 34) return 'yellow';
  return 'red';
}

/**
 * Derive today's energy signal from the available sources.
 * Precedence: stored manual/override > Whoop auto-derived > null (unknown).
 * An 'override' stored in energy_log always wins even when Whoop is present.
 */
export function deriveEnergySignal(
  todayLog: EnergyLog | null | undefined,
  whoopRecoveryScore: number | null | undefined,
): EnergySignal | null {
  // Stored entry (manual or override) wins
  if (todayLog) {
    return { level: todayLog.level, source: todayLog.source };
  }
  // Auto-derive from Whoop when no stored entry
  if (whoopRecoveryScore != null) {
    return { level: whoopTierToLevel(whoopRecoveryScore), source: 'whoop' };
  }
  return null;
}

/**
 * Build the ENERGY STATE block for the morning briefing prompt.
 * Returns '' when unknown (briefing will prompt Edge to ask).
 */
export function formatEnergyForBriefing(
  signal: EnergySignal | null,
  prioritiesWithCost: Priority[],
  firstName = '',
): string {
  const costPriorities = prioritiesWithCost.filter(p => p.energy_cost);
  const costLines = costPriorities.length
    ? costPriorities.map((p, i) => `${i + 1}. ${p.text} (${p.energy_cost}-energy)`).join('\n')
    : '';

  if (!signal) {
    return [
      'ENERGY STATE: Unknown — no Whoop data and no manual entry for today.',
      'ACTION: Ask the user their energy level EARLY in the briefing (right after the greeting): "Before I run your day, how\'s your energy — red, yellow, or green?" Wait for the answer, call setEnergyLevel with the result, then tailor the plan.',
      costLines ? `FOCUS-AREA ENERGY COSTS:\n${costLines}` : '',
    ].filter(Boolean).join('\n');
  }

  const detail = signal.level === 'green'
    ? 'Full capacity — schedule high-energy focus blocks, push hard on the top priority.'
    : signal.level === 'yellow'
    ? 'Moderate — proceed as planned, avoid over-extending.'
    : 'Low — protect the day: lean into low-energy work, defer high-energy blocks to a better day.';

  const sourceNote = signal.source === 'whoop'
    ? 'Auto-derived from Whoop recovery.'
    : signal.source === 'override'
    ? 'Subjective override (user\'s felt energy — takes precedence over Whoop).'
    : 'Set manually.';

  const lines = [
    `ENERGY STATE: ${signal.level.toUpperCase()} (${detail}) [${sourceNote}]`,
    signal.source === 'whoop'
      ? `If the Whoop tier doesn't match how ${firstName || 'they'} says they feel, call setEnergyLevel with source 'override' — felt energy wins.`
      : '',
    costLines ? `FOCUS-AREA ENERGY COSTS:\n${costLines}` : '',
  ].filter(Boolean);

  // Red day + high-energy priorities → proactive move suggestion
  if (signal.level === 'red') {
    const highEnergyPriorities = prioritiesWithCost.filter(p => p.energy_cost === 'high');
    if (highEnergyPriorities.length) {
      lines.push(
        `RED DAY ACTION: The following priorities are high-energy but today's signal is red — ` +
        `scan the calendar for any focus block tied to these and proactively offer to defer it: ` +
        highEnergyPriorities.map(p => `"${p.text}"`).join(', ') +
        `. Offer to move it to the next green-looking slot (earlier in the week was better; don't guess — offer to find a slot).`
      );
    }
  }

  return lines.join('\n');
}

/**
 * Compact energy line for the live-call system prompt.
 * Returns '' when unknown (prompt tells Edge to ask early).
 */
export function formatEnergyForCall(
  signal: EnergySignal | null,
  firstName: string,
): string {
  if (!signal) {
    return `ENERGY CHECK: No energy signal for today yet. Ask EARLY — right after the greeting: "${firstName}, before we dive in — how's your energy today: red, yellow, or green?" Call setEnergyLevel with the result immediately; use it to shape the rest of the call.`;
  }
  const detail = signal.level === 'green'
    ? 'full capacity — encourage pushing on high-energy priorities'
    : signal.level === 'yellow'
    ? 'moderate — proceed as planned'
    : 'low — keep today lighter, protect the day, offer to defer heavy work';
  const src = signal.source === 'whoop' ? 'Whoop' : signal.source === 'override' ? 'override' : 'manual';
  return (
    `ENERGY: ${signal.level.toUpperCase()} today (${src}) — ${detail}. ` +
    (signal.source === 'whoop'
      ? `State it upfront: "recovery's ${signal.level} today". Offer a light override: "feel about right, or different?" If they say lower/higher, call setEnergyLevel(level, 'override') and adjust.`
      : `Already confirmed — use it, don't re-ask.`)
  );
}
