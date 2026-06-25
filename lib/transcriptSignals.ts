// R41 T1 — Conversation State Engine, Layer 3. Cheap, deterministic signals about HOW the user spoke
// (not just what facts they stated): hesitation, explicit emotional-state declarations, and how much
// they were asking vs telling. `detectTranscriptSignals` is pure (no I/O); `recordTranscriptSignals`
// persists the durable explicit-state declarations as `pattern` facts (fire-and-forget, never throws).

export interface ExplicitState {
  topic: string;   // what the state is about ("fundraising"), or "general"
  state: string;   // the emotion word ("stressed", "excited", "good")
}

export interface TranscriptSignals {
  hesitationDensity: number;                 // hesitation markers per 100 user words
  explicitStateDeclarations: ExplicitState[];
  questionDensity: number;                   // user questions ÷ user sentences (0–1)
}

const HESITATION_RE = /\b(?:um+|uh+|er+|hmm+|like|you know|i mean|sort of|kind of|i guess)\b/gi;

const STATE_WORDS = [
  'stressed', 'overwhelmed', 'excited', 'worried', 'anxious', 'nervous', 'frustrated', 'exhausted',
  'burned out', 'burnt out', 'drained', 'tired', 'good', 'great', 'happy', 'calm', 'confident',
  'optimistic', 'hopeful', 'grateful', 'proud', 'relieved', 'down', 'sad', 'angry', 'scared',
].join('|');

// "I'm/I am/I feel/I was [really] <state> [about X]"
const STATE_RE = new RegExp(
  `\\bi(?:'m| am| feel| was|'ve been| have been| feel like i'm)\\s+(?:really |very |so |pretty |a bit |a little |kind of |quite )?(${STATE_WORDS})\\b(?:\\s+about\\s+([^.!?,;]{2,40}))?`,
  'gi',
);

const round2 = (n: number) => Math.round(n * 100) / 100;

// Extract just the USER's turns from a role-prefixed transcript ("User: …" / "AI: …"). If the
// transcript carries no role markers, treat the whole thing as user text.
function userText(transcript: string): string {
  const lines = transcript.split(/\r?\n/);
  const userLines: string[] = [];
  let sawRole = false;
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z][\w .'-]*?)\s*[:：]\s*(.*)$/);
    if (!m) continue;
    sawRole = true;
    const role = m[1].toLowerCase();
    if (!/\b(ai|assistant|bot|edge|edg3|system|agent)\b/.test(role)) userLines.push(m[2]);
  }
  return sawRole ? userLines.join(' ') : transcript;
}

export function detectTranscriptSignals(transcript: string): TranscriptSignals {
  const text = userText(transcript || '').trim();
  if (!text) return { hesitationDensity: 0, explicitStateDeclarations: [], questionDensity: 0 };

  const wordCount = (text.match(/\b[\w']+\b/g) ?? []).length;
  const hesitationCount = (text.match(HESITATION_RE) ?? []).length;
  const hesitationDensity = wordCount ? round2((hesitationCount / wordCount) * 100) : 0;

  const sentences = text.split(/[.!?]+/).map(s => s.trim()).filter(Boolean);
  const questions = (text.match(/\?/g) ?? []).length;
  const questionDensity = sentences.length ? round2(questions / sentences.length) : 0;

  const explicitStateDeclarations: ExplicitState[] = [];
  const seen = new Set<string>();
  for (const m of text.matchAll(STATE_RE)) {
    const state = m[1].toLowerCase();
    // Trim the "about X" clause at the first conjunction so trailing chatter/hesitation isn't captured
    // as part of the topic ("the move and um" → "the move").
    const topic = (m[2]?.trim().replace(/\s+(?:and|but|or|so|because)\b.*$/i, '').trim() || 'general').toLowerCase();
    const key = `${state}|${topic}`;
    if (seen.has(key)) continue;
    seen.add(key);
    explicitStateDeclarations.push({ topic, state });
    if (explicitStateDeclarations.length >= 5) break;
  }

  return { hesitationDensity, explicitStateDeclarations, questionDensity };
}

// Persist the durable part — explicit emotional-state declarations — as `pattern` facts so they
// compound into Edge's model of the user. Per-call density numbers stay transient (not stored as
// facts to avoid bloat). Fire-and-forget: never throws, never blocks the post-call pipeline.
export async function recordTranscriptSignals(userId: number, transcript: string): Promise<void> {
  try {
    const signals = detectTranscriptSignals(transcript);
    if (!signals.explicitStateDeclarations.length) return;
    const { factQueries } = await import('./db');
    for (const s of signals.explicitStateDeclarations) {
      const statement = s.topic === 'general'
        ? `Recently expressed feeling ${s.state}`
        : `Recently expressed feeling ${s.state} about ${s.topic}`;
      try { factQueries.upsertFact(userId, 'pattern', statement.slice(0, 500), s.topic === 'general' ? null : s.topic, 'low'); } catch { /* per-fact non-fatal */ }
    }
  } catch {
    /* never block the webhook */
  }
}
