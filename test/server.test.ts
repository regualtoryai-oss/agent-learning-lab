import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { setTimeout } from "node:timers/promises";
import { startLabServer } from "../src/server.ts";
import { MockModel } from "../src/model.ts";
import type { Task } from "../src/store.ts";
import { testDirectory } from "./helpers.ts";

async function create(url: string, owner = "A", scenario = "normal"): Promise<Task> {
  const response = await fetch(`${url}/tasks`, {
    method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": owner },
    body: JSON.stringify({ input: "解释 Agent loop", scenario }),
  });
  assert.equal(response.status, 202);
  return response.json() as Promise<Task>;
}

async function waitForTask(url: string, id: string, status: string): Promise<Task> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const response = await fetch(`${url}/tasks/${id}`, { headers: { "x-demo-user": "A" } });
    assert.equal(response.status, 200);
    const task = await response.json() as Task;
    if (task.status === status) return task;
    await setTimeout(10);
  }
  throw new Error(`任务未进入 ${status}`);
}

test("HTTP：创建、查询、工具错误、超限和输入校验", async () => {
  const temp = testDirectory();
  const app = await startLabServer({ dbPath: join(temp.path, "tasks.sqlite"), maxRounds: 2 });
  try {
    const task = await create(app.url, "A", "tool-error");
    const completed = await waitForTask(app.url, task.id, "completed");
    assert.match(completed.output!, /INVALID_ARGUMENTS/);
    const infinite = await create(app.url, "A", "limit");
    assert.match((await waitForTask(app.url, infinite.id, "limit")).error!, /轮数/);
    const noUser = await fetch(`${app.url}/tasks/${task.id}`);
    assert.equal(noUser.status, 401);
    const invalid = await fetch(`${app.url}/tasks`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-demo-user": "A" }, body: JSON.stringify({ input: "", path: ".env" }),
    });
    assert.equal(invalid.status, 400);
  } finally { await app.close(); temp.remove(); }
});

test("HTTP：B 不能读或取消 A 的任务；A 可以取消运行任务", async () => {
  const temp = testDirectory();
  const app = await startLabServer({ dbPath: join(temp.path, "tasks.sqlite"), modelFactory: () => new MockModel({ latencyMs: 500 }) });
  try {
    const task = await create(app.url);
    assert.equal((await fetch(`${app.url}/tasks/${task.id}`, { headers: { "x-demo-user": "B" } })).status, 404);
    assert.equal((await fetch(`${app.url}/tasks/${task.id}/cancel`, { method: "POST", headers: { "x-demo-user": "B" } })).status, 404);
    assert.equal((await fetch(`${app.url}/tasks/${task.id}/cancel`, { method: "POST", headers: { "x-demo-user": "A" } })).status, 202);
    const cancelled = await waitForTask(app.url, task.id, "cancelled");
    assert.equal(cancelled.events.some((event) => event.type === "tool-start"), false);
  } finally { await app.close(); temp.remove(); }
});

test("HTTP：服务关闭后重新打开同一 SQLite，已完成任务与 trace 仍在", async () => {
  const temp = testDirectory();
  const dbPath = join(temp.path, "tasks.sqlite");
  let app = await startLabServer({ dbPath });
  try {
    const task = await create(app.url);
    const before = await waitForTask(app.url, task.id, "completed");
    await app.close();
    app = await startLabServer({ dbPath });
    const after = await waitForTask(app.url, task.id, "completed");
    assert.deepEqual(after, before);
    assert.equal((await fetch(`${app.url}/tasks/${task.id}`, { headers: { "x-demo-user": "B" } })).status, 404);
  } finally { await app.close(); temp.remove(); }
});
