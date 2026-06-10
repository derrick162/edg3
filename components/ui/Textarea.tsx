'use client';

import React from 'react';

interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  label?: string;
  hint?: string;
}

export function Textarea({ label, hint, className = '', ...props }: TextareaProps) {
  return (
    <div>
      {label && <label className="block text-sm font-medium mb-2" style={{ color: 'var(--text-muted)' }}>{label}</label>}
      <textarea className={`input ${className}`} {...props} />
      {hint && <p className="text-xs mt-1" style={{ color: 'var(--text-faint)' }}>{hint}</p>}
    </div>
  );
}
