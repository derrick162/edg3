// C11 — Trade Monitor integration (Core-owned).
//
// Derrick runs a separate personal trading dashboard ("trade-monitor" on Railway) and wants its
// data in his morning briefing + available to Edge mid-call. This module fetches a read-only JSON
// snapshot and formats it for the briefing prompt / voice.
//
// HONESTY GUARD (load-bearing): this is Derrick's OWN dashboard data. Formatters cite the snapshot's
// numbers and its own component/morningRead text verbatim — they NEVER editorialize direction or
// infer bullish/bearish from the score. If the snapshot says it, Edge can say it; otherwise no.
//
// Degrades to null on ANY failure and when env vars are unset (local dev + pre-Railway state), so
// the briefing never blocks or degrades on it.

export interface TradeComponent {
  name?: string;
  weight?: number;
  contrib?: number;   // signed contribution to the score — magnitude ranks "biggest mover"
  text?: string;      // human-readable note straight from the dashboard (cite verbatim-ish)
}

export interface TradePosition {
  symbol?: string;
  direction?: string;   // "long" / "short" (as the dashboard labels it)
  entryDate?: string;
  entryPrice?: number;
  lastClose?: number;
  pnlPct?: number;      // percent P&L as the dashboard reports it
}

export interface TradeSnapshot {
  generatedAt?: string;
  asOf?: string;
  tradeScore?: { score?: number; prev?: number; components?: TradeComponent[]; intraday?: unknown };
  morningRead?: { d?: string; text?: string };
  trades?: TradePosition[];
  catalysts?: { earningsUpcoming?: unknown; [k: string]: unknown };
  [k: string]: unknown;
}

export const TRADE_UNAVAILABLE = "I couldn't reach your trade dashboard just now.";

/**
 * Fetch the consolidated snapshot from the trade-monitor dashboard.
 * Returns null when the env vars are unset (local/pre-Railway) or on ANY failure/timeout —
 * never throws, so the briefing pipeline is unaffected. Credentials live only in env vars.
 */
export async function getTradeSnapshot(): Promise<TradeSnapshot | null> {
  const url = process.env.TRADE_MONITOR_URL;
  const pass = process.env.TRADE_MONITOR_PASS;
  if (!url || !pass) return null; // silent no-op until Railway env is configured

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    // HTTP Basic auth — username is ignored by the dashboard ("any-username:{pass}").
    const auth = Buffer.from(`edg3:${pass}`).toString('base64');
    const res = await fetch(`${url.replace(/\/$/, '')}/api/snapshot`, {
      headers: { Authorization: `Basic ${auth}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === 'object' ? (data as TradeSnapshot) : null;
  } catch {
    return null; // timeout / network / parse — degrade silently
  } finally {
    clearTimeout(timer);
  }
}

// ── Pure formatting helpers (exported for tests) ──────────────────────────────

/** "+3" / "-5" / "0" — a signed integer-ish delta for prompt text. */
function signed(n: number): string {
  const r = Math.round(n * 10) / 10;
  return r > 0 ? `+${r}` : `${r}`;
}

/** ", up 3" / ", down 5" / ", flat" — a spoken delta phrase. */
function deltaPhrase(n: number): string {
  const r = Math.round(n * 10) / 10;
  if (r > 0) return `, up ${r}`;
  if (r < 0) return `, down ${Math.abs(r)}`;
  return ', flat';
}

/** Component texts sorted by |contrib| (biggest movers first), up to `max`. */
export function topMoverTexts(components: TradeComponent[] | undefined, max: number): string[] {
  if (!Array.isArray(components)) return [];
  return [...components]
    .filter(c => c && typeof c.text === 'string' && c.text.trim())
    .sort((a, b) => Math.abs(b.contrib ?? 0) - Math.abs(a.contrib ?? 0))
    .slice(0, max)
    .map(c => c.text!.trim());
}

/** Best-effort extraction of upcoming-earnings names from an unknown-shaped field. */
export function earningsNames(earningsUpcoming: unknown): string[] {
  if (!Array.isArray(earningsUpcoming)) return [];
  const out: string[] = [];
  for (const e of earningsUpcoming) {
    if (typeof e === 'string') { if (e.trim()) out.push(e.trim()); }
    else if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      const name = o.symbol ?? o.name ?? o.ticker;
      if (typeof name === 'string' && name.trim()) out.push(name.trim());
    }
  }
  return out;
}

/** One P&L line per position, e.g. "SOXL long: +4.2%". */
function positionLines(trades: TradePosition[] | undefined): string[] {
  if (!Array.isArray(trades)) return [];
  return trades
    .filter(t => t && typeof t.symbol === 'string' && t.symbol.trim())
    .map(t => {
      const dir = t.direction ? ` ${t.direction}` : '';
      const pnl = typeof t.pnlPct === 'number' ? `${signed(t.pnlPct)}%` : 'P&L n/a';
      return `${t.symbol!.trim()}${dir}: ${pnl}`;
    });
}

function firstSentence(text: string): string {
  const m = text.trim().match(/^[\s\S]*?[.!?](?=\s|$)/);
  return (m ? m[0] : text.trim()).trim();
}

/**
 * TRADE MONITOR block for the briefing prompt (data only — the briefing template adds the
 * "weave one line" guidance). Returns null when there's no usable score.
 */
export function formatTradeMonitorForBriefing(s: TradeSnapshot | null): string | null {
  const score = s?.tradeScore?.score;
  if (!s || typeof score !== 'number') return null;

  const prev = s.tradeScore?.prev;
  const lines: string[] = ['TRADE MONITOR (Derrick\'s own trading dashboard — cite these numbers/notes exactly, never infer direction beyond them):'];
  lines.push(`- Trade score: ${score}${typeof prev === 'number' ? ` (prev ${prev}, ${signed(score - prev)})` : ''}`);

  const movers = topMoverTexts(s.tradeScore?.components, 3);
  if (movers.length) {
    lines.push('- Biggest component movers:');
    for (const m of movers) lines.push(`    • ${m}`);
  }

  const positions = positionLines(s.trades);
  if (positions.length) {
    lines.push('- Positions:');
    for (const p of positions) lines.push(`    • ${p}`);
  }

  const earnings = earningsNames(s.catalysts?.earningsUpcoming);
  if (earnings.length) lines.push(`- Earnings upcoming: ${earnings.join(', ')}`);

  return lines.join('\n');
}

/**
 * Spoken-friendly 2–4 sentence summary for the getTradeUpdate voice tool.
 * `todayET` (YYYY-MM-DD, ET) defaults to now — the morningRead sentence is only included when it's
 * from the same ET day (fresh).
 */
export function formatTradeUpdateForVoice(s: TradeSnapshot | null, todayET?: string): string {
  if (!s) return TRADE_UNAVAILABLE;
  const parts: string[] = [];

  const score = s.tradeScore?.score;
  const prev = s.tradeScore?.prev;
  if (typeof score === 'number') {
    const delta = typeof prev === 'number' ? deltaPhrase(score - prev) : '';
    const mover = topMoverTexts(s.tradeScore?.components, 1)[0];
    parts.push(`Your trade score's at ${score}${delta}${mover ? ` — ${mover}` : ''}.`);
  }

  const positions = positionLines(s.trades);
  if (positions.length) parts.push(`Positions: ${positions.join('; ')}.`);

  const et = todayET ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(new Date());
  if (s.morningRead?.text && s.morningRead?.d === et) {
    const fs = firstSentence(s.morningRead.text);
    if (fs) parts.push(fs);
  }

  return parts.join(' ') || 'I reached your trade dashboard, but there’s nothing to report right now.';
}
