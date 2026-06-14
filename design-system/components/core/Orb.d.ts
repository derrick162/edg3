import React from 'react';

export interface OrbProps extends React.HTMLAttributes<HTMLDivElement> {
  /** 1 = indigo, top-right (600px). 2 = violet, bottom-left (400px). */
  variant?: 1 | 2;
}

/** Ambient blurred glow for page depth. Place behind a relative, z-indexed content layer. */
export function Orb(props: OrbProps): JSX.Element;
