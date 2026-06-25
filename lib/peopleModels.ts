// R37 (M4-4) — social mental models. After a call, update one relationship model per person mentioned,
// so Edge holds a single evolving Patrick profile instead of scattered isolated facts. The schema +
// `peopleModelQueries` (encrypted at rest) are Vijay's; this is the Core write path. Degrades silently —
// never throws, never blocks the webhook response.

import { factQueries, peopleModelQueries, type PeopleModelFields, type PeopleModel } from './db';

const MAX_PEOPLE_PER_CALL = 5; // bound Haiku cost

// One Haiku call: merge the existing model with new signal from the transcript. Preserves fields the
// transcript doesn't speak to. Returns null on any failure (caller skips the upsert).
async function deriveModelViaHaiku(
  name: string,
  transcript: string,
  existing: PeopleModel | undefined,
): Promise<PeopleModelFields | null> {
  try {
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 300,
      messages: [{
        role: 'user',
        content: `You are updating a relationship model for a person named ${name} based on a conversation transcript.

Current model (may be empty):
Goals: ${existing?.goals ?? 'unknown'}
Communication style: ${existing?.communication_style ?? 'unknown'}
Relationship state: ${existing?.relationship_state ?? 'unknown'}
Last interaction: ${existing?.last_interaction ?? 'unknown'}

Transcript:
${transcript.slice(0, 2500)}

Return ONLY a JSON object with these four fields. Only update a field if the transcript provides NEW signal about ${name} — otherwise return null for that field to preserve the existing value. If nothing is known, use null.
{"goals": string | null, "communication_style": string | null, "relationship_state": string | null, "last_interaction": string | null}`,
      }],
    });
    const text = res.content.filter((b: { type: string }) => b.type === 'text').map((b: { type: string; text?: string }) => b.text ?? '').join('');
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]) as Record<string, unknown>;
    const str = (v: unknown) => (typeof v === 'string' && v.trim() && v.trim().toLowerCase() !== 'null' && v.trim().toLowerCase() !== 'unknown') ? v.trim() : null;
    const fields: PeopleModelFields = {
      goals: str(parsed.goals),
      communicationStyle: str(parsed.communication_style),
      relationshipState: str(parsed.relationship_state),
      lastInteraction: str(parsed.last_interaction),
    };
    // Nothing new to write → skip (upsert COALESCEs nulls anyway, but this avoids a pointless write).
    if (!fields.goals && !fields.communicationStyle && !fields.relationshipState && !fields.lastInteraction) return null;
    return fields;
  } catch {
    return null;
  }
}

export async function updatePeopleModels(userId: number, transcript: string, userName: string): Promise<void> {
  try {
    if (!transcript?.trim()) return;
    const lowerTranscript = transcript.toLowerCase();
    // Scope guard: only people we already track as person-category facts (not arbitrary transcript names).
    const personNames = [...new Set(
      factQueries.getAll(userId)
        .filter(f => f.category === 'person' && f.entity?.trim())
        .map(f => f.entity!.trim()),
    )];
    // Only those actually mentioned in THIS call (first-name match), capped.
    const mentioned = personNames
      .filter(name => {
        const first = name.toLowerCase().split(/\s+/)[0];
        return first.length >= 2 && lowerTranscript.includes(first) && name.toLowerCase() !== userName.trim().toLowerCase();
      })
      .slice(0, MAX_PEOPLE_PER_CALL);
    if (!mentioned.length) return;

    for (const name of mentioned) {
      try {
        const existing = peopleModelQueries.getForUser(userId, name);
        const updated = await deriveModelViaHaiku(name, transcript, existing);
        if (updated) peopleModelQueries.upsert(userId, name, updated);
      } catch { /* per-person failure is non-fatal */ }
    }
  } catch {
    /* never block the post-call pipeline */
  }
}
