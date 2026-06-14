import React from 'react';

export interface CheckboxProps {
  checked?: boolean;
  onChange?: (next: boolean) => void;
  /** Optional label; strikes through and dims when checked. */
  label?: React.ReactNode;
  disabled?: boolean;
}

/** Square check toggle used for tasks and to-dos. */
export function Checkbox(props: CheckboxProps): JSX.Element;
