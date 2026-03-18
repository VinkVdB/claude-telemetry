import type { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { subscribe } from "../sse/broadcaster";

export function createSseRoute(app: Hono): void {
  app.get("/api/stream", (c) => {
    return streamSSE(c, async (stream) => {
      const unsubscribe = subscribe((event, data) => {
        stream.writeSSE({ event, data });
      });

      // Keep alive
      const keepAlive = setInterval(() => {
        stream.writeSSE({ event: "ping", data: "" });
      }, 30_000);

      stream.onAbort(() => {
        unsubscribe();
        clearInterval(keepAlive);
      });

      // Keep the stream open
      await new Promise(() => {});
    });
  });
}
