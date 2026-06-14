import React from 'react';

/**
 * Edg3 Card — the frosted glass surface that holds nearly all
 * content. Optional `hover` enables the indigo border + glow on
 * hover; `accent` gives it a persistent indigo-tinted border for
 * "Edge is here" emphasis.
 */
export function Card({
  hover = false,
  accent = false,
  padding = 24,
  className = '',
  style,
  children,
  ...rest
}) {
  const [isHover, setIsHover] = React.useState(false);
  return (
    <div
      className={className}
      onMouseEnter={() => setIsHover(true)}
      onMouseLeave={() => setIsHover(false)}
      style={{
        background: 'var(--surface-card)',
        border: `1px solid ${accent ? 'var(--border-accent)' : 'var(--border-card)'}`,
        borderRadius: 'var(--radius-lg)',
        backdropFilter: 'var(--blur-glass)',
        padding,
        transition: 'border-color var(--dur-base), box-shadow var(--dur-base)',
        ...(hover && isHover
          ? { borderColor: 'var(--border-accent)', boxShadow: 'var(--shadow-hover-glow)' }
          : null),
        ...style,
      }}
      {...rest}
    >
      {children}
    </div>
  );
}
