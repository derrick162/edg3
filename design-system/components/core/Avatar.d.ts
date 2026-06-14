import React from 'react';

export interface AvatarProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Initials or single character to display. */
  initials?: string;
  /** Diameter in px. Default 40. */
  size?: number;
}

/** Circular indigo-tinted initial badge — user identity and numbered priority chips. */
export function Avatar(props: AvatarProps): JSX.Element;
