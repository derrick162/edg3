import { describe, it, expect } from 'vitest';
import { isNoiseSubject, filterReviewedSubjects, isLikelySpam } from './emailActivityFilter';

const SIGNAL_KEYWORDS = ['urgent', 'invoice', 'legal', 'contract', 'overdue', 'payment', 'lawsuit', 'agreement'];
const isFlagged = (s: string) => SIGNAL_KEYWORDS.some(k => s.toLowerCase().includes(k));

describe('isNoiseSubject', () => {
  it('flags order receipts / confirmations', () => {
    expect(isNoiseSubject('Your Instacart order has shipped')).toBe(true);
    expect(isNoiseSubject('Walmart: Order Confirmation #12345')).toBe(true);
    expect(isNoiseSubject('Your receipt from Uber')).toBe(true);
    expect(isNoiseSubject('Out for delivery: your package')).toBe(true);
  });

  it('flags promotional / newsletter blasts', () => {
    expect(isNoiseSubject('30% off everything — limited time')).toBe(true);
    expect(isNoiseSubject('The CNBC Daily Digest')).toBe(true);
    expect(isNoiseSubject('Last chance: flash sale ends tonight')).toBe(true);
    expect(isNoiseSubject('Unsubscribe anytime')).toBe(true);
  });

  it('flags automated system mail', () => {
    expect(isNoiseSubject('Your verification code is 482910')).toBe(true);
    expect(isNoiseSubject('Do not reply — account update')).toBe(true);
    expect(isNoiseSubject('Your statement is ready')).toBe(true);
  });

  it('flags market-news blasts', () => {
    expect(isNoiseSubject('Closing Bell: stocks end higher')).toBe(true);
    expect(isNoiseSubject('Stock market today: what to watch')).toBe(true);
  });

  it('does NOT flag real correspondence', () => {
    expect(isNoiseSubject('Re: Tuesday sync')).toBe(false);
    expect(isNoiseSubject('Following up on the Series A deck')).toBe(false);
    expect(isNoiseSubject('Can we move our 1:1?')).toBe(false);
    expect(isNoiseSubject('Question about the term sheet')).toBe(false);
  });

  it('handles empty / whitespace safely', () => {
    expect(isNoiseSubject('')).toBe(false);
  });
});

describe('filterReviewedSubjects', () => {
  it('removes noise but keeps real threads', () => {
    const subjects = [
      'Re: investor intro',
      'Your Instacart order has shipped',
      'Can we reschedule?',
      '30% off everything',
      'Following up on the contract', // also flagged
    ];
    const result = filterReviewedSubjects(subjects, isFlagged);
    expect(result).toContain('Re: investor intro');
    expect(result).toContain('Can we reschedule?');
    expect(result).toContain('Following up on the contract');
    expect(result).not.toContain('Your Instacart order has shipped');
    expect(result).not.toContain('30% off everything');
  });

  it('always keeps a flagged subject even if it looks like noise', () => {
    // "payment received" matches a receipt pattern, but "payment" is a flagged signal keyword
    const subjects = ['Payment received — invoice #88 overdue'];
    const result = filterReviewedSubjects(subjects, isFlagged);
    expect(result).toEqual(['Payment received — invoice #88 overdue']);
  });

  it('preserves original order', () => {
    const subjects = ['A real reply', 'Your order shipped', 'B real reply'];
    expect(filterReviewedSubjects(subjects, isFlagged)).toEqual(['A real reply', 'B real reply']);
  });

  it('defaults to no flagging when predicate omitted', () => {
    expect(filterReviewedSubjects(['Your receipt from Lyft'])).toEqual([]);
    expect(filterReviewedSubjects(['Re: lunch'])).toEqual(['Re: lunch']);
  });
});

describe('isLikelySpam', () => {
  it('flags promotional/automated subjects (via isNoiseSubject)', () => {
    expect(isLikelySpam('Your Instacart order has shipped', 'orders@instacart.com')).toBe(true);
    expect(isLikelySpam('30% off everything', 'deals@store.com')).toBe(true);
  });

  it('flags no-reply / bulk-mailer senders even with a neutral subject', () => {
    expect(isLikelySpam('Account activity', 'no-reply@bank.com')).toBe(true);
    expect(isLikelySpam('Weekly update', 'newsletter@news.com')).toBe(true);
    expect(isLikelySpam('Notice', 'notifications@linkedin.com')).toBe(true);
    expect(isLikelySpam('Campaign', 'bounce@mailchimp.com')).toBe(true);
  });

  it('does NOT flag real correspondence from a person', () => {
    expect(isLikelySpam('Re: term sheet', 'sarah@acme.com')).toBe(false);
    expect(isLikelySpam('Can we move our 1:1?', 'jim@startup.io')).toBe(false);
  });

  it('does NOT over-flag shared-inbox addresses real people use', () => {
    expect(isLikelySpam('Question about the contract', 'support@vendor.com')).toBe(false);
    expect(isLikelySpam('Intro', 'hello@founder.com')).toBe(false);
  });

  it('handles empty sender safely', () => {
    expect(isLikelySpam('Re: lunch')).toBe(false);
  });
});
