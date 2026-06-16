'use client';

import { useState, useEffect } from 'react';

// ── Types (contract with Core) ────────────────────────────────────────────────

export interface FocusRecommendationArea {
  id?: string;       // stable id for complete/dismiss (Darren populates; falls back to title)
  title: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
  anchor?: string;   // e.g. "Extend runway" — the top-3 priority this focus serves
}

export interface FocusRecommendation {
  areas: FocusRecommendationArea[];
  basedOn: string[];          // e.g. ['6 months of calendar', '14 briefing calls', 'Whoop recovery']
  generatedAt: string;        // ISO string
}

export interface FocusRecommendationCardProps {
  recommendation: FocusRecommendation | null;
  loading?: boolean;
  /** How many briefing calls the user has completed — informs empty-state copy */
  callsCompleted?: number;
  onConfirm: (areas: FocusRecommendationArea[]) => Promise<void>;
  onDismiss?: () => void;
  selfFetch?: boolean;
  /**
   * Today's already-confirmed focus areas (from /api/focus/confirm GET).
   * When set, the card skips the proposed state and renders the confirmed view directly.
   */
  confirmedAreas?: FocusRecommendationArea[];
  /**
   * Ranked pool of replacement candidates (from recommendFocusAreas).
   * When a focus area is dismissed, the next candidate slides in.
   */
  candidates?: FocusRecommendationArea[];
  /** Called when user marks a focus item done. Receives area id or title. */
  onCompleteArea?: (idOrTitle: string) => Promise<void>;
  /** Called when user dismisses a focus item. Receives area id or title. */
  onDismissArea?: (idOrTitle: string) => Promise<void>;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function confidenceColor(c: 'high' | 'medium' | 'low') {
  if (c === 'high')   return 'var(--rec-high)';
  if (c === 'medium') return 'var(--rec-medium)';
  return 'var(--rec-low)';
}

function confidenceTint(c: 'high' | 'medium' | 'low') {
  if (c === 'high')   return 'var(--rec-high-tint)';
  if (c === 'medium') return 'var(--rec-medium-tint)';
  return 'var(--rec-low-tint)';
}

function confidenceLabel(c: 'high' | 'medium' | 'low') {
  if (c === 'high')   return 'strong signal';
  if (c === 'medium') return 'good signal';
  return 'early read';
}

// ── Editable area row ─────────────────────────────────────────────────────────

function AreaRow({
  area,
  index,
  onEdit,
}: {
  area: FocusRecommendationArea;
  index: number;
  onEdit: (updated: FocusRecommendationArea) => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(area.title);

  function commitEdit() {
    const trimmed = draft.trim();
    if (trimmed && trimmed !== area.title) {
      onEdit({ ...area, title: trimmed });
    }
    setEditing(false);
  }

  const rankLabels = ['Primary', 'Secondary', 'Third'];

  return (
    <div
      className="rounded-xl p-4 transition-colors"
      style={{
        background: 'var(--rec-area-bg)',
        border: '1px solid var(--rec-area-border)',
      }}
    >
      <div className="flex items-start gap-3">
        {/* Rank badge */}
        <div
          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black mt-0.5"
          style={{ background: confidenceTint(area.confidence), color: confidenceColor(area.confidence) }}
        >
          {index + 1}
        </div>

        <div className="flex-1 min-w-0">
          {/* Title — tappable to edit */}
          {editing ? (
            <input
              autoFocus
              className="input text-sm font-semibold w-full mb-1"
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitEdit}
              onKeyDown={e => {
                if (e.key === 'Enter') commitEdit();
                if (e.key === 'Escape') { setDraft(area.title); setEditing(false); }
              }}
            />
          ) : (
            <div className="flex items-center gap-2 mb-1">
              <p className="text-sm font-semibold leading-snug" style={{ color: 'var(--text-strong)' }}>
                {area.title}
              </p>
              {/* Hidden duplicate — edit ✎ on the right handles this */}
            </div>
          )}

          {/* Rationale */}
          <p className="text-xs leading-relaxed mb-1.5" style={{ color: 'var(--text-muted)' }}>
            {area.rationale}
          </p>

          {/* Anchor tie-in */}
          {area.anchor && (
            <p className="text-xs mb-2" style={{ color: 'var(--text-faint)' }}>
              ↳ {area.anchor}
            </p>
          )}

          {/* Confidence chip + rank label */}
          <div className="flex items-center gap-2">
            <span
              className="text-xs px-2 py-0.5 rounded-full font-medium"
              style={{ background: confidenceTint(area.confidence), color: confidenceColor(area.confidence) }}
            >
              {rankLabels[index]}
            </span>
            <span className="text-xs" style={{ color: 'var(--text-faint)' }}>
              {confidenceLabel(area.confidence)}
            </span>
          </div>
        </div>

        {/* Edit button — visible on mobile tap, subtle on desktop */}
        <button
          onClick={() => { setDraft(area.title); setEditing(true); }}
          className="flex-shrink-0 text-xs px-2 py-1.5 rounded-lg transition-opacity active:opacity-70"
          style={{ background: 'var(--edg-fill-04)', color: 'var(--text-faint)', border: '1px solid var(--edg-hairline)' }}
          title="Edit this focus area"
          aria-label="Edit"
        >
          ✎
        </button>
      </div>
    </div>
  );
}

// ── Confirmed focus item row (interactive) ────────────────────────────────────

type FocusItemState = 'idle' | 'completing' | 'done' | 'dismissing' | 'replacing';

function ConfirmedFocusItem({
  area,
  rank,
  incoming,
  onComplete,
  onDismiss,
}: {
  area: FocusRecommendationArea;
  rank: number;
  incoming?: boolean;
  onComplete: () => Promise<void>;
  onDismiss: () => Promise<void>;
}) {
  const [state, setState] = useState<FocusItemState>('idle');
  const [mounted, setMounted] = useState(!incoming);

  // Slide-in entrance for replacement items
  useEffect(() => {
    if (incoming) {
      const t = setTimeout(() => setMounted(true), 30);
      return () => clearTimeout(t);
    }
  }, [incoming]);

  async function handleComplete() {
    if (state !== 'idle') return;
    setState('completing');
    await onComplete();
    setState('done');
  }

  async function handleDismiss() {
    if (state !== 'idle') return;
    setState('dismissing');
    await onDismiss();
  }

  const isDone      = state === 'done';
  const isExiting   = state === 'dismissing';
  const isCelebrate = state === 'completing' || isDone;

  return (
    <div
      style={{
        opacity:   !mounted || isExiting ? 0 : 1,
        transform: !mounted ? 'translateX(12px)' : isExiting ? 'translateX(-8px)' : 'translateX(0)',
        transition: 'opacity 0.3s ease, transform 0.3s ease',
        position: 'relative',
        overflow: 'hidden',
      }}
    >
      <div
        className="flex items-center gap-3 rounded-xl px-3 py-3 transition-all duration-300"
        style={{
          background: isDone ? 'rgba(16,185,129,0.06)' : 'var(--rec-area-bg)',
          border: `1px solid ${isDone ? 'rgba(16,185,129,0.25)' : 'var(--rec-area-border)'}`,
        }}
      >
        {/* Rank / done badge */}
        <div
          className="flex-shrink-0 w-6 h-6 rounded-full flex items-center justify-center text-xs font-black transition-all duration-300"
          style={{
            background: isDone ? 'rgba(16,185,129,0.18)' : confidenceTint(area.confidence),
            color: isDone ? 'var(--edg-success)' : confidenceColor(area.confidence),
            transform: isCelebrate ? 'scale(1.15)' : 'scale(1)',
          }}
        >
          {isDone ? '✓' : rank}
        </div>

        {/* Title + anchor */}
        <div className="flex-1 min-w-0">
          <p
            className="text-sm font-semibold leading-snug transition-all duration-300"
            style={{
              color: isDone ? 'var(--text-faint)' : 'var(--text-strong)',
              textDecoration: isDone ? 'line-through' : 'none',
            }}
          >
            {area.title}
          </p>
          {area.anchor && !isDone && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-faint)' }}>
              ↳ {area.anchor}
            </p>
          )}
          {isDone && (
            <p className="text-xs mt-0.5" style={{ color: 'var(--edg-success)', animation: 'score-rise 0.3s ease both' }}>
              Done — nice work.
            </p>
          )}
        </div>

