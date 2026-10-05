import test from "node:test";
import assert from "node:assert/strict";
import { performance } from "node:perf_hooks";
import { runAgent } from "../src/agent.ts";
import { MockModel } from "../src/model.ts";
import { executeTool } from "../src/tools.ts";
import type { Message, Model } from "../src/types.ts";

test("正常：两次只读工具调用后完成，trace 保留调用 ID", async () => {
  const result = await runAgent("解释 Agent", new MockModel());
  assert.equal(result.status, "completed");
  assert.equal(result.rounds, 3);
  assert.match(result.output!, /离线 Mock/);
  assert.deepEqual(result.events.filter((event) => event.type === "tool-result").map((event) => event.detail.callId), ["search-1", "read-1"]);
  assert.equal(result.events.at(-1)?.type, "run-end");
});

test("工具失败：结构化错误与原调用 ID 一起返回模型", async () => {
  let received: readonly Message[] = [];
  const model: Model = {
    name: "test-error",
    next: async (messages) => {
      received = [...messages];
      if (!messages.some((message) => message.role === "tool")) {
        return { toolCalls: [{ id: "invalid-1", name: "searchDocs", arguments: { query: 42 } }] };
      }
      return { content: "已收到失败原因。" };
    },
  };
  const result = await runAgent("测试", model);
  assert.equal(result.status, "completed");
  const toolMessage = received.find((message) => message.role === "tool");
  assert.ok(toolMessage && toolMessage.role === "tool");
  assert.equal(toolMessage.callId, "invalid-1");
  assert.deepEqual(JSON.parse(toolMessage.content).error.code, "INVALID_ARGUMENTS");
});

test("未知工具被拒绝，同时仍按原 ID 回传错误", async () => {
  const messagesSeen: Message[][] = [];
  const model: Model = {
    name: "unknown-tool-test",
    next: async (messages) => {
      messagesSeen.push([...messages]);
      return messagesSeen.length === 1
        ? { toolCalls: [{ id: "unknown-1", name: "writeFile", arguments: { path: "anything" } }] }
        : { content: "工具被拒绝。" };
    },
  };
  const result = await runAgent("测试", model);
  assert.equal(result.status, "completed");
  const last = messagesSeen[1]!.at(-1)!;
  assert.equal(last.role, "tool");
  assert.match(last.content, /UNKNOWN_TOOL/);
});

test("闭合 ID：合法材料可读取，路径与额外字段被拒绝", () => {
  assert.equal(executeTool("readDoc", { docId: "agent-loop" }).ok, true);
  for (const docId of ["../../.env", "C:\\Users\\secret.txt", "/etc/passwd", "file://secret", "not-in-list"]) {
    assert.deepEqual(executeTool("readDoc", { docId }), {
      ok: false, error: { code: "DOCUMENT_NOT_ALLOWED", message: "docId 不在教学文档白名单中；文件路径不会被读取。" },
    });
  }
  assert.equal(executeTool("readDoc", { docId: "agent-loop", path: ".env" }).ok, false);
  assert.equal(executeTool("searchDocs", { query: " " }).ok, false);
  assert.equal(executeTool("searchDocs", { query: "x".repeat(161) }).ok, false);
});

test("轮数预算：永不最终回答的 mock 被停止", async () => {
  const result = await runAgent("测试", new MockModel({ scenario: "limit" }), { maxRounds: 2 });
  assert.equal(result.status, "limit");
  assert.equal(result.rounds, 2);
  assert.match(result.error!, /轮数/);
});

test("工具预算：达到数量上限后不执行后续工具", async () => {
  const result = await runAgent("测试", new MockModel(), { maxToolCalls: 1 });
  assert.equal(result.status, "limit");
  assert.match(result.error!, /工具调用数量/);
  assert.equal(result.events.filter((event) => event.type === "tool-result").length, 1);
});

test("时间预算：等待模型时也能超时", async () => {
  const result = await runAgent("测试", new MockModel({ latencyMs: 200 }), { timeoutMs: 20 });
  assert.equal(result.status, "limit");
  assert.match(result.error!, /时间/);
});

