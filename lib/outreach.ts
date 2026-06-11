// Email-outreach COMPOSITION for Edge's draft-only outreach feature (Core lane).
//
// This module owns the *composition* side: filtering researched recipients, formatting the user's
// real open calendar slots, and writing a polite plain-text outreach email body. It does NOT touch
// Gmail or auth — creating the actual draft is Security's guarded primitive (`lib/gmail.ts`
// `createDraft`), and Edge NEVER sends mail. Ownership split set by the PM on 2026-06-09 to resolve
// the dual-`gmail.ts` collision (see ROADMAP.md §3).
//
// ─── REMAINING WIRING (gated on 🔒 Security; coordinate via the Status Board first) ───────────
// Once Security's Gmail scope + `lib/gmail.ts createDraft` + the `deleteDraft` UndoOp are on master,
// add a `draftEmail` handler in app/api/vapi/tool-call/route.ts (Shared) that:
//   1. emailableRecipients(researchRecipients) → split sendable vs. skipped (report who lacked an email)
//   2. pull this week's free slots via findFreeSlots(); formatSlotsForEmail() → clean lines
//   3. for each sendable recipient: composeOutreachEmail() → { recipient, subject, body }
//   4. call Security's createDraft({ to: recipient.email, subject, body }) — DRAFT ONLY, no send
//   5. recordUndo via Security's new `deleteDraft` UndoOp (delete each draft id)
//   6. confirm back "Drafted N emails in your Gmail — review and send", naming any skipped contacts
// Then add the `draftEmail` params to the Vapi dashboard tool schema (external step, like the
// all-day endDate params). PLANNED params: recipients[{name,email}], ask, proposeAvailability,
// startDate?/endDate? (default this week), subject?.

export interface OutreachRecipient {
  name?: string;
  email?: string;
}

// Parse structured contact blocks from Edge's saved research notes, extracting
// contacts that have a real email address. Each "block" is a blank-line-separated
// section; a block qualifies if it has an "Email: <addr>" line. The research delimiter
// lines are stripped first so they don't contaminate the parse.
// Exported here so it can be unit-tested; the draftEmail handler in route.ts uses
// its own identical inline copy (cannot import from here while the collision lock on
// route.ts is live — sync once Security releases the file).
export function recipientsFromNotes(notes: string): OutreachRecipient[] {
  if (!notes) return [];
  const cleaned = notes.replace(/-{2,}\s*(?:end\s+)?edge research\s*-{2,}/gi, '');
  const out: OutreachRecipient[] = [];
  const seen = new Set<string>();
  for (const block of cleaned.split(/\n\s*\n/)) {
    const lines = block.split('\n').map(l => l.trim()).filter(Boolean);
    const emailLine = lines.find(l => /^email\s*:/i.test(l));
    if (!emailLine) continue;
    const email = emailLine.replace(/^email\s*:/i, '').trim();
    if (
      !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ||
      /not found/i.test(email) ||
      seen.has(email.toLowerCase())
    ) continue;
    // Prefer an explicit "Name: ..." line; fall back to the first non-label line,
    // but reject obvious non-names (URLs, email addresses, long description sentences).
    const nameLine = lines.find(l => /^name\s*:/i.test(l));
    const name = nameLine
      ? nameLine.replace(/^name\s*:/i, '').trim()
      : lines.find(l =>
          !/^(?:phone|email|website|address|name)\s*:/i.test(l) &&
          !/:\s*$/.test(l) &&
          !/^https?:\/\//i.test(l) &&   // not a URL
          !l.includes('@') &&            // not an email address
          l.length <= 80                 // not a long description paragraph
        );
    seen.add(email.toLowerCase());
    out.push({ name, email });
  }
  return out;
}

export interface ComposedEmail {
  recipient: { name?: string; email: string };
  subject: string;
  body: string;
}

// Split research-provided recipients into those we can email and the names we had to skip
// (no/placeholder email — research writes "Email: not found" when it can't find one).
export function emailableRecipients(recipients: OutreachRecipient[]): {
  ok: { name?: string; email: string }[];
  skipped: string[];
} {
  const ok: { name?: string; email: string }[] = [];
  const skipped: string[] = [];
  for (const r of recipients ?? []) {
    const email = (r.email ?? '').trim();
    const name = r.name?.trim();
    if (email && !/not found/i.test(email) && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      ok.push({ name, email });
    } else {
      skipped.push(name || email || 'a contact');
    }
  }
  return { ok, skipped };
}

// Turn findFreeSlots() output into clean slot lines for an email body. findFreeSlots returns an
// "Open time …:\n<lines>" block (or a "No open…/I need…" message); we drop the header, the
// "…and N more" trailer, and the "(NN min free)" suffix on each line.
export function formatSlotsForEmail(freeSlotsText: string): string[] {
  if (!freeSlotsText || /^(No open|I need)/i.test(freeSlotsText)) return [];
  return freeSlotsText
    .split('\n')
    .filter(l => /:/.test(l) && !/^open time/i.test(l) && !/^…and \d+ more/i.test(l.trim()))
    .map(l => l.replace(/\s*\(\d+\s*min free\)\s*$/i, '').trim())
    .filter(Boolean);
}

/** Get the short timezone abbreviation (e.g. "PDT", "ET") for an IANA zone. */
function tzAbbrev(tz: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone: tz, timeZoneName: 'short' })
    .formatToParts(new Date())
    .find(p => p.type === 'timeZoneName')?.value ?? tz;
}

