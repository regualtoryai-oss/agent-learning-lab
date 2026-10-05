import { documents, documentIds } from "./documents.ts";
import type { ToolResult } from "./types.ts";

export const toolDefinitions = [
  {
    type: "function",
    function: {
      name: "searchDocs",
      description: "按关键词检索自编教学材料；返回文档 ID 和摘要。",
      parameters: {
        type: "object",
        properties: { query: { type: "string", minLength: 1, maxLength: 160 } },
        required: ["query"],
        additionalProperties: false,
      },
    },
  },
  {
    type: "function",
    function: {
      name: "readDoc",
      description: "根据闭合的文档 ID 读取教学材料。不能读取文件路径。",
      parameters: {
        type: "object",
        properties: { docId: { type: "string", enum: documentIds } },
        required: ["docId"],
        additionalProperties: false,
      },
    },
  },
] as const;

function error(code: string, message: string): ToolResult {
  return { ok: false, error: { code, message } };
}

function objectWithOnly(value: unknown, key: string): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    && Object.keys(value).length === 1 && Object.hasOwn(value, key);
}

export function executeTool(name: string, args: unknown): ToolResult {
  if (name === "searchDocs") {
    if (!objectWithOnly(args, "query") || typeof args.query !== "string"
      || args.query.trim().length === 0 || args.query.length > 160) {
      return error("INVALID_ARGUMENTS", "query 必须为 1–160 字符的非空字符串，且不能附带其他字段。");
    }
    const terms = args.query.trim().toLocaleLowerCase().split(/\s+/);
    const results = documents
      .map((document) => ({ document, score: terms.filter((term) => `${document.title} ${document.body}`.toLocaleLowerCase().includes(term)).length }))
      .filter(({ score }) => score > 0)
      .sort((a, b) => b.score - a.score)
      .map(({ document }) => ({ id: document.id, title: document.title, excerpt: document.body.slice(0, 100) }));
    return { ok: true, data: { results } };
  }
  if (name === "readDoc") {
    if (!objectWithOnly(args, "docId") || typeof args.docId !== "string") {
      return error("INVALID_ARGUMENTS", "readDoc 只接受一个 docId 字段。");
    }
    const document = documents.find((item) => item.id === args.docId);
    if (!document) return error("DOCUMENT_NOT_ALLOWED", "docId 不在教学文档白名单中；文件路径不会被读取。");
    return { ok: true, data: document };
  }
  return error("UNKNOWN_TOOL", "工具不在允许列表中。");
}
