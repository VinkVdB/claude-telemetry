// src/client/components/AgentGraph.tsx
import { useEffect, useRef, useMemo } from "react";
import * as d3Force from "d3-force";
import * as d3Selection from "d3-selection";
import type { Agent, Event } from "../lib/types";

const AGENT_COLORS = ["#00a2e0", "#bdd72d", "#f59e0b", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

interface Node {
  id: string;
  label: string;
  type: string;
  tokens: number;
  x?: number;
  y?: number;
}

interface Link {
  source: string;
  target: string;
  strength: number; // 0-1, fades over time
}

export function AgentGraph({ agents, events }: { agents: Agent[]; events: Event[] }) {
  const svgRef = useRef<SVGSVGElement>(null);

  const { nodes, links } = useMemo(() => {
    if (agents.length === 0) return { nodes: [], links: [] };

    const nodes: Node[] = agents.map((a) => ({
      id: a.id,
      label: a.agent_type ?? "agent",
      type: a.agent_type ?? "unknown",
      tokens: a.total_tokens,
    }));

    // Create links from parent_session relationships
    const links: Link[] = [];
    agents.forEach((a) => {
      if (a.parent_session) {
        const parent = agents.find((p) => p.session_id === a.parent_session);
        if (parent) {
          links.push({ source: parent.id, target: a.id, strength: 0.8 });
        }
      }
    });

    return { nodes, links };
  }, [agents, events]);

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return;

    const width = 600;
    const height = 400;
    const svg = d3Selection.select(svgRef.current);
    svg.selectAll("*").remove();

    const maxTokens = Math.max(...nodes.map((n) => n.tokens), 1);

    const simulation = d3Force
      .forceSimulation(nodes as any)
      .force("link", d3Force.forceLink(links).id((d: any) => d.id).distance(120))
      .force("charge", d3Force.forceManyBody().strength(-200))
      .force("center", d3Force.forceCenter(width / 2, height / 2));

    // Links
    const link = svg
      .append("g")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", "#00a2e0")
      .attr("stroke-opacity", (d) => d.strength * 0.6)
      .attr("stroke-width", 2);

    // Nodes
    const node = svg
      .append("g")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("cursor", "pointer");

    // Node circles
    node
      .append("circle")
      .attr("r", (d) => 12 + (d.tokens / maxTokens) * 20)
      .attr("fill", (_, i) => AGENT_COLORS[i % AGENT_COLORS.length])
      .attr("opacity", 0.85);

    // Node labels
    node
      .append("text")
      .text((d) => d.label)
      .attr("dy", (d) => 12 + (d.tokens / maxTokens) * 20 + 14)
      .attr("text-anchor", "middle")
      .attr("fill", "#003864")
      .attr("font-size", 11)
      .attr("font-weight", 500);

    simulation.on("tick", () => {
      link
        .attr("x1", (d: any) => d.source.x)
        .attr("y1", (d: any) => d.source.y)
        .attr("x2", (d: any) => d.target.x)
        .attr("y2", (d: any) => d.target.y);

      node.attr("transform", (d: any) => `translate(${d.x},${d.y})`);
    });

    return () => simulation.stop();
  }, [nodes, links]);

  if (agents.length === 0) {
    return <p className="text-muted text-sm">No agent interactions to display. This view is available for team sessions with multiple agents.</p>;
  }

  return (
    <div className="border border-border rounded-xl bg-white p-4">
      <svg ref={svgRef} width={600} height={400} className="mx-auto" />
    </div>
  );
}
