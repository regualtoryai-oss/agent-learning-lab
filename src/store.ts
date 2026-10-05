import { randomUUID } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import type { AgentResult, TraceEvent } from "./types.ts";

export type DemoUser = "A" | "B";
export type TaskStatus = "queued" | "running" | AgentResult["status"] | "interrupted";
export interface Task {
  id: string;
  owner: DemoUser;
  input: string;
  model: "offline-mock";
  status: TaskStatus;
  createdAt: string;
  updatedAt: string;
  output: string | null;
  error: string | null;
  events: TraceEvent[];
}

interface Row {
  id: string; owner: DemoUser; input: string; status: TaskStatus;
  created_at: string; updated_at: string; output: string | null; error: string | null; events: string;
}

function decode(row: Row): Task {
  return { id: row.id, owner: row.owner, input: row.input, model: "offline-mock", status: row.status,
    createdAt: row.created_at, updatedAt: row.updated_at, output: row.output, error: row.error,
    events: JSON.parse(row.events) as TraceEvent[] };
}

export class TaskStore {
  private db: DatabaseSync;

  constructor(path: string) {
    this.db = new DatabaseSync(path);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      CREATE TABLE IF NOT EXISTS tasks (
        id TEXT PRIMARY KEY,
        owner TEXT NOT NULL CHECK (owner IN ('A', 'B')),
        input TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        output TEXT,
        error TEXT,
        events TEXT NOT NULL DEFAULT '[]'
      );
    `);
    // 仅支持一个服务进程拥有数据库。状态持久化 != 自动恢复执行。
    this.db.prepare("UPDATE tasks SET status = 'interrupted', error = ?, updated_at = ? WHERE status IN ('queued', 'running')")
      .run("服务重启前任务未完成；本版本不自动恢复执行。", new Date().toISOString());
  }

  create(owner: DemoUser, input: string): Task {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db.prepare("INSERT INTO tasks (id, owner, input, status, created_at, updated_at) VALUES (?, ?, ?, 'queued', ?, ?)")
      .run(id, owner, input, now, now);
    return this.get(id, owner)!;
  }

  get(id: string, owner: DemoUser): Task | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ? AND owner = ?").get(id, owner) as Row | undefined;
    return row ? decode(row) : undefined;
  }

  markRunning(id: string, owner: DemoUser): void {
    this.db.prepare("UPDATE tasks SET status = 'running', updated_at = ? WHERE id = ? AND owner = ? AND status = 'queued'")
      .run(new Date().toISOString(), id, owner);
  }

  appendEvent(id: string, owner: DemoUser, event: TraceEvent): void {
    const task = this.get(id, owner);
    if (!task) throw new Error("任务不存在。");
    this.db.prepare("UPDATE tasks SET events = ?, updated_at = ? WHERE id = ? AND owner = ?")
      .run(JSON.stringify([...task.events, event]), new Date().toISOString(), id, owner);
  }

  finish(id: string, owner: DemoUser, result: AgentResult): void {
    this.db.prepare("UPDATE tasks SET status = ?, output = ?, error = ?, events = ?, updated_at = ? WHERE id = ? AND owner = ?")
      .run(result.status, result.output ?? null, result.error ?? null, JSON.stringify(result.events), new Date().toISOString(), id, owner);
  }

  close(): void { this.db.close(); }
}
