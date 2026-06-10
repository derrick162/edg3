import { NextRequest, NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { createCalendarEvent } from '@/lib/calendar';
import { notificationQueries } from '@/lib/db';
import { bookEventTimes } from '@/lib/time';
import { claimEventCreate, buildEventDedupeKey } from '@/lib/idempotency';

// Create a calendar event from the web (used by the notification "Book it" quick-form).
// The user confirms title/date/time/duration before this is called — we never auto-book
// a time the AI guessed. Optionally marks the originating notification as handled.
export async function POST(req: NextRequest) {
  const user = await getSession();
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: { title?: string; date?: string; time?: string; durationMins?: number; notificationId?: number };
  try { body = await req.json(); } catch { return NextResponse.json({ error: 'Invalid request' }, { status: 400 }); }

  const title = (body.title || '').trim();
  const date = body.date || '';
  const time = body.time || '';
  if (!title) return NextResponse.json({ error: 'A title is required.' }, { status: 400 });
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return NextResponse.json({ error: 'A valid date is required.' }, { status: 400 });
  if (!/^\d{2}:\d{2}$/.test(time)) return NextResponse.json({ error: 'A valid time is required.' }, { status: 400 });

  const tz = user.timezone || 'America/New_York';
  const dur = Number(body.durationMins) > 0 ? Number(body.durationMins) : 30;
  const { start, end } = bookEventTimes(date, time, dur);

  // Idempotency guard — absorbs double-taps on "Book it" within the 5-min TTL window.
  // Returns success immediately (the event from the first tap already exists on the calendar).
  if (!claimEventCreate(user.id, buildEventDedupeKey(title, start))) {
    if (typeof body.notificationId === 'number') notificationQueries.markRead(body.notificationId, user.id);
    return NextResponse.json({ success: true });
  }

  try {
    await createCalendarEvent(user.id, title, start, end, tz);
  } catch {
    return NextResponse.json({ error: 'Could not create the event — check that your Google Calendar is connected.' }, { status: 500 });
  }

  if (typeof body.notificationId === 'number') notificationQueries.markRead(body.notificationId, user.id);
  return NextResponse.json({ success: true });
}
