import { runAgent } from "./agent.ts";
import { MockModel, OpenAICompatibleModel, type MockScenario } from "./model.ts";
import type { Model } from "./types.ts";

const args = process.argv.slice(2);
const live = args.includes("--live");
const scenarioArg = args.find((argument) => argument.startsWith("--scenario="))?.split("=")[1] ?? "normal";
if (!["normal", "tool-error", "limit"].includes(scenarioArg)) throw new Error("scenario 仅允许 normal / tool-error / limit。");
if (live && scenarioArg !== "normal") throw new Error("scenario 只用于离线 mock。");
const unknown = args.filter((argument) => argument.startsWith("--") && argument !== "--live" && !argument.startsWith("--scenario="));
if (unknown.length) throw new Error(`未知参数：${unknown.join(", ")}`);
const input = args.filter((argument) => !argument.startsWith("--")).join(" ") || "解释 Agent loop，并引用教学资料。";
let model: Model;
if (live) {
  const apiKey = process.env.OPENAI_API_KEY;
  const modelName = process.env.OPENAI_MODEL;
  if (!apiKey || apiKey === "replace-with-your-own-key" || !modelName || modelName === "replace-with-your-model-name") {
    throw new Error("--live 需要你主动配置 OPENAI_API_KEY 与 OPENAI_MODEL，可能产生 API 费用。");
  }
  model = new OpenAICompatibleModel({ apiKey, model: modelName, baseUrl: process.env.OPENAI_BASE_URL });
  console.log("真实模型模式：会将本次输入与自编教学资料发送至你配置的 API 服务。");
} else {
  model = new MockModel({ scenario: scenarioArg as MockScenario });
  console.log("离线 Mock 模式：固定脚本，不调用模型 API，不读取密钥。");
}
const controller = new AbortController();
const cancel = () => controller.abort();
process.once("SIGINT", cancel);
try {
  const result = await runAgent(input, model, {
    signal: controller.signal,
    onEvent: (event) => console.log(JSON.stringify(event)),
  });
  console.log(`状态：${result.status}；轮数：${result.rounds}`);
  if (result.output) console.log(result.output);
  if (result.error) console.log(result.error);
  if (result.status !== "completed") process.exitCode = 1;
} finally { process.removeListener("SIGINT", cancel); }
