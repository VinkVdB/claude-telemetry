// src/client/components/TraceView.tsx
import { useState, useMemo, useRef, useEffect } from "react";
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

export function TraceView({ events, agents }: { events: Event[]; agents: Agent[] }) {
  const { settings } = useSettings();
  const AGENT_COLORS: string[] = settings["graph.agentColors"] ?? ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];
  const ROW_HEIGHT: number = settings["display.traceRowHeight"] ?? 32;
  const LABEL_WIDTH: number = settings["display.traceLabelWidth"] ?? 160;
  const MIN_SPAN_WIDTH: number = settings["display.traceMinSpanWidth"] ?? 4;
  const [selected, setSelected] = useState<Event | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
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

  const { spans, totalMs, minTime } = useMemo(() => {
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

  if (spans.length === 0) return <p className="text-muted text-sm">No trace data available.</p>;

  const laneCount = Math.max(...spans.map((s) => s.lane)) + 1;
  const svgHeight = laneCount * (ROW_HEIGHT + 2) + 40;

  return (
    <div ref={containerRef} className="overflow-x-auto">
      <svg width={LABEL_WIDTH + timelineWidth + 20} height={svgHeight} className="text-sm">
        {/* Time axis */}
        {[0, 0.25, 0.5, 0.75, 1].map((pct) => {
          const x = LABEL_WIDTH + pct * timelineWidth;
          const timeMs = pct * totalMs;
          return (
            <g key={pct}>
              <line x1={x} y1={0} x2={x} y2={svgHeight} stroke="#e2e8f0" strokeWidth={1} />
              <text x={x} y={svgHeight - 4} fill="#64748b" fontSize={10} textAnchor="middle">
                {timeMs < 1000 ? `${Math.round(timeMs)}ms` : `${(timeMs / 1000).toFixed(1)}s`}
              </text>
            </g>
          );
        })}

        {/* Lane labels */}
        {Array.from(laneLabels.entries()).map(([lane, label]) => {
          // Only render if this lane has spans
          if (lane >= laneCount) return null;
          return (
            <text
              key={lane}
              x={LABEL_WIDTH - 8}
              y={lane * (ROW_HEIGHT + 2) + ROW_HEIGHT / 2 + 16}
              fill="#003864"
              fontSize={12}
              fontWeight={500}
              textAnchor="end"
            >
              {label}
            </text>
          );
        })}

        {/* Spans */}
        {spans.map((span) => {
          const x = LABEL_WIDTH + (span.startMs / totalMs) * timelineWidth;
          const width = Math.max(((span.endMs - span.startMs) / totalMs) * timelineWidth, MIN_SPAN_WIDTH);
          const y = span.lane * (ROW_HEIGHT + 2) + 2;

          return (
            <g
              key={span.event.id}
              onClick={() => setSelected(span.event)}
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

      <DetailPanel event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
