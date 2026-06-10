'use client';

import React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'subtle' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  fullWidth?: boolean;
}

const SIZE: Record<string, React.CSSProperties> = {
  sm: { fontSize: 'var(--text-xs)',  padding: '6px 14px'  },
  md: { fontSize: 'var(--text-sm)',  padding: '10px 20px' },
  lg: { fontSize: 'var(--text-base)', padding: '13px 26px' },
};

const VARIANT: Record<string, React.CSSProperties> = {
  primary: {
    background: 'var(--edg-gradient-accent)',
    color: '#fff',
    border: 'none',
    boxShadow: 'var(--shadow-btn-glow)',
  },
  secondary: {
    background: 'transparent',
    color: 'var(--text-strong)',
    border: '1px solid var(--border-card)',
  },
  subtle: {
    background: 'transparent',
    color: 'var(--text-muted)',
    border: 'none',
  },
  danger: {
    background: 'linear-gradient(135deg, var(--edg-danger), #dc2626)',
    color: '#fff',
    border: 'none',
  },
};

export function Button({
  variant = 'primary',
  size = 'md',
  fullWidth = false,
  style,
  children,
  disabled,
  ...props
}: ButtonProps) {
  return (
    <button
      disabled={disabled}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
        borderRadius: 'var(--radius-md)',
        fontFamily: 'var(--font-sans)',
        fontWeight: 'var(--weight-semibold)',
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: 'opacity var(--dur-base), transform var(--dur-fast), box-shadow var(--dur-base)',
        width: fullWidth ? '100%' : undefined,
        ...SIZE[size],
        ...VARIANT[variant],
        ...style,
      }}
      {...props}
    >
      {children}
    </button>
  );
}
