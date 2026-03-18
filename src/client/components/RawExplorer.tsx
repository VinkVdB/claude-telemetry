// src/client/components/RawExplorer.tsx
import { useState, useEffect } from "react";
import { api } from "../lib/api";
import { DetailPanel } from "./DetailPanel";
import { formatTokens, formatCost, cn } from "../lib/utils";
import type { Event } from "../lib/types";

export function RawExplorer() {
  const [events, setEvents] = useState<Event[]>([]);
  const [total, setTotal] = useState(0);
  const [selected, setSelected] = useState<Event | null>(null);
  const [filters, setFilters] = useState({
    sessionId: "",
    type: "",
    model: "",
    toolName: "",
    limit: "100",
    offset: "0",
  });
  const [search, setSearch] = useState("");

  useEffect(() => {
    const params: Record<string, string> = {};
    Object.entries(filters).forEach(([k, v]) => { if (v) params[k] = v; });
    api.events.list(params).then((r) => {
      setEvents(r.events);
      setTotal(r.total);
    });
  }, [filters]);

  const filteredEvents = search
    ? events.filter((e) => e.raw?.toLowerCase().includes(search.toLowerCase()))
    : events;

  const page = parseInt(filters.offset) / parseInt(filters.limit) + 1;
  const totalPages = Math.ceil(total / parseInt(filters.limit));

  return (
    <div>
      {/* Filters */}
      <div className="flex gap-3 mb-4 flex-wrap">
        <select
          value={filters.type}
          onChange={(e) => setFilters((f) => ({ ...f, type: e.target.value, offset: "0" }))}
          className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All types</option>
          <option value="assistant">Assistant</option>
          <option value="user">User</option>
          <option value="progress">Progress</option>
          <option value="system">System</option>
        </select>
        <select
          value={filters.model}
          onChange={(e) => setFilters((f) => ({ ...f, model: e.target.value, offset: "0" }))}
          className="border border-border rounded-lg px-3 py-1.5 text-sm bg-white"
        >
          <option value="">All models</option>
          <option value="claude-opus-4-6">Opus</option>
          <option value="claude-sonnet-4-6">Sonnet</option>
          <option value="claude-haiku-4-5">Haiku</option>
        </select>
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search raw JSON..."
          className="border border-border rounded-lg px-3 py-1.5 text-sm flex-1 min-w-[200px]"
        />
      </div>

      {/* Table */}
      <div className="border border-border rounded-xl overflow-hidden">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-surface text-muted text-left">
              <th className="px-3 py-2 font-medium">Time</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Model</th>
              <th className="px-3 py-2 font-medium">Tool</th>
              <th className="px-3 py-2 font-medium text-right">In</th>
              <th className="px-3 py-2 font-medium text-right">Out</th>
              <th className="px-3 py-2 font-medium text-right">Cost</th>
            </tr>
          </thead>
          <tbody>
            {filteredEvents.map((e) => (
              <tr
                key={e.id}
                onClick={() => setSelected(e)}
                className="border-t border-border hover:bg-primary/5 cursor-pointer transition-colors"
              >
                <td className="px-3 py-2 font-mono text-muted">{new Date(e.timestamp).toLocaleTimeString()}</td>
                <td className="px-3 py-2">
                  <span className={cn(
                    "px-1.5 py-0.5 rounded text-[10px] font-medium",
                    e.type === "assistant" ? "bg-primary/10 text-primary" :
                    e.type === "user" ? "bg-accent/20 text-primary-dark" :
                    "bg-surface text-muted"
                  )}>
                    {e.type}
                  </span>
                </td>
                <td className="px-3 py-2 text-muted">{e.model?.replace("claude-", "") ?? "—"}</td>
                <td className="px-3 py-2 font-mono text-primary">{e.tool_name ?? "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{e.input_tokens != null ? formatTokens(e.input_tokens) : "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{e.output_tokens != null ? formatTokens(e.output_tokens) : "—"}</td>
                <td className="px-3 py-2 text-right font-mono">{e.cost_usd != null ? formatCost(e.cost_usd) : "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      <div className="flex items-center justify-between mt-3 text-sm text-muted">
        <span>{total} events total</span>
        <div className="flex gap-2">
          <button
            disabled={page <= 1}
            onClick={() => setFilters((f) => ({ ...f, offset: String(Math.max(0, parseInt(f.offset) - parseInt(f.limit))) }))}
            className="px-3 py-1 border border-border rounded-lg disabled:opacity-30 hover:border-primary"
          >
            Prev
          </button>
          <span className="px-3 py-1">Page {page} of {totalPages}</span>
          <button
            disabled={page >= totalPages}
            onClick={() => setFilters((f) => ({ ...f, offset: String(parseInt(f.offset) + parseInt(f.limit)) }))}
            className="px-3 py-1 border border-border rounded-lg disabled:opacity-30 hover:border-primary"
          >
            Next
          </button>
        </div>
      </div>

      <DetailPanel event={selected} onClose={() => setSelected(null)} />
    </div>
  );
}
