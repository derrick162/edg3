// Pure formatting for the Activity tab — no imports, no I/O, no side-effects.
// Converts raw audit_log rows into human-readable labels and expandable detail objects.

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

// YYYY-MM-DD → "Jun 12"  (date-only path, ignores any time component)
function fmtDate(s: string | null | undefined): string {
  if (!s) return '';
  const m = s.slice(0, 10).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return s;
  const d = new Date(`${m[0]}T12:00:00Z`);
  return `${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}`;
}

// YYYY-MM-DD → "Jun 12"  |  YYYY-MM-DDTHH:MM… → "Jun 12 at 2 PM"
// Anything else (natural language) → returned as-is
function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '';
  const dateOnly = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (dateOnly) return fmtDate(s);
  const dt = s.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (dt) {
    const [, , mo, day, hr, mn] = dt;
    const h = Number(hr); const m = Number(mn);
    const ampm = h >= 12 ? 'PM' : 'AM';
    const hr12 = h % 12 || 12;
    const timePart = m > 0 ? `${hr12}:${String(m).padStart(2, '0')} ${ampm}` : `${hr12} ${ampm}`;
    return `${MONTHS[Number(mo) - 1]} ${Number(day)} at ${timePart}`;
  }
  // Has an ISO date prefix but unknown format — try to extract the date part
  const prefix = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (prefix) return fmtDate(prefix[0]);
  return s;
}

function str(v: unknown): string { return typeof v === 'string' ? v : ''; }
function trunc(s: string, max = 40): string { return s.length > max ? s.slice(0, max) + '…' : s; }
function parseArgs(j: string): Record<string, unknown> { try { return JSON.parse(j) as Record<string, unknown>; } catch { return {}; } }
function parseSnap(s: string | null): Record<string, unknown> | null { if (!s) return null; try { return JSON.parse(s) as Record<string, unknown>; } catch { return null; } }

// Actions that are read-only and should not appear in the activity feed
export const READ_ONLY_ACTIONS = new Set([
  'readCalendar', 'findTime', 'getEventDetails', 'getDayEvents',
  'verifyPromises', 'checkReplies', 'readThread', 'findFreeSlots', 'planWeek',
]);

export type ActivityDetailSection = { label: string; value: string };
export type ActivityDetailChange = { label: string; before: string; after: string };
export type ActivityDetail = {
  sections: ActivityDetailSection[];
  changes?: ActivityDetailChange[];
};

export type ActivityItem = {
  id: number;
  action: string;
  label: string;
  detail: ActivityDetail | null;
  ok: boolean;
  created_at: string;
  undoId: number | null;
  undoLabel: string | null;
  undone: number | null; // null = no undo entry; 0 = available; 1 = already undone
};

// ── Label ────────────────────────────────────────────────────────────────────

