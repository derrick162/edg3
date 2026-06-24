import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { memoryQueries, factQueries, factHistoryQueries, getDb } from '@/lib/db';

export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  // Show real depth — each call produces several memory rows, so a small cap made the
  // Memory tab floor out after a couple of days (reported: "only goes back to June 8").
  const memories = memoryQueries.getRecent(user.id, 200);
  const facts = factQueries.getAll(user.id);
  let latestTs: Record<number, string> = {};
  try { latestTs = factHistoryQueries.getLatestTimestamps(user.id); } catch { /* non-fatal */ }

  // R25 T5 — flag whether each fact's source briefing was an open/gratitude call (vs a morning
  // briefing) so the Memory tab can label provenance correctly. Open/gratitude calls also carry
  // a source_briefing_id, so without this they were mislabeled "from your morning call".
  const briefingFlagMap = new Map<number, number>();
  const sourceIds = facts.filter(f => f.source_briefing_id).map(f => f.source_briefing_id as number);
  if (sourceIds.length) {
    try {
      const rows = getDb().prepare(
        `SELECT id, is_open_call FROM briefings WHERE id IN (${sourceIds.map(() => '?').join(',')})`,
      ).all(...sourceIds) as Array<{ id: number; is_open_call: number }>;
      rows.forEach(r => briefingFlagMap.set(r.id, r.is_open_call ?? 0));
    } catch { /* non-fatal */ }
  }

  const factsWithHistory = facts.map(f => ({
    ...f,
    last_updated_at: latestTs[f.id] ?? null,
    source_is_open_call: f.source_briefing_id ? (briefingFlagMap.get(f.source_briefing_id) ?? 0) : null,
  }));
  return NextResponse.json({ memories, facts: factsWithHistory });
}
