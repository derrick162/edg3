'use client';

import { useState, useEffect, useRef } from 'react';

// ── Types (contract with Core) ──────────────────────────────────────────────

export type EnergyCost = 'high' | 'medium' | 'low';

export interface FocusMilestone {
  id: number;
  title: string;
  done: boolean;
}

export interface FocusArea {
  priorityId: number;
  title: string;
  hoursThisWeek: number;
  targetHours?: number;
  milestonesDone: number;
  milestonesTotal: number;
  isComplete: boolean;
  neglected: boolean;
  energyCost?: EnergyCost;
  milestones: FocusMilestone[];
}

export interface FocusScoreboardProps {
  areas: FocusArea[];
  onToggleMilestone: (priorityId: number, milestoneId: number, done: boolean) => Promise<void>;
  onAddMilestone: (priorityId: number, title: string) => Promise<void>;
  onMilestoneComplete?: (priorityId: number, milestoneId: number) => void;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function progressPct(area: FocusArea): number {
  const target = area.targetHours ?? 10;
  const timePct = Math.min(area.hoursThisWeek / Math.max(target, 1), 1);
  const milestonePct = area.milestonesTotal > 0
    ? area.milestonesDone / area.milestonesTotal
    : 0;
  // Weight: 40% time + 60% milestones when milestones exist, 100% time when none
  const pct = area.milestonesTotal > 0
    ? timePct * 0.4 + milestonePct * 0.6
    : timePct;
  return Math.min(pct, 1);
}

function hoursBarPct(area: FocusArea): number {
  const target = area.targetHours ?? 10;
  return Math.min(area.hoursThisWeek / Math.max(target, 1), 1);
}

function fillColor(pct: number, isComplete: boolean): string {
  if (isComplete) return 'var(--score-fill-done)';
  if (pct >= 0.7) return 'var(--score-fill-high)';
  if (pct >= 0.3) return 'var(--score-fill-mid)';
  return 'var(--score-fill-low)';
}

const ENERGY_LABEL: Record<EnergyCost, string> = {
  high: '⚡ High energy',
  medium: '◑ Med energy',
  low: '○ Low energy',
};
const ENERGY_COLOR: Record<EnergyCost, string> = {
  high: 'var(--energy-red)',
  medium: 'var(--energy-yellow)',
  low: 'var(--energy-green)',
};

// ── Ring SVG ─────────────────────────────────────────────────────────────────

function ProgressRing({ pct, isComplete, size = 52 }: { pct: number; isComplete: boolean; size?: number }) {
  const r = (size - 6) / 2;
  const circ = 2 * Math.PI * r;
  const dash = circ * pct;
  const color = fillColor(pct, isComplete);

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} style={{ flexShrink: 0 }}>
      {/* Track */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke="var(--score-ring-bg)"
        strokeWidth={5}
      />
      {/* Fill — rotated so it starts from 12 o'clock */}
      <circle
        cx={size / 2} cy={size / 2} r={r}
        fill="none"
        stroke={color}
        strokeWidth={5}
        strokeLinecap="round"
        strokeDasharray={`${dash} ${circ}`}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.4,0,0.2,1), stroke 0.4s ease' }}
      />
      {/* Center pct label */}
      <text
        x="50%" y="50%"
        dominantBaseline="central"
        textAnchor="middle"
        fontSize={size * 0.22}
        fontWeight={700}
        fill={color}
      >
        {Math.round(pct * 100)}%
      </text>
    </svg>
  );
}

// ── Celebration burst ─────────────────────────────────────────────────────────

function CelebrationBurst({ show }: { show: boolean }) {
  if (!show) return null;
  return (
    <div
      className="absolute inset-0 pointer-events-none flex items-center justify-center"
      style={{ zIndex: 10 }}
      aria-hidden
    >
      <div
        className="animate-ping"
        style={{
          width: 80, height: 80, borderRadius: '50%',
          background: 'var(--score-fill-done)',
          opacity: 0.25,
        }}
      />
      <span
        className="absolute text-3xl"
        style={{ animation: 'pop-in 0.4s cubic-bezier(0.34,1.56,0.64,1) both' }}
      >
        ✓
      </span>
    </div>
  );
}

// ── Milestone row ─────────────────────────────────────────────────────────────

