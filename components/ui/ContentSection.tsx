'use client';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContentCard {
  id: string;
  title: string;
  preview: string;
  /** One of the predefined gradient keys */
  gradient: 'indigo' | 'teal' | 'amber' | 'rose' | 'violet' | 'slate';
  /** Simple icon/glyph shown on the thumbnail */
  icon: string;
}

// Hardcoded starter content — Esther to draft full articles as a fast-follow.
const CONTENT: ContentCard[] = [
  {
    id: 'calendar-energy',
    title: 'Manage your calendar by your energy',
    preview: 'Stop blocking time by hours. Block it by when your brain is actually ready to do the work.',
    gradient: 'indigo',
    icon: '⚡',
  },
  {
    id: 'burnout',
    title: 'What burnout really is — and how Edge protects you',
    preview: 'Burnout isn\'t tiredness. It\'s a slow erosion of your capacity to care. Here\'s what the data says.',
    gradient: 'rose',
    icon: '🛡',
  },
  {
    id: 'edge-score',
    title: 'Your Edge Score, explained',
    preview: 'Focus · Energy · Clarity · Momentum — what each one measures and why it matters today.',
    gradient: 'violet',
    icon: '✦',
  },
  {
    id: 'three-areas',
    title: 'Why just three areas of focus?',
    preview: 'Research shows attention fractures past three priorities. Edge keeps you honest about what actually moves the needle.',
    gradient: 'teal',
    icon: '🎯',
  },
  {
    id: 'sleep-recovery',
    title: 'The science of sleep & recovery',
    preview: 'Your recovery score isn\'t a vanity metric — it\'s a multiplier on everything else you do.',
    gradient: 'amber',
    icon: '🌙',
  },
  {
    id: 'peaks-troughs',
    title: 'Working with your peaks and troughs',
    preview: 'Everyone has a 90-minute ultradian rhythm. Edge helps you schedule to it, not against it.',
    gradient: 'slate',
    icon: '〰',
  },
];

// ── Thumbnail gradients (design-system only — no photos) ──────────────────────

const GRADIENTS: Record<ContentCard['gradient'], string> = {
  indigo: 'linear-gradient(135deg, var(--edg-accent-20) 0%, var(--edg-accent-08) 100%)',
  teal:   'linear-gradient(135deg, rgba(20,184,166,0.25) 0%, rgba(20,184,166,0.08) 100%)',
  amber:  'linear-gradient(135deg, rgba(245,158,11,0.22) 0%, rgba(245,158,11,0.07) 100%)',
  rose:   'linear-gradient(135deg, rgba(244,63,94,0.22)  0%, rgba(244,63,94,0.07)  100%)',
  violet: 'linear-gradient(135deg, rgba(139,92,246,0.25) 0%, rgba(139,92,246,0.08) 100%)',
  slate:  'linear-gradient(135deg, rgba(100,116,139,0.2) 0%, rgba(100,116,139,0.07) 100%)',
};

const ICON_COLORS: Record<ContentCard['gradient'], string> = {
  indigo: 'var(--text-accent)',
  teal:   'rgba(20,184,166,0.9)',
  amber:  'rgba(245,158,11,0.9)',
  rose:   'rgba(244,63,94,0.9)',
  violet: 'rgba(139,92,246,0.9)',
  slate:  'rgba(100,116,139,0.9)',
};

// ── Card component ─────────────────────────────────────────────────────────────

function Card({ card }: { card: ContentCard }) {
  return (
    <div
      className="flex-shrink-0 rounded-2xl overflow-hidden cursor-pointer transition-transform hover:scale-[1.02] active:scale-[0.98]"
      style={{
        width: 200,
        border: '1px solid var(--edg-hairline)',
        background: 'var(--glass-bg)',
      }}
      role="button"
      tabIndex={0}
      aria-label={card.title}
    >
      {/* Thumbnail */}
      <div
        className="flex items-center justify-center"
        style={{
          height: 96,
          background: GRADIENTS[card.gradient],
          borderBottom: '1px solid var(--edg-hairline)',
        }}
      >
        <span
          className="text-3xl select-none"
          style={{ color: ICON_COLORS[card.gradient], filter: 'drop-shadow(0 1px 3px rgba(0,0,0,0.15))' }}
          aria-hidden="true"
        >
          {card.icon}
        </span>
      </div>

      {/* Text */}
      <div className="p-3">
        <p className="text-xs font-semibold leading-snug mb-1" style={{ color: 'var(--text-strong)' }}>
          {card.title}
        </p>
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-faint)', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
          {card.preview}
        </p>
      </div>
    </div>
  );
}

// ── ContentSection ─────────────────────────────────────────────────────────────

export function ContentSection() {
  return (
    <div>
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold" style={{ color: 'var(--text-muted)' }}>
          LEARN
        </p>
      </div>

      {/* Horizontal scroll row */}
      <div
        className="flex gap-3 overflow-x-auto pb-2 no-scrollbar"
        style={{ scrollSnapType: 'x mandatory' }}
      >
        {CONTENT.map(card => (
          <div key={card.id} style={{ scrollSnapAlign: 'start' }}>
            <Card card={card} />
          </div>
        ))}
      </div>
    </div>
  );
}
