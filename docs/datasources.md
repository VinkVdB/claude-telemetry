# Data Source Comparison

Here's the high-level overview of what each source provides:

## Comparison Matrix

| Capability | Hooks | Filesystem (JSONL) | Native OTEL |
|---|---|---|---|
| Token usage (in/out/cache) | - | Yes (per message) | Yes (per API call) |
| Cost in USD | - | - (must compute) | Yes (cost_usd) |
| Model name | - | Yes | Yes |
| Duration/latency | - (infer from timestamps) | - (infer from timestamps) | Yes (duration_ms) |
| Tool calls + full I/O | Yes (full payload) | Yes (full payload) | Partial (name, success, duration) |
| User prompts | Yes | Yes | Opt-in (OTEL_LOG_USER_PROMPTS=1) |
| Subagent/team tracking | Yes (SubagentStart/Stop) | Yes (sidechain + agentId) | - |
| Real-time streaming | Yes (HTTP POST) | Tail file (fswatch) | OTLP push (configurable interval) |
| Session lifecycle | Yes (12 events) | Yes (implicit from messages) | Partial (session.count metric) |
| Thinking content | - | Yes (thinking blocks) | - |
| Git branch | - | Yes | - |
| Requires config per project | Yes (hooks in settings) | No (always written) | Yes (env vars) |

## Key Insight

The JSONL files (~/.claude/projects/) are the richest single data source. They contain:

- Full conversation logs with tool calls and responses
- Token breakdowns per API call (input, output, cache read, cache creation)
- Model name, git branch, timestamps
- Subagent conversations in separate files with metadata
- Always written — no configuration needed

## Recommended Architecture: JSONL-primary, OTEL-supplemented

1. Primary: Watch JSONL files via filesystem monitoring — gives us everything except cost (which we compute from token counts +
pricing tables)
2. Supplementary: Enable OTEL for cost_usd and duration_ms per API call, which JSONL lacks
3. Optional: Hooks for real-time event streaming to the dashboard (SSE), reusing the proven pattern from claude-trace
