// Gmail draft creation for Edge's outreach feature (DRAFT-ONLY).
//
// Edge can research contacts, pull the user's real open calendar slots, and compose a polite
// outreach email per contact asking their availability — saved as a Gmail DRAFT for the user to
// review and send themselves. Edge NEVER sends mail: this module intentionally exposes only
// drafts.create / drafts.delete and must never call gmail.users.messages.send.
//
// ─── INTEGRATION STATUS (gated on the 🔒 Security lane) ──────────────────────────────────────
// The pure helpers below (MIME build, availability formatting, body compose, recipient filtering)
// are fully usable today and unit-tested. The two network functions — createGmailDraft /
// deleteGmailDraft — depend on the OAuth token carrying a Gmail scope, which Security owns:
//   - Security adds a Gmail scope (e.g. https://www.googleapis.com/auth/gmail.compose) to the
//     Google OAuth consent + re-consent flow, so the stored token in `calendar_tokens` is
//     authorized for Gmail. Until that lands, getGmailClient() builds fine but drafts.create
//     returns an insufficient-scope 403 at call time.
// Remaining Core wiring once the scope lands (coordinate via the Status Board first):
//   1. Add a `draftEmail` handler in app/api/vapi/tool-call/route.ts (Shared) that:
//        a. takes the researched recipients, pulls this week's free slots via findFreeSlots,
//        b. composeOutreachEmail() per recipient, createGmailDraft() each,
//        c. skips recipients with no email (emailableRecipients) and reports who was skipped,
//        d. records undo = deleteGmailDraft (needs a new UndoOp type in lib/undo.ts — Security-owned).
//   2. Add the `draftEmail` tool params to the Vapi dashboard tool schema (see PLANNED_TOOL_SCHEMA).
//
// PLANNED draftEmail tool params (for the Vapi dashboard schema, mirrors createEvent's pattern):
//   - recipients: array of { name: string; email: string } (from research results)
//   - ask: string — what to ask, e.g. "when they can come this week"
//   - proposeAvailability: boolean — include the user's open slots (default true)
//   - startDate / endDate: optional YYYY-MM-DD — availability window (defaults to this week)
//   - subject: optional string — overrides the default subject

import { google, gmail_v1 } from 'googleapis';
import { getOAuthClient } from './calendar';
import { calendarQueries } from './db';

export interface OutreachRecipient {
  name?: string;
  email?: string;
}

export interface DraftMessage {
  to: string;       // "Name <email>" or bare "email"
  subject: string;
  body: string;     // plain text
}

// Build a Gmail client for the user from their stored Google token. Reuses the SAME OAuth client
// and token row as the calendar (one Google grant), so this only succeeds once Security has added
// a Gmail scope to that grant. `From` is filled in by Gmail as the authenticated user.
function getGmailClient(userId: number): gmail_v1.Gmail {
  const tokenRow = calendarQueries.get(userId);
  if (!tokenRow) throw new Error('No calendar connected');
  const oauth2Client = getOAuthClient();
  oauth2Client.setCredentials({
    access_token: tokenRow.access_token,
    refresh_token: tokenRow.refresh_token || undefined,
    expiry_date: tokenRow.expiry ? parseInt(tokenRow.expiry) : undefined,
  });
  // Persist refreshed tokens so we don't re-auth every call (mirrors lib/calendar.ts).
  oauth2Client.on('tokens', (tokens) => {
    if (tokens.access_token) {
      calendarQueries.upsert(
        userId,
        tokens.access_token,
        tokens.refresh_token || tokenRow.refresh_token || '',
        tokens.expiry_date?.toString() || '',
      );
    }
  });
  return google.gmail({ version: 'v1', auth: oauth2Client });
}

// Encode an RFC 2822 plain-text message as a base64url string for the Gmail API `raw` field.
// Pure + testable. Subject is RFC 2047 encoded only when it contains non-ASCII.
export function buildRawMessage(msg: DraftMessage): string {
  const subject = /[^\x00-\x7F]/.test(msg.subject)
    ? `=?UTF-8?B?${Buffer.from(msg.subject, 'utf8').toString('base64')}?=`
    : msg.subject;
  const headers = [
    `To: ${msg.to}`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
  ];
  const mime = `${headers.join('\r\n')}\r\n\r\n${msg.body}`;
  return Buffer.from(mime, 'utf8').toString('base64url');
}

// Create a Gmail DRAFT (never sends). Returns the draft id (used for undo). GATED on Gmail scope.
export async function createGmailDraft(userId: number, msg: DraftMessage): Promise<{ id: string }> {
  const gmail = getGmailClient(userId);
  const res = await gmail.users.drafts.create({
    userId: 'me',
    requestBody: { message: { raw: buildRawMessage(msg) } },
  });
  if (!res.data.id) throw new Error('Gmail draft create returned no id');
  return { id: res.data.id };
}

// Delete a Gmail draft by id — the inverse op for undo. GATED on Gmail scope.
export async function deleteGmailDraft(userId: number, draftId: string): Promise<void> {
  const gmail = getGmailClient(userId);
  await gmail.users.drafts.delete({ userId: 'me', id: draftId });
}

// ─── Pure helpers (no network — safe to use and test before the scope lands) ──────────────────

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

// Turn findFreeSlots() output into clean slot lines for an email body. findFreeSlots returns a
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

// A short, polite plain-text outreach email body. Deterministic (used directly, and as the
// fallback if the Claude polish in composeOutreachEmail fails).
export function buildOutreachBody(opts: {
  recipientName?: string;
  senderName: string;
  ask: string;
  slots: string[];
}): string {
  const lines: string[] = [opts.recipientName ? `Hi ${opts.recipientName},` : 'Hello,', ''];
  lines.push(opts.ask.trim());
  if (opts.slots.length) {
    lines.push('', 'In case it helps, here are some times that work on my end:');
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

// Compose a polished outreach email (subject + body). Tries Claude for a warmer one-paragraph
// note; falls back to the deterministic template on any failure so a draft is always produced.
export async function composeOutreachEmail(opts: {
  recipientName?: string;
  senderName: string;
  ask: string;
  slots: string[];
  subject?: string;
}): Promise<{ subject: string; body: string }> {
  const subject = (opts.subject?.trim()) || defaultSubject(opts.ask);
  const fallback = buildOutreachBody(opts);
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const slotBlock = opts.slots.length ? `Times that work on the sender's end:\n${opts.slots.map(s => `- ${s}`).join('\n')}` : 'The sender has open availability (no specific slots provided).';
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{ role: 'user', content: `Write a short, warm, professional plain-text outreach email. Output ONLY the email body — no subject line, no markdown, no commentary.
- Greet ${opts.recipientName ? opts.recipientName : 'the recipient (no name known — use "Hello,")'}.
- Politely ask: ${opts.ask}
- If specific times are given below, offer them as the sender's availability (you may list them).
- Keep it 3-5 short sentences. Sign off as "${opts.senderName}".
- Do NOT invent details, phone numbers, or commitments.

${slotBlock}` }],
    });
    const text = res.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('').trim();
    const body = text.replace(/[*_#`]+/g, '').trim();
    return { subject, body: body || fallback };
  } catch (err) {
    console.error('[gmail] composeOutreachEmail Claude polish failed, using template:', err);
    return { subject, body: fallback };
  }
}
