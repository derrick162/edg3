// Email Intelligence — Core-owned.
//
// Pure enrichment layer (regex + fact lookup, zero I/O, zero LLM cost).
// Extracts deadlines, dollar amounts, and sender VIP status from email metadata,
// then computes an urgency level for each thread.
//
// Design note: keeps EmailSignalItem (Security-owned in lib/gmail.ts) immutable —
// enrichment is additive via EmailIntelItem which extends it.

import type { EmailSignalItem } from './gmail';
import type { Fact } from './db';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface EmailIntelItem extends EmailSignalItem {
  deadlineDate: string | null;     // YYYY-MM-DD extracted from subject+snippet; null if none
  dollarAmounts: number[];         // any dollar figures found ($X, X dollars, etc.)
  senderVip: boolean;              // sender matches a stored 'person' fact entity
  urgencyLevel: 'critical' | 'high' | 'normal';
}

// ── Deadline extraction ───────────────────────────────────────────────────────

const MONTH_MAP: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
  january: 1, february: 2, march: 3, april: 4, june: 6,
  july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

// Deadline trigger keywords
const DEADLINE_TRIGGER = /\b(by|due|before|expires?|deadline|overdue|final notice|last chance|respond by|payment due|required by)\b/i;

/**
 * Extract a deadline date (YYYY-MM-DD) from email subject + snippet.
 * Returns null if no explicit deadline found or date can't be parsed.
 */
