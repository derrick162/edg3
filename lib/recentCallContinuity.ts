// C12 — same-morning memory continuity (Core-owned).
//
// Incident: a briefing call dropped at the duration cap; the user called back 13 seconds later and
// Edge had no memory of the call that had JUST ended — because the post-call memory pipeline
// (transcript fetch + fact extraction) runs asynchronously on the call-ended webhook, seconds after
// the call ends. A back-to-back call therefore builds its memory text before the previous call's
// notes exist.
//
// Fix: before building the open-call / inbound memory text, look for the user's most recent call
// that just happened and whose analysis hasn't landed yet (still 'calling', or completed within ~15
// min with facts not yet extracted). If found, inject the raw transcript tail as a "MINUTES AGO"
// block so Edge already knows what was just said — and can acknowledge a drop instead of a cold
// greeting. Fully guarded: any failure returns '' and the call proceeds normally.

import { getDb, decryptBriefingRow, type Briefing } from './db';

const RECENT_WINDOW_MIN = 15;
const TAIL_CHARS = 2000;

/** True once the post-call fact-extraction pipeline has completed for this briefing. */
function factsExtracted(b: Briefing): boolean {
  const ls = (b as { learning_status?: string | null }).learning_status;
  if (!ls) return false;
  try { return JSON.parse(ls)?.facts_ok === true; } catch { return false; }
}

/**
 * The user's most recent call whose memory hasn't landed yet — still 'calling' (webhook not done),
 * or completed/missed within the window with facts not yet extracted. Excludes the current call.
 * Returns null when there's nothing recent+unprocessed. Never throws.
 */
export function findRecentUnprocessedBriefing(userId: number, excludeBriefingId?: number): Briefing | null {
  try {
    const db = getDb();
    const exclude = excludeBriefingId ?? -1;
    const row = db.prepare(
      `SELECT * FROM briefings
         WHERE user_id = ? AND id != ?
           AND status IN ('calling','completed','missed')
           AND created_at >= datetime('now', '-${RECENT_WINDOW_MIN} minutes')
         ORDER BY id DESC LIMIT 1`,
    ).get(userId, exclude) as Briefing | undefined;
    if (!row) return null;
    const b = decryptBriefingRow(row);
    // 'calling' = webhook hasn't processed the end yet (unprocessed by definition).
    // completed/missed = only unprocessed until facts land; once extracted, normal memory covers it.
    if (b.status !== 'calling' && factsExtracted(b)) return null;
    return b;
  } catch {
    return null;
  }
}

/** Fetch the transcript straight from the Vapi API (used when the DB row has none yet). 3s timeout. */
async function fetchVapiTranscript(callId: string): Promise<string> {
  if (!process.env.VAPI_API_KEY) return '';
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 3000);
  try {
    const res = await fetch(`https://api.vapi.ai/call/${callId}`, {
      headers: { Authorization: `Bearer ${process.env.VAPI_API_KEY}` },
      signal: controller.signal,
    });
    if (!res.ok) return '';
    const data = await res.json();
    return String((data?.transcript || data?.artifact?.transcript || '') ?? '');
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}

/** Build the MINUTES AGO system-prompt block from a transcript. Pure; '' for an empty transcript. */
export function buildContinuityBlock(transcript: string): string {
  const clean = (transcript ?? '').trim();
  if (!clean) return '';
  const tail = clean.length > TAIL_CHARS ? clean.slice(-TAIL_CHARS) : clean;
  return `
MINUTES AGO — the previous call ended moments ago and its notes haven't been saved to memory yet. This is what was ACTUALLY said (most recent at the bottom) — treat it as fresh context you already have, in the user's own words:
"""
${tail}
"""
Reference this directly if the user picks up where they left off — NEVER act like you don't remember it or say you don't have access to it. If the transcript looks cut off mid-thought (the call likely dropped at a time limit), OPEN by briefly acknowledging that — e.g. "Sorry, looks like we got cut off — I've got everything up to [last point]." — then continue. Otherwise greet normally.`;
}

/**
 * Continuity block to append to the open-call / inbound memory text. Returns '' when there's no
 * recent unprocessed call, or on any failure — the call always proceeds. `excludeBriefingId` is the
 * current call's own briefing row, so it isn't mistaken for the "previous" one.
 */
export async function getRecentCallContinuityBlock(userId: number, excludeBriefingId?: number): Promise<string> {
  try {
    const recent = findRecentUnprocessedBriefing(userId, excludeBriefingId);
    if (!recent) return '';
    let transcript = (recent.transcript ?? '').trim();
    if (!transcript && recent.vapi_call_id) transcript = await fetchVapiTranscript(recent.vapi_call_id);
    return buildContinuityBlock(transcript);
  } catch {
    return '';
  }
}
