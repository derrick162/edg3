// R23 T1 — rich memory context for open / inbound calls, so Edge has briefing-quality recall on
// every live call (not just 10 preference facts). Lives here (not in scheduler) so the Vapi webhook
// can import it without dragging in scheduler's cron side-effects. Best-effort: each section degrades
// to nothing on failure, never throwing.
import { format } from 'date-fns';
import { factQueries, openLoopQueries, briefingQueries, priorityQueries, userQueries } from './db';
import { getWeekOf } from './briefing';
import { parseWorkSchedule, formatWorkHours } from './workHours';

// R23 T2 — the user's current top priorities as prompt text. Lives here (not just in scheduler) so
// the inbound-call webhook can build a personalized prompt without importing scheduler's cron module.
export function currentPrioritiesText(userId: number): string {
  try {
    const prios = priorityQueries.getThisWeek(userId, getWeekOf());
    const eff = prios.length ? prios : priorityQueries.getMostRecent(userId);
    return eff.length ? eff.map((p, i) => `${i + 1}. ${p.text}`).join('\n') : '';
  } catch { return ''; }
}

// R29 Part D — structured grounding contract. A labelled, ALL-CAPS-sectioned block lets the model
// index into memory far more reliably than a flat prose blob. One item per line; a person's full
// fact set on ONE line; empty sections omitted; soft-capped so the prompt stays tight.
const KNOW_CHAR_BUDGET = 600;

export function currentOpenCallMemoryText(userId: number): string {
  const sections: string[] = [];

  // Section 1 — "WHAT EDGE KNOWS ABOUT YOU" as labelled sections, in priority order.
  try {
    const facts = factQueries.getAll(userId);

    // M4-5 — the lifetime profile is the highest-signal, most-stable context: inject it FIRST.
    const lifetime = facts.find(f => f.category === 'lifetime_profile');
    const lifetimeBlock = lifetime?.statement?.trim() ? `LIFETIME PROFILE:\n- ${lifetime.statement.trim()}` : null;

    // PEOPLE: one line per person, ALL their facts joined (never truncate a person's line).
    const peopleByEntity = new Map<string, string[]>();
    for (const f of facts) {
      if (f.category !== 'person' || !f.entity?.trim()) continue;
      const arr = peopleByEntity.get(f.entity) ?? [];
      arr.push(f.statement);
      peopleByEntity.set(f.entity, arr);
    }
    const peopleLines = [...peopleByEntity.entries()].slice(0, 6)
      .map(([entity, statements]) => `- ${entity}: ${statements.join('; ')}`);

    // GOALS / PROJECTS / PREFERENCES / OTHER — one item per line, dash-prefixed.
    const simpleLines = (cat: string, cap: number) =>
      facts.filter(f => f.category === cat).slice(0, cap)
        .map(f => `- ${f.entity?.trim() ? `${f.entity}: ` : ''}${f.statement}`);

    // OPEN COMMITMENTS — recent stated intentions (R34 commitment facts), open loops as fallback.
    const commitmentLines = facts.filter(f => f.category === 'commitment')
      .sort((a, b) => Date.parse(b.learned_at) - Date.parse(a.learned_at))
      .slice(0, 2)
      .map(f => `- Said on ${(() => { try { return format(new Date(f.learned_at), 'EEE'); } catch { return 'recently'; } })()}: "${f.statement}"`);
    let loopLines: string[] = [];
    try { loopLines = openLoopQueries.list(userId, 'open').slice(0, 2).map(l => `- ${l.description}`); } catch { /* skip */ }
    const commitBlock = [...commitmentLines, ...loopLines].slice(0, 3);

    // CONSTRAINTS — work hours (so the model never proposes work outside them).
    let constraintsBlock: string | null = null;
    try {
      const sched = parseWorkSchedule(userQueries.getWorkSchedule(userId));
      constraintsBlock = `CONSTRAINTS:\n- Work hours: ${formatWorkHours(sched)}\n- No work scheduling suggestions outside work hours`;
    } catch { /* skip */ }

    // Assemble in priority order, accumulating under a soft char budget (people/goals always win).
    const ordered: Array<[string, string[]]> = [
      ['PEOPLE', peopleLines],
      ['GOALS', simpleLines('goal', 5)],
      ['PREFERENCES', simpleLines('preference', 5)],
      ['OPEN COMMITMENTS', commitBlock],
      ['PROJECTS', simpleLines('project', 4)],
      ['OTHER', simpleLines('fact', 4)],
    ];
    const blocks: string[] = [];
    let used = 0;
    if (lifetimeBlock) { blocks.push(lifetimeBlock); used += lifetimeBlock.length; }
    for (const [header, lines] of ordered) {
      if (!lines.length) continue;
      const block = `${header}:\n${lines.join('\n')}`;
      // Always include the top two sections; otherwise stop once over budget.
      if (blocks.length >= 2 && used + block.length > KNOW_CHAR_BUDGET) continue;
      blocks.push(block);
      used += block.length;
    }
    // Constraints ride along only when there's real learned memory — never surface work hours alone
    // (they always have a default, which would otherwise make an empty profile look non-empty).
    if (constraintsBlock && blocks.length) blocks.push(constraintsBlock);
    if (blocks.length) sections.push(`WHAT EDGE KNOWS ABOUT YOU:\n\n${blocks.join('\n\n')}`);
  } catch { /* skip section */ }

  // Section 2 — recent call context (last 2 completed calls, for continuity).
  try {
    const recent = briefingQueries.getRecent(userId, 8).filter(b => b.status === 'completed').slice(0, 2);
    const lines: string[] = [];
    for (const b of recent) {
      const note = (b.user_response && b.user_response.trim()) || (b.content ? b.content.slice(0, 150) : '');
      if (note.trim()) lines.push(`${(b.scheduled_for || '').slice(0, 10)}: ${note.trim()}`);
    }
    if (lines.length) sections.push(`RECENT CALL NOTES (last 2 calls — use for continuity, don't repeat back verbatim):\n${lines.join('\n')}`);
  } catch { /* skip section */ }

  return sections.join('\n\n');
}
