import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { runAgent } from "./agent.ts";
import { MockModel, type MockScenario } from "./model.ts";
import { TaskStore, type DemoUser } from "./store.ts";
import type { Model } from "./types.ts";

class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) { super(message); this.status = status; }
}

function json(response: ServerResponse, status: number, value: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  if (!request.headers["content-type"]?.startsWith("application/json")) throw new HttpError(415, "需要 application/json。");
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 16_384) throw new HttpError(413, "请求体过大。");
    chunks.push(buffer);
  }
  let parsed: unknown;
  try { parsed = JSON.parse(Buffer.concat(chunks).toString("utf8")); } catch { throw new HttpError(400, "JSON 无效。"); }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) throw new HttpError(400, "请求体需要对象。");
  return parsed as Record<string, unknown>;
}

export async function startLabServer(options: {
  dbPath: string;
  port?: number;
  modelFactory?: (scenario: MockScenario) => Model;
  timeoutMs?: number;
  maxRounds?: number;
}): Promise<{ url: string; close: () => Promise<void> }> {
  const store = new TaskStore(options.dbPath);
  const controllers = new Map<string, AbortController>();
  const pending = new Map<string, Promise<void>>();
  let closing = false;
  const server = createServer(async (request, response) => {
    try {
      if (closing) throw new HttpError(503, "服务正在关闭。");
      const userHeader = request.headers["x-demo-user"];
      if (userHeader !== "A" && userHeader !== "B") throw new HttpError(401, "教学模拟身份需要 x-demo-user: A 或 B。");
      const owner: DemoUser = userHeader;
      const url = new URL(request.url ?? "/", "http://127.0.0.1");
      if (request.method === "POST" && url.pathname === "/tasks") {
        const payload = await body(request);
        if (Object.keys(payload).some((key) => !["input", "scenario"].includes(key))) throw new HttpError(400, "未知请求字段。");
        if (typeof payload.input !== "string" || !payload.input.trim() || payload.input.length > 2_000) {
          throw new HttpError(400, "input 必须为 1–2000 字符的非空字符串。");
        }
        const scenario = payload.scenario ?? "normal";
        if (scenario !== "normal" && scenario !== "tool-error" && scenario !== "limit") throw new HttpError(400, "scenario 无效。");
        // 读取请求体有 await；在接受任务之前重新检查，避免并发请求绕过上限。
        if (closing) throw new HttpError(503, "服务正在关闭。");
        if (controllers.size >= 8) throw new HttpError(429, "本机演示最多同时执行 8 个任务。");
        const task = store.create(owner, payload.input);
        const controller = new AbortController();
        controllers.set(task.id, controller);
        store.markRunning(task.id, owner);
        const execution = runAgent(task.input, options.modelFactory?.(scenario) ?? new MockModel({ scenario, latencyMs: 20 }), {
          signal: controller.signal,
          timeoutMs: options.timeoutMs ?? 5_000,
          maxRounds: options.maxRounds ?? 6,
          onEvent: (event) => store.appendEvent(task.id, owner, event),
        }).then((result) => store.finish(task.id, owner, result)).catch(() => {
          store.finish(task.id, owner, { status: "failed", rounds: 0, error: "执行器发生内部错误。", events: [] });
        }).finally(() => { controllers.delete(task.id); pending.delete(task.id); });
        pending.set(task.id, execution);
        json(response, 202, task);
        return;
      }
      const match = /^\/tasks\/([0-9a-f-]{36})(\/cancel)?$/.exec(url.pathname);
      if (!match?.[1]) throw new HttpError(404, "接口不存在。");
      const id = match[1];
      const task = store.get(id, owner);
      if (!task) throw new HttpError(404, "任务不存在。");
      if (request.method === "GET" && !match[2]) { json(response, 200, task); return; }
      if (request.method === "POST" && match[2]) {
        const controller = controllers.get(id);
        if (!controller) throw new HttpError(409, "任务已经结束。");
        controller.abort();
        json(response, 202, { id, cancellationRequested: true });
        return;
      }
      throw new HttpError(405, "方法不支持。");
    } catch (error) {
      json(response, error instanceof HttpError ? error.status : 500,
        { error: error instanceof HttpError ? error.message : "服务内部错误。" });
    }
  });
  server.requestTimeout = 10_000;
  server.headersTimeout = 5_000;
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port ?? 0, "127.0.0.1", () => { server.removeListener("error", reject); resolve(); });
  }).catch((error) => { store.close(); throw error; });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("未获得监听地址。");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: async () => {
      if (closing) return;
      closing = true;
      for (const controller of controllers.values()) controller.abort();
      const connectionsClosed = new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
      await Promise.all([...pending.values()]);
      server.closeIdleConnections();
      await connectionsClosed;
      store.close();
    },
  };
}
