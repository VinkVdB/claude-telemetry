import { Link } from "react-router-dom";
import type { Session } from "../lib/types";
import { formatTokens, formatCost, timeAgo } from "../lib/utils";
import { useSettings } from "../contexts/SettingsContext";
import { sessionDisplayName } from "../utils/displayName";

export function SessionTable({ sessions }: { sessions: Session[] }) {
  const { settings } = useSettings();
  const formatOpts = {
    kThreshold: settings["display.tokenKThreshold"] as number,
    mThreshold: settings["display.tokenMThreshold"] as number,
    costPrecisionThreshold: settings["display.costPrecisionThreshold"] as number,
    timeAgoJustNow: settings["display.timeAgoJustNow"] as number,
    timeAgoMinutes: settings["display.timeAgoMinutes"] as number,
    timeAgoHours: settings["display.timeAgoHours"] as number,
  };
  return (
    <div className="border border-border rounded-xl overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-surface text-muted text-left">
            <th className="px-4 py-3 font-medium">Session</th>
            <th className="px-4 py-3 font-medium">Branch</th>
            <th className="px-4 py-3 font-medium">Started</th>
            <th className="px-4 py-3 font-medium">Last Updated</th>
            <th className="px-4 py-3 font-medium text-right">Events</th>
            <th className="px-4 py-3 font-medium text-right">Agents</th>
            <th className="px-4 py-3 font-medium text-right">Tokens</th>
            <th className="px-4 py-3 font-medium text-right">Cost</th>
          </tr>
        </thead>
        <tbody>
          {sessions.filter((s) => s.id).map((s) => {
            const totalTokens = s.total_input_tokens + s.total_output_tokens + s.total_cache_read + s.total_cache_creation;
            const models = JSON.parse(s.models_used || "[]") as string[];
            return (
              <tr key={s.id} className="border-t border-border hover:bg-surface/50 transition-colors">
                <td className="px-4 py-3">
                  <Link to={`/sessions/${s.id}`} className="text-primary hover:underline font-medium">
                    {sessionDisplayName(s)}
                  </Link>
                  {models.length > 0 && (
                    <div className="flex gap-1 mt-1">
                      {models.filter(m => m !== "null").map((m) => (
                        <span key={m} className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded">
                          {m.replace("claude-", "")}
                        </span>
                      ))}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-muted">{s.git_branch ?? "—"}</td>
                <td className="px-4 py-3 text-muted">{s.started_at ? timeAgo(s.started_at, formatOpts) : "—"}</td>
                <td className="px-4 py-3 text-muted">{s.last_updated ? timeAgo(s.last_updated, formatOpts) : "—"}</td>
                <td className="px-4 py-3 text-right">{s.event_count}</td>
                <td className="px-4 py-3 text-right">{s.agent_count}</td>
                <td className="px-4 py-3 text-right font-mono">{formatTokens(totalTokens, formatOpts)}</td>
                <td className="px-4 py-3 text-right font-mono">{formatCost(s.total_cost_usd, formatOpts)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
