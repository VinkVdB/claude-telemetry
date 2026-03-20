import { useRef, useCallback, useState, useEffect } from "react";
import { formatTokens, formatCost, timeAgo, cn } from "../lib/utils";
import { useSettings } from "../contexts/SettingsContext";
import type { Event } from "../lib/types";

export interface EventTableProps {
  events: Event[];
  total: number;
  isLoading: boolean;
  onLoadMore: () => void;
  onLoadPrevious: () => void;
  offset: number;
  hasMore: boolean;
  hasPrevious: boolean;
  onJumpTo: (eventNumber: number) => void;
  onScrollToTop: () => void;
  selected: Event | null;
  onSelect: (event: Event) => void;
  /** Stable map from event.id → event number (computed from unfiltered data) */
  eventNumberMap: Map<string, number>;
  /** Event ID to scroll to after a jump */
  jumpTargetEventId: string | null;
  /** Optional: show Agent column (for session view) */
  showAgentColumn?: boolean;
  /** Optional: agent color/name maps (for session view) */
  colorMap?: Map<string | null, string>;
  nameMap?: Map<string | null, string>;
  /** Called when a jump targets an event whose agent is hidden */
  onAutoEnableAgent?: (agentId: string | null) => void;
}

interface ToolLabel {
  text: string;
  /** tool = blue (tool use), human = orange (user input), hook = gray (hooks/system) */
  style: "tool" | "human" | "hook";
}

function getToolLabel(e: Event): ToolLabel {
  // assistant: tool_name in blue, or stop_reason in gray
  if (e.type === "assistant") {
    if (e.tool_name) return { text: e.tool_name, style: "tool" };
    if (e.stop_reason) return { text: e.stop_reason, style: "hook" };
    return { text: "\u2014", style: "hook" };
  }

  // progress: extract hookName from raw JSON — gray
  if (e.type === "progress" && e.raw) {
    try {
      const parsed = JSON.parse(e.raw);
      const hookName = parsed?.data?.hookName;
      if (hookName) return { text: hookName, style: "hook" };
    } catch {}
    return { text: "\u2014", style: "hook" };
  }

  // user: Answer/Prompt in orange
  if (e.type === "user" && e.raw) {
    try {
      const parsed = JSON.parse(e.raw);
      const content = parsed?.message?.message?.content;
      if (Array.isArray(content) && content[0]?.type === "tool_result") {
        return { text: "Answer", style: "human" };
      }
      if (typeof content === "string") {
        return { text: "Prompt", style: "human" };
      }
    } catch {}
    return { text: "\u2014", style: "hook" };
  }

  return { text: "\u2014", style: "hook" };
}

