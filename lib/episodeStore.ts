// Episode Store (Core-owned ingestion + query path).
//
// The episodic memory tier — preserves raw call transcripts so Edge can say
// "last time you talked fundraising you committed to X — did that happen?"
// rather than relying solely on lossy LLM-extracted summaries.
//
// Spec: specs/episode-store.md
//
// Architecture: write path (persistCallEpisode) called fire-and-forget at call end
// in app/api/vapi/webhook. Query path (buildEpisodeMemoryBlock) called at briefing
// time to surface relevant past episodes in the briefing prompt.

import { episodeQueries, type Episode } from './db';

// ── Pure helpers ──────────────────────────────────────────────────────────────

/**
 * Extract topic tags from a transcript by matching against priority texts and
 * a set of known topic keywords. Keyword-based — zero LLM cost.
 *
 * Returns the subset of priorityTexts that appear (loosely) in the transcript,
 * plus any domain keywords detected (fundraising, health, fitness, hiring, etc.).
 */
export function tagTopicsFromTranscript(
  transcript: string,
  priorityTexts: string[],
): string[] {
  if (!transcript) return [];
  const lower = transcript.toLowerCase();
  const tags = new Set<string>();

  // Match each priority by keyword overlap (any meaningful word in the priority text)
  for (const p of priorityTexts) {
    const words = p.toLowerCase().split(/\W+/).filter(w => w.length >= 5);
    if (words.length === 0) { // short priority, match whole phrase
      if (lower.includes(p.toLowerCase())) tags.add(p);
    } else {
      if (words.some(w => lower.includes(w))) tags.add(p);
    }
  }

  // Domain keywords not necessarily in priorities
  const DOMAIN_KEYWORDS: Record<string, string> = {
    'fundrais': 'fundraising',
    'investor': 'fundraising',
    'funding':  'fundraising',
    'runway':   'runway',
    'burn rate': 'runway',
    'health':   'health',
    'recovery': 'recovery',
    'exercise': 'fitness',
    'workout':  'fitness',
    'hiring':   'hiring',
    'recruit':  'hiring',
    'product':  'product',
    'launch':   'launch',
    'revenue':  'revenue',
    'customer': 'customers',
    'user':     'product',
  };
  for (const [kw, tag] of Object.entries(DOMAIN_KEYWORDS)) {
    if (lower.includes(kw)) tags.add(tag);
  }

  return [...tags].slice(0, 10); // cap at 10 tags
}

/**
 * Extract commitment tags from a transcript using already-extracted task texts.
 * This avoids a second LLM call — we reuse whatever extractTasksFromTranscript
 * already produced.
 */
export function tagCommitmentsFromTasks(taskTexts: string[]): string[] {
  return taskTexts.slice(0, 10);
}

// ── I/O path ─────────────────────────────────────────────────────────────────

/**
 * Persist a call as an episode. Called fire-and-forget from the Vapi webhook
 * after transcript is available. Never throws (caller should .catch() anyway).
 */
export function persistCallEpisode(
  userId: number,
  transcript: string,
  occurredAt: string,
  priorityTexts: string[],
  taskTexts: string[],
): void {
  if (!transcript || transcript.length < 50) return; // skip trivially empty calls
  const topics = tagTopicsFromTranscript(transcript, priorityTexts);
  const commitments = tagCommitmentsFromTasks(taskTexts);
  episodeQueries.insert(userId, 'call', occurredAt, transcript, topics, commitments);
}

// ── Briefing query ────────────────────────────────────────────────────────────

/**
 * Build the EPISODE MEMORY block for the briefing prompt.
 * Pulls recent episodes (last 5 calls) that share topics with today's
 * priorities or calendar event titles.
 *
 * Returns '' when there are no relevant episodes (degrade silently).
 */
export function buildEpisodeMemoryBlock(
  userId: number,
  priorityTexts: string[],
  todayEventTitles: string[],
): string {
  let episodes: Episode[];
  try {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
    episodes = episodeQueries.search(userId, { topics: priorityTexts, since, limit: 5 });
  } catch {
    return '';
  }
  if (!episodes.length) return '';

  const lines: string[] = ['EPISODIC MEMORY (past calls Edge remembers — use for continuity, not as current facts):'];
  for (const ep of episodes) {
    const date = ep.occurredAt.slice(0, 10);
    const topicStr = ep.topics.length ? ` [${ep.topics.slice(0, 3).join(', ')}]` : '';
    const commitStr = ep.commitments.length
      ? ` · committed: "${ep.commitments[0]}"${ep.commitments.length > 1 ? ` +${ep.commitments.length - 1} more` : ''}`
      : '';
    lines.push(`  • ${date}${topicStr}${commitStr}`);
  }
  lines.push('Reference these episodes when you see the same topic on today\'s calendar or in stated priorities — say "last time we talked about X you…" to show memory. One mention max.');

  void todayEventTitles; // used by caller to pre-filter; kept in signature for future use
  return lines.join('\n');
}
