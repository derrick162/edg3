import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { briefingQueries } from '@/lib/db';

// GET /api/journal — the current user's saved journal entries (most recent first).
// Each entry: timestamp, transcript, and audio_url (call recording) when available.
export async function GET() {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const rows = briefingQueries.getJournals(user.id, 30);
  const journals = rows.map(r => ({
    id: r.id,
    createdAt: r.scheduled_for,
    transcript: r.transcript || '',
    audioUrl: r.audio_url || null,
  }));
  return NextResponse.json({ journals });
}
