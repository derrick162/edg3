// Priority↔calendar alignment for EDG3 briefings (Core-owned).
//
// Measures how many real calendar hours map to each stated weekly priority, and how many
// hours are unaligned (meetings/events that don't serve any priority). The result is injected
// into the briefing prompt as structured facts so the model can make one concrete, empathetic
// observation — not a vague aside.
//
// Design: ONE Claude-Haiku call classifies all events at once (no per-event round-trips).
// Always degrades safely: any failure returns null, and the briefing falls back gracefully.

import { type calendar_v3 } from 'googleapis';
import { type Priority } from './db';

export interface AlignmentResult {
  perPriority: { priority: string; hours: number; blocked: boolean }[];
  unalignedHours: number;
  topUnaligned: { title: string; hours: number }[];
}

function eventDurationHours(e: calendar_v3.Schema$Event): number {
  if (e.start?.dateTime && e.end?.dateTime) {
    const ms = new Date(e.end.dateTime).getTime() - new Date(e.start.dateTime).getTime();
    return Math.round((ms / 3600000) * 10) / 10;
  }
  if (e.start?.date && e.end?.date) {
    // All-day: approximate as 8 working hours per calendar day
    const days = (new Date(e.end.date).getTime() - new Date(e.start.date).getTime()) / 86400000;
    return Math.max(1, days) * 8;
  }
  return 0;
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/**
 * Classify this week's calendar events against the user's stated priorities via one Haiku call.
 * Returns a structured result with hours-per-priority and unaligned time sinks.
 * Returns null on ANY failure so callers always degrade gracefully.
 */
export async function computeAlignment(
  priorities: Priority[],
  weekEvents: calendar_v3.Schema$Event[],
  _tz: string,
): Promise<AlignmentResult | null> {
  try {
    if (!priorities.length) return null;

    const events = weekEvents
      .slice(0, 40) // cap to avoid oversized prompts
      .map(e => ({ title: (e.summary || 'Untitled').trim(), hours: eventDurationHours(e) }))
      .filter(e => e.hours > 0);

    // No time-bearing events → all priorities at 0h, nothing unaligned
    if (!events.length) {
      return {
        perPriority: priorities.map(p => ({ priority: p.text, hours: 0, blocked: false })),
        unalignedHours: 0,
        topUnaligned: [],
      };
    }

    const priorityList = priorities.map((p, i) => `${i + 1}. ${p.text}`).join('\n');
    const eventList = events.map(e => `- "${e.title}" (${e.hours.toFixed(1)}h)`).join('\n');

    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Classify each calendar event against the priorities below. Output ONLY a JSON array — no preamble, no markdown, no commentary.

Priorities:
${priorityList}

Events this week:
${eventList}

For each event assign a priority number (1–${priorities.length}) if it contributes to that priority, or "none" if it doesn't relate to any priority.
Output format: [{"event":"EXACT TITLE","priority":"1"},{"event":"EXACT TITLE","priority":"none"},...]`,
      }],
    });

    const raw = res.content
      .filter((b: { type: string }) => b.type === 'text')
      .map((b: { type: string; text?: string }) => b.text ?? '')
      .join('')
      .trim();

    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) return null;

    const classifications: { event: string; priority: string }[] = JSON.parse(match[0]);

    const hoursMap = new Map<number, number>(priorities.map((_, i) => [i + 1, 0]));
    const unalignedList: { title: string; hours: number }[] = [];

    for (const c of classifications) {
      const ev = events.find(e => e.title === c.event);
      if (!ev) continue;
      const idx = parseInt(c.priority, 10);
      if (!isNaN(idx) && idx >= 1 && idx <= priorities.length) {
        hoursMap.set(idx, (hoursMap.get(idx) ?? 0) + ev.hours);
      } else {
        unalignedList.push({ title: ev.title, hours: ev.hours });
      }
    }

    return {
      perPriority: priorities.map((p, i) => {
        const h = round1(hoursMap.get(i + 1) ?? 0);
        return { priority: p.text, hours: h, blocked: h > 0 };
      }),
      unalignedHours: round1(unalignedList.reduce((s, e) => s + e.hours, 0)),
      topUnaligned: [...unalignedList]
        .sort((a, b) => b.hours - a.hours)
        .slice(0, 3)
        .map(e => ({ title: e.title, hours: round1(e.hours) })),
    };
  } catch {
    return null;
  }
}
