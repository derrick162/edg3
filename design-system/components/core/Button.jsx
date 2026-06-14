import React from 'react';

/**
 * Edg3 Button — the primary action control.
 * `primary` is the indigo→violet gradient with glow; `secondary`
 * is a hairline-outlined ghost; `subtle` is a quiet text button
 * used for tertiary actions (e.g. "Skip for now").
 */
export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  disabled = false,
  type = 'button',
  className = '',
  style,
  children,
  ...rest
}) {
  const sizes = {
    sm: { padding: '8px 16px', fontSize: 'var(--text-sm)' },
    md: { padding: '12px 20px', fontSize: 'var(--text-sm)' },
    lg: { padding: '14px 32px', fontSize: 'var(--text-base)' },
  };

  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    fontFamily: 'var(--font-sans)',
    fontWeight: 'var(--weight-semibold)',
    borderRadius: 'var(--radius-md)',
    cursor: disabled ? 'not-allowed' : 'pointer',
    width: fullWidth ? '100%' : 'auto',
    whiteSpace: 'nowrap',
    transition: 'opacity var(--dur-base), transform var(--dur-fast), box-shadow var(--dur-base), border-color var(--dur-base), background var(--dur-base)',
    opacity: disabled ? 0.5 : 1,
    ...sizes[size],
  };

  const variants = {
    primary: {
      background: 'var(--edg-gradient-accent)',
      color: '#fff',
      border: 'none',
      boxShadow: disabled ? 'none' : 'var(--shadow-btn-glow)',
    },
    secondary: {
      background: 'transparent',
      color: 'var(--text-strong)',
      border: '1px solid var(--border-card)',
    },
    subtle: {
      background: 'transparent',
      color: 'var(--text-faint)',
      border: 'none',
      boxShadow: 'none',
    },
  };

  return (
    <button
      type={type}
      disabled={disabled}
      className={className}
      style={{ ...base, ...variants[variant], ...style }}
      {...rest}
    >
      {children}
    </button>
  );
}
