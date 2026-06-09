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

// Compose a polished outreach email for one recipient (subject + body). Tries Claude for a warmer
// one-paragraph note; falls back to the deterministic template on any failure so a draft is always
// produced. Returns the recipient alongside the message so the caller can create the draft.
export async function composeOutreachEmail(opts: {
  recipient: { name?: string; email: string };
  senderName: string;
  ask: string;
  slots: string[];
  subject?: string;
}): Promise<ComposedEmail> {
  const subject = (opts.subject?.trim()) || defaultSubject(opts.ask);
  const fallback = buildOutreachBody({ recipientName: opts.recipient.name, senderName: opts.senderName, ask: opts.ask, slots: opts.slots });
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const slotBlock = opts.slots.length
      ? `Times that work on the sender's end:\n${opts.slots.map(s => `- ${s}`).join('\n')}`
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
