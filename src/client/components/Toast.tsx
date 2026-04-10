import { useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { useSSE } from "../lib/sse";

interface Toast {
  id: string;
  sessionId: string;
  slug: string | null;
  message: string;
}

let toastCounter = 0;

export function ToastContainer() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const navigate = useNavigate();

  const dismiss = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  useSSE((event, data) => {
    if (event === "session_new") {
      const id = `toast-${++toastCounter}`;
      const toast: Toast = {
        id,
        sessionId: data.sessionId,
        slug: data.slug ?? null,
        message: data.slug ? `New session: ${data.slug}` : `New session started`,
      };
      setToasts((prev) => [...prev.slice(-4), toast]); // max 5 toasts
      setTimeout(() => dismiss(id), 5000);
    }
  });

  if (toasts.length === 0) return null;

  return (
    <div className="fixed top-4 right-4 z-50 flex flex-col gap-2 pointer-events-none">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className="pointer-events-auto flex items-center gap-3 bg-surface border border-border rounded-xl shadow-lg px-4 py-3 cursor-pointer hover:border-primary transition-all animate-slide-in-right max-w-sm"
          onClick={() => { navigate(`/sessions/${toast.sessionId}`); dismiss(toast.id); }}
          role="button"
        >
          <div className="w-2 h-2 rounded-full bg-[#bdd72d] shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-primary-dark truncate">{toast.message}</p>
            <p className="text-xs text-muted">Click to view session</p>
          </div>
          <button
            className="text-muted hover:text-primary-dark text-lg leading-none shrink-0"
            onClick={(e) => { e.stopPropagation(); dismiss(toast.id); }}
          >×</button>
        </div>
      ))}
    </div>
  );
}
