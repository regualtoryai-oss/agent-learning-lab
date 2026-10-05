# Agent Learning Lab

一个围绕完整任务逐步开发的 TypeScript Agent 学习作品：从目标、工具、动态决策、上下文和验收开始，再接入真实模型、评测和界面。适合已有 JS / TS 基础、正在学习 Agent 应用开发的学习者。

**当前版本是 AI 协作生成的教学起步代码。运行成功不代表作者已经独立掌握 Agent 开发。** 独立讲解、变式练习和自己的提交记录，是后续作品集证据。

## 现在能做什么

- CLI 演示模型请求工具、应用校验执行、按调用 ID 回传结果、最终回答的完整 loop。
- 两个只读工具 `searchDocs` / `readDoc`，只访问 4 篇自编教学材料；文档 ID 是白名单，不接收文件路径。
- 控制模型轮数、工具数量与总执行时间，支持取消，记录事件 trace。
- localhost HTTP 创建、查询、取消任务；SQLite 保存状态、结果与 trace。
- 22 个离线测试覆盖正常流程、工具失败、路径拒绝、调用 ID、超限、取消、用户隔离、重启持久化和可选 adapter 的消息映射。

**默认 `MockModel` 是固定脚本，不会理解任意问题。** 它演示控制流，不调用付费 API，不读取 API 密钥。真实模型 adapter 需要主动选择 `--live`，没有进行付费 API 验证。当前检索是关键词匹配，尚未实现 embedding / 向量检索 / RAG 评测。

## 快速开始

