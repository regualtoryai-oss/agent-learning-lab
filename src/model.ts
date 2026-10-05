import { setTimeout } from "node:timers/promises";
import { toolDefinitions } from "./tools.ts";
import type { Message, Model, ModelTurn, ToolCall } from "./types.ts";

export type MockScenario = "normal" | "tool-error" | "limit";

// 固定脚本，不是 AI 推理。通过可重复的输入演示 loop 和错误处理。
export class MockModel implements Model {
  readonly name = "offline-mock";
  private scenario: MockScenario;
  private latencyMs: number;

  constructor(options: { scenario?: MockScenario; latencyMs?: number } = {}) {
    this.scenario = options.scenario ?? "normal";
    this.latencyMs = options.latencyMs ?? 0;
  }

  async next(messages: readonly Message[], signal: AbortSignal): Promise<ModelTurn> {
    signal.throwIfAborted();
    if (this.latencyMs > 0) await setTimeout(this.latencyMs, undefined, { signal });
    const replies = messages.filter((message) => message.role === "tool");
    const count = replies.length;
    if (this.scenario === "limit") {
      return { toolCalls: [{ id: `loop-${count}`, name: "searchDocs", arguments: { query: "Agent" } }] };
    }
    if (this.scenario === "tool-error") {
      if (count === 0) return { toolCalls: [{ id: "bad-query", name: "searchDocs", arguments: { query: 42 } }] };
      return { content: "[离线 Mock] 收到了 INVALID_ARGUMENTS 工具错误，已停止本次演示。" };
    }
    if (count === 0) return { toolCalls: [{ id: "search-1", name: "searchDocs", arguments: { query: "Agent" } }] };
    if (count === 1) return { toolCalls: [{ id: "read-1", name: "readDoc", arguments: { docId: "agent-loop" } }] };
    return { content: "[离线 Mock，固定脚本] Agent 从用户输入开始，模型请求工具，应用校验并执行，将结果按调用 ID 回传，直到最终回答或触及预算。资料：[agent-loop]。这个回答不证明真实模型效果。" };
  }
}

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export class OpenAICompatibleModel implements Model {
  readonly name = "live-openai-compatible";
  private apiKey: string;
  private model: string;
  private baseUrl: string;

  constructor(options: { apiKey: string; model: string; baseUrl?: string }) {
    this.apiKey = options.apiKey;
    this.model = options.model;
    const url = new URL(options.baseUrl ?? "https://api.openai.com/v1");
    if (url.username || url.password || url.search || url.hash) throw new Error("baseUrl 不能包含凭据、查询或片段。");
    if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname))) {
      throw new Error("baseUrl 需要 HTTPS；本机测试允许 localhost HTTP。");
    }
    this.baseUrl = url.toString().replace(/\/$/, "");
  }

  async next(messages: readonly Message[], signal: AbortSignal): Promise<ModelTurn> {
    const wireMessages = messages.map((message) => {
      if (message.role === "tool") return { role: "tool", tool_call_id: message.callId, content: message.content };
      if (message.role === "assistant") {
        return { role: "assistant", content: message.content || null, ...(message.toolCalls?.length ? {
          tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: "function", function: { name: call.name, arguments: JSON.stringify(call.arguments) } })),
        } : {}) };
      }
      return { role: message.role, content: message.content };
    });
    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({ model: this.model, messages: wireMessages, tools: toolDefinitions, tool_choice: "auto" }),
      signal,
    });
    // 不将第三方响应体直接打印到日志，避免它回显认证信息。
    if (!response.ok) throw new Error(`模型 API HTTP ${response.status}`);
    const data: unknown = await response.json();
    if (!object(data) || !Array.isArray(data.choices) || !object(data.choices[0]) || !object(data.choices[0].message)) {
      throw new Error("模型 API 响应缺少 choices[0].message。");
    }
    const message = data.choices[0].message;
    const calls: ToolCall[] = [];
    if (message.tool_calls !== undefined) {
      if (!Array.isArray(message.tool_calls)) throw new Error("tool_calls 不是数组。");
      for (const call of message.tool_calls) {
        if (!object(call) || typeof call.id !== "string" || call.type !== "function"
          || !object(call.function) || typeof call.function.name !== "string" || typeof call.function.arguments !== "string") {
          throw new Error("模型 API 的工具调用格式无效。");
        }
        let args: unknown;
        try { args = JSON.parse(call.function.arguments); } catch { args = null; }
        calls.push({ id: call.id, name: call.function.name, arguments: args });
      }
    }
    if (message.content !== undefined && message.content !== null && typeof message.content !== "string") {
      throw new Error("模型 API 的 content 格式无效。");
    }
    return { content: typeof message.content === "string" ? message.content : "", toolCalls: calls };
  }
}
