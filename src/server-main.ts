import { mkdirSync } from "node:fs";
import { resolve } from "node:path";
import { startLabServer } from "./server.ts";

const rawPort = process.env.PORT ?? "3000";
if (!/^\d{1,5}$/.test(rawPort) || Number(rawPort) < 1 || Number(rawPort) > 65535) throw new Error("PORT 必须为 1–65535。");
const runtime = resolve("runtime");
mkdirSync(runtime, { recursive: true });
const app = await startLabServer({ dbPath: resolve(runtime, "tasks.sqlite"), port: Number(rawPort) });
console.log(`离线教学服务：${app.url}（仅监听本机）。身份头 x-demo-user: A / B 是模拟，不是认证。`);
console.log("按 Ctrl+C 结束。任务状态保存在 runtime/tasks.sqlite。");
for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => { void app.close().then(() => { process.exitCode = 0; }); });
}
