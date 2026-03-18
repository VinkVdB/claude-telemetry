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
    model?: string;
    role?: string;
    content?: ContentBlock[];
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
  const content = line.message?.content;

  // Find first tool_use block for tool_name
  const toolUse = content?.find((b) => b.type === "tool_use");

  const event: ExtractedEvent = {
    id: line.uuid,
    sessionId: line.sessionId,
    parentId: line.parentUuid,
    type: line.type,
    timestamp: line.timestamp,
    content: content ? JSON.stringify(content) : undefined,
    isSidechain: line.isSidechain,
    agentId: line.agentId,
  };

  if (line.message?.model) event.model = line.message.model;
  if (usage?.input_tokens) event.inputTokens = usage.input_tokens;
  if (usage?.output_tokens) event.outputTokens = usage.output_tokens;
  if (usage?.cache_read_input_tokens) event.cacheReadTokens = usage.cache_read_input_tokens;
  if (usage?.cache_creation_input_tokens) event.cacheCreationTokens = usage.cache_creation_input_tokens;
  if (line.message?.stop_reason) event.stopReason = line.message.stop_reason;
  if (toolUse?.name) event.toolName = toolUse.name;

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