// A short, polite plain-text outreach email body. Deterministic (used directly, and as the
// fallback if the Claude polish in composeOutreachEmail fails).
// `userTimezone` is the sender's IANA zone — when provided and slots are present, the email
// includes a "times below are in <TZ>" line so the recipient always knows which timezone the
// availability refers to. Omitting it is safe: the slot block is included without a tz label.
export function buildOutreachBody(opts: {
  recipientName?: string;
  senderName: string;
  ask: string;
  slots: string[];
  userTimezone?: string;
}): string {
  const lines: string[] = [opts.recipientName ? `Hi ${opts.recipientName},` : 'Hello,', ''];
  lines.push(opts.ask.trim());
  if (opts.slots.length) {
    const tzLabel = opts.userTimezone ? ` (${tzAbbrev(opts.userTimezone)})` : '';
    lines.push('', `In case it helps, here are some times that work on my end${tzLabel}:`);
    for (const s of opts.slots) lines.push(`  - ${s}`);
    lines.push('', "If any of those suit you, let me know — happy to work around your schedule too.");
  } else {
    lines.push('', "Let me know what times work for you and I'll do my best to accommodate.");
  }
  lines.push('', 'Thanks,', opts.senderName);
  return lines.join('\n');
}

function defaultSubject(ask: string): string {
  const a = ask.trim();
  return a.length > 0 && a.length <= 50 ? a.replace(/[.?!]+$/, '') : 'Finding a time to connect';
}

// Compose a polished outreach email for one recipient (subject + body). Tries Claude for a warmer
// one-paragraph note; falls back to the deterministic template on any failure so a draft is always
// produced. Returns the recipient alongside the message so the caller can create the draft.
// `userTimezone` is passed through to buildOutreachBody so slots in the fallback template carry
// a "times below are in <TZ>" label; the Claude prompt also includes the abbreviation.
export async function composeOutreachEmail(opts: {
  recipient: { name?: string; email: string };
  senderName: string;
  ask: string;
  slots: string[];
  subject?: string;
  userTimezone?: string;
}): Promise<ComposedEmail> {
  const subject = (opts.subject?.trim()) || defaultSubject(opts.ask);
  const fallback = buildOutreachBody({ recipientName: opts.recipient.name, senderName: opts.senderName, ask: opts.ask, slots: opts.slots, userTimezone: opts.userTimezone });
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const tzNote = opts.userTimezone && opts.slots.length ? ` All times are in ${tzAbbrev(opts.userTimezone)}.` : '';
    const slotBlock = opts.slots.length
      ? `Times that work on the sender's end:${tzNote}\n${opts.slots.map(s => `- ${s}`).join('\n')}`
      : 'The sender has open availability (no specific slots provided).';
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: `Write a short, warm, professional plain-text outreach email. Output ONLY the email body — no subject line, no markdown, no commentary.
- Greet ${opts.recipient.name ? opts.recipient.name : 'the recipient (no name known — use "Hello,")'}.
- Politely ask: ${opts.ask}
- If specific times are given below, offer them as the sender's availability (you may list them).
- Keep it 3-5 short sentences. Sign off as "${opts.senderName}".
- Do NOT invent details, phone numbers, or commitments.

${slotBlock}` }],
    });
    const text = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim();
    const body = text.replace(/[*_#`]+/g, '').trim();
    return { recipient: opts.recipient, subject, body: body || fallback };
  } catch (err) {
    console.error('[outreach] composeOutreachEmail Claude polish failed, using template:', err);
    return { recipient: opts.recipient, subject, body: fallback };
  }
}

// ─── Name-correction helpers (reduces STT transcription errors in recipient names) ──────────────

function editDistance(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (__, j) => (i === 0 ? j : j === 0 ? i : 0))
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

const NAME_STOP = new Set([
  'email', 'call', 'meeting', 'schedule', 'with', 'for', 'to', 'about', 'and', 'or',
  'the', 'follow', 'up', 'draft', 'contact', 'a', 'an', 'regarding', 're', 'send',
]);

/**
 * If the event title contains a capitalized word that fuzzy-matches `recipientName`
 * (same first letter + edit distance ≤ 40 % of the longer name's length), returns the
 * title's spelling. Returns null when no match is found.
 *
 * Example: titleSpellingFor('Email Derrick', 'Derek') → 'Derrick'
 */
export function titleSpellingFor(title: string, recipientName: string): string | null {
  if (!title || !recipientName) return null;
  const nameLower = recipientName.toLowerCase();
  const tokens = title.split(/\s+/).filter(t =>
    t.length >= 2 && !NAME_STOP.has(t.toLowerCase()) && /^[A-Z]/.test(t)
  );
  for (const token of tokens) {
    const tokenLower = token.toLowerCase();
    if (tokenLower === nameLower) return token; // exact (case fix)
    if (tokenLower[0] !== nameLower[0]) continue; // different initial → skip
    const threshold = Math.ceil(Math.max(token.length, recipientName.length) * 0.4);
    if (editDistance(tokenLower, nameLower) <= threshold) return token;
  }
  return null;
}

/**
 * Correct recipient name spellings before composing an outreach email.
 * Reduces STT transcription errors (e.g. "Derek" → "Derrick") by preferring
 * user-typed sources over voice-transcribed notes. Does not eliminate all errors.
 *
 * Corrections applied (in priority order):
 * 1. If the recipient's email matches the user's own email → use the profile name.
 * 2. If the event title has a name token that fuzzy-matches → prefer title's spelling.
 */
export function correctRecipientNames(
  recipients: OutreachRecipient[],
  opts: { eventTitle?: string; userEmail?: string; userName?: string }
): OutreachRecipient[] {
  return recipients.map(r => {
    if (opts.userEmail && r.email && r.email.toLowerCase() === opts.userEmail.toLowerCase()) {
      return { ...r, name: opts.userName || r.name };
    }
    if (opts.eventTitle && r.name) {
      const corrected = titleSpellingFor(opts.eventTitle, r.name);
      if (corrected) return { ...r, name: corrected };
    }
    return r;
  });
}
