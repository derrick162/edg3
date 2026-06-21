'use client';

export interface WeeklyReviewStats {
  events: number;
  tasksCompleted: number;
  tasksMissed: number;
  whoopAvgRecovery: number | null;
}

export interface WeeklyReviewCardProps {
  weekOf: string;                  // ISO date (Monday)
  reviewText: string | null;       // spoken summary, null until fetched
  stats: WeeklyReviewStats | null;
  loading?: boolean;
  onRegenerate?: () => void;
}

function fmtWeek(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

export function WeeklyReviewCard({ weekOf, reviewText, stats, loading = false, onRegenerate }: WeeklyReviewCardProps) {
  return (
    <div className="glass-card p-5">
      <div className="flex items-center justify-between mb-4">
        <p className="label-caps">Week of {fmtWeek(weekOf)}</p>
        {onRegenerate && !loading && (
          <button
            className="text-xs px-2 py-1 rounded"
            style={{ color: 'var(--text-faint)', background: 'var(--edg-fill-04)' }}
            onClick={onRegenerate}
          >
            Regenerate
          </button>
        )}
      </div>

      {loading ? (
        <WeeklyReviewSkeleton />
      ) : reviewText ? (
        <>
          <blockquote
            className="text-sm leading-relaxed mb-4 pl-3"
            style={{
              color: 'var(--text-body)',
              fontStyle: 'italic',
              borderLeft: '2px solid var(--edg-accent-20)',
            }}
          >
            {reviewText}
          </blockquote>
          {stats && <StatRow stats={stats} />}
        </>
      ) : (
        <p className="text-xs" style={{ color: 'var(--text-faint)' }}>
          No weekly review yet — ask Edge "how was my week?" on your next call.
        </p>
      )}
    </div>
  );
}

function StatRow({ stats }: { stats: WeeklyReviewStats }) {
  return (
    <div className="flex flex-wrap gap-2">
      <span className="badge" style={{ color: 'var(--text-muted)' }}>
        📅 {stats.events} events
      </span>
      {stats.tasksCompleted > 0 && (
        <span className="badge badge-success">✓ {stats.tasksCompleted} done</span>
      )}
      {stats.tasksMissed > 0 && (
        <span className="badge badge-danger">✗ {stats.tasksMissed} missed</span>
      )}
      {stats.whoopAvgRecovery !== null && (
        <span className="badge" style={{ color: 'var(--text-muted)' }}>
          💚 {stats.whoopAvgRecovery}% avg recovery
        </span>
      )}
    </div>
  );
}

function WeeklyReviewSkeleton() {
  return (
    <div aria-label="Loading weekly review…">
      <div className="space-y-2 mb-4 pl-3" style={{ borderLeft: '2px solid var(--edg-accent-10)' }}>
        <div className="h-3 rounded w-full" style={{ background: 'var(--edg-fill-04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div className="h-3 rounded w-5/6" style={{ background: 'var(--edg-fill-04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        <div className="h-3 rounded w-4/5" style={{ background: 'var(--edg-fill-04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
      </div>
      <div className="flex gap-2">
        {[60, 48, 52, 72].map(w => (
          <div key={w} className="h-5 rounded" style={{ width: w, background: 'var(--edg-fill-04)', animation: 'pulse 1.5s ease-in-out infinite' }} />
        ))}
      </div>
    </div>
  );
}
