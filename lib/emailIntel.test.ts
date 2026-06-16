import { describe, it, expect } from 'vitest';
import {
  extractDeadlineDate,
  extractDollarAmounts,
  isSenderVip,
  computeUrgencyLevel,
  enrichEmailSignal,
  formatEnrichedEmailForPrompt,
} from './emailIntel';
import type { EmailSignalItem } from './gmail';
import type { Fact } from './db';

// ── Helpers ───────────────────────────────────────────────────────────────────

function item(sender: string, subject: string, snippet = '', opts: Partial<EmailSignalItem> = {}): EmailSignalItem {
  return { threadId: 't1', sender, subject, snippet, date: '2026-06-15', isUnread: false, isImportant: false, ...opts };
}

function fact(entity: string | null, statement = 'Known contact'): Fact {
  return { id: 1, user_id: 1, category: 'person', statement, entity, learned_at: '2026-06-01', confidence: 'high', source_briefing_id: null };
}

const REF = '2026-06-15'; // Monday

// ── extractDeadlineDate ───────────────────────────────────────────────────────

describe('extractDeadlineDate', () => {
  it('returns null when no deadline trigger keyword', () => {
    expect(extractDeadlineDate('Hello there, just checking in', REF)).toBeNull();
  });

  it('extracts ISO date from text', () => {
    expect(extractDeadlineDate('Payment due 2026-06-20', REF)).toBe('2026-06-20');
  });

  it('extracts month + day (June 20)', () => {
    expect(extractDeadlineDate('Payment due June 20', REF)).toBe('2026-06-20');
  });

  it('extracts month + day with ordinal (June 20th)', () => {
    expect(extractDeadlineDate('Response required by June 20th', REF)).toBe('2026-06-20');
  });

  it('extracts "by Friday" as next Friday', () => {
    // REF = 2026-06-15 (Monday) → next Friday = 2026-06-19
    const result = extractDeadlineDate('respond by Friday', REF);
    expect(result).toBe('2026-06-19');
  });

  it('extracts "end of month" as last day of current month', () => {
    // June has 30 days
    expect(extractDeadlineDate('Payment due end of month', REF)).toBe('2026-06-30');
  });

  it('returns null when deadline keyword present but no date found', () => {
    expect(extractDeadlineDate('Payment is overdue, please respond', REF)).toBeNull();
  });

  it('uses next year when month+day is already past', () => {
    // REF is June 15 — March 10 is in the past → should return 2027-03-10
    const result = extractDeadlineDate('Final notice — payment due March 10', REF);
    expect(result).toBe('2027-03-10');
  });
});

// ── extractDollarAmounts ──────────────────────────────────────────────────────

describe('extractDollarAmounts', () => {
  it('extracts simple dollar amount', () => {
    expect(extractDollarAmounts('You owe $1,500.00')).toContain(1500);
  });

  it('extracts dollar with k suffix', () => {
    expect(extractDollarAmounts('Outstanding balance: $50k')).toContain(50000);
  });

  it('extracts dollar with million', () => {
    expect(extractDollarAmounts('Deal value: $2.5 million')).toContain(2500000);
  });

  it('extracts "X dollars" pattern', () => {
    expect(extractDollarAmounts('please pay 350 dollars by Friday')).toContain(350);
  });

  it('returns [] when no dollar amounts', () => {
    expect(extractDollarAmounts('Hello, just a friendly reminder')).toEqual([]);
  });

  it('deduplicates identical amounts', () => {
    const amounts = extractDollarAmounts('$500 and $500 outstanding');
    expect(amounts.filter(x => x === 500)).toHaveLength(1);
  });
});

// ── isSenderVip ───────────────────────────────────────────────────────────────

describe('isSenderVip', () => {
  it('returns false when no person facts', () => {
    expect(isSenderVip('Faiza Khan <faiza@cibc.com>', [])).toBe(false);
  });

  it('returns true when sender name matches a person fact entity', () => {
    const facts = [fact('Faiza Khan')];
    expect(isSenderVip('Faiza Khan <faiza@cibc.com>', facts)).toBe(true);
  });

  it('matches on first name only', () => {
    const facts = [fact('Faiza Khan')];
    expect(isSenderVip('faiza@cibc.com', facts)).toBe(true);
  });

  it('is case-insensitive', () => {
    const facts = [fact('John Smith')];
    expect(isSenderVip('JOHN SMITH <john@corp.com>', facts)).toBe(true);
  });

  it('returns false when sender does not match any fact entity', () => {
    const facts = [fact('Alice Wong')];
    expect(isSenderVip('Bob Jones <bob@corp.com>', facts)).toBe(false);
  });

  it('ignores facts with null entity', () => {
    const facts = [fact(null, 'This person has no entity name')];
    expect(isSenderVip('someone@corp.com', facts)).toBe(false);
  });
});

