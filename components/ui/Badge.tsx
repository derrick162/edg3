'use client';

import React from 'react';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'info' | 'success' | 'pending' | 'danger';
}

const VARIANT_CLASS: Record<string, string> = {
  info:    'badge badge-info',
  success: 'badge badge-success',
  pending: 'badge badge-pending',
  danger:  'badge badge-danger',
};

export function Badge({ variant = 'info', className, children, ...props }: BadgeProps) {
  return (
    <span className={`${VARIANT_CLASS[variant]} ${className || ''}`} {...props}>
      {children}
    </span>
  );
}
