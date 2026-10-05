import test from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { TaskStore } from "../src/store.ts";
import { testDirectory } from "./helpers.ts";

test("SQLite：重启后未完成任务标记 interrupted，不伪装成恢复执行", () => {
  const temp = testDirectory();
  const dbPath = join(temp.path, "tasks.sqlite");
  let store = new TaskStore(dbPath);
  try {
    const queued = store.create("A", "排队任务");
    const running = store.create("A", "x'; DROP TABLE tasks; --");
    store.markRunning(running.id, "A");
    store.close();
    store = new TaskStore(dbPath);
    assert.equal(store.get(queued.id, "A")?.status, "interrupted");
    assert.equal(store.get(running.id, "A")?.status, "interrupted");
    assert.equal(store.get(running.id, "A")?.input, "x'; DROP TABLE tasks; --");
    assert.equal(store.get(running.id, "B"), undefined);
  } finally { store.close(); temp.remove(); }
});
