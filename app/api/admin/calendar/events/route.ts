import { NextRequest, NextResponse } from 'next/server';
import { userQueries } from '@/lib/db';
import { getUpcomingEvents, createCalendarEvent } from '@/lib/calendar';

function checkAuth(req: NextRequest): boolean {
  const secret = process.env.ADMIN_SECRET;
  if (!secret) return false;
  return req.headers.get('x-admin-secret') === secret;
}

// Shape returned to the Chief-of-Staff agent — only the fields it needs,
// not the full Google Calendar API blob.
function formatEvent(ev: {
  id?: string | null;
  summary?: string | null;
  start?: { dateTime?: string | null; date?: string | null } | null;
  end?: { dateTime?: string | null; date?: string | null } | null;
  description?: string | null;
  location?: string | null;
  status?: string | null;
}) {
  const startRaw = ev.start?.dateTime || ev.start?.date || '';
  const endRaw = ev.end?.dateTime || ev.end?.date || '';
  return {
    id: ev.id ?? null,
    title: ev.summary ?? '(no title)',
    start: startRaw,
    end: endRaw,
    allDay: !ev.start?.dateTime,
    description: ev.description ?? null,
    location: ev.location ?? null,
    status: ev.status ?? 'confirmed',
  };
}

// GET /api/admin/calendar/events?email=...&days=7
// Returns upcoming events for the next N days on the user's primary + shared calendars.
export async function GET(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const email = searchParams.get('email');
  if (!email) return NextResponse.json({ error: 'email param required' }, { status: 400 });

  const daysRaw = parseInt(searchParams.get('days') || '7', 10);
  const days = isNaN(daysRaw) || daysRaw < 1 ? 7 : Math.min(daysRaw, 90);

  const user = userQueries.findByEmail(email);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  try {
    const raw = await getUpcomingEvents(user.id, days);
    const events = raw.map(formatEvent);
    return NextResponse.json({ events, count: events.length, days });
  } catch (err) {
    console.error('[admin/calendar/events GET]', err);
    return NextResponse.json(
      { error: 'Failed to fetch calendar events', detail: String(err) },
      { status: 500 }
    );
  }
}

// POST /api/admin/calendar/events
// Body: { email, title, start (ISO datetime), end (ISO datetime), description?, timezone? }
// Creates a calendar event on the user's primary calendar and returns the new event id.
export async function POST(req: NextRequest) {
  if (!checkAuth(req)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  let body: {
    email?: string;
    title?: string;
    start?: string;
    end?: string;
    description?: string;
    timezone?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const { email, title, start, end, description } = body;
  if (!email) return NextResponse.json({ error: 'email is required' }, { status: 400 });
  if (!title) return NextResponse.json({ error: 'title is required' }, { status: 400 });
  if (!start || !end) return NextResponse.json({ error: 'start and end are required (ISO datetime)' }, { status: 400 });

  // Validate that start/end look like ISO datetime strings
  if (isNaN(Date.parse(start)) || isNaN(Date.parse(end))) {
    return NextResponse.json({ error: 'start and end must be valid ISO datetime strings' }, { status: 400 });
  }
  if (new Date(end) <= new Date(start)) {
    return NextResponse.json({ error: 'end must be after start' }, { status: 400 });
  }

  const user = userQueries.findByEmail(email);
  if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const timezone = body.timezone || user.timezone || 'America/New_York';

  try {
    const created = await createCalendarEvent(user.id, title, start, end, timezone, description);
    return NextResponse.json({
      success: true,
      eventId: created.id ?? null,
      title,
      start,
      end,
      timezone,
    });
  } catch (err) {
    console.error('[admin/calendar/events POST]', err);
    return NextResponse.json(
      { error: 'Failed to create calendar event', detail: String(err) },
      { status: 500 }
    );
  }
}
