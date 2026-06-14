import React from 'react';

/**
 * Edg3 Checkbox — square check toggle used for tasks. Filled
 * indigo when checked, hairline outline when empty. Optional
 * `label` renders to the right and strikes through when checked.
 */
export function Checkbox({
  checked = false,
  onChange,
  label,
  disabled = false,
  className = '',
  style,
  ...rest
}) {
  return (
    <label
      className={className}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 12,
        cursor: disabled ? 'not-allowed' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      <button
        type="button"
        role="checkbox"
        aria-checked={checked}
        disabled={disabled}
        onClick={() => !disabled && onChange?.(!checked)}
        style={{
          width: 20,
          height: 20,
          flexShrink: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: 6,
          background: checked ? 'var(--edg-indigo)' : 'transparent',
          border: checked ? '2px solid var(--edg-indigo)' : '2px solid rgba(255,255,255,0.15)',
          cursor: disabled ? 'not-allowed' : 'pointer',
          transition: 'background var(--dur-base), border-color var(--dur-base)',
          padding: 0,
        }}
        {...rest}
      >
        {checked && <span style={{ color: '#fff', fontSize: 11, lineHeight: 1 }}>✓</span>}
      </button>
      {label && (
        <span
          style={{
            fontSize: 'var(--text-sm)',
            color: checked ? 'var(--text-faint)' : 'var(--text-strong)',
            textDecoration: checked ? 'line-through' : 'none',
          }}
        >
          {label}
        </span>
      )}
    </label>
  );
}
