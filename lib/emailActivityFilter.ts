// Email-activity noise filter (Derrick dashboard ticket 9).
//
// The "Threads Edg3 reviewed" panel was showing automated noise — Instacart receipts,
// Walmart order confirmations, CNBC newsletters, market-update blasts. Those erode trust
// ("why is Edge reviewing my grocery receipt?"). This classifies a subject line as noise
// so the display can hide it. We only have subject lines here (no sender), so classification
// is heuristic on the subject text.
//
// Pure, zero-I/O, fully testable. A subject that matches a flagged signal keyword
// (invoice, legal, contract, …) is NEVER treated as noise — those always surface.

// Promotional / newsletter / marketing blasts.
const PROMO_PATTERNS = [
  'unsubscribe', 'newsletter', 'weekly digest', 'daily digest', 'daily brief', 'morning brief',
  '% off', 'percent off', 'sale ends', 'flash sale', 'on sale', 'limited time', 'limited-time',
  "don't miss", 'dont miss', 'deal of the', 'best deals', 'save big', 'save up to', 'new arrivals',
  'shop now', 'exclusive offer', 'special offer', 'promo code', 'coupon', 'clearance', 'black friday',
  'cyber monday', 'last chance', 'just dropped', 'now available', 'introducing',
];

// Order receipts / shipping / delivery confirmations.
const RECEIPT_PATTERNS = [
  'order confirmation', 'your order', 'order #', 'order placed', 'order has shipped', 'has shipped',
  'your shipment', 'out for delivery', 'your receipt', 'receipt from', 'receipt for', 'your package',
  'tracking number', 'your delivery', 'delivery update', 'has been delivered', 'was delivered',
  'subscription renew', 'auto-renew', 'payment received', 'payment confirmation', 'thanks for your order',
  'thank you for your order', 'thank you for your purchase', 'your invoice from', // vendor receipts (≠ a real invoice you must pay)
];

// Automated system/notification mail.
const AUTOMATED_PATTERNS = [
  'do not reply', 'do-not-reply', 'no-reply', 'noreply', 'verification code', 'verify your',
  'confirm your email', 'confirm your account', 'your statement', 'statement is ready',
  'security alert', 'new sign-in', 'new login', 'sign-in attempt', 'password reset', 'reset your password',
  'welcome to', 'your account', 'account update', 'terms of service', 'privacy policy update',
];

// Market / finance news blasts (CNBC-style).
const MARKET_NEWS_PATTERNS = [
  'closing bell', 'opening bell', 'pre-markets', 'premarket', 'after the bell', 'stocks to watch',
  'market close', 'markets close', 'markets closed', 'today in markets', 'market update',
  'earnings season', 'stock market today', 'wall street', 'top stories', 'breaking news',
];

const ALL_NOISE = [
  ...PROMO_PATTERNS,
  ...RECEIPT_PATTERNS,
  ...AUTOMATED_PATTERNS,
  ...MARKET_NEWS_PATTERNS,
];

/**
 * True if a subject line looks like automated noise (promo, receipt, system notice, news blast).
 * Conservative substring matching on a normalized subject.
 */
export function isNoiseSubject(subject: string): boolean {
  if (!subject) return false;
  const s = subject.toLowerCase();
  return ALL_NOISE.some(p => s.includes(p));
}

/**
 * Filter a list of reviewed subject lines for display: drop noise, but always keep any subject
 * the caller's `isFlagged` predicate marks as a signal (invoice/legal/contract/…) even if it
 * also matches a noise pattern. Preserves original order.
 */
export function filterReviewedSubjects(
  subjects: string[],
  isFlagged: (s: string) => boolean = () => false,
): string[] {
  return subjects.filter(s => isFlagged(s) || !isNoiseSubject(s));
}

// Sender patterns typical of automated / bulk / no-reply mail. Conservative on purpose —
// we do NOT include shared-inbox addresses (info@, support@, team@, hello@) because real
// people and businesses use those; only clearly machine/marketing senders.
const NOISE_SENDER_HINTS = [
  'no-reply', 'noreply', 'no_reply', 'donotreply', 'do-not-reply', 'do_not_reply',
  'mailer-daemon', 'mailer@', 'newsletter@', 'marketing@', 'promotions@', 'promo@',
  'notifications@', 'notification@', 'updates@', 'mailchimp', 'sendgrid', 'mailgun',
];

/**
 * True if an email thread looks like promotional / automated noise we should NOT read
 * into memory (Round 7: full-body fact extraction). Combines the subject classifier with
 * a conservative sender check. Real correspondence passes through.
 */
export function isLikelySpam(subject: string, sender = ''): boolean {
  if (isNoiseSubject(subject)) return true;
  const s = sender.toLowerCase();
  return NOISE_SENDER_HINTS.some(h => s.includes(h));
}