// ── computeUrgencyLevel ───────────────────────────────────────────────────────

describe('computeUrgencyLevel', () => {
  it('critical when deadline within 2 days', () => {
    const i = item('bank@cibc.com', 'Payment required');
    expect(computeUrgencyLevel(i, '2026-06-16', [], false, REF)).toBe('critical');
  });

  it('critical when deadline within 7 days + large dollar amount', () => {
    const i = item('bank@cibc.com', 'Payment required');
    expect(computeUrgencyLevel(i, '2026-06-20', [5000], false, REF)).toBe('critical');
  });

  it('high when deadline within 7 days (no dollar)', () => {
    const i = item('bank@cibc.com', 'Response needed');
    expect(computeUrgencyLevel(i, '2026-06-20', [], false, REF)).toBe('high');
  });

  it('high when VIP sender', () => {
    const i = item('faiza@cibc.com', 'Checking in');
    expect(computeUrgencyLevel(i, null, [], true, REF)).toBe('high');
  });

  it('high when isImportant', () => {
    const i = item('faiza@cibc.com', 'Checking in', '', { isImportant: true });
    expect(computeUrgencyLevel(i, null, [], false, REF)).toBe('high');
  });

  it('high when dollar amount >= $5000', () => {
    const i = item('bank@cibc.com', 'Statement');
    expect(computeUrgencyLevel(i, null, [7500], false, REF)).toBe('high');
  });

  it('normal when no signals', () => {
    const i = item('newsletter@acme.com', 'Weekly digest');
    expect(computeUrgencyLevel(i, null, [], false, REF)).toBe('normal');
  });
});

// ── enrichEmailSignal ─────────────────────────────────────────────────────────

describe('enrichEmailSignal', () => {
  it('enriches with deadline from subject', () => {
    const items = [item('bank@cibc.com', 'Payment due June 20')];
    const enriched = enrichEmailSignal(items, [], REF);
    expect(enriched[0].deadlineDate).toBe('2026-06-20');
  });

  it('enriches with dollar amounts from snippet', () => {
    const items = [item('bank@cibc.com', 'Statement', 'Your balance is $1,200.00 overdue')];
    const enriched = enrichEmailSignal(items, [], REF);
    expect(enriched[0].dollarAmounts).toContain(1200);
  });

  it('marks VIP sender from person facts', () => {
    const items = [item('Faiza Khan <faiza@cibc.com>', 'Deal update')];
    const facts = [fact('Faiza Khan')];
    const enriched = enrichEmailSignal(items, facts, REF);
    expect(enriched[0].senderVip).toBe(true);
  });

  it('computes urgencyLevel correctly', () => {
    const items = [item('bank@cibc.com', 'Overdue payment by June 16', '$2,500 outstanding')];
    const enriched = enrichEmailSignal(items, [], REF);
    expect(enriched[0].urgencyLevel).toBe('critical');
  });

  it('returns normal urgency for newsletter', () => {
    const items = [item('news@acme.com', 'This week in tech', 'Check out the latest trends')];
    const enriched = enrichEmailSignal(items, [], REF);
    expect(enriched[0].urgencyLevel).toBe('normal');
    expect(enriched[0].deadlineDate).toBeNull();
    expect(enriched[0].dollarAmounts).toEqual([]);
    expect(enriched[0].senderVip).toBe(false);
  });
});

// ── formatEnrichedEmailForPrompt ──────────────────────────────────────────────

describe('formatEnrichedEmailForPrompt', () => {
  it('returns empty string for empty array', () => {
    expect(formatEnrichedEmailForPrompt([])).toBe('');
  });

  it('includes CRITICAL tag for critical urgency', () => {
    const items = enrichEmailSignal(
      [item('bank@cibc.com', 'Payment due June 16', '$500 outstanding')],
      [], REF,
    );
    const result = formatEnrichedEmailForPrompt(items);
    expect(result).toContain('[CRITICAL');
    expect(result).toContain('deadline');
  });

  it('includes VIP sender tag', () => {
    const items = enrichEmailSignal(
      [item('Faiza Khan <faiza@cibc.com>', 'Update')],
      [fact('Faiza Khan')], REF,
    );
    const result = formatEnrichedEmailForPrompt(items);
    expect(result).toContain('VIP sender');
  });

  it('includes dollar amounts', () => {
    const items = enrichEmailSignal(
      [item('bank@cibc.com', 'Statement', 'Your outstanding balance is $3,500')],
      [], REF,
    );
    const result = formatEnrichedEmailForPrompt(items);
    expect(result).toContain('$3');
  });

  it('includes email subject and sender', () => {
    const items = enrichEmailSignal(
      [item('alice@corp.com', 'Q2 review meeting')],
      [], REF,
    );
    const result = formatEnrichedEmailForPrompt(items);
    expect(result).toContain('alice@corp.com');
    expect(result).toContain('Q2 review meeting');
  });
});
