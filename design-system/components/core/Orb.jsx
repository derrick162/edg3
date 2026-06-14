import React from 'react';

/**
 * Edg3 Orb — the ambient blurred glow used for depth. Drop two
 * (an indigo orb-1 top-right, a violet orb-2 bottom-left) behind
 * page content. Renders position:fixed and z-index:0; keep your
 * content in a position:relative, z-index:1 layer above it.
 */
export function Orb({ variant = 1, className = '', style, ...rest }) {
  const variants = {
    1: {
      width: 600,
      height: 600,
      top: -200,
      right: -100,
      background: 'radial-gradient(circle, rgba(99,102,241,0.15) 0%, transparent 70%)',
    },
    2: {
      width: 400,
      height: 400,
      bottom: -100,
      left: -100,
      background: 'radial-gradient(circle, rgba(139,92,246,0.10) 0%, transparent 70%)',
    },
  };
  return (
    <div
      aria-hidden="true"
      className={className}
      style={{
        position: 'fixed',
        borderRadius: 'var(--radius-pill)',
        filter: 'var(--blur-orb)',
        pointerEvents: 'none',
        zIndex: 0,
        ...variants[variant],
        ...style,
      }}
      {...rest}
    />
  );
}
