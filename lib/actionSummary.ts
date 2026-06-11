// Pure utility — no imports. Safe for both client ('use client') and server components.
// Centralises the filter + label map for briefings.tool_actions so the dashboard view and
// the calendar call-summary event (saveCallSummaryToCalendar) always agree on what "Edge did."

export interface ToolAction {
  fn: string;
  args?: Record<string, unknown>;
  result?: string;
  ok?: boolean;
}

// Read-only / internal calls — excluded from the user-facing summary.
const READ_ONLY_FNS = new Set([
  'readCalendar', 'findTime', 'getEventDetails', 'getDayEvents', 'verifyPromises',
  'checkReplies', 'readThread', 'findFreeSlots',
]);

/**
 * Converts raw tool_actions entries into plain-English labels for the user.
 * Filters: only ok=true, non-read-only actions produce a label.
 * If nothing survives the filter, returns [].
 */
export function summarizeUserFacingActions(toolActions: ToolAction[]): string[] {
  const labels: string[] = [];
  for (const a of toolActions) {
    if (!a.ok) continue;
    if (READ_ONLY_FNS.has(a.fn)) continue;
    const label = actionToLabel(a);
    if (label) labels.push(label);
  }
  return labels;
}

function actionToLabel(a: ToolAction): string | null {
  const args = a.args ?? {};
  const title = (args.title as string | undefined) ?? '';
  switch (a.fn) {
    case 'createEvent':
      return title ? `Added '${title}' to your calendar` : 'Added an event to your calendar';
    case 'createRecurringEvent':
      return title ? `Added recurring '${title}' to your calendar` : 'Added a recurring event';
    case 'moveEvent':
      return title ? `Moved '${title}'` : 'Moved an event';
    case 'deleteEvent':
      return title ? `Removed '${title}'` : 'Removed an event';
    case 'editEvent':
      return title ? `Updated '${title}'` : 'Updated an event';
    case 'colorEvent':
      return title ? `Colored '${title}'` : 'Colored an event';
    case 'researchToEvent':
      return title ? `Researched '${title}' and saved notes` : 'Researched an event and saved notes';
    case 'draftEmail': {
      const recs = args.recipients as { name?: string }[] | undefined;
      if (Array.isArray(recs) && recs.length > 1) return `Drafted ${recs.length} emails`;
      const name = recs?.[0]?.name;
      return name ? `Drafted an email to ${name}` : 'Drafted an email';
    }
    case 'copyDayEvents': {
      const src = args.sourceDate as string | undefined;
      return src ? `Copied events from ${src}` : 'Copied events from another day';
    }
    case 'setMyTimezone':
      return 'Updated your timezone';
    case 'undoLastAction':
      return 'Undid the last change';
    default:
      return null;
  }
}
