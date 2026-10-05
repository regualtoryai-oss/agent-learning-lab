import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join, resolve, sep } from "node:path";

export function testDirectory(): { path: string; remove: () => void } {
  const runtime = resolve("runtime", "tests");
  mkdirSync(runtime, { recursive: true });
  const path = mkdtempSync(join(runtime, "case-"));
  return { path, remove: () => {
    const target = resolve(path);
    if (!target.startsWith(`${runtime}${sep}`)) throw new Error("测试清理目标越过 runtime/tests。");
    rmSync(target, { recursive: true, force: true });
  } };
}