function MilestoneRow({
  milestone,
  onToggle,
  celebrating,
}: {
  milestone: FocusMilestone;
  onToggle: (done: boolean) => Promise<void>;
  celebrating: boolean;
}) {
  const [optimistic, setOptimistic] = useState(milestone.done);
  const [busy, setBusy] = useState(false);

  useEffect(() => { setOptimistic(milestone.done); }, [milestone.done]);

  async function handleToggle() {
    if (busy) return;
    const next = !optimistic;
    setOptimistic(next);
    setBusy(true);
    await onToggle(next);
    setBusy(false);
  }

  return (
    <div
      className="flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all"
      style={{
        background: optimistic ? 'var(--score-milestone-done)' : 'transparent',
        opacity: busy ? 0.6 : 1,
      }}
    >
      <button
        onClick={handleToggle}
        disabled={busy}
        className="flex-shrink-0 w-5 h-5 rounded-full border-2 flex items-center justify-center transition-all"
        style={{
          borderColor: optimistic ? 'var(--edg-success)' : 'var(--edg-hairline)',
          background: optimistic ? 'var(--edg-success)' : 'transparent',
        }}
        aria-label={optimistic ? 'Mark incomplete' : 'Mark done'}
      >
        {optimistic && (
          <svg width="10" height="8" viewBox="0 0 10 8" fill="none">
            <path d="M1 4l3 3 5-6" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        )}
      </button>
      <span
        className="text-sm flex-1"
        style={{
          color: optimistic ? 'var(--text-muted)' : 'var(--text-body)',
          textDecoration: optimistic ? 'line-through' : 'none',
          transition: 'color 0.3s ease, text-decoration 0.3s ease',
        }}
      >
        {milestone.title}
      </span>
      {celebrating && <span className="text-sm animate-bounce">🎉</span>}
    </div>
  );
}

// ── Add milestone form ───────────────────────────────────────────────────────

function AddMilestoneForm({ onAdd }: { onAdd: (title: string) => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { if (open) inputRef.current?.focus(); }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!value.trim() || busy) return;
    setBusy(true);
    await onAdd(value.trim());
    setValue('');
    setBusy(false);
    setOpen(false);
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg transition-all"
        style={{ color: 'var(--text-faint)', border: '1px dashed var(--edg-hairline)' }}
      >
        <span>＋</span>
        <span>Add milestone</span>
      </button>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="flex items-center gap-2 px-1">
      <input
        ref={inputRef}
        className="input flex-1 text-sm py-1.5"
        placeholder="What does done look like?"
        value={value}
        onChange={e => setValue(e.target.value)}
        onKeyDown={e => { if (e.key === 'Escape') { setOpen(false); setValue(''); } }}
        maxLength={120}
      />
      <button
        type="submit"
        disabled={!value.trim() || busy}
        className="btn-primary text-xs py-1.5 px-3"
      >
        {busy ? '…' : 'Add'}
      </button>
      <button
        type="button"
        onClick={() => { setOpen(false); setValue(''); }}
        className="text-xs"
        style={{ color: 'var(--text-faint)' }}
      >
        ✕
      </button>
    </form>
  );
}

// ── Focus Area Card ──────────────────────────────────────────────────────────

