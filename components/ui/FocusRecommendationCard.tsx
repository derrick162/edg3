'use client';

import { useState } from 'react';

// ── Types (contract with Core) ────────────────────────────────────────────────

export interface FocusRecommendationArea {
  title: string;
  rationale: string;
  confidence: 'high' | 'medium' | 'low';
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
              <button
                onClick={() => { setDraft(area.title); setEditing(true); }}
                className="text-xs opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0"
                style={{ color: 'var(--text-faint)' }}
                title="Edit"
              >
                ✎
              </button>
            </div>
          )}

          {/* Rationale */}
          <p className="text-xs leading-relaxed mb-2" style={{ color: 'var(--text-muted)' }}>
            {area.rationale}
          </p>

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

        {/* Tap-to-edit shortcut (desktop) */}
        <button
          onClick={() => { setDraft(area.title); setEditing(true); }}
          className="flex-shrink-0 text-xs px-2 py-1 rounded-lg opacity-60 hover:opacity-100 transition-opacity"
          style={{ background: 'var(--edg-fill-04)', color: 'var(--text-faint)', border: '1px solid var(--edg-hairline)' }}
          title="Tweak this area"
        >
          tweak
        </button>
      </div>
    </div>
  );
}

// ── FocusRecommendationCard ───────────────────────────────────────────────────

export function FocusRecommendationCard({
  recommendation,
  loading = false,
  callsCompleted = 0,
  onConfirm,
  onDismiss,
}: FocusRecommendationCardProps) {
  const [areas, setAreas] = useState<FocusRecommendationArea[]>(
    recommendation?.areas ?? []
  );
  const [confirming, setConfirming] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  // Sync if recommendation prop changes (e.g. data loads after mount)
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

  // ── Confirmed state
  if (confirmed) {
    return (
      <div
        className="glass-card p-5"
        style={{
          background: 'var(--rec-card-bg)',
          borderColor: 'var(--rec-card-border)',
          animation: 'score-rise 0.4s ease both',
        }}
      >
        <div className="flex items-center gap-3 mb-3">
          <span
            className="flex-shrink-0 w-9 h-9 rounded-full flex items-center justify-center text-base"
            style={{
              background: 'var(--edg-accent-08)',
              border: '1px solid var(--edg-accent-20)',
              boxShadow: 'var(--shadow-btn-glow)',
              animation: 'pop-in 0.45s ease both',
            }}
          >
            ✓
          </span>
          <div>
            <p className="text-sm font-bold" style={{ color: 'var(--text-strong)' }}>
              Focus set for today
            </p>
            <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
              Edge will score your calendar against these.
            </p>
          </div>
        </div>
        <div className="space-y-1">
          {areas.map((a, i) => (
            <div key={i} className="flex items-center gap-2">
              <span
                className="w-1.5 h-1.5 rounded-full flex-shrink-0"
                style={{ background: confidenceColor(a.confidence) }}
              />
              <p className="text-xs font-medium" style={{ color: 'var(--text-muted)' }}>{a.title}</p>
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div
      className="glass-card p-5"
      style={{ background: 'var(--rec-card-bg)', borderColor: 'var(--rec-card-border)' }}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 mb-4">
        <div>
          <p className="text-xs font-semibold mb-0.5" style={{ color: 'var(--text-accent)' }}>
            ✦ EDGE&apos;S RECOMMENDATION
          </p>
          <h3 className="text-base font-bold leading-snug" style={{ color: 'var(--text-strong)' }}>
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
