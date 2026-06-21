'use client';

export interface ScoreSparklineProps {
  /** 7 entries oldest→newest. Null = no call that day (renders as gap). */
  scores: Array<{ date: string; score: number | null }>;
  height?: number;
  width?: number;
}

// Line/fill color based on last non-null score
function sparkColor(scores: Array<{ date: string; score: number | null }>): string {
  const last = [...scores].reverse().find(p => p.score !== null);
  if (!last || last.score === null) return 'var(--text-faint)';
  if (last.score >= 70) return 'var(--edg-success)';
  if (last.score >= 45) return 'var(--edg-warn)';
  return 'var(--edg-error)';
}

export function ScoreSparkline({ scores, height = 48, width = 160 }: ScoreSparklineProps) {
  const PAD = 3;
  const W = width;
  const H = height;

  const color = sparkColor(scores);

  // Build connected segments between non-null runs
  const pts = scores.map((p, i) => ({
    x: PAD + (i / Math.max(scores.length - 1, 1)) * (W - PAD * 2),
    y: p.score !== null ? PAD + (1 - p.score / 100) * (H - PAD * 2) : null,
    score: p.score,
  }));

  // Split into continuous segments (null = break)
  const segments: Array<Array<{ x: number; y: number }>> = [];
  let current: Array<{ x: number; y: number }> = [];
  for (const pt of pts) {
    if (pt.y !== null) {
      current.push({ x: pt.x, y: pt.y });
    } else {
      if (current.length >= 1) segments.push(current);
      current = [];
    }
  }
  if (current.length >= 1) segments.push(current);

  // Find last non-null point for end-cap dot
  const lastPt = [...pts].reverse().find(p => p.y !== null);

  // Area fill — only under the last segment (the most recent continuous run)
  const lastSeg = segments[segments.length - 1];
  let areaPath = '';
  if (lastSeg && lastSeg.length >= 2) {
    areaPath =
      `M${lastSeg[0].x},${H} ` +
      lastSeg.map(p => `L${p.x},${p.y}`).join(' ') +
      ` L${lastSeg[lastSeg.length - 1].x},${H} Z`;
  }

  if (segments.length === 0) {
    // All nulls — show dashed baseline
    return (
      <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true"
        style={{ display: 'block', overflow: 'visible' }}>
        <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2}
          stroke="var(--edg-hairline)" strokeWidth="1" strokeDasharray="3 4" />
      </svg>
    );
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} aria-hidden="true"
      style={{ display: 'block', overflow: 'visible' }}>
      {/* Mid-axis reference */}
      <line x1={PAD} y1={H / 2} x2={W - PAD} y2={H / 2}
        stroke="var(--edg-hairline)" strokeWidth="0.75" strokeDasharray="2 4" />

      {/* Area fill under last segment */}
      {areaPath && (
        <path d={areaPath} fill={color} opacity={0.12} />
      )}

      {/* Line segments — one polyline per continuous run */}
      {segments.map((seg, si) =>
        seg.length >= 2 ? (
          <polyline
            key={si}
            points={seg.map(p => `${p.x},${p.y}`).join(' ')}
            fill="none"
            stroke={color}
            strokeWidth="1.5"
            strokeLinejoin="round"
            strokeLinecap="round"
          />
        ) : (
          // Single isolated point — render as dot
          <circle key={si} cx={seg[0].x} cy={seg[0].y} r={2} fill={color} opacity={0.6} />
        )
      )}

      {/* End-cap dot on last non-null point */}
      {lastPt && lastPt.y !== null && (
        <>
          <circle cx={lastPt.x} cy={lastPt.y} r={4} fill={color} opacity={0.2} />
          <circle cx={lastPt.x} cy={lastPt.y} r={2.5} fill={color} />
        </>
      )}
    </svg>
  );
}
