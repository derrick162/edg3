import React from 'react';

export interface CardProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Enable the indigo border + glow on hover (for clickable cards). */
  hover?: boolean;
  /** Persistent indigo-tinted border for "Edge" emphasis surfaces. */
  accent?: boolean;
  /** Inner padding in px. Default 24. */
  padding?: number;
  children?: React.ReactNode;
}

/**
 * The frosted glass surface that holds nearly all Edg3 content.
 * @startingPoint section="Core" subtitle="Frosted glass surface" viewport="700x220"
 */
export function Card(props: CardProps): JSX.Element;
