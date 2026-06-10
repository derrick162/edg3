'use client';

import React from 'react';

interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  hint?: string;
}

export function Input({ label, hint, style, ...props }: InputProps) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {label && (
        <label style={{ fontSize: 'var(--text-xs)', fontWeight: 'var(--weight-medium)', color: 'var(--text-muted)' }}>
          {label}
        </label>
      )}
      <input
        className="input"
        style={style}
        {...props}
      />
      {hint && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)' }}>{hint}</p>
      )}
    </div>
  );
}
