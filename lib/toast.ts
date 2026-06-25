import { createContext, useContext } from 'react';

export type ToastType = 'success' | 'error' | 'info';

export interface Toast {
  id: number;
  message: string;
  type: ToastType;
}

export interface ToastContextValue {
  showToast: (message: string, type?: ToastType) => void;
}

export const ToastContext = createContext<ToastContextValue>({
  showToast: () => {},
});

export function useToast(): ToastContextValue {
  return useContext(ToastContext);
}
