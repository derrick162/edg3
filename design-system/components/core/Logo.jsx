import React from 'react';

/**
 * Edg3 Logo — the EDG3 wordmark in gradient ink. Optionally
 * shows the "ELITE DAILY GUIDANCE ENGINE" eyebrow beneath it.
 */
export function Logo({
  size = 24,
  eyebrow = false,
  text = 'EDG3',
  className = '',
  style,
  ...rest
}) {
  return (
    <div className={className} style={{ display: 'inline-block', ...style }} {...rest}>
      <span
        style={{
          fontFamily: 'var(--font-sans)',
          fontWeight: 'var(--weight-black)',
          fontSize: size,
          lineHeight: 1,
          letterSpacing: 'var(--tracking-logo)',
          background: 'var(--edg-gradient-logo)',
          WebkitBackgroundClip: 'text',
          backgroundClip: 'text',
          WebkitTextFillColor: 'transparent',
        }}
      >
        {text}
      </span>
      {eyebrow && (
        <p
          style={{
            margin: '3px 0 0',
            fontSize: 'var(--text-xs)',
            color: 'var(--edg-indigo)',
            letterSpacing: 'var(--tracking-wide)',
            fontWeight: 'var(--weight-medium)',
          }}
        >
          ELITE DAILY GUIDANCE ENGINE
        </p>
      )}
    </div>
  );
}
