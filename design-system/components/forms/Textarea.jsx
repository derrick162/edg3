import React from 'react';

/**
 * Edg3 Textarea — multi-line text field. Same surface treatment
 * as Input, vertically resizable, taller default min-height.
 */
export function Textarea({
  label,
  hint,
  id,
  rows,
  className = '',
  style,
  ...rest
}) {
  const taId = id || (label ? `ta-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return (
    <div style={{ width: '100%' }}>
      {label && (
        <label
          htmlFor={taId}
          style={{
            display: 'block',
            fontSize: 'var(--text-sm)',
            fontWeight: 'var(--weight-medium)',
            color: 'var(--text-muted)',
            marginBottom: 8,
          }}
        >
          {label}
        </label>
      )}
      <textarea
        id={taId}
        rows={rows}
        className={className}
        style={{
          background: 'var(--surface-input)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-strong)',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-sm)',
          lineHeight: 'var(--leading-relaxed)',
          padding: '12px 16px',
          width: '100%',
          minHeight: 120,
          resize: 'vertical',
          outline: 'none',
          transition: 'border-color var(--dur-base), box-shadow var(--dur-base)',
          ...style,
        }}
        onFocus={(e) => {
          e.target.style.borderColor = 'rgba(99,102,241,0.5)';
          e.target.style.boxShadow = 'var(--ring-focus)';
          rest.onFocus?.(e);
        }}
        onBlur={(e) => {
          e.target.style.borderColor = 'var(--border-card)';
          e.target.style.boxShadow = 'none';
          rest.onBlur?.(e);
        }}
        {...rest}
      />
      {hint && (
        <p style={{ fontSize: 'var(--text-xs)', color: 'var(--text-faint)', marginTop: 8, lineHeight: 'var(--leading-normal)' }}>
          {hint}
        </p>
      )}
    </div>
  );
}
