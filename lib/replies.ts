// Email-reply tracking (Core) — detect + understand replies to Edge's own outreach.
//
// Ownership: Core. This reads ONLY the threads Edge itself drafted (from watched_threads)
// via Security's guarded readThread() primitive (lib/gmail.ts) — never the broader inbox.
// It summarizes each new reply with Claude and proposes the next action; the briefing
// (lib/briefing.ts) surfaces these so Edge can raise them on the call.

import { watchedThreadQueries, notificationQueries, type WatchedThread } from './db';
import { readThread } from './gmail';

export interface ReplyUpdate {
  recipient: string;
  eventTitle: string | null;
  eventDate: string | null;
  summary: string;          // one sentence: what they said
  suggestedAction: string;  // the single most useful next step
}

// Check every open watched thread for new inbound replies. Degrades safely: if the user
// hasn't granted Gmail read access yet (re-consent pending) or anything errors, it just
// returns the updates it could gather (often none) — never throws into the briefing.
export async function checkOutreachReplies(userId: number): Promise<ReplyUpdate[]> {
  let threads: WatchedThread[] = [];
  try {
    threads = watchedThreadQueries.listOpen(userId);
  } catch {
    return [];
  }
  const updates: ReplyUpdate[] = [];
  for (const t of threads) {
    try {
      const msgs = await readThread(userId, t.thread_id);
      if (!msgs.length) continue;
      // New replies = inbound messages (not our own SENT) after the last one we processed.
      const lastIdx = t.last_seen_message_id ? msgs.findIndex((m) => m.id === t.last_seen_message_id) : -1;
      const fresh = msgs.slice(lastIdx + 1).filter((m) => !m.fromMe && m.text.trim());
      const newestId = msgs[msgs.length - 1]?.id;
      if (!fresh.length) {
        if (newestId) watchedThreadQueries.markSeen(t.id, newestId); // keep marker current; nothing to surface
        continue;
      }
      const latest = fresh[fresh.length - 1];
      const u = await understandReply(latest.text, t.context || '');
      const who = t.recipient || latest.from || 'a contact';
      updates.push({
        recipient: who,
        eventTitle: t.event_title,
        eventDate: t.event_date,
        summary: u.summary,
        suggestedAction: u.suggestedAction,
      });
      // Record an in-app notification (the last_seen marker below dedupes — created once per reply).
      notificationQueries.create(
        userId,
        'reply',
        `${who} replied${t.event_title ? ` · ${t.event_title}` : ''}`,
        `${u.summary} — Suggested: ${u.suggestedAction}`,
      );
      if (newestId) watchedThreadQueries.markSeen(t.id, newestId);
    } catch (err) {
      // Most commonly: gmail.readonly not yet granted (GmailScopeError) → skip quietly.
      console.error(`[replies] could not check thread ${t.thread_id}:`, err);
    }
  }
  return updates;
}

// Summarize one reply + propose the next action. Claude with a deterministic fallback so
// a model hiccup never blocks the briefing.
async function understandReply(replyText: string, context: string): Promise<{ summary: string; suggestedAction: string }> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 200,
      messages: [{ role: 'user', content: `A contact replied to an outreach email the user sent. Original ask: "${context}".

Their reply:
"""
${replyText.slice(0, 2000)}
"""

Output EXACTLY two lines, no markdown, no preamble:
SUMMARY: <one sentence — what they said. Did they propose a time, decline, or ask a question? Include the specific time/date if they gave one.>
ACTION: <the single most useful next step for the user, e.g. "Book Tuesday 2pm", "Reply with your address", or "No action needed">` }],
    });
    const text = res.content.filter((b) => b.type === 'text').map((b) => (b as { text: string }).text).join('');
    const summary = (text.match(/SUMMARY:\s*(.+)/i)?.[1] || '').replace(/[*_#`]+/g, '').trim();
    const action = (text.match(/ACTION:\s*(.+)/i)?.[1] || '').replace(/[*_#`]+/g, '').trim();
    if (summary) return { summary, suggestedAction: action || 'No action needed' };
  } catch (err) {
    console.error('[replies] understandReply failed, using fallback:', err);
  }
  return { summary: 'replied to your outreach.', suggestedAction: 'Review their reply in Gmail.' };
}
