# Token Counting Issues in Claude Code JSONL Files

Research conducted while building the Claude Telemetry Dashboard revealed two distinct bugs in how
tokens are recorded in `~/.claude/projects/**/*.jsonl`. This document explains both issues,
includes evidence, and describes the fix we implemented in this project.

---

## Issue 1: Duplicate JSONL entries per API response

### What happens

When Claude produces a response that contains **multiple content blocks** (e.g. text + a tool call),
Claude Code writes **multiple separate JSONL lines** for that single API response. Each line gets a
unique `uuid`, but they all share the same `message.id` — and crucially, **each line carries the
full `usage` object** with all token counts.

### Example

```json
{"uuid": "uuid-A", "message": {"id": "msg_01TWy...", "usage": {"input_tokens": 4, "cache_creation_input_tokens": 15178, "output_tokens": 312}}}
{"uuid": "uuid-B", "message": {"id": "msg_01TWy...", "usage": {"input_tokens": 4, "cache_creation_input_tokens": 15178, "output_tokens": 312}}}
```

Both lines are the same API response. If you sum all JSONL lines naively, you count this response
**2× (or more)**. In our own data we found a single `message.id` appearing **7×** in one session
file, meaning those tokens were counted 7× instead of once.

In a sample session file from this project:
- 70 total assistant entries
- 39 unique `message.id` values
- 31 duplicate entries — up to 7× repetition

### Impact

Naive summation inflates non-cache token counts by ~2× and cost estimates accordingly.

### Fix

Deduplicate by `message.id` before summing or storing. For each group of entries sharing the same
`message.id`, keep only the entry with the **highest total token count**
(`input + output + cache_read + cache_creation`). The highest count corresponds to the final,
fully-streamed entry rather than an intermediate snapshot.

```
group by message.id → keep max(input + output + cache_read + cache_creation)
```

This is what we implemented in `src/server/ingestion/processor.ts`.

---

## Issue 2: `input_tokens` and `output_tokens` are severely undercounted — upstream relay bug

### What happens

`output_tokens` (and often `input_tokens`) are written incorrectly to JSONL by the Claude Code
relay itself. The recorded value is frequently `1` regardless of actual output length. This is
**not** a streaming-snapshot timing issue — the wrong value is persisted even on the final entry
(the one with `stop_reason: "end_turn"` or `"tool_use"`).

Additionally, some API calls are not recorded to JSONL at all, creating gaps that no
consumer-side deduplication or "keep highest" strategy can recover.

This was investigated by the ccusage project (PR #826), which closed a deduplication PR after
concluding: *"the root cause of underreported output_tokens is an upstream Claude Code API relay
issue, not ccusage deduplication logic. JSONL output_tokens values are always 1 (incorrect). This
issue is not universal and cannot be fixed by ccusage."*

### Evidence from real-world data (ccusage #866)

| Metric | JSONL (deduplicated) | Claude status bar (cumulative) | Ratio |
|---|---|---|---|
| `input_tokens` | 41,444 | 7,199,162 | **174× undercount** |
| `output_tokens` | 183,829 | 3,208,365 | **17× undercount** |
| `cache_read_input_tokens` | 104,353,324 | 114,798,863 | ~1× (accurate) |
| `cache_creation_input_tokens` | 3,170,696 | 2,717,775 | ~1× (accurate) |

### Key insight

`cache_read_input_tokens` and `cache_creation_input_tokens` are written accurately to JSONL because
they are determined at the **start** of a request (before streaming begins). `input_tokens` and
`output_tokens` are computed at the **end** of a streaming response and the relay appears to
write incorrect values (`1`) rather than the actual counts. This is a Claude Code bug, not a
parsing or deduplication problem.

### Impact

If you rely only on JSONL for `input_tokens`/`output_tokens`, those figures will be far lower than
actual API usage. Cost estimates based on these fields will be significantly understated.

### Mitigation

There is no consumer-side fix. Issue 1's "keep highest" deduplication strategy does **not** help
here — if the relay writes `output_tokens: 1` on the final entry, that value is what gets kept.

For applications that need accurate `input_tokens`/`output_tokens`, the only reliable sources are
the Anthropic usage dashboard or the `usage` field returned directly from the Streaming API.

In our tool, cache tokens dominate (>99% of total token volume) and cache fields are accurate, so
**cost calculations remain reliable despite the input/output undercount**. We display these fields
but users should treat them as lower-bound estimates, not exact values.

---

## How this compares to Claude's own `/stats` command

Claude Code's `/stats` shows notably lower token counts than our tool for the same sessions. After
investigation, the difference is explained by three factors:

| Factor | `/stats` | Our tool |
|---|---|---|
| Cache tokens | Excluded from count | Included |
| Sidechain / subagent events | Excluded | Included |
| Duplicate JSONL entries | (unknown) | Deduplicated (after this fix) |

After applying the deduplication fix in this project, our non-cache token count aligns much closer
to what `/stats` reports once the sidechain contribution is accounted for.

---

## References

- ccusage issue #389 — duplicate token entries per message
- ccusage issue #888 — same request logged multiple times
- ccusage issue #866 — JSONL tokens unreliable upstream (streaming undercount)
- ccusage PR #826 — improved deduplication: keep entry with highest total token count
- Claude Code issue #22686 — output tokens incorrectly recorded
- Claude Code issue #6805 — stream-json mode duplicates usage stats (closed NOT_PLANNED)
