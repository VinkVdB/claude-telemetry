// src/client/components/DetailPanel.tsx
import type { Event } from "../lib/types";
import { formatTokens, formatCost } from "../lib/utils";
import { tokenTypeCost } from "@shared/pricing";
import { useSettings } from "../contexts/SettingsContext";

export function DetailPanel({ event, onClose }: { event: Event | null; onClose: () => void }) {
  const { settings } = useSettings();
  const formatOpts = {
    kThreshold: settings["display.tokenKThreshold"] as number,
    mThreshold: settings["display.tokenMThreshold"] as number,
    costPrecisionThreshold: settings["display.costPrecisionThreshold"] as number,
  };

  if (!event) return null;

  let content: any[] = [];
  try {
    const parsed = event.content ? JSON.parse(event.content) : [];
    content = Array.isArray(parsed) ? parsed : [];
  } catch { content = []; }

  return (
    <div className="border border-border rounded-xl bg-white flex flex-col max-h-[calc(100vh-8rem)] overflow-hidden">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <h3 className="font-semibold text-primary-dark">Event Detail</h3>
        <button onClick={onClose} className="text-muted hover:text-primary-dark text-xl">&times;</button>
      </div>
      <div className="flex-1 overflow-auto p-4 space-y-4">
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div><span className="text-muted">Type:</span> <strong>{event.type}</strong></div>
          <div><span className="text-muted">Model:</span> <strong>{event.model ?? "—"}</strong></div>
          {event.tool_name && <div><span className="text-muted">Tool:</span> <strong>{event.tool_name}</strong></div>}
          {event.duration_ms != null && (
            <div><span className="text-muted">Duration:</span> <strong>{event.duration_ms}ms</strong></div>
          )}
        </div>

        {/* Token & cost breakdown */}
        {(event.input_tokens != null || event.output_tokens != null) && (
          <div className="bg-surface rounded-lg p-3">
            <h4 className="text-xs font-medium text-muted mb-2 uppercase tracking-wide">Tokens & Cost</h4>
            <div className="grid grid-cols-2 gap-2 text-sm">
              <div>
                <span className="text-muted text-xs">Input</span>
                <p className="font-semibold text-primary-dark">
                  {formatTokens(event.input_tokens, formatOpts)}
                  {event.model && event.input_tokens != null && (
                    <span className="text-muted text-xs ml-1">({formatCost(tokenTypeCost(event.model, "input", event.input_tokens), formatOpts)})</span>
                  )}
                </p>
              </div>
              <div>
                <span className="text-muted text-xs">Output</span>
                <p className="font-semibold text-primary-dark">
                  {formatTokens(event.output_tokens, formatOpts)}
                  {event.model && event.output_tokens != null && (
                    <span className="text-muted text-xs ml-1">({formatCost(tokenTypeCost(event.model, "output", event.output_tokens), formatOpts)})</span>
                  )}
                </p>
              </div>
              <div>
                <span className="text-muted text-xs">Cache read</span>
                <p className="font-semibold text-primary-dark">
                  {formatTokens(event.cache_read_tokens, formatOpts)}
                  {event.model && event.cache_read_tokens != null && (
                    <span className="text-muted text-xs ml-1">({formatCost(tokenTypeCost(event.model, "cache_read", event.cache_read_tokens), formatOpts)})</span>
                  )}
                </p>
              </div>
              <div>
                <span className="text-muted text-xs">Cache write</span>
                <p className="font-semibold text-primary-dark">
                  {formatTokens(event.cache_creation_tokens, formatOpts)}
                  {event.model && event.cache_creation_tokens != null && (
                    <span className="text-muted text-xs ml-1">({formatCost(tokenTypeCost(event.model, "cache_write", event.cache_creation_tokens), formatOpts)})</span>
                  )}
                </p>
              </div>
            </div>
            {event.cost_usd != null && (
              <div className="mt-2 pt-2 border-t border-border flex justify-between items-baseline">
                <span className="text-xs text-muted">Total cost</span>
                <span className="font-bold text-primary-dark">{formatCost(event.cost_usd, formatOpts)}</span>
              </div>
            )}
          </div>
        )}

        {content.length > 0 && (
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
        )}

        <div>
          <p className="text-xs text-muted mb-2 font-medium">Raw JSON</p>
          <pre className="text-xs bg-surface rounded-lg p-3 overflow-x-auto">
            {event.raw ? (() => { try { return JSON.stringify(JSON.parse(event.raw), null, 2); } catch { return event.raw; } })() : "—"}
          </pre>
        </div>
      </div>
    </div>
  );
}
