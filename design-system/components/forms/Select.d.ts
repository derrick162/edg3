import React from 'react';

export interface SelectOption {
  label: string;
  value: string;
}

export interface SelectProps extends React.SelectHTMLAttributes<HTMLSelectElement> {
  label?: string;
  /** Options as {label, value} pairs. */
  options?: SelectOption[];
}

/** Native dropdown styled for the dark canvas, with a custom chevron. */
export function Select(props: SelectProps): JSX.Element;
