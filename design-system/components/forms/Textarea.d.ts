import React from 'react';

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
}

/** Multi-line text field (vertically resizable). */
export function Textarea(props: TextareaProps): JSX.Element;
