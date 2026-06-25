'use client';

import { useState, useCallback, useRef, useEffect } from 'react';
import { ToastContext, Toast, ToastType } from '@/lib/toast';

const TOAST_DURATION = 3000;
const MAX_TOASTS = 3;

function ToastItem({ toast, onRemove }: { toast: Toast; onRemove: (id: number) => void }) {
  const barRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = setTimeout(() => onRemove(toast.id), TOAST_DURATION + 220);
    return () => clearTimeout(t);
  }, [toast.id, onRemove]);

  const bg =
    toast.type === 'success' ? 'var(--edg-success-tint)' :
    toast.type === 'error' ? 'var(--edg-danger-tint)' :
    'var(--edg-accent-08)';
  const border =
    toast.type === 'success' ? 'var(--edg-success-border)' :
    toast.type === 'error' ? 'var(--edg-danger-border)' :
    'var(--edg-accent-20)';
  const color =
    toast.type === 'success' ? 'var(--edg-success)' :
    toast.type === 'error' ? 'var(--edg-danger)' :
    'var(--text-accent)';
  const icon =
    toast.type === 'success' ? '✓' :
    toast.type === 'error' ? '✕' :
    'ℹ';

  return (
    <div
      className="toast-slide-in flex items-start gap-3 px-4 py-3 rounded-xl shadow-lg max-w-xs w-full relative overflow-hidden"
      style={{ background: bg, border: `1px solid ${border}`, backdropFilter: 'blur(8px)' }}
      role="alert"
    >
      <span className="text-sm font-bold flex-shrink-0 mt-0.5" style={{ color }}>{icon}</span>
      <p className="text-sm flex-1" style={{ color: 'var(--text-body)' }}>{toast.message}</p>
      <button
        onClick={() => onRemove(toast.id)}
        className="flex-shrink-0 text-xs leading-none mt-0.5 hover:opacity-80"
        style={{ color: 'var(--text-faint)' }}
        aria-label="Dismiss"
      >
        ✕
      </button>
      {/* Countdown bar */}
      <div
        ref={barRef}
        className="toast-countdown-bar absolute bottom-0 left-0 h-0.5"
        style={{
          background: color,
          opacity: 0.4,
          animation: `toast-countdown ${TOAST_DURATION}ms linear forwards`,
        }}
      />
    </div>
  );
}

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(0);

  const removeToast = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const showToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = nextId.current++;
    setToasts(prev => {
      const next = [...prev, { id, message, type }];
      return next.slice(-MAX_TOASTS);
    });
  }, []);

  return (
    <ToastContext.Provider value={{ showToast }}>
      {children}
      {/* Toast container — bottom-right */}
      <div
        style={{
          position: 'fixed',
          bottom: 24,
          right: 24,
          zIndex: 9000,
          display: 'flex',
          flexDirection: 'column',
          gap: 10,
          alignItems: 'flex-end',
          pointerEvents: 'none',
        }}
        aria-live="polite"
      >
        {toasts.map(t => (
          <div key={t.id} style={{ pointerEvents: 'auto' }}>
            <ToastItem toast={t} onRemove={removeToast} />
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