export function buildLabel(
  action: string,
  argsJson: string,
  resultText: string | null,
): string {
  const args = parseArgs(argsJson);

  switch (action) {
    case 'createEvent': {
      const title = trunc(str(args.title), 40);
      if (args.allDay) {
        const start = fmtDate(str(args.startDateTime) || str(args.startDate));
        const end = args.endDate ? fmtDate(str(args.endDate)) : '';
        const range = end && end !== start ? `${start}–${end}` : start;
        return title ? `Created '${title}'${range ? ` · all-day ${range}` : ''}` : 'Created event';
      }
      const dt = fmtDateTime(str(args.startDateTime));
      return title ? `Created '${title}'${dt ? ` · ${dt}` : ''}` : 'Created event';
    }

    case 'createRecurringEvent': {
      const title = trunc(str(args.title), 40);
      const start = fmtDate(str(args.startDate));
      return title
        ? `Created recurring '${title}'${start ? ` · starting ${start}` : ''}`
        : 'Created recurring event';
    }

    case 'moveEvent': {
      const title = trunc(str(args.title), 40);
      const from = fmtDateTime(str(args.date));
      const to = fmtDateTime(str(args.newStartDateTime) || str(args.newStartDate));
      if (title && from && to) return `Moved '${title}' · ${from} → ${to}`;
      if (title && to) return `Moved '${title}' to ${to}`;
      return title ? `Moved '${title}'` : 'Moved event';
    }

    case 'deleteEvent': {
      const title = trunc(str(args.title), 40);
      const dt = fmtDateTime(str(args.date));
      return title ? `Deleted '${title}'${dt ? ` · ${dt}` : ''}` : 'Deleted event';
    }

    case 'editEvent': {
      const title = trunc(str(args.title), 40);
      const parts: string[] = [];
      if (args.description !== undefined || args.appendDescription !== undefined) parts.push('notes');
      if (args.location !== undefined) parts.push('location');
      const what = parts.length ? ` · updated ${parts.join(' & ')}` : '';
      return title ? `Edited '${title}'${what}` : 'Edited event';
    }

    case 'researchToEvent': {
      const title = trunc(str(args.title), 40);
      const query = str(args.query);
      if (title && query) return `Researched '${title}' · "${trunc(query, 50)}"`;
      return title ? `Researched '${title}'` : 'Added research to event';
    }

    case 'draftEmail': {
      const recips = Array.isArray(args.recipients)
        ? (args.recipients as { name?: string; email?: string }[])
        : [];
      if (recips.length === 1)
        return `Drafted email to ${trunc(str(recips[0].name) || str(recips[0].email) || 'contact', 30)}`;
      if (recips.length > 1) return `Drafted email to ${recips.length} contacts`;
      return 'Drafted email';
    }

    case 'copyDayEvents': {
      const from = fmtDate(str(args.sourceDate));
      const targets = Array.isArray(args.targetDates) ? (args.targetDates as string[]) : [];
      const to = targets.length === 1 ? fmtDate(targets[0]) : targets.length > 1 ? `${targets.length} days` : '';
      if (from && to) return `Copied events from ${from} to ${to}`;
      return 'Copied calendar events';
    }

    case 'colorEvent': {
      const title = trunc(str(args.title), 40);
      const color = str(args.color);
      return title ? `Colored '${title}'${color ? ` · ${color}` : ''}` : 'Colored event';
    }

    case 'setMyTimezone':
      return `Updated timezone to ${str(args.timezone) || 'unknown'}`;

    case 'undoLastAction':
      return 'Undid the last change';

    default:
      if (resultText) return trunc(resultText, 80);
      return action.replace(/([A-Z])/g, ' $1').trim();
  }
}

// ── Detail ───────────────────────────────────────────────────────────────────

