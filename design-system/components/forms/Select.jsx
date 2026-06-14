import React from 'react';

/**
 * Edg3 Select — native dropdown styled for the dark canvas.
 * Options use the elevated popover fill so the menu reads on
 * top of the page. Pass `options` as {label, value} pairs.
 */
export function Select({
  label,
  options = [],
  id,
  className = '',
  style,
  children,
  ...rest
}) {
  const selId = id || (label ? `sel-${label.replace(/\s+/g, '-').toLowerCase()}` : undefined);
  return (
    <div style={{ width: '100%' }}>
      {label && (
        <label
          htmlFor={selId}
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
      <select
        id={selId}
        className={className}
        style={{
          background: 'var(--edg-bg-select)',
          border: '1px solid var(--border-card)',
          borderRadius: 'var(--radius-md)',
          color: 'var(--text-strong)',
          fontFamily: 'var(--font-sans)',
          fontSize: 'var(--text-sm)',
          padding: '12px 16px',
          width: '100%',
          outline: 'none',
          cursor: 'pointer',
          appearance: 'none',
          backgroundImage:
            'url("data:image/svg+xml;utf8,<svg xmlns=\'http://www.w3.org/2000/svg\' width=\'16\' height=\'16\' viewBox=\'0 0 24 24\' fill=\'none\' stroke=\'%23888899\' stroke-width=\'2\' stroke-linecap=\'round\' stroke-linejoin=\'round\'><polyline points=\'6 9 12 15 18 9\'/></svg>")',
          backgroundRepeat: 'no-repeat',
          backgroundPosition: 'right 14px center',
          paddingRight: 40,
          ...style,
        }}
        {...rest}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value} style={{ background: 'var(--edg-bg-select)', color: 'var(--text-strong)' }}>
            {o.label}
          </option>
        ))}
        {children}
      </select>
    </div>
  );
}
