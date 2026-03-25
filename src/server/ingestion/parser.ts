// src/server/ingestion/parser.ts

export interface ParsedLine {
  uuid: string;
  parentUuid?: string;
  type: string; // "assistant" | "user" | "progress" | "system"
  timestamp: string;
  sessionId: string;
  cwd?: string;
  version?: string;
  gitBranch?: string;
  slug?: string;
  isSidechain?: boolean;
  agentId?: string;
  requestId?: string;
  message?: {
    id?: string;
    model?: string;
    role?: string;
    content?: ContentBlock[] | string;
    stop_reason?: string;
    usage?: {
      input_tokens?: number;
      output_tokens?: number;
      cache_read_input_tokens?: number;
      cache_creation_input_tokens?: number;
    };
  };
  toolUseResult?: { success?: boolean };
  data?: any; // for progress type
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: any;
  tool_use_id?: string;
  content?: any;
}

export interface ExtractedEvent {
  id: string;
  messageId?: string;
  toolUseId?: string;
  sessionId: string;
  parentId?: string;
  type: string;
  timestamp: string;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheCreationTokens?: number;
  toolName?: string;
  stopReason?: string;
  content?: string;
  sessionMeta?: {
    cwd?: string;
    gitBranch?: string;
    slug?: string;
    version?: string;
  };
  isSidechain?: boolean;
  agentId?: string;
}

export function parseJsonlLine(line: string): ParsedLine | null {
  const trimmed = line.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    return null;
  }
}

export function extractEventData(line: ParsedLine): ExtractedEvent {
  const usage = line.message?.usage;
  const rawContent = line.message?.content;
  // content can be a string (user messages) or an array of ContentBlock (assistant messages)
  const content: ContentBlock[] | undefined = Array.isArray(rawContent) ? rawContent : undefined;

  // Find first tool_use block for tool_name (assistant events)
  const toolUse = content?.find((b) => b.type === "tool_use");
  // Find first tool_result block for user events
  const toolResult = content?.find((b) => b.type === "tool_result");

  const event: ExtractedEvent = {
    id: line.uuid,
    sessionId: line.sessionId,
    parentId: line.parentUuid,
    type: line.type,
    timestamp: line.timestamp,
    content: rawContent
      ? Array.isArray(rawContent)
        ? JSON.stringify(rawContent)
        : String(rawContent)
      : undefined,
    isSidechain: line.isSidechain,
    agentId: line.agentId,
  };

  if (line.message?.id) event.messageId = line.message.id;
  if (toolUse?.id) event.toolUseId = toolUse.id;
  if (line.message?.model) event.model = line.message.model;
  if (usage?.input_tokens) event.inputTokens = usage.input_tokens;
  if (usage?.output_tokens) event.outputTokens = usage.output_tokens;
  if (usage?.cache_read_input_tokens) event.cacheReadTokens = usage.cache_read_input_tokens;
  if (usage?.cache_creation_input_tokens) event.cacheCreationTokens = usage.cache_creation_input_tokens;
  if (line.message?.stop_reason) event.stopReason = line.message.stop_reason;
  if (toolUse?.name) event.toolName = toolUse.name;
  // For user events with tool_result content, mark as tool_result
  if (line.type === "user" && toolResult && !event.toolName) {
    event.toolName = "tool_result";
  }

  if (line.cwd || line.gitBranch || line.slug) {
    event.sessionMeta = {
      cwd: line.cwd,
      gitBranch: line.gitBranch,
      slug: line.slug,
      version: line.version,
    };
  }

  return event;
}
