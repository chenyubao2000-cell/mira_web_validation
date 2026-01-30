/**
 * 实验入口：从环境变量读取 EVAL_DATASET, EVAL_EVALUATORS（逗号分隔）, EVAL_MAX_CONCURRENCY
 */
import { langfuse, sdk, currentEnv } from "./config/index.js";
import { myTask } from "./task.js";
import logger from "./utils/logger.js";
import {
  completedEvaluator,
  sessionCostEvaluator,
  databaseStatusEvaluator,
  toolCallEvaluator,
  timeToFirstTokenEvaluator,
  timeToLastTokenEvaluator,
  outputTokensPerSecEvaluator,
  tokensEvaluator,
  nTurnsEvaluator,
  gaiaEvaluator,
  sessionDurationEvaluator,
} from "./evaluators/item-level/index.js";
import type { EvaluatorInput, EvaluatorResult } from "./types.js";

type EvaluatorFunction = (input: EvaluatorInput) => Promise<EvaluatorResult>;

const EVALUATOR_MAP: Record<string, EvaluatorFunction> = {
  completedEvaluator: completedEvaluator as EvaluatorFunction,
  sessionCostEvaluator: sessionCostEvaluator as EvaluatorFunction,
  gaiaEvaluator: gaiaEvaluator as EvaluatorFunction,
  databaseStatusEvaluator: databaseStatusEvaluator as EvaluatorFunction,
  toolCallEvaluator: toolCallEvaluator as EvaluatorFunction,
  timeToFirstTokenEvaluator: timeToFirstTokenEvaluator as EvaluatorFunction,
  timeToLastTokenEvaluator: timeToLastTokenEvaluator as EvaluatorFunction,
  outputTokensPerSecEvaluator: outputTokensPerSecEvaluator as EvaluatorFunction,
  tokensEvaluator: tokensEvaluator as EvaluatorFunction,
  sessionDurationEvaluator: sessionDurationEvaluator as EvaluatorFunction,
  nTurnsEvaluator: nTurnsEvaluator as EvaluatorFunction,
};

async function main(): Promise<void> {
  const datasetName = process.env.EVAL_DATASET || "Ask";
  const evaluatorIds = (process.env.EVAL_EVALUATORS || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const maxConcurrency = Math.max(
    1,
    Math.min(20, parseInt(process.env.EVAL_MAX_CONCURRENCY || "5", 10) || 5)
  );

  let evaluators = evaluatorIds
    .map((id) => EVALUATOR_MAP[id])
    .filter((e): e is EvaluatorFunction => e !== undefined);
  if (evaluators.length === 0) {
    logger.warn("未选择有效评价器，使用默认列表");
    evaluators = [
      completedEvaluator,
      sessionCostEvaluator,
      gaiaEvaluator,
      databaseStatusEvaluator,
      toolCallEvaluator,
      timeToFirstTokenEvaluator,
      timeToLastTokenEvaluator,
      outputTokensPerSecEvaluator,
      tokensEvaluator,
      sessionDurationEvaluator,
      nTurnsEvaluator,
    ];
  }

  logger.info("\n🚀 启动实验 (CLI): Mira Agent with Tool Analysis");
  logger.info(`🌍 环境: ${currentEnv.toUpperCase()} (可通过 MIRA_ENV 环境变量设置: test/online)`);
  logger.info(`📊 数据集: ${datasetName}`);
  logger.info(`⚙️  并发数: ${maxConcurrency}`);
  logger.info(`📋 评价器: ${evaluators.length} 个`);

  const dataset = await langfuse.dataset.get(datasetName);
  const result = await dataset.runExperiment({
    name: "Mira Agent with Tool Analysis",
    description: "评估 Mira Agent 的准确性、响应长度和工具调用正确性",
    // @ts-ignore - myTask 签名与 ExperimentTask 兼容，但 TypeScript 类型检查较严格
    task: myTask,
    maxConcurrency,
    evaluators,
    runEvaluators: [],
  });

  logger.info(`\n✅ 实验完成 | 结果: ${result.datasetRunUrl}`);
  await langfuse.flush();
  await sdk.shutdown();
  await langfuse.shutdown();
  logger.info("✅ 数据已上传\n");
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
