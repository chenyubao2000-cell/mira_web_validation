/**
 * 数据集选项（对应 testMira-with-tools.js 中 langfuse.dataset.get(...)）
 */
export const DATASET_OPTIONS = [
  { value: "Ask", label: "Ask" },
  { value: "GAIA", label: "GAIA" },
] as const;

/**
 * 评价器选项（对应 testMira-with-tools.js 第 32-42 行）
 */
export const EVALUATOR_OPTIONS = [
  { id: "completedEvaluator", label: "完成度 (completedEvaluator)" },
  { id: "sessionCostEvaluator", label: "会话成本 (sessionCostEvaluator)" },
  { id: "gaiaEvaluator", label: "GAIA (gaiaEvaluator)" },
  { id: "databaseStatusEvaluator", label: "数据库状态 (databaseStatusEvaluator)" },
  { id: "toolCallEvaluator", label: "工具调用 (toolCallEvaluator)" },
  { id: "timeToFirstTokenEvaluator", label: "首 Token 时间 (timeToFirstTokenEvaluator)" },
  { id: "timeToLastTokenEvaluator", label: "末 Token 时间 (timeToLastTokenEvaluator)" },
  { id: "outputTokensPerSecEvaluator", label: "输出 Token/秒 (outputTokensPerSecEvaluator)" },
  { id: "tokensEvaluator", label: "Token 数 (tokensEvaluator)" },
  { id: "sessionDurationEvaluator", label: "会话时长 (sessionDurationEvaluator)" },
  { id: "nTurnsEvaluator", label: "对话轮数 (nTurnsEvaluator)" },
] as const;

export type DatasetId = (typeof DATASET_OPTIONS)[number]["value"];
export type EvaluatorId = (typeof EVALUATOR_OPTIONS)[number]["id"];
