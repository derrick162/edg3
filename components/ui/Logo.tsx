'use client';

import React from 'react';

interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: number;
  eyebrow?: boolean;
  text?: string;
}

export function Logo({ size = 24, eyebrow = false, text = 'EDG3', style, ...props }: LogoProps) {
  return (
    <div style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'center', gap: 4, ...style }} {...props}>
      <span className="logo-text" style={{ fontSize: size }}>{text}</span>
      {eyebrow && (
        <span style={{ fontSize: 10, letterSpacing: 'var(--tracking-wide)', color: 'var(--text-faint)', fontWeight: 'var(--weight-semibold)' }}>
          ELITE DAILY GUIDANCE ENGINE
        </span>
      )}
    </div>
  );
}