function formatTimestamp(ts: string) {
  const d = new Date(ts);
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function EventTable({
  events,
  total,
  isLoading,
  onLoadMore,
  onLoadPrevious,
  offset,
  hasMore,
  hasPrevious,
  onJumpTo,
  onScrollToTop,
  selected,
  onSelect,
  eventNumberMap,
  jumpTargetEventId,
  showAgentColumn = false,
  colorMap,
  nameMap,
  onAutoEnableAgent,
}: EventTableProps) {
  const { settings } = useSettings();
  const jumpStep = settings["display.jumpStepSize"] ?? 50;
  const scrollRef = useRef<HTMLDivElement>(null);
  const [jumpInput, setJumpInput] = useState("");
  const prevScrollHeightRef = useRef(0);

  // Bidirectional scroll detection
  const handleScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el || isLoading) return;

    const { scrollTop, scrollHeight, clientHeight } = el;

    // Load more when near bottom
    if (scrollHeight - scrollTop - clientHeight < 200 && hasMore) {
      onLoadMore();
    }

    // Load previous when near top
    if (scrollTop < 200 && hasPrevious) {
      prevScrollHeightRef.current = scrollHeight;
      onLoadPrevious();
    }
  }, [isLoading, hasMore, hasPrevious, onLoadMore, onLoadPrevious]);

  // After prepend, maintain scroll position so content doesn't jump
  useEffect(() => {
    if (prevScrollHeightRef.current > 0 && scrollRef.current) {
      const newHeight = scrollRef.current.scrollHeight;
      const diff = newHeight - prevScrollHeightRef.current;
      if (diff > 0) {
        scrollRef.current.scrollTop += diff;
      }
      prevScrollHeightRef.current = 0;
    }
  }, [events.length]);

  // Scroll to jump target when it changes
  useEffect(() => {
    if (!jumpTargetEventId || !scrollRef.current || events.length === 0) return;

    // Find the target in the displayed events
    const targetIndex = events.findIndex((e) => e.id === jumpTargetEventId);
    if (targetIndex < 0) return;

    requestAnimationFrame(() => {
      const el = scrollRef.current;
      if (!el) return;
      const rows = el.querySelectorAll("tbody tr");
      const targetRow = rows[targetIndex] as HTMLElement | undefined;
      if (targetRow) {
        const containerRect = el.getBoundingClientRect();
        const rowRect = targetRow.getBoundingClientRect();
        const scrollTarget =
          el.scrollTop +
          (rowRect.top - containerRect.top) -
          containerRect.height / 2 +
          rowRect.height / 2;
        el.scrollTo({ top: Math.max(0, scrollTarget), behavior: "smooth" });

        // Briefly highlight the row
        targetRow.classList.add("bg-accent/20");
        setTimeout(() => targetRow.classList.remove("bg-accent/20"), 2000);
      }
    });
  }, [jumpTargetEventId, events.length]);

  const handleScrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    onScrollToTop();
  }, [onScrollToTop]);

  const handleJumpSubmit = useCallback(() => {
    const num = parseInt(jumpInput, 10);
    if (!isNaN(num) && num >= 1 && num <= total) {
      onJumpTo(num);
      setJumpInput("");
    }
  }, [jumpInput, onJumpTo, total]);

  // Derive the range of visible event numbers for the status bar
  const visibleNumbers = events
    .map((e) => eventNumberMap.get(e.id))
    .filter((n): n is number => n != null);
  const minVisible = visibleNumbers.length > 0 ? Math.min(...visibleNumbers) : 0;
  const maxVisible = visibleNumbers.length > 0 ? Math.max(...visibleNumbers) : 0;

  const colCount = showAgentColumn ? 11 : 10;

  return (
    <div className="flex flex-col">
      {/* Scrollable table */}
      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="max-h-[calc(100vh-16rem)] overflow-y-auto border border-border rounded-xl"
      >
        {/* Top loading indicator for prepend */}
        {isLoading && hasPrevious && (
          <div className="flex items-center justify-center py-2 text-xs text-muted">
            Loading earlier events...
          </div>
        )}

        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10">
            <tr className="bg-surface text-muted text-left">
              <th className="px-2 py-2 font-medium text-right w-12">#</th>
              <th className="px-3 py-2 font-medium">Time</th>
              {showAgentColumn && (
                <th className="px-3 py-2 font-medium">Agent</th>
              )}
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Tool</th>
              <th className="px-3 py-2 font-medium text-right">In</th>
              <th className="px-3 py-2 font-medium text-right">Out</th>
              <th className="px-3 py-2 font-medium text-right">Read</th>
              <th className="px-3 py-2 font-medium text-right">Write</th>
              <th className="px-3 py-2 font-medium text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {events.map((e) => {
              const agentColor = colorMap?.get(e.agent_id) ?? "#94a3b8";
              const agentName = nameMap?.get(e.agent_id) ?? "main";
              const eventNumber = eventNumberMap.get(e.id) ?? "?";

              return (
                <tr
                  key={e.id}
                  onClick={() => onSelect(e)}
                  className={cn(
                    "border-t border-border hover:bg-primary/5 cursor-pointer transition-colors",
                    selected?.id === e.id ? "bg-primary/10" : ""
                  )}
                >
                  <td className="px-2 py-2 text-right font-mono text-muted text-[10px]">
                    {eventNumber}
                  </td>
                  <td
                    className="px-3 py-2 font-mono text-muted whitespace-nowrap"
                    title={timeAgo(e.timestamp)}
                  >
                    {formatTimestamp(e.timestamp)}
                  </td>
                  {showAgentColumn && (
                    <td className="px-3 py-2">
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="w-2 h-2 rounded-full shrink-0"
                          style={{ backgroundColor: agentColor }}
                        />
                        <span className="text-primary-dark">{agentName}</span>
                      </span>
                    </td>
                  )}
                  <td className="px-3 py-2">
                    <span
                      className={cn(
                        "px-1.5 py-0.5 rounded text-[10px] font-medium",
                        e.type === "assistant"
                          ? "bg-primary/10 text-primary"
                          : e.type === "user"
                            ? "bg-accent/20 text-primary-dark"
                            : "bg-surface text-muted"
                      )}
                    >
                      {e.type}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-muted">
                    {e.model?.replace("claude-", "") ?? "\u2014"}
                  </td>
                  <td className="px-3 py-2">
                    {(() => {
                      const toolLabel = getToolLabel(e);
                      if (toolLabel.style === "tool") {
                        return <span className="font-mono text-primary">{toolLabel.text}</span>;
                      }
                      if (toolLabel.style === "human") {
                        return <span className="font-medium text-amber-600">{toolLabel.text}</span>;
                      }
                      return <span className="text-muted">{toolLabel.text}</span>;
                    })()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {e.input_tokens != null
                      ? formatTokens(e.input_tokens)
                      : "\u2014"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {e.output_tokens != null
                      ? formatTokens(e.output_tokens)
                      : "\u2014"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {e.cache_read_tokens != null ? formatTokens(e.cache_read_tokens) : "\u2014"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {e.cache_creation_tokens != null ? formatTokens(e.cache_creation_tokens) : "\u2014"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {e.cost_usd != null ? formatCost(e.cost_usd) : "\u2014"}
                  </td>
                </tr>
              );
            })}
            {events.length === 0 && !isLoading && (
              <tr>
                <td
                  colSpan={colCount}
                  className="px-3 py-8 text-center text-muted"
                >
                  No events found
                </td>
              </tr>
            )}
          </tbody>
        </table>

        {/* Bottom loading indicator */}
        {isLoading && !hasPrevious && (
          <div className="flex items-center justify-center py-4 text-sm text-muted">
            <svg
              className="animate-spin h-4 w-4 mr-2 text-primary"
              viewBox="0 0 24 24"
              fill="none"
            >
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"
              />
            </svg>
            Loading...
          </div>
        )}
      </div>

      {/* Jump bar */}
      <div className="flex items-center justify-between mt-3 text-sm text-muted">
        <span>
          {visibleNumbers.length > 0
            ? `Showing #${minVisible}\u2013#${maxVisible} of ${total} events`
            : total > 0
              ? `${total} events (all filtered)`
              : "0 events"}
        </span>
        <div className="flex items-center gap-2">
          <button
            disabled={offset <= 0}
            onClick={() => onJumpTo(Math.min(total, (maxVisible) + jumpStep))}
            className="px-2.5 py-1 border border-border rounded-lg disabled:opacity-30 hover:border-primary text-xs font-medium"
            title={`Jump ${jumpStep} events newer`}
          >
            +{jumpStep}
          </button>
          <input
            type="number"
            min={1}
            max={total}
            value={jumpInput}
            onChange={(e) => setJumpInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleJumpSubmit();
            }}
            placeholder="Event #"
            className="w-20 border border-border rounded-lg px-2 py-1 text-xs text-center"
          />
          <button
            disabled={!hasMore}
            onClick={() => onJumpTo(Math.max(1, (minVisible) - jumpStep))}
            className="px-2.5 py-1 border border-border rounded-lg disabled:opacity-30 hover:border-primary text-xs font-medium"
            title={`Jump ${jumpStep} events older`}
          >
            -{jumpStep}
          </button>
          <button
            onClick={handleScrollToTop}
            className="px-2.5 py-1 border border-border rounded-lg hover:border-primary text-xs font-medium"
            title="Jump to most recent"
          >
            Latest
          </button>
        </div>
      </div>
    </div>
  );
}
