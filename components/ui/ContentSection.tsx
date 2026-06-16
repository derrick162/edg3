'use client';

import { useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ContentCard {
  id: string;
  title: string;
  preview: string;
  body: string;
  gradient: 'indigo' | 'teal' | 'amber' | 'rose' | 'violet' | 'slate';
  icon: string;
}

// ── Real editorial content (v1 — Esther) ─────────────────────────────────────

const CONTENT: ContentCard[] = [
  {
    id: 'calendar-energy',
    title: 'Manage your calendar by your energy',
    preview: 'Your calendar shouldn\'t just tell you what to do — it should tell you when to do it.',
    gradient: 'indigo',
    icon: '⚡',
    body: `Most people schedule by availability. If there's a free slot, the task goes there. But not all hours are created equal.

Your energy has a rhythm. There are windows in the day when you're sharp, creative, and capable of your best thinking — and windows when you're better off on autopilot. Ignoring that rhythm doesn't make you more productive. It just means you're grinding through your hardest work at your lowest capacity.

Edge learns your energy pattern — when you peak, when you dip, when you need to protect your focus — and organizes your calendar around it. High-energy tasks in high-energy windows. Admin and routine work in the dips. Recovery protected, not squeezed out.

The result isn't just a better calendar. It's a day that actually feels manageable.`,
  },
  {
    id: 'burnout',
    title: 'What burnout really is — and how Edge protects you',
    preview: 'Burnout doesn\'t happen overnight. It accumulates — and it\'s preventable.',
    gradient: 'rose',
    icon: '🛡',
    body: `Burnout isn't a dramatic collapse. It's a slow drain. It happens when you consistently spend more energy than you recover — when every week is a little more output, a little less rest, a little more reactive, a little less intentional.

High performers are especially vulnerable because the early warning signs feel like success. Busy = productive. Tired = hard-working. Full calendar = in demand.

Edge is designed to catch the pattern before it catches you. When your Energy score dips for several days running, Edge notices. When your calendar is packed with high-demand work on a low-recovery day, Edge says something. When you haven't touched a focus area in a week, Edge surfaces it.

Think of it as a chief of staff who pays attention to your energy the way a good coach pays attention to your training load — always asking: is this sustainable?`,
  },
  {
    id: 'edge-score',
    title: 'Your Edge Score, explained',
    preview: 'One number. Four things that determine how ready you are to do your best work.',
    gradient: 'violet',
    icon: '✦',
    body: `Your Edge Score is a daily readout of how set up you are to perform — not how busy you are, but how well-positioned you are. It's made up of four components:

**Focus (30%)** — Does your calendar reflect your top three priorities? A high Focus score means the things that matter most have protected time. A low score means your calendar is full of everything except the work that moves the needle.

**Energy (30%)** — How's your capacity today? Informed by your Whoop data (sleep + recovery) or your self-reported check-in. Edge uses this to know whether to push or protect.

**Clarity (20%)** — How well does Edge know you? The more you share — your focus areas, energy profile, connected tools — the smarter Edge gets. Clarity grows as Edge learns.

**Momentum (20%)** — Are you showing up consistently? Daily calls completed, focus confirmed, plans followed through. Momentum is the compounding edge. Small, consistent actions build the score — and the results.

The goal isn't a perfect 100. It's a score that's honest, improving, and working for you.`,
  },
  {
    id: 'three-areas',
    title: 'Why just three areas of focus?',
    preview: 'The cost of too many priorities is that nothing gets prioritized.',
    gradient: 'teal',
    icon: '🎯',
    body: `When everything is important, nothing is. It sounds like a cliché because it's true — and most high performers have felt it.

The problem with a long list of priorities is that it doesn't force a decision. It just postpones one. You end up spreading attention across eight things and making meaningful progress on none of them.

Three focus areas is the constraint that makes the decision real. Which three things, if you moved them forward this week, would matter most? Not which ten things are important — which three deserve your calendar.

Edge is built around this constraint deliberately. The Focus score, the morning briefing, the calendar reshaping — all of it is organized around your three areas. Not because three is a magic number, but because limits create clarity. And clarity is what lets you actually execute.

Change them whenever you need to. But pick three.`,
  },
  {
    id: 'sleep-recovery',
    title: 'The science of sleep & recovery',
    preview: 'Sleep isn\'t rest. It\'s the work your body does so you can do the work you want to.',
    gradient: 'amber',
    icon: '🌙',
    body: `Recovery isn't passive. While you sleep, your brain consolidates memory, clears metabolic waste, regulates mood, and repairs tissue. Whoop measures this process directly — your recovery score reflects how well that work actually got done.

A high recovery score means your body is ready. A low one means it's still catching up — and pushing hard into a low-recovery day costs more than it produces.

Edge uses your recovery data to adapt your day. On green days, it protects your peak windows for your hardest focus work. On red days, it suggests lighter loads and reminds you that protecting today's recovery is an investment in tomorrow's output.

This is what separates sustainable performance from the cycle most high performers know too well: push hard, crash, recover, push again. Edge tries to flatten that curve — not by doing less, but by doing the right things at the right time.`,
  },
  {
    id: 'peaks-troughs',
    title: 'Working with your peaks and troughs',
    preview: 'You already have a rhythm. Edge just helps you use it.',
    gradient: 'slate',
    icon: '〰',
    body: `Most people have a natural performance curve across the day — a window of peak alertness and creative capacity, usually in the morning or early afternoon, followed by a dip, and sometimes a secondary lift later in the day.

Research on circadian rhythms and cognitive performance consistently shows the same thing: the work you do in your peak window is qualitatively different from the same work done in a trough. Your best thinking doesn't happen on demand — it happens when your biology is ready for it.

The practical implication is simple: protect your peak for your hardest, most important work. Use your trough for email, admin, low-stakes decisions, routine tasks. Don't schedule a critical creative session at 3pm if 3pm is when you hit a wall.

Tell Edge your peak and trough windows — or let it learn from your patterns — and it will organize your calendar around them automatically. Your peak hours become a protected resource, not just another time slot.`,
  },
];

// ── Thumbnail gradients (design-system — no photos) ───────────────────────────

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

// ── Simple bold-aware paragraph renderer ──────────────────────────────────────

function ArticleBody({ text }: { text: string }) {
  return (
    <div className="space-y-4">
      {text.split('\n\n').map((para, i) => {
        // Render **bold** inline
        const parts = para.split(/(\*\*[^*]+\*\*)/g);
        return (
          <p key={i} className="text-sm leading-relaxed" style={{ color: 'var(--text-body)' }}>
            {parts.map((part, j) =>
              part.startsWith('**') && part.endsWith('**')
                ? <strong key={j} style={{ color: 'var(--text-strong)' }}>{part.slice(2, -2)}</strong>
                : part
            )}
          </p>
        );
      })}
    </div>
  );
}

// ── Article reader modal ──────────────────────────────────────────────────────

function ArticleModal({ card, onClose }: { card: ContentCard; onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4"
      style={{ background: 'var(--edg-overlay-dark)', backdropFilter: 'blur(4px)' }}
      onClick={e => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div
        className="w-full sm:max-w-lg rounded-t-2xl sm:rounded-2xl overflow-hidden flex flex-col"
        style={{
          background: 'var(--glass-bg)',
          border: '1px solid var(--edg-hairline)',
          maxHeight: '85vh',
          animation: 'score-rise 0.25s ease both',
        }}
      >
        {/* Thumbnail strip */}
        <div
          className="flex-shrink-0 flex items-center gap-3 px-5 py-4"
          style={{ background: GRADIENTS[card.gradient], borderBottom: '1px solid var(--edg-hairline)' }}
        >
          <span className="text-2xl" style={{ color: ICON_COLORS[card.gradient] }} aria-hidden="true">
            {card.icon}
          </span>
          <h2 className="text-sm font-bold leading-snug flex-1" style={{ color: 'var(--text-strong)' }}>
            {card.title}
          </h2>
          <button
            onClick={onClose}
            className="flex-shrink-0 text-xs px-2 py-1 rounded-lg"
            style={{ color: 'var(--text-faint)', background: 'rgba(0,0,0,0.12)' }}
            aria-label="Close"
          >
            ✕
          </button>
        </div>

        {/* Scrollable body */}
        <div className="overflow-y-auto px-5 py-5 flex-1">
          <p className="text-xs mb-4 italic" style={{ color: 'var(--text-faint)' }}>
            {card.preview}
          </p>
          <ArticleBody text={card.body} />
        </div>
      </div>
    </div>
  );
}

// ── Card tile ─────────────────────────────────────────────────────────────────

function CardTile({ card, onTap }: { card: ContentCard; onTap: () => void }) {
  return (
    <button
      onClick={onTap}
      className="flex-shrink-0 rounded-2xl overflow-hidden text-left transition-transform hover:scale-[1.02] active:scale-[0.98] focus:outline-none focus-visible:ring-2"
      style={{
        width: 196,
        border: '1px solid var(--edg-hairline)',
        background: 'var(--glass-bg)',
      }}
      aria-label={card.title}
    >
      {/* Thumbnail */}
      <div
        className="flex items-center justify-center"
        style={{
          height: 92,
          background: GRADIENTS[card.gradient],
          borderBottom: '1px solid var(--edg-hairline)',
        }}
      >
        <span
          className="text-3xl select-none"
          style={{ color: ICON_COLORS[card.gradient], filter: 'drop-shadow(0 1px 4px rgba(0,0,0,0.12))' }}
          aria-hidden="true"
        >
          {card.icon}
        </span>
      </div>

      {/* Text */}
      <div className="p-3">
        <p className="text-xs font-semibold leading-snug mb-1.5" style={{ color: 'var(--text-strong)' }}>
          {card.title}
        </p>
        <p
          className="text-xs leading-relaxed"
          style={{
            color: 'var(--text-faint)',
            display: '-webkit-box',
            WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical',
            overflow: 'hidden',
          }}
        >
          {card.preview}
        </p>
      </div>
    </button>
  );
}

// ── ContentSection ─────────────────────────────────────────────────────────────

export function ContentSection() {
  const [open, setOpen] = useState<ContentCard | null>(null);

  return (
    <>
      <div>
        <div
          className="flex gap-3 overflow-x-auto pb-2 no-scrollbar"
          style={{ scrollSnapType: 'x mandatory' }}
        >
          {CONTENT.map(card => (
            <div key={card.id} style={{ scrollSnapAlign: 'start' }}>
              <CardTile card={card} onTap={() => setOpen(card)} />
            </div>
          ))}
        </div>
      </div>

      {open && <ArticleModal card={open} onClose={() => setOpen(null)} />}
    </>
  );
}
