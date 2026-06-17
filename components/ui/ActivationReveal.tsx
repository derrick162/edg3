'use client';

import { useEffect, useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface DerivedPriority {
  text: string;
  rationale: string;
  evidenceTags: string[];
}

export interface DerivedProposal {
  priorities: DerivedPriority[];
  summaryLine: string;
  dataSnapshot?: {
    calendarEventCount: number;
    calendarDaysSpanned: number;
    emailThreadCount: number;
    factsCount: number;
    openLoopsCount: number;
  };
}

// ── Loading messages (Esther's copy, Screen 2) ────────────────────────────────

const SCAN_MESSAGES = [
  'Reading the last few months of your calendar…',
  'Looking for what you keep coming back to…',
  "Identifying what's getting your time — and what isn't.",
];

// ── ActivationLoading ─────────────────────────────────────────────────────────

export function ActivationLoading() {
  const [msgIdx, setMsgIdx] = useState(0);
  const [visible, setVisible] = useState(true);

  useEffect(() => {
    if (msgIdx >= SCAN_MESSAGES.length - 1) return;
    const t = setTimeout(() => {
      setVisible(false);
      setTimeout(() => {
        setMsgIdx(i => Math.min(i + 1, SCAN_MESSAGES.length - 1));
        setVisible(true);
      }, 250);
    }, 2500);
    return () => clearTimeout(t);
  }, [msgIdx]);

  return (
    <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
      {/* Shimmer ring — pulse, not spinner */}
      <div className="relative mb-8">
        <div
          className="w-20 h-20 rounded-full flex items-center justify-center"
          style={{
            background: 'var(--edg-accent-08)',
            border: '1.5px solid var(--edg-accent-20)',
            animation: 'pulse 2s ease-in-out infinite',
          }}
        >
          <span className="text-2xl" style={{ color: 'var(--text-accent)' }}>✦</span>
        </div>
        <div
          className="absolute rounded-full"
          style={{
            inset: '-8px',
            border: '1px solid var(--edg-accent-08)',
            animation: 'pulse 2s ease-in-out infinite 0.5s',
          }}
        />
      </div>

      <h2 className="text-xl font-bold mb-3" style={{ color: 'var(--text-strong)' }}>
        Edge is learning about you.
      </h2>

      {/* Rotating subtext — swap ~2.5s, end on last line before reveal */}
      <p
        className="text-sm leading-relaxed"
        style={{
          color: 'var(--text-accent)',
          opacity: visible ? 1 : 0,
          transition: 'opacity 0.25s ease',
          minHeight: '2.5em',
          maxWidth: '280px',
        }}
      >
        {SCAN_MESSAGES[msgIdx]}
      </p>
    </div>
  );
}

// ── ThinDataFallback (Screen 3b) ──────────────────────────────────────────────

export function ThinDataFallback({
  onSubmit,
}: {
  onSubmit: (q1: string, q2: string) => void;
}) {
  const [q1, setQ1] = useState('');
  const [q2, setQ2] = useState('');

  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-xl font-bold mb-2" style={{ color: 'var(--text-strong)' }}>
          Your calendar is pretty clear.
        </h2>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          Edge doesn&apos;t have enough calendar history yet to know what drives your week — but
          that changes fast. Answer two quick questions and Edge will have everything it needs to
          start.
        </p>
      </div>

      <div className="space-y-4">
        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-body)' }}>
            What&apos;s the most important thing you&apos;re trying to make progress on right now?
          </label>
          <textarea
            className="input"
            style={{ minHeight: 80, fontSize: 14 }}
            placeholder="Growing the business, getting healthier, a specific project…"
            value={q1}
            onChange={e => setQ1(e.target.value)}
          />
        </div>

        <div>
          <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-body)' }}>
            Is there anything you&apos;re trying to protect time for — something that keeps getting
            squeezed out?
          </label>
          <textarea
            className="input"
            style={{ minHeight: 80, fontSize: 14 }}
            placeholder="Deep focus, exercise, time with family…"
            value={q2}
            onChange={e => setQ2(e.target.value)}
          />
        </div>
      </div>

      <button
        className="btn-primary w-full"
        onClick={() => onSubmit(q1, q2)}
        disabled={!q1.trim()}
      >
        That&apos;s it. Let&apos;s go →
      </button>
    </div>
  );
}

// ── RevealItem ────────────────────────────────────────────────────────────────

