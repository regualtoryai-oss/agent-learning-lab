// 自编教学材料。这里不读取个人知识库、磁盘文件或网络。
export const documents = [
  {
    id: "agent-loop",
    title: "Agent loop：模型、工具与停止条件",
    body: "Agent loop 在每一轮向模型传入会话。模型可以给出最终回答，也可以提出工具调用。应用负责校验参数、执行工具、按调用 ID 回传结果，再进入下一轮。应用必须设置轮数与时间预算。工具调用是模型的请求，不是执行授权。",
  },
  {
    id: "tool-contract",
    title: "工具契约：参数校验与错误返回",
    body: "工具需要明确的名称、参数结构、返回格式和权限边界。JSON Schema 让模型理解参数，但应用仍需在运行时校验。可恢复的工具失败应返回结构化错误。工具响应必须带回原调用 ID，避免多个调用的结果串线。",
  },
  {
    id: "state-storage",
    title: "任务状态与持久化",
    body: "任务状态应从排队进入运行，再进入完成、失败、取消或超限。SQLite 可以保存任务输入、结果与事件记录。保存状态不等于恢复执行；恢复执行还需要检查点、幂等性和恢复策略。不同用户的任务读取应带上所有者条件。",
  },
  {
    id: "evaluation",
    title: "评测与证据",
    body: "单次演示不能证明 Agent 可靠。需要固定正常、参数错误、超限、取消和越权等案例，记录预期行为。离线 mock 可以验证执行器控制流，但不能证明真实模型的任务成功率、引用准确度、成本或延迟。",
  },
] as const;

export type DocumentId = (typeof documents)[number]["id"];
export const documentIds = documents.map((document) => document.id);
