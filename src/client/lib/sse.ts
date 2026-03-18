import { useEffect, useRef } from "react";

export function useSSE(onEvent: (event: string, data: any) => void): void {
  const callbackRef = useRef(onEvent);
  callbackRef.current = onEvent;

  useEffect(() => {
    const source = new EventSource("/api/stream");

    source.addEventListener("event", (e) => {
      try {
        callbackRef.current("event", JSON.parse(e.data));
      } catch {}
    });

    source.onerror = () => {
      // Auto-reconnect is built into EventSource
    };

    return () => source.close();
  }, []);
}
