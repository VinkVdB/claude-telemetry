// src/client/components/DetailPanel.tsx
import type { Event } from "../lib/types";
import { formatTokens, formatCost, cn } from "../lib/utils";

export function DetailPanel({ event, onClose }: { event: Event | null; onClose: () => void }) {
  if (!event) return null;

  const content = event.content ? JSON.parse(event.content) : [];

  return (
    <div className="fixed inset-y-0 right-0 w-[480px] bg-white border-l border-border shadow-xl z-50 flex flex-col animate-in slide-in-from-right">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <h3 className="font-semibold text-primary-dark">Event Detail</h3>
        <button onClick={onClose} className="text-muted hover:text-primary-dark text-xl">&times;</button>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted">Type:</span> <strong>{event.type}</strong></div>
          <div><span className="text-muted">Model:</span> <strong>{event.model ?? "—"}</strong></div>
          {event.tool_name && <div><span className="text-muted">Tool:</span> <strong>{event.tool_name}</strong></div>}
          {event.input_tokens != null && (
            <div><span className="text-muted">Input:</span> <strong>{formatTokens(event.input_tokens)}</strong></div>
          )}
          {event.output_tokens != null && (
            <div><span className="text-muted">Output:</span> <strong>{formatTokens(event.output_tokens)}</strong></div>
          )}
          {event.cost_usd != null && (
            <div><span className="text-muted">Cost:</span> <strong>{formatCost(event.cost_usd)}</strong></div>
          )}
          {event.duration_ms != null && (
            <div><span className="text-muted">Duration:</span> <strong>{event.duration_ms}ms</strong></div>
          )}
        </div>

        <div>
          <h4 className="text-sm font-medium text-muted mb-2">Content</h4>
          {content.map((block: any, i: number) => (
            <div key={i} className="mb-2">
              {block.type === "text" && <p className="text-sm whitespace-pre-wrap">{block.text}</p>}
              {block.type === "thinking" && (
                <details className="bg-surface rounded-lg p-3">
                  <summary className="text-xs text-muted cursor-pointer">Thinking</summary>
                  <p className="text-sm mt-2 whitespace-pre-wrap">{block.thinking}</p>
                </details>
              )}
              {block.type === "tool_use" && (
                <div className="bg-surface rounded-lg p-3">
                  <p className="text-xs text-muted mb-1">Tool: <strong className="text-primary">{block.name}</strong></p>
                  <pre className="text-xs overflow-x-auto">{JSON.stringify(block.input, null, 2)}</pre>
                </div>
              )}
              {block.type === "tool_result" && (
                <div className="bg-surface rounded-lg p-3">
                  <p className="text-xs text-muted mb-1">Tool Result</p>
                  <pre className="text-xs overflow-x-auto">{JSON.stringify(block.content, null, 2)}</pre>
                </div>
              )}
            </div>
          ))}
        </div>

        <details>
          <summary className="text-xs text-muted cursor-pointer">Raw JSON</summary>
          <pre className="text-xs mt-2 bg-surface rounded-lg p-3 overflow-x-auto">
            {event.raw ? JSON.stringify(JSON.parse(event.raw), null, 2) : "—"}
          </pre>
        </details>
      </div>
    </div>
  );
}
