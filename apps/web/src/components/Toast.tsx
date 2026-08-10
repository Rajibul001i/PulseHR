/**
 * Toasts.
 *
 * Replaces inline red text, which was easy to miss and vanished on navigation. Approving a
 * leave request previously gave no visible confirmation at all — the row just changed.
 *
 * `aria-live="polite"` so screen readers announce it without interrupting (NFR-11).
 */

import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from 'react';

export type ToastKind = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  exiting?: boolean;
}

/** Matches the `slide-out` keyframe duration in styles.css. */
const EXIT_MS = 160;

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
}

let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  // Two-step removal so `.exiting` gets a frame to animate before the toast leaves state.
  const dismiss = useCallback((id: number) => {
    setToasts((t) => t.map((x) => (x.id === id ? { ...x, exiting: true } : x)));
    window.setTimeout(() => {
      setToasts((t) => t.filter((x) => x.id !== id));
    }, EXIT_MS);
  }, []);

  const push = useCallback((kind: ToastKind, message: string) => {
    const id = nextId++;
    setToasts((t) => [...t, { id, kind, message }]);
    // Errors linger — the user may need to read a validation message twice.
    window.setTimeout(() => dismiss(id), kind === 'error' ? 7000 : 3500);
  }, [dismiss]);

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push],
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite" aria-atomic="false">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`toast ${t.kind}${t.exiting ? ' exiting' : ''}`}
            role={t.kind === 'error' ? 'alert' : undefined}
          >
            <span className="toast-icon" aria-hidden="true">
              {t.kind === 'success' ? '✓' : t.kind === 'error' ? '!' : 'i'}
            </span>
            <span>{t.message}</span>
            <button className="toast-close" aria-label="Dismiss notification" onClick={() => dismiss(t.id)}>
              ×
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