export function buildDetail(
  action: string,
  argsJson: string,
  resultText: string | null,
  snapshotBefore: string | null,
  snapshotAfter: string | null,
): ActivityDetail | null {
  const args = parseArgs(argsJson);
  const before = parseSnap(snapshotBefore);
  const after = parseSnap(snapshotAfter);
  const sections: ActivityDetailSection[] = [];
  const changes: ActivityDetailChange[] = [];

  switch (action) {
    case 'createEvent': {
      const title = str(args.title);
      if (title) sections.push({ label: 'Event', value: title });
      if (args.allDay) {
        const start = fmtDate(str(args.startDateTime) || str(args.startDate));
        const end = args.endDate ? fmtDate(str(args.endDate)) : '';
        const dateStr = end && end !== start ? `${start} – ${end}` : start;
        if (dateStr) sections.push({ label: 'Date', value: dateStr });
      } else {
        const startFmt = fmtDateTime(str(args.startDateTime));
        const endFmt = fmtDateTime(str(args.endDateTime));
        if (startFmt) sections.push({ label: 'Start', value: startFmt });
        if (endFmt) sections.push({ label: 'End', value: endFmt });
      }
      const desc = str(after?.description) || str(args.description);
      if (desc) sections.push({ label: 'Notes', value: trunc(desc, 400) });
      const loc = str(after?.location) || str(args.location);
      if (loc) sections.push({ label: 'Location', value: loc });
      return sections.length ? { sections } : null;
    }

    case 'deleteEvent': {
      const title = str(args.title);
      if (title) sections.push({ label: 'Event', value: title });
      const dt = fmtDateTime(str(args.date));
      if (dt) sections.push({ label: 'Date', value: dt });
      if (before) {
        const desc = str(before.description);
        if (desc) sections.push({ label: 'Notes', value: trunc(desc, 400) });
        const loc = str(before.location);
        if (loc) sections.push({ label: 'Location', value: loc });
      }
      return sections.length ? { sections } : null;
    }

    case 'moveEvent': {
      const title = str(args.title);
      if (title) sections.push({ label: 'Event', value: title });
      const from = fmtDateTime(str(args.date));
      if (from) sections.push({ label: 'From', value: from });
      const to = fmtDateTime(str(args.newStartDateTime) || str(args.newStartDate));
      if (to) sections.push({ label: 'To', value: to });
      return sections.length ? { sections } : null;
    }

    case 'editEvent': {
      const title = str(args.title);
      if (title) sections.push({ label: 'Event', value: title });
      if (before && after) {
        const FIELDS: [string, string][] = [
          ['summary', 'Title'], ['description', 'Notes'], ['location', 'Location'],
        ];
        for (const [key, label] of FIELDS) {
          const b = str(before[key]); const a = str(after[key]);
          if (b !== a && (b || a))
            changes.push({ label, before: trunc(b || '(empty)', 200), after: trunc(a || '(removed)', 200) });
        }
      } else {
        const desc = str(args.description) || str(args.appendDescription);
        if (desc) sections.push({ label: args.appendDescription ? 'Appended notes' : 'New notes', value: trunc(desc, 400) });
        const loc = str(args.location);
        if (loc) sections.push({ label: 'New location', value: loc });
      }
      return sections.length || changes.length
        ? { sections, changes: changes.length ? changes : undefined }
        : null;
    }

    case 'researchToEvent': {
      const title = str(args.title);
      if (title) sections.push({ label: 'Event', value: title });
      const query = str(args.query);
      if (query) sections.push({ label: 'Query', value: query });
      const research = str(after?.description) || str(resultText);
      if (research) sections.push({ label: 'Research saved', value: trunc(research, 800) });
      return sections.length ? { sections } : null;
    }

    case 'draftEmail': {
      const recips = Array.isArray(args.recipients)
        ? (args.recipients as { name?: string; email?: string }[])
        : [];
      if (recips.length)
        sections.push({ label: 'To', value: recips.map(r => str(r.name) || str(r.email) || '?').join(', ') });
      const subject = str(args.subject);
      if (subject) sections.push({ label: 'Subject', value: subject });
      const ask = str(args.ask);
      if (ask) sections.push({ label: 'Ask', value: trunc(ask, 400) });
      return sections.length ? { sections } : null;
    }

    case 'createRecurringEvent': {
      const title = str(args.title);
      if (title) sections.push({ label: 'Event', value: title });
      const start = fmtDate(str(args.startDate));
      if (start) sections.push({ label: 'Starting', value: start });
      const end = fmtDate(str(args.endDate));
      if (end) sections.push({ label: 'Ending', value: end });
      const rec = str(args.recurrence);
      if (rec) sections.push({ label: 'Repeats', value: rec });
      return sections.length ? { sections } : null;
    }

    case 'copyDayEvents': {
      const from = fmtDate(str(args.sourceDate));
      if (from) sections.push({ label: 'From', value: from });
      const targets = Array.isArray(args.targetDates) ? (args.targetDates as string[]) : [];
      const toVal = targets.map(t => fmtDate(t)).filter(Boolean).join(', ');
      if (toVal) sections.push({ label: 'To', value: toVal });
      return sections.length ? { sections } : null;
    }

    default:
      if (resultText) return { sections: [{ label: 'Result', value: trunc(resultText, 400) }] };
      return null;
  }
}

// ── Assembly ─────────────────────────────────────────────────────────────────

// Minimal shapes matching auditLogQueries.recent / undoQueries.listRecent outputs
type AuditInput = {
  id: number;
  action: string;
  args_json: string;
  result_text: string | null;
  ok: number;
  snapshot_before: string | null;
  snapshot_after: string | null;
  created_at: string;
};
type UndoInput = { id: number; label: string; undone: number; created_at: string };

export function buildActivityItems(
  auditRows: AuditInput[],
  undoRows: UndoInput[],
  limit = 50,
): ActivityItem[] {
  const usedUndoIds = new Set<number>();

  return auditRows
    .filter(ar => !READ_ONLY_ACTIONS.has(ar.action) && ar.ok === 1)
    .map(ar => {
      const arMs = new Date(ar.created_at).getTime();
      let matched: UndoInput | null = null;
      let bestDelta = Infinity;
      for (const ur of undoRows) {
        if (usedUndoIds.has(ur.id)) continue;
        const delta = Math.abs(new Date(ur.created_at).getTime() - arMs);
        if (delta <= 2000 && delta < bestDelta) { matched = ur; bestDelta = delta; }
      }
      if (matched) usedUndoIds.add(matched.id);

      return {
        id: ar.id,
        action: ar.action,
        label: buildLabel(ar.action, ar.args_json, ar.result_text),
        detail: buildDetail(ar.action, ar.args_json, ar.result_text, ar.snapshot_before, ar.snapshot_after),
        ok: true,
        created_at: ar.created_at,
        undoId: matched?.id ?? null,
        undoLabel: matched?.label ?? null,
        undone: matched ? matched.undone : null,
      };
    })
    .slice(0, limit);
}
