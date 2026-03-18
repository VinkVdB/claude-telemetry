// test/server/parser.test.ts
import { describe, test, expect } from "bun:test";
import { parseJsonlLine, extractEventData, type ParsedLine } from "../../src/server/ingestion/parser";

describe("parseJsonlLine", () => {
  test("parses valid JSON line", () => {
    const line = '{"uuid":"msg-001","type":"user","timestamp":"2026-03-18T10:00:00.000Z","sessionId":"sess-abc"}';
    const result = parseJsonlLine(line);
    expect(result).not.toBeNull();
    expect(result!.uuid).toBe("msg-001");
    expect(result!.type).toBe("user");
  });

  test("returns null for empty line", () => {
    expect(parseJsonlLine("")).toBeNull();
    expect(parseJsonlLine("  ")).toBeNull();
  });

  test("returns null for invalid JSON", () => {
    expect(parseJsonlLine("{broken")).toBeNull();
  });
});

describe("extractEventData", () => {
  test("extracts tokens from assistant message", () => {
    const line: ParsedLine = {
      uuid: "msg-002",
      parentUuid: "msg-001",
      type: "assistant",
      timestamp: "2026-03-18T10:00:05.000Z",
      sessionId: "sess-abc",
      cwd: "/Users/dev/my-project",
      version: "2.1.78",
      gitBranch: "main",
      slug: "implement-auth",
      message: {
        model: "claude-sonnet-4-6",
        role: "assistant",
        content: [
          { type: "text", text: "Hello" },
          { type: "tool_use", id: "toolu_001", name: "Write", input: {} },
        ],
        stop_reason: "tool_use",
        usage: {
          input_tokens: 150,
          output_tokens: 80,
          cache_read_input_tokens: 5000,
          cache_creation_input_tokens: 200,
        },
      },
    };

    const event = extractEventData(line);
    expect(event.model).toBe("claude-sonnet-4-6");
    expect(event.inputTokens).toBe(150);
    expect(event.outputTokens).toBe(80);
    expect(event.cacheReadTokens).toBe(5000);
    expect(event.cacheCreationTokens).toBe(200);
    expect(event.stopReason).toBe("tool_use");
    expect(event.toolName).toBe("Write");
  });

  test("extracts tool name from first tool_use content block", () => {
    const line: ParsedLine = {
      uuid: "msg-005",
      type: "assistant",
      timestamp: "2026-03-18T10:00:00.000Z",
      sessionId: "sess-abc",
      message: {
        model: "claude-sonnet-4-6",
        role: "assistant",
        content: [
          { type: "tool_use", id: "t1", name: "Bash", input: { command: "ls" } },
          { type: "tool_use", id: "t2", name: "Read", input: { path: "/" } },
        ],
        usage: { input_tokens: 10, output_tokens: 5 },
      },
    };
    const event = extractEventData(line);
    // When multiple tools, tool_name captures the first; content has all
    expect(event.toolName).toBe("Bash");
  });

  test("handles user message with no usage", () => {
    const line: ParsedLine = {
      uuid: "msg-001",
      type: "user",
      timestamp: "2026-03-18T10:00:00.000Z",
      sessionId: "sess-abc",
      message: { role: "user", content: [{ type: "text", text: "Hello" }] },
    };
    const event = extractEventData(line);
    expect(event.model).toBeUndefined();
    expect(event.inputTokens).toBeUndefined();
  });

  test("extracts session metadata", () => {
    const line: ParsedLine = {
      uuid: "msg-001",
      type: "user",
      timestamp: "2026-03-18T10:00:00.000Z",
      sessionId: "sess-abc",
      cwd: "/Users/dev/my-project",
      gitBranch: "feature/auth",
      slug: "my-session",
      message: { role: "user", content: [] },
    };
    const meta = extractEventData(line);
    expect(meta.sessionMeta?.cwd).toBe("/Users/dev/my-project");
    expect(meta.sessionMeta?.gitBranch).toBe("feature/auth");
    expect(meta.sessionMeta?.slug).toBe("my-session");
  });
});
