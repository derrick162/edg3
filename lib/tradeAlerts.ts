// C14 — voice-set trade alerts: pure helpers for parsing/describing/matching. Core-owned, 0 I/O.
// The honesty pattern: Edge echoes the PARSED condition back so a misheard ticker/number is caught
// before the trade-monitor starts watching it.

export type AlertDirection = 'above' | 'below';
export type AlertType = 'price' | 'volume_bar' | 'signal_grade';

export interface TradeAlertLike {
  symbol: string;
  type?: AlertType;                      // defaults to 'price' (C14b)
  direction?: AlertDirection | null;     // present for 'price'; null/absent for the others
  level: number;
}

// C14b — voice defaults when the user doesn't state a level.
export const VOLUME_BAR_DEFAULT_LEVEL = 1_500_000; // "a big volume bar" → 1.5M shares
export const SIGNAL_GRADE_DEFAULT_LEVEL = 8;       // "grades an eight"

/** Canonical alert type from a raw phrase; defaults to 'price'. */
export function parseAlertType(raw: string | null | undefined): AlertType {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return 'price';
  if (s === 'volume_bar' || /\bvolume\b|\bshares?\b|\binstitution/.test(s)) return 'volume_bar';
  if (s === 'signal_grade' || /\bgrades?\b|\bsetup\b|\bsignal\b/.test(s)) return 'signal_grade';
  return 'price';
}

// Map the many ways a user phrases a threshold to a canonical direction.
const ABOVE_WORDS = /\b(above|over|breaks?|break\s*out|hits?|reaches?|crosses?\s*(?:up|above)?|up\s*(?:to|through)|exceeds?|tops?|past|>|≥|>=|at\s*or\s*above)\b/i;
const BELOW_WORDS = /\b(below|under|beneath|drops?|falls?|dips?|breaks?\s*down|down\s*(?:to|through)|loses?|<|≤|<=|at\s*or\s*below)\b/i;

/** Canonical direction from a raw model/user phrase, or null when it's genuinely ambiguous. */
export function parseAlertDirection(raw: string | null | undefined): AlertDirection | null {
  const s = (raw ?? '').trim().toLowerCase();
  if (!s) return null;
  if (s === 'above' || s === 'below') return s; // exact (model usually passes these)
  // "break(s) down" is BELOW even though a bare "break" is ABOVE — resolve the compound first.
  if (/\bbreaks?\s*down\b/.test(s)) return 'below';
  // Comparison symbols (word boundaries don't apply to them).
  if (/[>≥]/.test(s) && !/[<≤]/.test(s)) return 'above';
  if (/[<≤]/.test(s) && !/[>≥]/.test(s)) return 'below';
  const above = ABOVE_WORDS.test(s);
  const below = BELOW_WORDS.test(s);
  if (above && !below) return 'above';
  if (below && !above) return 'below';
  return null; // unknown or contradictory
}

/** Price as a clean spoken/display string: whole numbers bare, otherwise 2 decimals ("501.30"). */
export function formatAlertPrice(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

/** Human-readable condition, per type: price → "SOXX below 501.30"; volume_bar → "a volume bar on
 * SOXX at or above 1,500,000 shares"; signal_grade → "a SOXX setup grade of 8 or higher". */
export function describeTradeAlert(a: TradeAlertLike): string {
  const type = a.type ?? 'price';
  if (type === 'volume_bar') return `a volume bar on ${a.symbol} at or above ${a.level.toLocaleString('en-US')} shares`;
  if (type === 'signal_grade') return `a ${a.symbol} setup grade of ${a.level} or higher`;
  return `${a.symbol} ${a.direction ?? 'below'} ${formatAlertPrice(a.level)}`;
}

/**
 * Resolve which active alerts a cancel request refers to. Filters by symbol (case-insensitive) and/or
 * level (±0.01 tolerance for float wobble). With neither filter, returns all (caller disambiguates).
 */
export function matchTradeAlerts<T extends TradeAlertLike>(alerts: T[], q: { symbol?: string; level?: number }): T[] {
  const sym = q.symbol?.trim().toUpperCase();
  return alerts.filter(a => {
    if (sym && a.symbol.toUpperCase() !== sym) return false;
    if (typeof q.level === 'number' && Math.abs(a.level - q.level) > 0.01) return false;
    return true;
  });
}
