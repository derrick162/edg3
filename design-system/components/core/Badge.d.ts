import React from 'react';

export interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  /** Semantic tint. */
  variant?: 'info' | 'success' | 'pending' | 'danger';
  children?: React.ReactNode;
}

/**
 * Small status / label pill.
 * @startingPoint section="Core" subtitle="Status & label pills" viewport="700x120"
 */
export function Badge(props: BadgeProps): JSX.Element;
