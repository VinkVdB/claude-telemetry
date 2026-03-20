// src/client/components/TraceView.tsx
import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import type { Event, Agent } from "../lib/types";
import { DetailPanel } from "./DetailPanel";
import { formatTokens, formatCost, cn } from "../lib/utils";
import { useSettings } from "../contexts/SettingsContext";

interface Span {
  event: Event;
  startMs: number;
  endMs: number;
  lane: number;
  color: string;
  label: string;
}

function formatTime(ms: number): string {
  const totalSecs = Math.floor(ms / 1000);
  const h = Math.floor(totalSecs / 3600);
  const m = Math.floor((totalSecs % 3600) / 60);
  const s = totalSecs % 60;
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}m`;
  if (m > 0) return `${m}m${s.toString().padStart(2, "0")}s`;
  return `${s}s`;
}

export function TraceView({ events, agents }: { events: Event[]; agents: Agent[] }) {
  const { settings } = useSettings();
  const AGENT_COLORS: string[] = settings["graph.agentColors"] ?? ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];
  const ROW_HEIGHT: number = settings["display.traceRowHeight"] ?? 32;
  const LABEL_WIDTH: number = settings["display.traceLabelWidth"] ?? 160;
  const MIN_SPAN_WIDTH: number = settings["display.traceMinSpanWidth"] ?? 4;
  const ROW_GAP = 2;
  const [selected, setSelected] = useState<Event | null>(null);
  const [hoveredLane, setHoveredLane] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const scrubberRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(800);

  // Track container width
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width } = entries[0].contentRect;
      setContainerWidth(Math.max(width, 400));
    });
    ro.observe(el);
    const rect = el.getBoundingClientRect();
    setContainerWidth(Math.max(rect.width, 400));
    return () => ro.disconnect();
  }, []);

  const timelineWidth = Math.max(containerWidth - LABEL_WIDTH - 20, 200);

  // Assign lanes based on agent_id, not session_id
  const agentLanes = useMemo(() => {
    const lanes = new Map<string | null, number>();
    lanes.set(null, 0); // main session = lane 0
    agents.forEach((a, i) => {
      lanes.set(a.id, i + 1);
    });
    return lanes;
  }, [agents]);

  const laneLabels = useMemo(() => {
    const labels = new Map<number, string>();
    labels.set(0, "main");
    agents.forEach((a, i) => {
      labels.set(i + 1, a.agent_type ?? `agent-${i}`);
    });
    return labels;
  }, [agents]);

  const { spans: allSpans, totalMs, minTime } = useMemo(() => {
    const assistantEvents = events.filter((e) => e.type === "assistant" && e.timestamp);
    if (assistantEvents.length === 0) return { spans: [], totalMs: 0, minTime: 0 };

    const times = assistantEvents.map((e) => new Date(e.timestamp).getTime());
    const minT = Math.min(...times);
    const maxT = Math.max(...times);
    const totalMs = Math.max(maxT - minT, 1000); // minimum 1s range

    const spans: Span[] = assistantEvents.map((e, i) => {
      const startMs = new Date(e.timestamp).getTime() - minT;
      // Estimate end time: use duration_ms if available, else use next event's timestamp, else 2s default
      const nextEvent = assistantEvents[i + 1];
      const duration = e.duration_ms ?? (nextEvent
        ? Math.min(new Date(nextEvent.timestamp).getTime() - new Date(e.timestamp).getTime(), 30000)
        : 2000);
      const lane = agentLanes.get(e.agent_id) ?? 0;
      const color = lane === 0 ? settings["graph.mainColor"] ?? "#ff26f8" : AGENT_COLORS[lane % AGENT_COLORS.length];

      return {
        event: e,
        startMs,
        endMs: startMs + duration,
        lane,
        color,
        label: e.tool_name ?? e.stop_reason ?? e.type,
      };
    });

    return { spans, totalMs, minTime: minT };
  }, [events, agentLanes]);

  // Time range selector state
  const startMs = 0;
  const endMs = totalMs;
  const [selectedRange, setSelectedRange] = useState<{ start: number; end: number }>({ start: 0, end: 0 });
  const dragRef = useRef<{ handle: "start" | "end" | "create"; startX: number; initialRange: { start: number; end: number }; createStartPct?: number } | null>(null);

  // Reset selected range when totalMs changes
  useEffect(() => {
    setSelectedRange({ start: 0, end: totalMs });
  }, [totalMs]);

  // Filtered spans based on selected range
  const filteredSpans = useMemo(() => {
    return allSpans.filter(
      (span) => span.endMs >= selectedRange.start && span.startMs <= selectedRange.end
    );
  }, [allSpans, selectedRange]);

  // Compute visible range duration for scaling
  const visibleDuration = Math.max(selectedRange.end - selectedRange.start, 1);

  // Drag logic for scrubber handles
  const handleMouseMove = useCallback((e: MouseEvent) => {
    const drag = dragRef.current;
    const scrubber = scrubberRef.current;
    if (!drag || !scrubber) return;

    const rect = scrubber.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    const timePos = startMs + pct * (endMs - startMs);

    if (drag.handle === "start") {
      setSelectedRange((prev) => ({
        start: Math.min(timePos, prev.end - 100),
        end: prev.end,
      }));
    } else if (drag.handle === "end") {
      setSelectedRange((prev) => ({
        start: prev.start,
        end: Math.max(timePos, prev.start + 100),
      }));
    } else if (drag.handle === "create") {
      const createStartTime = startMs + (drag.createStartPct ?? 0) * (endMs - startMs);
      const rangeStart = Math.min(createStartTime, timePos);
      const rangeEnd = Math.max(createStartTime, timePos);
      setSelectedRange({
        start: Math.max(rangeStart, startMs),
        end: Math.min(rangeEnd, endMs),
      });
    }
  }, [startMs, endMs]);

  const handleMouseUp = useCallback(() => {
    dragRef.current = null;
    window.removeEventListener("mousemove", handleMouseMove);
    window.removeEventListener("mouseup", handleMouseUp);
  }, [handleMouseMove]);

  const startDragHandle = useCallback((e: React.MouseEvent, handle: "start" | "end") => {
    e.preventDefault();
    dragRef.current = { handle, startX: e.clientX, initialRange: { ...selectedRange } };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [selectedRange, handleMouseMove, handleMouseUp]);

  const handleScrubberMouseDown = useCallback((e: React.MouseEvent) => {
    const scrubber = scrubberRef.current;
    if (!scrubber) return;
    e.preventDefault();
    const rect = scrubber.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    dragRef.current = { handle: "create", startX: e.clientX, initialRange: { ...selectedRange }, createStartPct: pct };
    window.addEventListener("mousemove", handleMouseMove);
    window.addEventListener("mouseup", handleMouseUp);
  }, [selectedRange, handleMouseMove, handleMouseUp]);

  if (allSpans.length === 0) return <p className="text-muted text-sm">No trace data available.</p>;

  const laneCount = Math.max(...allSpans.map((s) => s.lane)) + 1;
  const svgHeight = laneCount * (ROW_HEIGHT + ROW_GAP) + 40;
  const uniqueLanes = Array.from(new Set(allSpans.map((s) => s.lane)));
  const totalDuration = endMs - startMs;
  const isRangeSelected = selectedRange.start !== startMs || selectedRange.end !== endMs;

  return (
    <div ref={containerRef} className="overflow-x-auto">
      <svg width={LABEL_WIDTH + timelineWidth + 20} height={svgHeight} className="text-sm">
        {/* Time axis */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const x = LABEL_WIDTH + pct * timelineWidth;
          const timeMs = selectedRange.start + pct * visibleDuration;
          return (
            <g key={pct}>
              <line x1={x} y1={0} x2={x} y2={svgHeight} stroke="#e2e8f0" strokeWidth={1} />
              <text x={x} y={svgHeight - 4} fill="#64748b" fontSize={10} textAnchor="middle">
                {timeMs < 1000 ? `${Math.round(timeMs)}ms` : `${(timeMs / 1000).toFixed(1)}s`}
              </text>
            </g>
          );
        })}

        {/* Lane hover highlights */}
        {uniqueLanes.map((lane) => (
          <rect
            key={`hover-bg-${lane}`}
            x={0}
            y={lane * (ROW_HEIGHT + ROW_GAP)}
            width={LABEL_WIDTH + timelineWidth + 20}
            height={ROW_HEIGHT + ROW_GAP}
            fill="#00a2e0"
            fillOpacity={hoveredLane === lane ? 0.08 : 0}
          />
        ))}

        {/* Lane labels */}
        {Array.from(laneLabels.entries()).map(([lane, label]) => {
          // Only render if this lane has spans
          if (lane >= laneCount) return null;
          const isHovered = hoveredLane === lane;
          return (
            <text
              key={lane}
              x={LABEL_WIDTH - 8}
              y={lane * (ROW_HEIGHT + ROW_GAP) + ROW_HEIGHT / 2 + 2}
              fill={isHovered ? "#00a2e0" : "#003864"}
              fontSize={12}
              fontWeight={isHovered ? 700 : 500}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {label}
            </text>
          );
        })}

        {/* Spans */}
        {filteredSpans.map((span) => {
          const clampedStart = Math.max(span.startMs, selectedRange.start);
          const clampedEnd = Math.min(span.endMs, selectedRange.end);
          const x = LABEL_WIDTH + ((clampedStart - selectedRange.start) / visibleDuration) * timelineWidth;
          const width = Math.max(((clampedEnd - clampedStart) / visibleDuration) * timelineWidth, MIN_SPAN_WIDTH);
          const y = span.lane * (ROW_HEIGHT + ROW_GAP) + 2;

          return (
            <g
              key={span.event.id}
              onClick={() => setSelected(span.event)}
              onMouseEnter={() => setHoveredLane(span.lane)}
              onMouseLeave={() => setHoveredLane(null)}
              className="cursor-pointer"
              role="button"
            >
              <rect
                x={x}
                y={y}
                width={width}
                height={ROW_HEIGHT}
                rx={4}
                fill={span.color}
                opacity={0.85}
                className="hover:opacity-100 transition-opacity"
              />
              {width > 40 && (
                <text
                  x={x + 6}
                  y={y + ROW_HEIGHT / 2 + 4}
                  fill="white"
                  fontSize={10}
                  fontWeight={500}
                >
                  {span.label}
                </text>
              )}
            </g>
          );
        })}
      </svg>

      {/* Time range selector / scrubber */}
      <div className="mt-3 px-4" style={{ paddingLeft: LABEL_WIDTH + 10 }}>
        <div className="text-xs text-muted mb-1 flex justify-between">
          <span>{formatTime(selectedRange.start)}</span>
          <span>drag to select range</span>
          <span>{formatTime(selectedRange.end)}</span>
        </div>
        {/* Range slider track */}
        <div
          ref={scrubberRef}
          className="relative h-8 bg-gray-100 rounded-lg cursor-crosshair select-none"
          onMouseDown={handleScrubberMouseDown}
        >
          {/* Selected range highlight */}
          <div
            className="absolute inset-y-0 bg-[#00a2e0]/20 border-x-2 border-[#00a2e0] rounded"
            style={{
              left: `${totalDuration > 0 ? ((selectedRange.start - startMs) / totalDuration) * 100 : 0}%`,
              width: `${totalDuration > 0 ? ((selectedRange.end - selectedRange.start) / totalDuration) * 100 : 100}%`,
            }}
          />
          {/* Mini-spans preview */}
          {allSpans.map((span, i) => (
            <div
              key={i}
              className="absolute inset-y-1 rounded-sm opacity-40"
              style={{
                left: `${totalDuration > 0 ? ((span.startMs - startMs) / totalDuration) * 100 : 0}%`,
                width: `${Math.max(0.5, totalDuration > 0 ? ((span.endMs - span.startMs) / totalDuration) * 100 : 1)}%`,
                backgroundColor: span.color,
              }}
            />
          ))}
          {/* Left handle */}
          <div
            className="absolute inset-y-0 w-2 bg-[#00a2e0] rounded-l cursor-ew-resize"
            style={{ left: `${totalDuration > 0 ? ((selectedRange.start - startMs) / totalDuration) * 100 : 0}%` }}
            onMouseDown={(e) => { e.stopPropagation(); startDragHandle(e, "start"); }}
          />
          {/* Right handle */}
          <div
            className="absolute inset-y-0 w-2 bg-[#00a2e0] rounded-r cursor-ew-resize"
            style={{ left: `calc(${totalDuration > 0 ? ((selectedRange.end - startMs) / totalDuration) * 100 : 100}% - 8px)` }}
            onMouseDown={(e) => { e.stopPropagation(); startDragHandle(e, "end"); }}
          />
        </div>
        {isRangeSelected ? (
          <button
            onClick={() => setSelectedRange({ start: startMs, end: endMs })}
            className="mt-1 text-xs text-[#00a2e0] hover:underline"
          >
            Reset to full range
          </button>
        ) : null}
      </div>

      <DetailPanel event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
