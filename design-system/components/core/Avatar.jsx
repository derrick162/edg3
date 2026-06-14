import React from 'react';

/**
 * Edg3 Avatar — circular initial badge with an indigo-tinted
 * fill. Used for user identity and the numbered priority chips.
 */
export function Avatar({
  initials = '',
  size = 40,
  className = '',
  style,
  ...rest
}) {
  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        flexShrink: 0,
        borderRadius: 'var(--radius-pill)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--edg-accent-20)',
        color: 'var(--edg-indigo-bright)',
        fontFamily: 'var(--font-sans)',
        fontWeight: 'var(--weight-black)',
        fontSize: Math.round(size * 0.4),
        letterSpacing: '-0.02em',
        ...style,
      }}
      {...rest}
    >
      {initials}
    </div>
  );
}
