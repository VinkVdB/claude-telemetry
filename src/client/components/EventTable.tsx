import { useRef, useCallback, useState, useEffect, useMemo } from "react";
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
  /** Optional: client-side search query to filter rendered rows */
  searchQuery?: string;
}

interface ToolLabel {
  text: string;
  /** tool = blue (tool use), human = orange (user input), hook = gray (hooks/system) */
  style: "tool" | "human" | "hook";
}

function getToolLabel(e: Event): ToolLabel {
  // assistant: tool_name in blue, or stop_reason in gray
  if (e.type === "assistant") {
    if (e.tool_name) {
      // Agent tool: show subagent type as postfix
      if (e.tool_name === "Agent" && e.raw) {
        try {
          const parsed = JSON.parse(e.raw);
          const content = parsed?.message?.content;
          if (Array.isArray(content)) {
            const toolBlock = content.find((b: any) => b.type === "tool_use" && b.name === "Agent");
            const subType = toolBlock?.input?.subagent_type;
            if (subType) {
              const truncated = subType.length > 12 ? `${subType.slice(0, 12)}\u2026` : subType;
              return { text: `Agent: ${truncated}`, style: "tool" };
            }
          }
        } catch {}
      }
      return { text: e.tool_name, style: "tool" };
    }
    // Pure thinking response (no tool call)
    if (e.raw) {
      try {
        const parsed = JSON.parse(e.raw);
        const content = parsed?.message?.content;
        if (Array.isArray(content) && content[0]?.type === "thinking") {
          return { text: "Thinking", style: "tool" };
        }
      } catch {}
    }
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

  // Check for hookInfos in raw JSON — gray
  if (e.raw) {
    try {
      const parsed = JSON.parse(e.raw);
      if (Array.isArray(parsed?.hookInfos) && parsed.hookInfos.length > 0) {
        return { text: "Hook", style: "hook" };
      }
    } catch {}
  }

  // user: Answer/Prompt in orange, with content preview
  if (e.type === "user") {
    // Try to extract preview from raw JSONL
    if (e.raw) {
      try {
        const parsed = JSON.parse(e.raw);
        const content = parsed?.message?.message?.content;
        if (Array.isArray(content) && content[0]?.type === "tool_result") {
          // tool_result: show tool_name if set, or extract preview from result content — blue style
          const resultContent = content[0]?.content;
          let preview = "";
          if (typeof resultContent === "string") {
            preview = resultContent.slice(0, 40);
          } else if (Array.isArray(resultContent)) {
            const textBlock = resultContent.find((b: any) => b.type === "text");
            if (textBlock?.text) preview = textBlock.text.slice(0, 40);
          }
          const label = e.tool_name && e.tool_name !== "tool_result"
            ? e.tool_name
            : preview
              ? `Answer: ${preview}${preview.length >= 40 ? "\u2026" : ""}`
              : "Answer";
          return { text: label, style: "tool" };
        }
        if (typeof content === "string") {
          const preview = content.slice(0, 50);
          return {
            text: `Prompt: ${preview}${content.length > 50 ? "\u2026" : ""}`,
            style: "human",
          };
        }
      } catch {}
    }
    // Fallback: try content field (parsed content blocks)
    if (e.content) {
      try {
        const blocks = JSON.parse(e.content);
        if (Array.isArray(blocks) && blocks[0]?.type === "tool_result") {
          return { text: e.tool_name ?? "Answer", style: "tool" };
        }
        if (Array.isArray(blocks)) {
          const textBlock = blocks.find((b: any) => b.type === "text");
          if (textBlock?.text) {
            const preview = textBlock.text.slice(0, 50);
            return { text: `Prompt: ${preview}${textBlock.text.length > 50 ? "\u2026" : ""}`, style: "human" };
          }
        }
      } catch {
        // content is a plain string
        if (typeof e.content === "string" && e.content.length > 0) {
          const preview = e.content.slice(0, 50);
          return { text: `Prompt: ${preview}${e.content.length > 50 ? "\u2026" : ""}`, style: "human" };
        }
      }
    }
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
  searchQuery,
}: EventTableProps) {
  const { settings } = useSettings();
  const jumpStep = settings["display.jumpStepSize"] ?? 50;
  const formatOpts = {
    kThreshold: settings["display.tokenKThreshold"] as number,
    mThreshold: settings["display.tokenMThreshold"] as number,
    costPrecisionThreshold: settings["display.costPrecisionThreshold"] as number,
    timeAgoJustNow: settings["display.timeAgoJustNow"] as number,
    timeAgoMinutes: settings["display.timeAgoMinutes"] as number,
    timeAgoHours: settings["display.timeAgoHours"] as number,
  };
  // Client-side search filter: match against getToolLabel text, type, model, agent name
  const displayEvents = useMemo(() => {
    if (!searchQuery) return events;
    const q = searchQuery.toLowerCase();
    return events.filter(e => {
      if (getToolLabel(e).text.toLowerCase().includes(q)) return true;
      if (e.type.toLowerCase().includes(q)) return true;
      if (e.model?.toLowerCase().includes(q)) return true;
      const agentName = nameMap?.get(e.agent_id) ?? "";
      if (agentName.toLowerCase().includes(q)) return true;
      return false;
    });
  }, [events, searchQuery, nameMap]);

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

    const targetIndex = events.findIndex((e) => e.id === jumpTargetEventId);
    if (targetIndex < 0) return;

    // Double rAF: first frame commits the DOM, second frame has stable layout measurements
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const el = scrollRef.current;
        if (!el) return;
        const rows = el.querySelectorAll("tbody tr");
        const targetRow = rows[targetIndex] as HTMLElement | undefined;
        if (targetRow) {
          const containerRect = el.getBoundingClientRect();
          const rowRect = targetRow.getBoundingClientRect();
          // Scroll the container (not the page) so the row is centered
          const scrollTarget =
            el.scrollTop +
            (rowRect.top - containerRect.top) -
            containerRect.height / 2 +
            rowRect.height / 2;
          el.scrollTo({ top: Math.max(0, scrollTarget), behavior: "smooth" });

          // Highlight the row for 2s
          targetRow.classList.add("bg-accent/20");
          setTimeout(() => targetRow.classList.remove("bg-accent/20"), 2000);
        }
      });
    });
  }, [jumpTargetEventId, events.length]);

  const handleScrollToTop = useCallback(() => {
    scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
    onScrollToTop();
  }, [onScrollToTop]);

  const handleJumpSubmit = useCallback(() => {
    const num = parseInt(jumpInput, 10);
    if (!isNaN(num) && num >= 1) {
      onJumpTo(num);
      setJumpInput("");
    }
  }, [jumpInput, onJumpTo]);

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
        className="max-h-[calc(100vh-16rem)] min-h-[16rem] overflow-y-auto border border-border rounded-xl"
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
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Action</th>
              <th className="px-3 py-2 font-medium text-right">In</th>
              <th className="px-3 py-2 font-medium text-right">Out</th>
              <th className="px-3 py-2 font-medium text-right">Read</th>
              <th className="px-3 py-2 font-medium text-right">Write</th>
              <th className="px-3 py-2 font-medium text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {displayEvents.map((e) => {
              const agentColor = colorMap?.get(e.agent_id) ?? "#94a3b8";
              const agentName = nameMap?.get(e.agent_id) ?? "main";
              const eventNumber = eventNumberMap.get(e.id) ?? "?";

              return (
                <tr
                  key={e.id}
                  onClick={() => onSelect(e)}
                  className={cn(
                    "border-t border-border hover:bg-primary/5 cursor-pointer transition-colors",
                    selected?.id === e.id
                      ? "bg-primary/10"
                      : e.type === "user"
                        ? "bg-accent/5"
                        : ""
                  )}
                >
                  <td className="px-2 py-2 text-right font-mono text-muted text-[10px]">
                    {eventNumber}
                  </td>
                  <td
                    className="px-3 py-2 font-mono text-muted whitespace-nowrap"
                    title={timeAgo(e.timestamp, formatOpts)}
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
                  <td className="px-3 py-2 text-muted">
                    {e.model?.replace("claude-", "") ?? "\u2014"}
                  </td>
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
                  <td className="px-3 py-2 max-w-[240px]">
                    {(() => {
                      const toolLabel = getToolLabel(e);
                      if (toolLabel.style === "tool") {
                        return <span className="font-mono text-primary truncate block">{toolLabel.text}</span>;
                      }
                      if (toolLabel.style === "human") {
                        return <span className="font-medium text-amber-600 truncate block" title={toolLabel.text}>{toolLabel.text}</span>;
                      }
                      return <span className="text-muted">{toolLabel.text}</span>;
                    })()}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {e.input_tokens != null
                      ? formatTokens(e.input_tokens, formatOpts)
                      : "\u2014"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {e.output_tokens != null
                      ? formatTokens(e.output_tokens, formatOpts)
                      : "\u2014"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {e.cache_read_tokens != null ? formatTokens(e.cache_read_tokens, formatOpts) : "\u2014"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {e.cache_creation_tokens != null ? formatTokens(e.cache_creation_tokens, formatOpts) : "\u2014"}
                  </td>
                  <td className="px-3 py-2 text-right font-mono">
                    {e.otel_cost_usd != null
                      ? <span title="OTEL cost">{formatCost(e.otel_cost_usd, formatOpts)}</span>
                      : e.cost_usd != null
                        ? <span title="Token Cost">{formatCost(e.cost_usd, formatOpts)}</span>
                        : "\u2014"}
                  </td>
                </tr>
              );
            })}
            {displayEvents.length === 0 && !isLoading && (
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
