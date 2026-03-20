// src/client/components/AgentGraph.tsx
import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import * as d3Force from "d3-force";
import type { Agent, Event } from "../lib/types";
import { formatTokens } from "../lib/utils";
import { useSettings } from "../contexts/SettingsContext";

interface GraphNode {
  id: string;
  label: string;
  type: string;
  tokens: number;
  eventCount: number;
  description: string | null;
  colorIndex: number;
  x: number;
  y: number;
  fx?: number | null; // fixed position after drag
  fy?: number | null;
}

interface GraphLink {
  source: string;
  target: string;
  tokens: number;
  lastActiveAt: number; // timestamp ms
  color: string;
}

interface Transform {
  x: number;
  y: number;
  scale: number;
}

interface Tooltip {
  x: number;
  y: number;
  node: GraphNode;
}

export function AgentGraph({ agents, events }: { agents: Agent[]; events: Event[] }) {
  const { settings } = useSettings();
  const AGENT_COLORS: string[] = settings["graph.agentColors"] ?? ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];
  const MAIN_COLOR: string = settings["graph.mainColor"] ?? "#003864";
  const formatOpts = {
    kThreshold: settings["display.tokenKThreshold"] as number,
    mThreshold: settings["display.tokenMThreshold"] as number,
  };
  const containerRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState({ width: 800, height: 1000 });
  const [nodePositions, setNodePositions] = useState<Map<string, { x: number; y: number }>>(new Map());
  const [transform, setTransform] = useState<Transform>({ x: 0, y: 0, scale: 1 });
  const [tooltip, setTooltip] = useState<Tooltip | null>(null);

  // Interaction refs (avoid re-renders during drag/pan)
  const dragRef = useRef<{ nodeId: string; offsetX: number; offsetY: number } | null>(null);
  const panRef = useRef<{ startX: number; startY: number; startTx: number; startTy: number } | null>(null);
  const transformRef = useRef(transform);
  transformRef.current = transform;
  const simulationRef = useRef<d3Force.Simulation<any, any> | null>(null);
  const simNodesRef = useRef<any[]>([]);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const { width, height } = entries[0].contentRect;
      setSize({ width: Math.max(width, 300), height: Math.max(height, 1000) });
    });
    ro.observe(el);
    // Initial measurement
    const rect = el.getBoundingClientRect();
    setSize({ width: Math.max(rect.width, 300), height: Math.max(rect.height, 1000) });
    return () => ro.disconnect();
  }, []);

  // Build graph data
  const { nodes, links, maxTokens } = useMemo(() => {
    // Count events per agent
    const agentEventCounts = new Map<string | null, number>();
    for (const e of events) {
      const key = e.agent_id;
      agentEventCounts.set(key, (agentEventCounts.get(key) ?? 0) + 1);
    }

    // Count tokens per agent
    const agentTokens = new Map<string | null, number>();
    for (const e of events) {
      const key = e.agent_id;
      const tokens = (e.input_tokens ?? 0) + (e.output_tokens ?? 0);
      agentTokens.set(key, (agentTokens.get(key) ?? 0) + tokens);
    }

    const nodes: GraphNode[] = [];

    // Synthetic "main" node for events with agent_id === null
    const mainEventCount = agentEventCounts.get(null) ?? 0;
    const mainTokens = agentTokens.get(null) ?? 0;
    nodes.push({
      id: "__main__",
      label: "main",
      type: "main",
      tokens: mainTokens,
      eventCount: mainEventCount,
      description: "Main session",
      colorIndex: -1, // special: uses MAIN_COLOR
      x: size.width / 2,
      y: size.height / 2,
    });

    // Agent nodes
    agents.forEach((a, i) => {
      nodes.push({
        id: a.id,
        label: a.agent_type ?? `agent-${i}`,
        type: a.agent_type ?? "unknown",
        tokens: a.total_tokens || (agentTokens.get(a.id) ?? 0),
        eventCount: a.event_count || (agentEventCounts.get(a.id) ?? 0),
        description: a.description,
        colorIndex: i,
        x: size.width / 2 + (Math.random() - 0.5) * 200,
        y: size.height / 2 + (Math.random() - 0.5) * 200,
      });
    });

    const maxTokens = Math.max(...nodes.map((n) => n.tokens), 1);

    // Build a lookup: session_id -> node id (for parent_session linking)
    const sessionToNodeId = new Map<string, string>();
    agents.forEach((a) => {
      sessionToNodeId.set(a.session_id, a.id);
    });

    // Links from parent_session relationships
    const links: GraphLink[] = [];
    const now = Date.now();

    agents.forEach((a, i) => {
      // Find source: the parent. If parent_session matches a known agent's session_id, use that.
      // Otherwise, the parent is main.
      let sourceId = "__main__";
      if (a.parent_session) {
        const parentNodeId = sessionToNodeId.get(a.parent_session);
        if (parentNodeId) {
          sourceId = parentNodeId;
        }
      }

      // Compute last active timestamp for this link
      const agentEvents = events.filter((e) => e.agent_id === a.id);
      const lastActive = agentEvents.length > 0
        ? Math.max(...agentEvents.map((e) => new Date(e.timestamp).getTime()))
        : a.started_at ? new Date(a.started_at).getTime() : now;

      // Source color
      const sourceNode = nodes.find((n) => n.id === sourceId);
      const color = sourceNode
        ? sourceNode.colorIndex === -1
          ? MAIN_COLOR
          : AGENT_COLORS[sourceNode.colorIndex % AGENT_COLORS.length]
        : MAIN_COLOR;

      links.push({
        source: sourceId,
        target: a.id,
        tokens: a.total_tokens || (agentTokens.get(a.id) ?? 0),
        lastActiveAt: lastActive,
        color,
      });
    });

    return { nodes, links, maxTokens };
  }, [agents, events, size.width, size.height]);

  // Run d3-force simulation once, store positions in state
  useEffect(() => {
    if (nodes.length === 0) return;

    const simNodes = nodes.map((n) => ({
      id: n.id,
      x: nodePositions.get(n.id)?.x ?? n.x,
      y: nodePositions.get(n.id)?.y ?? n.y,
    }));

    const simLinks = links.map((l) => ({ source: l.source, target: l.target }));

    const linkDistance: number = settings["graph.linkDistance"] ?? 150;
    const chargeStrength: number = settings["graph.chargeStrength"] ?? -300;
    const collideRadius: number = settings["graph.collideRadius"] ?? 50;
    const alphaDecay: number = settings["graph.alphaDecay"] ?? 0.05;
    const continuous: boolean = settings["graph.continuousSimulation"] ?? false;

    simNodesRef.current = simNodes;

    const simulation = d3Force
      .forceSimulation(simNodes as any)
      .force("link", d3Force.forceLink(simLinks).id((d: any) => d.id).distance(linkDistance))
      .force("charge", d3Force.forceManyBody().strength(chargeStrength))
      .force("center", d3Force.forceCenter(size.width / 2, size.height / 2))
      .force("collide", d3Force.forceCollide(collideRadius))
      .alphaDecay(alphaDecay);

    simulationRef.current = simulation;

    if (continuous) {
      simulation.alphaMin(0).alphaTarget(0.01);
    } else {
      simulation.on("end", () => {
        const positions = new Map<string, { x: number; y: number }>();
        for (const n of simNodes as any[]) {
          positions.set(n.id, { x: n.x, y: n.y });
        }
        setNodePositions(positions);
      });
    }

    // Also update during tick for visual feedback
    let tickCount = 0;
    simulation.on("tick", () => {
      tickCount++;
      if (tickCount % 5 === 0 || simulation.alpha() < 0.02) {
        const positions = new Map<string, { x: number; y: number }>();
        for (const n of simNodes as any[]) {
          positions.set(n.id, { x: n.x, y: n.y });
        }
        setNodePositions(positions);
      }
    });

    return () => { simulation.stop(); simulationRef.current = null; };
  }, [nodes.length, links.length, size.width, size.height,
    settings["graph.linkDistance"],
    settings["graph.chargeStrength"],
    settings["graph.collideRadius"],
    settings["graph.alphaDecay"],
    settings["graph.continuousSimulation"],
    settings["graph.linkThicknessMin"],
    settings["graph.linkThicknessMax"],
    settings["graph.opacityDecayMinutes"],
  ]);

  // Zoom handler — attached directly to DOM for non-passive event handling
  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      e.preventDefault();
      e.stopPropagation();
      const scaleFactor = e.deltaY > 0 ? 0.9 : 1.1;
      setTransform((prev) => {
        const newScale = Math.min(5, Math.max(0.2, prev.scale * scaleFactor));
        const rect = el.getBoundingClientRect();
        const cx = e.clientX - rect.left;
        const cy = e.clientY - rect.top;
        const dx = cx - prev.x;
        const dy = cy - prev.y;
        const ratio = newScale / prev.scale;
        return {
          x: cx - dx * ratio,
          y: cy - dy * ratio,
          scale: newScale,
        };
      });
    };
    el.addEventListener("wheel", handler, { passive: false });
    return () => el.removeEventListener("wheel", handler);
  }, []);

  // Pan handlers
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    // Only start pan if clicking on background (not on a node)
    if ((e.target as SVGElement).closest("[data-node-id]")) return;
    panRef.current = {
      startX: e.clientX,
      startY: e.clientY,
      startTx: transformRef.current.x,
      startTy: transformRef.current.y,
    };
  }, []);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    // Handle node drag
    const drag = dragRef.current;
    if (drag) {
      const rect = svgRef.current?.getBoundingClientRect();
      if (!rect) return;
      const t = transformRef.current;
      const svgX = (e.clientX - rect.left - t.x) / t.scale;
      const svgY = (e.clientY - rect.top - t.y) / t.scale;
      const newX = svgX - drag.offsetX;
      const newY = svgY - drag.offsetY;

      // Pin the node in the simulation so forces don't fight the drag
      const sim = simulationRef.current;
      if (sim) {
        const simNode = simNodesRef.current.find((n: any) => n.id === drag.nodeId);
        if (simNode) {
          simNode.fx = newX;
          simNode.fy = newY;
          sim.alpha(0.1).restart();
        }
      }

      setNodePositions((prev) => {
        const next = new Map(prev);
        next.set(drag.nodeId, { x: newX, y: newY });
        return next;
      });
      return;
    }

    // Handle pan
    if (panRef.current) {
      const dx = e.clientX - panRef.current.startX;
      const dy = e.clientY - panRef.current.startY;
      setTransform({
        x: panRef.current.startTx + dx,
        y: panRef.current.startTy + dy,
        scale: transformRef.current.scale,
      });
    }
  }, []);

  const handleMouseUp = useCallback(() => {
    // When continuous simulation is off, unpin the node after drag ends
    const drag = dragRef.current;
    if (drag && simulationRef.current && !settings["graph.continuousSimulation"]) {
      const simNode = simNodesRef.current.find((n: any) => n.id === drag.nodeId);
      if (simNode) {
        simNode.fx = null;
        simNode.fy = null;
      }
    }
    // When continuous simulation is ON, fx/fy stay set — node remains pinned
    dragRef.current = null;
    panRef.current = null;
  }, [settings]);

  // Node drag start
  const handleNodeMouseDown = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const rect = svgRef.current?.getBoundingClientRect();
    if (!rect) return;
    const t = transformRef.current;
    const svgX = (e.clientX - rect.left - t.x) / t.scale;
    const svgY = (e.clientY - rect.top - t.y) / t.scale;
    const pos = nodePositions.get(nodeId);
    if (!pos) return;
    dragRef.current = {
      nodeId,
      offsetX: svgX - pos.x,
      offsetY: svgY - pos.y,
    };
    setTooltip(null);
  }, [nodePositions]);

  // Double-click to unpin a node (clear fx/fy so simulation moves it freely)
  const handleNodeDoubleClick = useCallback((e: React.MouseEvent, nodeId: string) => {
    e.stopPropagation();
    const sim = simulationRef.current;
    if (!sim) return;
    const simNode = simNodesRef.current.find((n: any) => n.id === nodeId);
    if (simNode) {
      simNode.fx = null;
      simNode.fy = null;
      sim.alpha(0.3).restart();
    }
  }, []);

  // Tooltip handlers
  const handleNodeEnter = useCallback((e: React.MouseEvent, node: GraphNode) => {
    if (dragRef.current) return;
    const rect = containerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setTooltip({
      x: e.clientX - rect.left + 12,
      y: e.clientY - rect.top - 8,
      node,
    });
  }, []);

  const handleNodeLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  if (agents.length === 0) {
    return (
      <p className="text-muted text-sm">
        No agent interactions to display. This view is available for team sessions with multiple agents.
      </p>
    );
  }

  const now = Date.now();

  // Compute radius for a node
  const radius = (tokens: number) => 16 + Math.min((tokens / maxTokens) * 24, 24);

  // Compute link thickness based on tokens
  const minTokens = Math.min(...links.map(l => l.tokens));
  const maxTokens2 = Math.max(...links.map(l => l.tokens));
  const thicknessMin: number = settings["graph.linkThicknessMin"] ?? 1;
  const thicknessMax: number = settings["graph.linkThicknessMax"] ?? 10;
  const linkThickness = (tokens: number) => {
    if (maxTokens2 === minTokens) return (thicknessMin + thicknessMax) / 2;
    return thicknessMin + ((tokens - minTokens) / (maxTokens2 - minTokens)) * (thicknessMax - thicknessMin);
  };

  // Compute link color fade (desaturate toward gray over configurable minutes)
  const opacityDecayMinutes: number = settings["graph.opacityDecayMinutes"] ?? 1;
  const linkFade = (lastActiveAt: number) => {
    const minutesSince = (now - lastActiveAt) / 60_000;
    return Math.max(0.3, 1 - (minutesSince / opacityDecayMinutes) * 0.7);
  };

  const interpolateToGray = (hex: string, factor: number): string => {
    const gray = [148, 163, 184]; // #94a3b8
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return hex;
    return `rgb(${Math.round(r * factor + gray[0] * (1 - factor))},${Math.round(g * factor + gray[1] * (1 - factor))},${Math.round(b * factor + gray[2] * (1 - factor))})`;
  };

  const fadedColor = (color: string, lastActiveAt: number) =>
    interpolateToGray(color, linkFade(lastActiveAt));

  const nodeColor = (n: GraphNode) =>
    n.colorIndex === -1 ? MAIN_COLOR : AGENT_COLORS[n.colorIndex % AGENT_COLORS.length];

  return (
    <div
      ref={containerRef}
      className="relative border border-border rounded-xl bg-white overflow-hidden"
      style={{ minHeight: 1000 }}
    >
      <svg
        ref={svgRef}
        width={size.width}
        height={size.height}
        className="block"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
        style={{ cursor: panRef.current ? "grabbing" : "grab" }}
      >
        <defs>
          {/* Arrow markers per link color */}
          {links.map((link) => {
            const markerId = `arrow-${link.source}-${link.target}`;
            return (
              <marker
                key={markerId}
                id={markerId}
                viewBox="0 0 10 6"
                refX="0"
                refY="3"
                markerUnits="userSpaceOnUse"
                markerWidth={Math.max(8, linkThickness(link.tokens) * 2)}
                markerHeight={Math.max(8, linkThickness(link.tokens) * 2) * 0.6}
                orient="auto"
              >
                <path d="M 0 0 L 10 3 L 0 6 Z" fill={fadedColor(link.color, link.lastActiveAt)} />
              </marker>
            );
          })}
        </defs>

        <g transform={`translate(${transform.x}, ${transform.y}) scale(${transform.scale})`}>
          {/* Links */}
          {links.map((link, i) => {
            const sourcePos = nodePositions.get(link.source);
            const targetPos = nodePositions.get(link.target);
            if (!sourcePos || !targetPos) return null;

            // Shorten line so arrow tip sits at circle edge
            const targetNode = nodes.find((n) => n.id === link.target);
            const sourceNode2 = nodes.find((n) => n.id === link.source);
            const rTarget = targetNode ? radius(targetNode.tokens) : 20;
            const rSource = sourceNode2 ? radius(sourceNode2.tokens) : 20;
            const dx = targetPos.x - sourcePos.x;
            const dy = targetPos.y - sourcePos.y;
            const dist = Math.hypot(dx, dy);
            if (dist === 0) return null;
            const nx = dx / dist;
            const ny = dy / dist;
            // markerUnits="userSpaceOnUse" + refX="0": tip protrudes markerWidth px
            // beyond the line endpoint. markerWidth = max(8, thickness*2).
            const thickness = linkThickness(link.tokens);
            const markerLen = Math.max(8, thickness * 2);

            return (
              <line
                key={`${link.source}-${link.target}`}
                x1={sourcePos.x + nx * rSource}
                y1={sourcePos.y + ny * rSource}
                x2={targetPos.x - nx * (rTarget + markerLen)}
                y2={targetPos.y - ny * (rTarget + markerLen)}
                stroke={fadedColor(link.color, link.lastActiveAt)}
                strokeWidth={linkThickness(link.tokens)}
                markerEnd={`url(#arrow-${link.source}-${link.target})`}
              />
            );
          })}

          {/* Nodes */}
          {nodes.map((node) => {
            const pos = nodePositions.get(node.id);
            if (!pos) return null;
            const r = radius(node.tokens);
            const color = nodeColor(node);

            return (
              <g
                key={node.id}
                data-node-id={node.id}
                transform={`translate(${pos.x}, ${pos.y})`}
                onMouseDown={(e) => handleNodeMouseDown(e, node.id)}
                onDoubleClick={(e) => handleNodeDoubleClick(e, node.id)}
                onMouseEnter={(e) => handleNodeEnter(e, node)}
                onMouseLeave={handleNodeLeave}
                style={{ cursor: "pointer" }}
              >
                <circle
                  r={r}
                  fill={color}
                  opacity={0.85}
                  stroke="white"
                  strokeWidth={2}
                />
                {/* Icon/letter inside circle */}
                <text
                  textAnchor="middle"
                  dy="0.35em"
                  fill="white"
                  fontSize={Math.max(11, r * 0.6)}
                  fontWeight={700}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {node.label.charAt(0).toUpperCase()}
                </text>
                {/* Label below */}
                <text
                  y={r + 14}
                  textAnchor="middle"
                  fill="#003864"
                  fontSize={11}
                  fontWeight={500}
                  style={{ pointerEvents: "none", userSelect: "none" }}
                >
                  {node.label}
                </text>
              </g>
            );
          })}
        </g>
      </svg>

      {/* Tooltip */}
      {tooltip && (
        <div
          className="absolute z-50 pointer-events-none rounded-lg border border-border bg-white px-3 py-2 shadow-lg text-xs"
          style={{ left: tooltip.x, top: tooltip.y }}
        >
          <div className="font-semibold text-[#003864] mb-1">{tooltip.node.label}</div>
          <div className="text-[#64748b] space-y-0.5">
            <div>Type: {tooltip.node.type}</div>
            {tooltip.node.description && <div>Description: {tooltip.node.description}</div>}
            <div>Events: {tooltip.node.eventCount}</div>
            <div>Tokens: {formatTokens(tooltip.node.tokens, formatOpts)}</div>
          </div>
        </div>
      )}

      {/* Zoom indicator */}
      {transform.scale !== 1 && (
        <div className="absolute bottom-2 right-2 text-xs text-[#64748b] bg-white/80 px-2 py-0.5 rounded border border-border">
          {Math.round(transform.scale * 100)}%
        </div>
      )}
    </div>
  );
}
