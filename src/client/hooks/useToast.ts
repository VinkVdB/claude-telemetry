import { useState } from "react";
import { createElement } from "react";

export interface ToastState {
  message: string | null;
  showToast: (message: string, durationMs?: number) => void;
  /** Render this element somewhere in your component's JSX to display the toast */
  ToastNode: ReturnType<typeof createElement> | null;
}

export function useToast(): ToastState {
  const [message, setMessage] = useState<string | null>(null);

  const showToast = (msg: string, durationMs = 2500) => {
    setMessage(msg);
    setTimeout(() => setMessage(null), durationMs);
  };

  const ToastNode = message
    ? createElement(
        "div",
        {
          className:
            "fixed bottom-4 right-4 bg-primary-dark text-white text-sm px-4 py-2.5 rounded-lg shadow-lg z-50",
        },
        message
      )
    : null;

  return { message, showToast, ToastNode };
}