        {/* Actions */}
        {state === 'idle' && (
          <div className="flex items-center gap-1.5 flex-shrink-0">
            <button
              onClick={handleComplete}
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs font-bold transition-all active:scale-90"
              style={{
                background: 'rgba(16,185,129,0.1)',
                border: '1px solid rgba(16,185,129,0.25)',
                color: 'var(--edg-success)',
              }}
              title="Mark done"
              aria-label="Complete"
            >
              ✓
            </button>
            <button
              onClick={handleDismiss}
              className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-xs transition-opacity hover:opacity-80 active:scale-90"
              style={{
                background: 'var(--edg-fill-04)',
                border: '1px solid var(--edg-hairline)',
                color: 'var(--text-faint)',
              }}
              title="Remove and replace"
              aria-label="Dismiss"
            >
              ✕
            </button>
          </div>
        )}
        {state === 'completing' && (
          <span className="text-xs flex-shrink-0" style={{ color: 'var(--edg-success)' }}>…</span>
        )}
        {isDone && (
          <span
            className="text-xl flex-shrink-0"
            style={{ animation: 'pop-in 0.4s ease both' }}
          >
            🎉
          </span>
        )}
      </div>
    </div>
  );
}

// ── Confirmed focus panel (manages active list + replacements) ────────────────

