import React from 'react';

export interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  /** Field label rendered above the control. */
  label?: string;
  /** Helper / consent text rendered below the control. */
  hint?: string;
}

/**
 * Single-line text field for the dark canvas.
 * @startingPoint section="Forms" subtitle="Labeled text field" viewport="700x140"
 */
export function Input(props: InputProps): JSX.Element;