需要 **Node.js 24.12.0 或更高的 24.x 版本**。代码使用 Node 原生 TypeScript 类型擦除，运行没有第三方依赖。类型擦除不做类型检查；`npm run check` 单独检查类型，参见 [Node 官方说明](https://nodejs.org/docs/latest-v24.x/api/typescript.html)。

```sh
npm ci
npm run demo
npm run check
npm test
```

默认演示的关键顺序：

```text
run-start → round 1 → searchDocs(search-1)
          → round 2 → readDoc(read-1)
          → round 3 → 最终回答 → completed
```

失败与预算演示：

```sh
npm run demo -- --scenario=tool-error
npm run demo -- --scenario=limit
```

`tool-error` 会收到结构化参数错误后给出固定解释；`limit` 达到 6 轮后停止，退出码为 1。Windows 和 Linux 都可用上述命令。

## localhost HTTP 与持久化

```sh
npm start
```

只监听 `127.0.0.1:3000`。数据库位于 `runtime/tasks.sqlite`，不会进入 Git。Node 24.12.0 的 `node:sqlite` 会显示 ExperimentalWarning，当前版本使用了该原生模块，参见 [对应版本官方文档](https://nodejs.org/download/release/v24.12.0/docs/api/sqlite.html)。

在另一个 PowerShell 窗口：

```powershell
$headers = @{ 'x-demo-user' = 'A' }
$payload = @{ input = '解释 Agent loop'; scenario = 'normal' } | ConvertTo-Json
$task = Invoke-RestMethod -Method Post -Uri 'http://127.0.0.1:3000/tasks' -Headers $headers -ContentType 'application/json' -Body $payload
Invoke-RestMethod -Uri "http://127.0.0.1:3000/tasks/$($task.id)" -Headers $headers
# 取消仍在运行的任务；已结束任务返回 409。
Invoke-RestMethod -Method Post -Uri "http://127.0.0.1:3000/tasks/$($task.id)/cancel" -Headers $headers
```

| 接口 | 行为 |
| --- | --- |
| `POST /tasks` | 接受 `input` 与可选 `scenario`，返回任务与 ID，HTTP 202 |
| `GET /tasks/:id` | 返回本模拟用户的任务状态、结果、trace |
| `POST /tasks/:id/cancel` | 请求取消仍在运行的任务，HTTP 202 |

所有接口需要 `x-demo-user: A` 或 `B`。A 创建的任务，B 查询或取消会得到 404。**这是教学身份模拟，任意客户端可以伪造该请求头，不具备真实认证能力。** 不应暴露至公网。最多同时执行 8 个任务；请求输入最多 2000 字符。

已完成任务在重启后保留。非正常重启前处于 `queued` / `running` 的任务会被标记为 `interrupted`；本版本没有执行恢复或重试队列。正常关闭会取消正在执行的任务。每个数据库仅支持一个服务实例。

## 可选：真实模型

项目提供 OpenAI-compatible **Chat Completions** adapter。协议映射参考 [官方 function calling 指南](https://developers.openai.com/api/docs/guides/function-calling)和 [Chat Completions API 文档](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create)。不同提供商和模型的兼容程度需要单独验证。

主动配置环境变量 `OPENAI_API_KEY`、`OPENAI_MODEL`，可选 `OPENAI_BASE_URL`，再运行：

```sh
npm run demo -- --live "解释 Agent loop，并引用教学资料"
```

此模式会将本次输入和工具返回的教学资料发送给你配置的服务，可能产生 API 费用。`.env.example` 仅作变量说明，项目**不会自动加载 `.env`**；可以自行使用 Node 的 `--env-file`：

```sh
node --env-file=.env src/cli.ts --live "解释 Agent loop"
```

真实模式尚未验证模型质量、调用成本、真实网络错误恢复或 token 预算；当前没有自动重试、流式输出和并行工具执行。测试只连接本机假 API，不连接模型服务。不要把真实密钥提交到仓库。

时间预算使用单调时间，并在模型返回、工具执行前后等边界检查。等待模型时可以中止；同步代码不能被同一线程的 timer 抢占，超时会在同步工作返回后被判定，可能超过预算才结束。

## 从哪里开始学

从 [第一课：沿源码追踪一次完整 Agent 任务](docs/lesson-01.md) 开始。首场用 90–110 分钟沿 DSH 追踪完整任务，对照 Codex harness 的工具分发、结果回写和结束职责，再观察一次运行。源码推演、实际执行的 Mock 轨迹和真实模型轨迹分别记录。

每周安排 6 小时必修与 2 小时选修，按 [10 周迭代路线](docs/roadmap.md) 验证并扩展现有工具、HTTP、SQLite、trace 与取消能力，逐步完成带引用、可评测的 Agent 应用。以 TS / Vue 为核心，Python / FastAPI 与 MCP 选一项做薄桥接。用 [学习记录模板](docs/learning-log-template.md) 保存源码理解、实现、验收结果和讲解证据。课程的岗位依据见 [JD 对齐说明](docs/jd-alignment-2026-10-05.md)，固定源码版本与阅读位置见 [源码学习指南](docs/source-study.md)。

需要核对执行细节时，可以查看 [Agent loop 运行机制参考](docs/runtime-loop-reference.md)。

| 文件 | 学习问题 |
| --- | --- |
| `src/agent.ts` | 谁负责执行？什么情况下停？ |
| `src/model.ts` | mock 与真实模型的边界在哪里？ |
| `src/tools.ts` | Schema 为什么不能替代运行时校验？ |
| `src/store.ts` | 存储任务和恢复任务有什么区别？ |
| `src/server.ts` | 用户条件、状态与取消如何传递？ |
| `test/*.test.ts` | 哪些事实已经被验证，哪些还没有？ |

架构与状态转移见 [architecture.md](docs/architecture.md)。

## 作品集陈述边界

当前可以展示：有界执行器、参数与文档访问限制、调用 ID 关联、取消、持久化和失败测试。可以写“在 AI 辅助下搭建教学起点，正在完成独立讲解和变式实现”。不能把 mock 演示写成真实模型任务成功率，不能把 A/B 请求头写成生产级多租户认证，也不能把生成代码写成已经独立掌握。

MIT License。仓库不包含个人知识库数据、真实聊天记录或认证信息。