function RevealItem({
  priority,
  rank,
  delay,
}: {
  priority: DerivedPriority;
  rank: number;
  delay: number;
}) {
  const [entered, setEntered] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setEntered(true), delay);
    return () => clearTimeout(t);
  }, [delay]);

  const isTop = rank === 1;

  return (
    <div
      style={{
        opacity: entered ? 1 : 0,
        transform: entered ? 'translateY(0)' : 'translateY(10px)',
        transition: 'opacity 0.35s ease, transform 0.35s ease',
      }}
    >
      <div
        className="rounded-xl p-4"
        style={{
          background: isTop ? 'var(--edg-accent-08)' : 'var(--edg-fill-04)',
          border: `1px solid ${isTop ? 'var(--edg-accent-20)' : 'var(--edg-hairline)'}`,
        }}
      >
        <div className="flex items-start gap-3">
          <div
            className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold mt-0.5"
            style={{
              background: isTop ? 'var(--edg-indigo)' : 'var(--edg-accent-15)',
              color: isTop ? '#fff' : 'var(--text-accent)',
            }}
          >
            {rank}
          </div>
          <div className="flex-1 min-w-0">
            {/* Priority label — large */}
            <p className="text-sm font-semibold leading-snug mb-1" style={{ color: 'var(--text-strong)' }}>
              {priority.text}
            </p>
            {/* Evidence line — muted, small */}
            <p className="text-xs leading-relaxed mb-1.5" style={{ color: 'var(--text-muted)' }}>
              {priority.rationale}
            </p>
            {/* Category / evidence tags as optional badges */}
            {priority.evidenceTags.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {priority.evidenceTags.slice(0, 3).map((tag, i) => (
                  <span
                    key={i}
                    className="text-xs rounded-full px-2 py-0.5"
                    style={{
                      background: 'var(--edg-accent-08)',
                      border: '1px solid var(--edg-accent-15)',
                      color: 'var(--text-faint)',
                    }}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ActivationReveal ──────────────────────────────────────────────────────────

export function ActivationReveal({
  proposal,
  onAccept,
  onTweak,
  accepting,
}: {
  proposal: DerivedProposal;
  onAccept: () => void;
  onTweak: () => void;
  accepting: boolean;
}) {
  const [headerIn, setHeaderIn] = useState(false);
  const [footerIn, setFooterIn] = useState(false);

  const STAGGER_MS = 200;
  const itemDelay = (i: number) => 120 + i * STAGGER_MS;
  const lastDelay = itemDelay(proposal.priorities.length - 1) + 350;

  useEffect(() => {
    const t1 = setTimeout(() => setHeaderIn(true), 40);
    const t2 = setTimeout(() => setFooterIn(true), lastDelay + 100);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [lastDelay]);

  // Months of history from dataSnapshot
  const months = proposal.dataSnapshot?.calendarDaysSpanned
    ? Math.max(1, Math.round(proposal.dataSnapshot.calendarDaysSpanned / 30))
    : null;

  return (
    <div className="space-y-4">
      {/* Header (Screen 3 copy) */}
      <div
        style={{
          opacity: headerIn ? 1 : 0,
          transform: headerIn ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.35s ease, transform 0.35s ease',
        }}
      >
        <div className="flex items-center gap-2 mb-2">
          <span style={{ color: 'var(--text-accent)', fontSize: 13 }}>✦</span>
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-accent)', letterSpacing: '0.08em' }}
          >
            Edge&apos;s read
          </span>
        </div>
        <h2 className="text-xl font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
          Here&apos;s what I already know about you.
        </h2>
        {months && (
          <p className="text-sm mt-1" style={{ color: 'var(--text-faint)' }}>
            From your last {months} {months === 1 ? 'month' : 'months'} of calendar history.
          </p>
        )}
      </div>

      {/* Priority cards — staggered reveal */}
      <div className="space-y-2.5">
        {proposal.priorities.map((p, i) => (
          <RevealItem key={i} priority={p} rank={i + 1} delay={itemDelay(i)} />
        ))}
      </div>

      {/* Footer + CTAs */}
      <div
        className="space-y-3"
        style={{
          opacity: footerIn ? 1 : 0,
          transform: footerIn ? 'translateY(0)' : 'translateY(8px)',
          transition: 'opacity 0.35s ease, transform 0.35s ease',
        }}
      >
        <p className="text-xs leading-relaxed" style={{ color: 'var(--text-faint)' }}>
          These are based on your calendar, not a questionnaire. Edge will use them to frame every
          morning call and score your week.
        </p>

        {/* Primary — "These look right →" (dominant) */}
        <button
          className="btn-primary w-full"
          onClick={onAccept}
          disabled={accepting}
        >
          {accepting ? 'Saving…' : 'These look right →'}
        </button>

        {/* Secondary — smaller, lower visual weight */}
        <button
          className="w-full text-sm py-2 text-center transition-opacity hover:opacity-80"
          style={{ color: 'var(--text-muted)' }}
          onClick={onTweak}
        >
          Let me adjust →
        </button>
      </div>
    </div>
  );
}
