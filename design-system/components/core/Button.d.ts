import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual style. `primary` = gradient + glow, `secondary` = ghost outline, `subtle` = quiet text button. */
  variant?: 'primary' | 'secondary' | 'subtle';
  /** Control height / padding. */
  size?: 'sm' | 'md' | 'lg';
  /** Stretch to fill the container width. */
  fullWidth?: boolean;
  disabled?: boolean;
  children?: React.ReactNode;
}

/**
 * The primary action control for Edg3.
 * @startingPoint section="Core" subtitle="Gradient, ghost & subtle buttons" viewport="700x180"
 */
export function Button(props: ButtonProps): JSX.Element;
