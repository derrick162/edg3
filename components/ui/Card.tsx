'use client';

import React from 'react';

interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  hover?: boolean;
  accent?: boolean;
  padding?: number | string;
}

export function Card({ hover = false, accent = false, padding = 24, style, children, ...props }: CardProps) {
  return (
    <div
      style={{
        background: 'var(--surface-card)',
        border: `1px solid ${accent ? 'var(--border-accent)' : 'var(--border-card)'}`,
        borderRadius: 'var(--radius-lg)',
        backdropFilter: 'var(--blur-glass)',
        padding: typeof padding === 'number' ? padding : padding,
        transition: hover ? 'border-color var(--dur-base), box-shadow var(--dur-base)' : undefined,
        ...style,
      }}
      onMouseEnter={hover ? e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-accent)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'var(--shadow-hover-glow)';
      } : undefined}
      onMouseLeave={hover ? e => {
        (e.currentTarget as HTMLDivElement).style.borderColor = 'var(--border-card)';
        (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
      } : undefined}
      {...props}
    >
      {children}
    </div>
  );
}
