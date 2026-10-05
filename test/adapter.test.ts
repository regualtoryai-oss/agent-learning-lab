import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { runAgent } from "../src/agent.ts";
import { OpenAICompatibleModel } from "../src/model.ts";

test("可选 adapter：只用本机假 API 检查消息映射和 call ID 回传", async () => {
  const requests: { messages: Record<string, unknown>[]; tools: unknown[]; model: string }[] = [];
  const fakeApi = createServer(async (request, response) => {
    let body = "";
    for await (const chunk of request) body += chunk.toString();
    const payload = JSON.parse(body) as typeof requests[number];
    requests.push(payload);
    assert.equal(request.url, "/v1/chat/completions");
    assert.equal(request.headers.authorization, "Bearer fake-test-value");
    response.writeHead(200, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ choices: [{ message: requests.length === 1
      ? { role: "assistant", content: null, tool_calls: [{ id: "fixture-call", type: "function", function: { name: "readDoc", arguments: '{"docId":"agent-loop"}' } }] }
      : { role: "assistant", content: "[本机假 API] 已读资料。" } }] }));
  });
  await new Promise<void>((resolve) => fakeApi.listen(0, "127.0.0.1", resolve));
  const address = fakeApi.address();
  assert.ok(address && typeof address !== "string");
  try {
    const model = new OpenAICompatibleModel({ apiKey: "fake-test-value", model: "fixture-model", baseUrl: `http://127.0.0.1:${address.port}/v1` });
    const result = await runAgent("测试", model);
    assert.equal(result.status, "completed");
    assert.equal(requests.length, 2);
    assert.equal(requests[0]!.tools.length, 2);
    assert.equal(requests[0]!.model, "fixture-model");
    const toolReply = requests[1]!.messages.find((message) => message.role === "tool");
    assert.equal(toolReply?.tool_call_id, "fixture-call");
    assert.equal(JSON.parse(toolReply?.content as string).ok, true);
    const assistant = requests[1]!.messages.find((message) => message.role === "assistant");
    assert.ok(Array.isArray(assistant?.tool_calls));
  } finally {
    await new Promise<void>((resolve, reject) => fakeApi.close((error) => error ? reject(error) : resolve()));
  }
});

test("adapter 配置拒绝非本机明文 HTTP 和 URL 内嵌认证信息", () => {
  assert.throws(() => new OpenAICompatibleModel({ apiKey: "fake", model: "fake", baseUrl: "http://example.com/v1" }), /HTTPS/);
  assert.throws(() => new OpenAICompatibleModel({ apiKey: "fake", model: "fake", baseUrl: "https://user:password@example.com/v1" }), /凭据/);
});