export function extractDeadlineDate(text: string, referenceDate: string = new Date().toISOString().slice(0, 10)): string | null {
  if (!DEADLINE_TRIGGER.test(text)) return null;

  const refYear = parseInt(referenceDate.slice(0, 4), 10);
  const refMonth = parseInt(referenceDate.slice(5, 7), 10);

  // ISO date: 2026-06-15
  const isoMatch = text.match(/\b(20\d\d)[-/](0?\d|1[0-2])[-/]([0-2]?\d|3[01])\b/);
  if (isoMatch) {
    const y = isoMatch[1], m = isoMatch[2].padStart(2, '0'), d = isoMatch[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Month name + day: "June 15", "Jun 15th", "15 June"
  const monthDayMatch = text.match(/\b([A-Za-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?\b|\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]+)\b/);
  if (monthDayMatch) {
    const monthWord = (monthDayMatch[1] || monthDayMatch[4] || '').toLowerCase();
    const day = parseInt(monthDayMatch[2] || monthDayMatch[3] || '0', 10);
    const monthNum = MONTH_MAP[monthWord];
    if (monthNum && day >= 1 && day <= 31) {
      // Assume current year; if month+day is in the past, try next year
      const candidate = `${refYear}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      if (candidate >= referenceDate) return candidate;
      return `${refYear + 1}-${String(monthNum).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  // Relative: "end of month" → last day of current month
  if (/\bend of (the )?month\b/i.test(text)) {
    const lastDay = new Date(refYear, refMonth, 0).getDate();
    return `${refYear}-${String(refMonth).padStart(2, '0')}-${String(lastDay).padStart(2, '0')}`;
  }

  // Day of week: "by Friday" → next occurrence
  const DOW_OFFSETS: Record<string, number> = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
  const dowMatch = text.match(/\b(?:by|before|on)\s+(monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i);
  if (dowMatch) {
    const target = DOW_OFFSETS[dowMatch[1].toLowerCase()];
    const now = new Date(referenceDate + 'T12:00:00Z');
    const current = now.getUTCDay();
    const diff = ((target - current + 7) % 7) || 7; // at least 1 day out
    const d = new Date(now.getTime() + diff * 86400000);
    return d.toISOString().slice(0, 10);
  }

  return null;
}

// ── Dollar amount extraction ──────────────────────────────────────────────────

/**
 * Extract all dollar amounts from text as numbers.
 * e.g. "$1,500.00" → 1500, "$50k" → 50000, "2 million dollars" → 2000000
 */
export function extractDollarAmounts(text: string): number[] {
  const amounts: number[] = [];

  // Pattern: $X,XXX[.XX][k/K/m/M/million/thousand]
  const dollarPattern = /\$\s*([\d,]+(?:\.\d{1,2})?)\s*(million|thousand|k|m)?/gi;
  let match: RegExpExecArray | null;
  while ((match = dollarPattern.exec(text)) !== null) {
    const raw = parseFloat(match[1].replace(/,/g, ''));
    const suffix = (match[2] || '').toLowerCase();
    const multiplier = suffix === 'million' || suffix === 'm' ? 1_000_000
      : suffix === 'thousand' || suffix === 'k' ? 1_000
      : 1;
    if (!isNaN(raw)) amounts.push(raw * multiplier);
  }

  // Pattern: X dollars / X,XXX.XX dollars
  const wordsPattern = /([\d,]+(?:\.\d{1,2})?)\s+dollars?\b/gi;
  while ((match = wordsPattern.exec(text)) !== null) {
    const raw = parseFloat(match[1].replace(/,/g, ''));
    if (!isNaN(raw)) amounts.push(raw);
  }

  return [...new Set(amounts)];
}

// ── VIP sender detection ──────────────────────────────────────────────────────

/**
 * Check if a sender matches any 'person' fact entity stored for the user.
 * Case-insensitive. Matches partial names (first OR last name match).
 */
export function isSenderVip(sender: string, personFacts: Fact[]): boolean {
  if (!sender || personFacts.length === 0) return false;
  const senderLower = sender.toLowerCase();
  return personFacts.some(f => {
    if (!f.entity) return false;
    const entity = f.entity.toLowerCase();
    // Check each word in the entity name against the sender string
    return entity.split(/\s+/).some(word => word.length >= 3 && senderLower.includes(word));
  });
}

// ── Urgency computation ───────────────────────────────────────────────────────

/**
 * Compute urgency level for an email thread.
 * critical: deadline within 2 days OR large dollar amount + deadline
 * high: VIP sender OR deadline within 7 days OR large dollar amount OR isImportant
 * normal: everything else
 */
export function computeUrgencyLevel(
  item: EmailSignalItem,
  deadlineDate: string | null,
  dollarAmounts: number[],
  senderVip: boolean,
  referenceDate: string = new Date().toISOString().slice(0, 10),
): EmailIntelItem['urgencyLevel'] {
  const hasDollar = dollarAmounts.length > 0;
  const maxDollar = hasDollar ? Math.max(...dollarAmounts) : 0;

  if (deadlineDate) {
    const daysUntil = Math.round((new Date(deadlineDate + 'T12:00:00Z').getTime() - new Date(referenceDate + 'T12:00:00Z').getTime()) / 86400000);
    if (daysUntil <= 2 || (daysUntil <= 7 && maxDollar >= 1000)) return 'critical';
    if (daysUntil <= 7 || senderVip) return 'high';
  }

  if (senderVip || item.isImportant) return 'high';
  if (maxDollar >= 5000) return 'high';

  return 'normal';
}

// ── Main enrichment function ──────────────────────────────────────────────────

/**
 * Enrich a batch of email signal items with deadline, dollar, VIP, and urgency signals.
 * Pure — no I/O. Call once per session after fetching the email signal.
 */
export function enrichEmailSignal(
  items: EmailSignalItem[],
  facts: Fact[],
  referenceDate: string = new Date().toISOString().slice(0, 10),
): EmailIntelItem[] {
  const personFacts = facts.filter(f => f.category === 'person');

  return items.map(item => {
    const text = `${item.subject} ${item.snippet}`;
    const deadlineDate = extractDeadlineDate(text, referenceDate);
    const dollarAmounts = extractDollarAmounts(text);
    const senderVip = isSenderVip(item.sender, personFacts);
    const urgencyLevel = computeUrgencyLevel(item, deadlineDate, dollarAmounts, senderVip, referenceDate);

    return { ...item, deadlineDate, dollarAmounts, senderVip, urgencyLevel };
  });
}

/**
 * Format enriched email signal for inclusion in an LLM prompt.
 * Returns '' when no items or scope missing.
 * Supersedes the basic formatEmailSignalForPrompt in focusRecommendation.ts for richer context.
 */
export function formatEnrichedEmailForPrompt(items: EmailIntelItem[]): string {
  if (!items.length) return '';

  const lines = items.map(item => {
    const tags: string[] = [];
    if (item.urgencyLevel === 'critical') tags.push('CRITICAL');
    else if (item.urgencyLevel === 'high') tags.push('HIGH');
    if (item.senderVip) tags.push('VIP sender');
    if (item.deadlineDate) tags.push(`deadline ${item.deadlineDate}`);
    if (item.dollarAmounts.length > 0) {
      const formatted = item.dollarAmounts.map(n =>
        n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M`
        : n >= 1000 ? `$${(n / 1000).toFixed(0)}k`
        : `$${n}`
      ).join(', ');
      tags.push(formatted);
    }
    const tagStr = tags.length ? ` [${tags.join(' · ')}]` : '';
    return `- ${item.sender} — "${item.subject}"${tagStr}\n  ${item.snippet.slice(0, 120)}`;
  });

  return `EMAIL INBOX DIGEST (${items.length} threads):\n${lines.join('\n')}`;
}