function ConfirmedFocusPanel({
  initialAreas,
  candidates,
  onCompleteArea,
  onDismissArea,
}: {
  initialAreas: FocusRecommendationArea[];
  candidates: FocusRecommendationArea[];
  onCompleteArea?: (idOrTitle: string) => Promise<void>;
  onDismissArea?: (idOrTitle: string) => Promise<void>;
}) {
  // Each slot tracks which area is showing + whether it's an incoming replacement
  const [slots, setSlots] = useState<{ area: FocusRecommendationArea; incoming: boolean }[]>(
    initialAreas.map(a => ({ area: a, incoming: false }))
  );
  // Pool of candidates not yet used
  const [pool, setPool] = useState<FocusRecommendationArea[]>(
    candidates.filter(c => !initialAreas.some(a => (a.id || a.title) === (c.id || c.title)))
  );

  async function handleComplete(idx: number) {
    const area = slots[idx].area;
    if (onCompleteArea) await onCompleteArea(area.id || area.title);
    // Keep the row visible in done state — handled by ConfirmedFocusItem
  }

  async function handleDismiss(idx: number) {
    const area = slots[idx].area;
    if (onDismissArea) await onDismissArea(area.id || area.title);

    // After exit animation, slot in replacement if available
    setTimeout(() => {
      if (pool.length > 0) {
        const [next, ...rest] = pool;
        setPool(rest);
        setSlots(prev => prev.map((s, i) => i === idx ? { area: next, incoming: true } : s));
      } else {
        setSlots(prev => prev.filter((_, i) => i !== idx));
      }
    }, 350);
  }

  const rankLabels = ['Primary', 'Secondary', 'Third'];

  return (
    <div
      className="glass-card p-5"
      style={{ background: 'var(--rec-card-bg)', borderColor: 'var(--rec-card-border)', animation: 'score-rise 0.4s ease both' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-accent)' }}>
            ✦ TODAY&apos;S FOCUS
          </p>
          <h3 className="text-sm font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
            You&apos;re focused on these today.
          </h3>
        </div>
        <span
          className="flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center text-sm font-bold"
          style={{
            background: 'var(--edg-accent-08)',
            border: '1px solid var(--edg-accent-20)',
            boxShadow: 'var(--shadow-btn-glow)',
            color: 'var(--text-accent)',
            animation: 'pop-in 0.45s ease both',
          }}
        >
          ✓
        </span>
      </div>

      {/* Active focus items */}
      <div className="space-y-2 mb-4">
        {slots.map((slot, i) => (
          <ConfirmedFocusItem
            key={`${slot.area.id || slot.area.title}-${i}`}
            area={slot.area}
            rank={i + 1}
            incoming={slot.incoming}
            onComplete={() => handleComplete(i)}
            onDismiss={() => handleDismiss(i)}
          />
        ))}
        {slots.length === 0 && (
          <div className="text-center py-4">
            <p className="text-sm font-semibold mb-1" style={{ color: 'var(--text-strong)' }}>All done for today. 🎉</p>
            <p className="text-xs" style={{ color: 'var(--text-faint)' }}>Edge will have fresh focus areas tomorrow.</p>
          </div>
        )}
      </div>

      {/* Hint */}
      <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
        ✓ marks it done · ✕ swaps it for something else · Edge scores your calendar against these.
      </p>
    </div>
  );
}

// ── FocusRecommendationCard ───────────────────────────────────────────────────

export function FocusRecommendationCard({
  recommendation: recommendationProp,
  loading: loadingProp = false,
  callsCompleted = 0,
  onConfirm,
  onDismiss,
  selfFetch = false,
  confirmedAreas: confirmedAreasProp,
  candidates = [],
  onCompleteArea,
  onDismissArea,
}: FocusRecommendationCardProps) {
  // selfFetch mode: card owns its own data fetch
  const [fetchedRec, setFetchedRec] = useState<FocusRecommendation | null>(null);
  const [fetchLoading, setFetchLoading] = useState(false);

  useEffect(() => {
    if (!selfFetch) return;
    setFetchLoading(true);
    fetch('/api/focus/recommend')
      .then(r => r.ok ? r.json() : null)
      .then((data: FocusRecommendation | null) => { if (data?.areas) setFetchedRec(data); })
      .catch(() => {})
      .finally(() => setFetchLoading(false));
  }, [selfFetch]);

  const recommendation = selfFetch ? fetchedRec : recommendationProp;
  const loading        = selfFetch ? fetchLoading : loadingProp;

  const [areas, setAreas] = useState<FocusRecommendationArea[]>(
    recommendation?.areas ?? []
  );
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // Sync if recommendation changes (e.g. selfFetch data arrives)
  const [lastRec, setLastRec] = useState(recommendation);
  if (recommendation !== lastRec) {
    setLastRec(recommendation);
    if (recommendation) setAreas(recommendation.areas);
  }

  async function handleConfirm() {
    setConfirming(true);
    await onConfirm(areas);
    setConfirming(false);
    setConfirmed(true);
  }

  const thinData = recommendation && recommendation.areas.some(a => a.confidence === 'low');
  const allLow   = recommendation && recommendation.areas.every(a => a.confidence === 'low');

  // ── Loading skeleton
  if (loading) {
    return (
      <div
        className="glass-card p-5"
        style={{ background: 'var(--rec-card-bg)', borderColor: 'var(--rec-card-border)' }}
      >
        <div className="flex items-center gap-2 mb-4">
          <span className="w-4 h-4 border-2 border-indigo-400 border-t-transparent rounded-full animate-spin inline-block" />
          <span className="text-sm font-semibold" style={{ color: 'var(--text-muted)' }}>
            Edge is reading your data…
          </span>
        </div>
        <div className="space-y-3">
          {[1, 2, 3].map(i => (
            <div key={i} className="h-16 rounded-xl animate-pulse" style={{ background: 'var(--rec-area-bg)' }} />
          ))}
        </div>
      </div>
    );
  }

  // ── No recommendation yet
  if (!recommendation) {
    const hasStarted = callsCompleted > 0;
    return (
      <div
        className="glass-card p-5"
        style={{ background: 'var(--rec-card-bg)', borderColor: 'var(--rec-card-border)' }}
      >
        <div className="flex items-start gap-3">
          <span
            className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-base"
            style={{ background: 'var(--edg-accent-08)', border: '1px solid var(--edg-accent-20)' }}
          >
            ✦
          </span>
          <div>
            <p className="text-sm font-bold mb-1" style={{ color: 'var(--text-strong)' }}>
              {hasStarted ? 'Building your focus picture' : 'Your daily focus read'}
            </p>
            <p className="text-xs leading-relaxed" style={{ color: 'var(--text-muted)' }}>
              {hasStarted
                ? `Edge is learning from your ${callsCompleted} call${callsCompleted !== 1 ? 's' : ''} so far — a full recommendation appears after a few more briefings.`
                : 'After your first morning briefing, Edge will tell you exactly what to focus on today — based on your calendar, goals, and energy.'}
            </p>
            {hasStarted && (
              <div className="flex gap-1 mt-2">
                {Array.from({ length: 5 }).map((_, i) => (
                  <div
                    key={i}
                    className="h-1 flex-1 rounded-full"
                    style={{
                      background: i < callsCompleted ? 'var(--edg-indigo)' : 'var(--edg-hairline)',
                      opacity: i < callsCompleted ? 1 : 0.4,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    );
  }

  // ── Confirmed state (internal confirm OR parent-passed confirmedAreas from reload)
  const initialConfirmed = confirmedAreasProp && confirmedAreasProp.length > 0
    ? confirmedAreasProp
    : (confirmed ? areas : null);

  if (initialConfirmed) {
    return (
      <ConfirmedFocusPanel
        initialAreas={initialConfirmed}
        candidates={candidates}
        onCompleteArea={onCompleteArea}
        onDismissArea={onDismissArea}
      />
    );
  }

  return (
    <div
      className="glass-card p-5"
      style={{
        background: 'var(--rec-card-bg)',
        borderColor: 'var(--rec-card-border)',
        animation: 'score-rise 0.5s 0.1s ease both',
      }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-accent)' }}>
            ✦ TODAY&apos;S FOCUS
          </p>
          <h3 className="text-sm font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
            {allLow
              ? "Early read — I'm still learning you"
              : "Here's what I'd focus you on today"}
          </h3>
          {allLow ? (
            <p className="text-xs mt-1 leading-relaxed" style={{ color: 'var(--text-faint)' }}>
              These are my best guesses from what I know so far. Confirm them as-is or tweak any that feel off — that feedback sharpens my read.
            </p>
          ) : thinData ? (
            <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>
              A few areas are still early reads — more calls will sharpen them.
            </p>
          ) : null}
        </div>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="flex-shrink-0 text-xs"
            style={{ color: 'var(--text-faint)' }}
            title="Dismiss"
          >
            ✕
          </button>
        )}
      </div>

      {/* Based-on provenance */}
      {recommendation.basedOn.length > 0 && (
        <p className="text-xs mb-4" style={{ color: 'var(--text-faint)' }}>
          Based on: {recommendation.basedOn.join(' · ')}
        </p>
      )}

      {/* Area cards */}
      <div className="space-y-2 mb-5 group">
        {areas.map((area, i) => (
          <AreaRow
            key={i}
            area={area}
            index={i}
            onEdit={updated => setAreas(prev => prev.map((a, j) => j === i ? updated : a))}
          />
        ))}
      </div>

      {/* CTA */}
      <div className="flex items-center gap-3">
        <button
          onClick={handleConfirm}
          disabled={confirming}
          className="btn-primary flex-1 text-sm py-2.5"
          style={{ boxShadow: confirming ? 'none' : 'var(--rec-confirm-glow)' }}
        >
          {confirming ? 'Setting focus…' : '✓ Focus on these today'}
        </button>
        {onDismiss && (
          <button
            onClick={onDismiss}
            className="btn-secondary text-sm py-2.5 px-4 flex-shrink-0"
          >
            Not now
          </button>
        )}
      </div>

      <p className="text-xs text-center mt-3" style={{ color: 'var(--text-faint)' }}>
        Edge re-reads your data each morning. You can always adjust in the Priorities tab.
      </p>
    </div>
  );
}
