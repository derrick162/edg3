import React from 'react';

/**
 * Edg3 Badge — a small pill for status and labels.
 * Tints match the semantic palette: info (indigo), success,
 * pending (warning), danger.
 */
export function Badge({
  variant = 'info',
  className = '',
  style,
  children,
  ...rest
}) {
  const tints = {
    info:    { background: 'var(--edg-accent-15)',  color: 'var(--edg-indigo-bright)' },
    success: { background: 'var(--edg-success-tint)', color: 'var(--edg-success)' },
    pending: { background: 'var(--edg-warning-tint)', color: 'var(--edg-warning)' },
    danger:  { background: 'var(--edg-danger-tint)',  color: 'var(--edg-danger)' },
  };

  return (
    <span
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        padding: '4px 10px',
        borderRadius: 'var(--radius-pill)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-xs)',
        fontWeight: 'var(--weight-semibold)',
        ...tints[variant],
        ...style,
      }}
      {...rest}
    >
      {children}
    </span>
  );
}
