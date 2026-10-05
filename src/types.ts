export type ToolName = "searchDocs" | "readDoc";
export interface ToolCall {
  id: string;
  name: string;
  arguments: unknown;
}
export interface ToolError {
  code: string;
  message: string;
}
export type ToolResult = { ok: true; data: unknown } | { ok: false; error: ToolError };
export type Message =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ToolCall[] }
  | { role: "tool"; callId: string; name: string; content: string };
export interface ModelTurn {
  content?: string;
  toolCalls?: ToolCall[];
}
export interface Model {
  readonly name: string;
  next(messages: readonly Message[], signal: AbortSignal): Promise<ModelTurn>;
}
export type AgentStatus = "completed" | "failed" | "cancelled" | "limit";
export interface TraceEvent {
  type: "run-start" | "round-start" | "model-output" | "tool-start" | "tool-result" | "run-end";
  round: number;
  elapsedMs: number;
  detail: Record<string, unknown>;
}
export interface AgentResult {
  status: AgentStatus;
  rounds: number;
  output?: string;
  error?: string;
  events: TraceEvent[];
}