test("时间预算：不配合取消的模型 Promise 不会挂住 loop", async () => {
  const model: Model = { name: "never-resolves", next: async () => new Promise(() => {}) };
  const result = await runAgent("测试", model, { timeoutMs: 20 });
  assert.equal(result.status, "limit");
});

test("时间预算：同步模型超过预算，即使 timer 未执行也不能误报完成", async () => {
  const model: Model = {
    name: "synchronous-model",
    next: async () => {
      const until = performance.now() + 20;
      while (performance.now() < until) { /* 模拟同步模型处理，无法被 timer 抢占。 */ }
      return { content: "超过预算才返回的回答。" };
    },
  };
  const result = await runAgent("测试", model, { timeoutMs: 5 });
  assert.equal(result.status, "limit");
  assert.equal(result.output, undefined);
  assert.match(result.error!, /时间/);
  assert.equal(result.events.at(-1)?.detail.status, "limit");
});

test("时间预算：同步 trace 超出预算后，计划中的工具不会执行", async () => {
  const result = await runAgent("测试", new MockModel(), {
    timeoutMs: 5,
    onEvent: (event) => {
      if (event.type === "tool-start") {
        const until = performance.now() + 20;
        while (performance.now() < until) { /* 模拟同步日志 / 持久化开销。 */ }
      }
    },
  });
  assert.equal(result.status, "limit");
  assert.match(result.error!, /时间/);
  assert.equal(result.events.some((event) => event.type === "tool-result"), false);
});

test("取消：执行前取消，不请求模型或工具", async () => {
  const controller = new AbortController();
  controller.abort();
  const result = await runAgent("测试", new MockModel(), { signal: controller.signal });
  assert.equal(result.status, "cancelled");
  assert.equal(result.rounds, 0);
  assert.equal(result.events.some((event) => event.type === "tool-start"), false);
});

test("取消：等待模型时取消，停止继续执行", async () => {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 20);
  try {
    const result = await runAgent("测试", new MockModel({ latencyMs: 200 }), { signal: controller.signal });
    assert.equal(result.status, "cancelled");
    assert.equal(result.events.some((event) => event.type === "tool-start"), false);
  } finally { clearTimeout(timer); }
});

test("取消：一个工具完成后取消，下一工具不会执行", async () => {
  const controller = new AbortController();
  const model: Model = {
    name: "two-tools",
    next: async () => ({ toolCalls: [
      { id: "first", name: "readDoc", arguments: { docId: "agent-loop" } },
      { id: "second", name: "readDoc", arguments: { docId: "evaluation" } },
    ] }),
  };
  const result = await runAgent("测试", model, {
    signal: controller.signal,
    onEvent: (event) => { if (event.type === "tool-result") controller.abort(); },
  });
  assert.equal(result.status, "cancelled");
  assert.equal(result.events.filter((event) => event.type === "tool-result").length, 1);
});

test("调用 ID：重复或缺失的 ID 导致失败，不执行该轮工具", async () => {
  for (const ids of [["same", "same"], ["", "next"]]) {
    const model: Model = {
      name: "invalid-ids",
      next: async () => ({ toolCalls: ids.map((id) => ({ id, name: "readDoc", arguments: { docId: "agent-loop" } })) }),
    };
    const result = await runAgent("测试", model);
    assert.equal(result.status, "failed");
    assert.equal(result.events.some((event) => event.type === "tool-start"), false);
  }
});

test("空模型结果应失败，而非误报完成", async () => {
  const result = await runAgent("测试", { name: "empty", next: async () => ({ content: " " }) });
  assert.equal(result.status, "failed");
});

test("输入和预算配置经过边界校验", async () => {
  await assert.rejects(runAgent(" ", new MockModel()), /input/);
  await assert.rejects(runAgent("test", new MockModel(), { maxRounds: 0 }), /maxRounds/);
  await assert.rejects(runAgent("test", new MockModel(), { timeoutMs: 0 }), /timeoutMs/);
});
