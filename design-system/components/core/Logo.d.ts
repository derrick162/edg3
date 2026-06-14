import React from 'react';

export interface LogoProps extends React.HTMLAttributes<HTMLDivElement> {
  /** Wordmark font-size in px. */
  size?: number;
  /** Show the "ELITE DAILY GUIDANCE ENGINE" eyebrow beneath. */
  eyebrow?: boolean;
  /** Wordmark text. Default "EDG3". Use "E" for the compact avatar mark. */
  text?: string;
}

/**
 * The EDG3 gradient wordmark.
 * @startingPoint section="Brand" subtitle="EDG3 gradient wordmark" viewport="700x140"
 */
export function Logo(props: LogoProps): JSX.Element;
