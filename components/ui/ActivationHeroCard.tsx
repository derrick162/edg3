'use client';

import { useState } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface HeroSuggestion {
  action: string;          // e.g. "Move your 3pm sync to tomorrow — frees a 2h focus block"
  rationale: string;       // one-line why
  timeGained?: string;     // e.g. "2h freed today"
}

// ── ActivationHeroCard ────────────────────────────────────────────────────────

export function ActivationHeroCard({
  suggestion,
  edgeScore,
  onApply,
  onSkip,
  applying,
  applied,
}: {
  suggestion: HeroSuggestion;
  edgeScore?: number | null;
  onApply: () => void;
  onSkip: () => void;
  applying: boolean;
  applied: boolean;
}) {
  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span style={{ color: 'var(--text-accent)', fontSize: 13 }}>✦</span>
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--text-accent)', letterSpacing: '0.08em' }}
          >
            First move
          </span>
        </div>
        <h2 className="text-xl font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
          Here&apos;s what I&apos;d change today
        </h2>
      </div>

      {/* Suggestion card */}
      <div
        className="rounded-xl p-5"
        style={{
          background: 'var(--edg-accent-08)',
          border: '1px solid var(--edg-accent-20)',
          boxShadow: '0 0 32px var(--edg-accent-08)',
        }}
      >
        <p className="text-base font-semibold leading-snug mb-2" style={{ color: 'var(--text-strong)' }}>
          {suggestion.action}
        </p>
        <p className="text-sm leading-relaxed" style={{ color: 'var(--text-muted)' }}>
          {suggestion.rationale}
        </p>
        {suggestion.timeGained && (
          <div
            className="mt-3 inline-flex items-center gap-1.5 text-xs rounded-full px-2.5 py-1"
            style={{
              background: 'var(--edg-success-tint)',
              border: '1px solid var(--edg-success-border)',
              color: 'var(--edg-success)',
            }}
          >
            ↑ {suggestion.timeGained}
          </div>
        )}
      </div>

      {/* Edge Score reveal (after apply) */}
      {applied && edgeScore != null && (
        <div
          className="rounded-xl p-4 flex items-center gap-4"
          style={{
            background: 'var(--edg-fill-04)',
            border: '1px solid var(--edg-hairline)',
            animation: 'score-rise 0.5s ease both',
          }}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
            style={{
              background: 'var(--edg-accent-15)',
              border: '2px solid var(--edg-accent-25)',
              color: 'var(--text-strong)',
            }}
          >
            {edgeScore}
          </div>
          <div>
            <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-accent)' }}>
              Edge Score
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              How well today&apos;s calendar aligns with your priorities. You&apos;ll see this every morning.
            </p>
          </div>
        </div>
      )}

      {/* CTAs */}
      <div className="flex flex-col gap-2">
        {!applied ? (
          <>
            <button
              className="btn-primary w-full"
              onClick={onApply}
              disabled={applying}
            >
              {applying ? 'Making it happen…' : 'Make it happen'}
            </button>
            <button
              className="w-full text-sm py-2.5 text-center transition-opacity hover:opacity-80"
              style={{ color: 'var(--text-faint)' }}
              onClick={onSkip}
            >
              Skip — go to my dashboard
            </button>
          </>
        ) : (
          <button className="btn-primary w-full" onClick={onSkip}>
            Go to my dashboard →
          </button>
        )}
      </div>
    </div>
  );
}

// ── ActivationHeroAligned ─────────────────────────────────────────────────────
// Shown when today's calendar is already well-aligned — positive state.

export function ActivationHeroAligned({
  edgeScore,
  onContinue,
}: {
  edgeScore?: number | null;
  onContinue: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <div className="flex items-center gap-2 mb-1">
          <span style={{ color: 'var(--edg-success)', fontSize: 13 }}>✓</span>
          <span
            className="text-xs font-semibold uppercase tracking-wider"
            style={{ color: 'var(--edg-success)', letterSpacing: '0.08em' }}
          >
            Already aligned
          </span>
        </div>
        <h2 className="text-xl font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
          Today looks solid
        </h2>
        <p className="text-sm mt-1" style={{ color: 'var(--text-muted)' }}>
          Your schedule already reflects what matters. Edge will look for opportunities each morning.
        </p>
      </div>

      {edgeScore != null && (
        <div
          className="rounded-xl p-4 flex items-center gap-4"
          style={{
            background: 'var(--edg-fill-04)',
            border: '1px solid var(--edg-hairline)',
            animation: 'score-rise 0.5s ease both',
          }}
        >
          <div
            className="w-14 h-14 rounded-full flex items-center justify-center text-xl font-bold flex-shrink-0"
            style={{
              background: 'var(--edg-accent-15)',
              border: '2px solid var(--edg-accent-25)',
              color: 'var(--text-strong)',
            }}
          >
            {edgeScore}
          </div>
          <div>
            <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-accent)' }}>
              Edge Score
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              How well today&apos;s calendar aligns with your priorities.
            </p>
          </div>
        </div>
      )}

      <button className="btn-primary w-full" onClick={onContinue}>
        Go to my dashboard →
      </button>
    </div>
  );
}