function FocusAreaCard({
  area,
  rank,
  onToggleMilestone,
  onAddMilestone,
  onMilestoneComplete,
}: {
  area: FocusArea;
  rank: number;
  onToggleMilestone: (milestoneId: number, done: boolean) => Promise<void>;
  onAddMilestone: (title: string) => Promise<void>;
  onMilestoneComplete?: (milestoneId: number) => void;
}) {
  const pct = progressPct(area);
  const hBarPct = hoursBarPct(area);
  const [celebratingId, setCelebratingId] = useState<number | null>(null);
  const [areaJustCompleted, setAreaJustCompleted] = useState(false);
  const prevComplete = useRef(area.isComplete);

  // Fire area-complete celebration when isComplete flips to true
  useEffect(() => {
    if (area.isComplete && !prevComplete.current) {
      setAreaJustCompleted(true);
      setTimeout(() => setAreaJustCompleted(false), 2000);
    }
    prevComplete.current = area.isComplete;
  }, [area.isComplete]);

  async function handleToggle(milestoneId: number, done: boolean) {
    await onToggleMilestone(milestoneId, done);
    if (done) {
      setCelebratingId(milestoneId);
      setTimeout(() => setCelebratingId(null), 1800);
      onMilestoneComplete?.(milestoneId);
    }
  }

  const cardStyle: React.CSSProperties = {
    position: 'relative',
    overflow: 'hidden',
    ...(area.isComplete
      ? { background: 'var(--score-done-tint)', border: '1px solid var(--score-done-border)', boxShadow: 'var(--score-celebrate-glow)' }
      : area.neglected
      ? { background: 'var(--score-neglected-tint)', border: '1px solid var(--edg-danger-border)' }
      : {}),
  };

  return (
    <div className="glass-card p-5" style={cardStyle}>
      <CelebrationBurst show={areaJustCompleted} />

      {/* Header row */}
      <div className="flex items-start gap-4 mb-4">
        <ProgressRing pct={pct} isComplete={area.isComplete} />

        <div className="flex-1 min-w-0 pt-1">
          <div className="flex items-center gap-2 mb-0.5">
            <span
              className="text-xs font-black w-5 h-5 rounded-full flex items-center justify-center flex-shrink-0"
              style={{ background: 'var(--edg-accent-20)', color: 'var(--text-accent)' }}
            >
              {rank}
            </span>
            <h3 className="font-bold text-sm truncate" style={{ color: 'var(--text-strong)' }}>
              {area.title}
            </h3>
            {area.isComplete && (
              <span className="text-xs px-1.5 py-0.5 rounded font-semibold flex-shrink-0"
                style={{ background: 'var(--score-done-tint)', color: 'var(--edg-success)', border: '1px solid var(--score-done-border)' }}>
                ✓ done
              </span>
            )}
            {area.neglected && !area.isComplete && (
              <span className="text-xs px-1.5 py-0.5 rounded font-semibold flex-shrink-0"
                style={{ background: 'var(--edg-danger-tint)', color: 'var(--edg-danger)' }}>
                0h — no time blocked
              </span>
            )}
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-3 text-xs" style={{ color: 'var(--text-faint)' }}>
            <span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>{area.hoursThisWeek.toFixed(1)}h</span>
              {area.targetHours ? (
                <span> / {area.targetHours}h target</span>
              ) : (
                <span> this week</span>
              )}
            </span>
            {area.milestonesTotal > 0 && (
              <span>
                <span style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
                  {area.milestonesDone}/{area.milestonesTotal}
                </span>
                {' '}milestones
              </span>
            )}
            {area.energyCost && (
              <span style={{ color: ENERGY_COLOR[area.energyCost] }}>
                {ENERGY_LABEL[area.energyCost]}
              </span>
            )}
          </div>

          {/* Hours progress bar */}
          <div className="mt-2" style={{ height: 6, borderRadius: 3, background: 'var(--edg-fill-04)', overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${Math.round(hBarPct * 100)}%`,
                borderRadius: 3,
                background: area.isComplete
                  ? 'var(--score-fill-done)'
                  : hBarPct >= 0.7
                  ? 'var(--score-fill-high)'
                  : hBarPct >= 0.3
                  ? 'var(--score-fill-mid)'
                  : 'var(--score-fill-low)',
                transition: 'width 0.4s ease',
              }}
            />
          </div>
        </div>
      </div>

      {/* Milestones */}
      {(area.milestones.length > 0 || true) && (
        <div className="space-y-0.5">
          {area.milestones.map(m => (
            <MilestoneRow
              key={m.id}
              milestone={m}
              onToggle={done => handleToggle(m.id, done)}
              celebrating={celebratingId === m.id}
            />
          ))}
          <div className="pt-1">
            <AddMilestoneForm onAdd={onAddMilestone} />
          </div>
        </div>
      )}
    </div>
  );
}

// ── Scoreboard ───────────────────────────────────────────────────────────────

export function FocusScoreboard({ areas, onToggleMilestone, onAddMilestone, onMilestoneComplete }: FocusScoreboardProps) {
  if (areas.length === 0) {
    return (
      <div className="glass-card p-8 text-center">
        <p className="text-sm mb-1" style={{ color: 'var(--text-muted)' }}>
          No focus areas yet.
        </p>
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          Set your top 3 priorities and Edg3 will track your progress here.
        </p>
      </div>
    );
  }

  const totalDone = areas.filter(a => a.isComplete).length;
  const allDone = totalDone === areas.length && areas.length > 0;

  return (
    <div className="space-y-4">
      {allDone && (
        <div
          className="glass-card p-4 text-center"
          style={{ background: 'var(--score-done-tint)', border: '1px solid var(--score-done-border)', boxShadow: 'var(--score-celebrate-glow)' }}
        >
          <p className="text-base font-bold mb-0.5" style={{ color: 'var(--edg-success)' }}>
            All focus areas complete 🎉
          </p>
          <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
            Edg3 will celebrate with you on tomorrow&apos;s call.
          </p>
        </div>
      )}
      {areas.map((area, i) => (
        <FocusAreaCard
          key={area.priorityId}
          area={area}
          rank={i + 1}
          onToggleMilestone={(milestoneId, done) => onToggleMilestone(area.priorityId, milestoneId, done)}
          onAddMilestone={title => onAddMilestone(area.priorityId, title)}
          onMilestoneComplete={onMilestoneComplete ? (milestoneId) => onMilestoneComplete(area.priorityId, milestoneId) : undefined}
        />
      ))}
    </div>
  );
}
