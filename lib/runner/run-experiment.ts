/**
 * 实验入口：从环境变量读取 EVAL_DATASET, EVAL_EVALUATORS（逗号分隔）, EVAL_MAX_CONCURRENCY
 */
import { langfuse, sdk, currentEnv } from "./config/index.js";
import { myTask } from "./task.js";
import logger from "./utils/logger.js";
import { saveExperimentMetrics } from "./utils/experiment-storage.js";
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
  
  // 实验元数据
  const experimentId = `exp-${Date.now()}`;
  const timestamp = Date.now();
  const miraEnv = process.env.MIRA_ENV || currentEnv || "test";

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

  // 创建包装的评价器，用于收集评价结果
  const evaluationResults: Record<string, number[]> = {};
  
  const wrappedEvaluators = evaluators.map((evalFn) => {
    return async (input: EvaluatorInput): Promise<EvaluatorResult> => {
      const result = await evalFn(input);
      
      // 收集评价结果
      if (result && typeof result.value === "number") {
        const evaluatorName = Object.keys(EVALUATOR_MAP).find(
          key => EVALUATOR_MAP[key] === evalFn
        );
        if (evaluatorName) {
          if (!evaluationResults[evaluatorName]) {
            evaluationResults[evaluatorName] = [];
          }
          evaluationResults[evaluatorName].push(result.value);
        }
      }
      
      return result;
    };
  });

  const dataset = await langfuse.dataset.get(datasetName);
  const result = await dataset.runExperiment({
    name: "Mira Agent with Tool Analysis",
    description: "评估 Mira Agent 的准确性、响应长度和工具调用正确性",
    // @ts-ignore - myTask 签名与 ExperimentTask 兼容，但 TypeScript 类型检查较严格
    task: myTask,
    maxConcurrency,
    evaluators: wrappedEvaluators,
    runEvaluators: [],
  });

  logger.info(`\n✅ 实验完成 | 结果: ${result.datasetRunUrl}`);
  
  // 收集评价结果
  const evaluationMetrics: Record<string, number> = {};
  
  // 收集所有评价器的名称
  const evaluatorNames = evaluators.map((evalFn, idx) => {
    const name = Object.keys(EVALUATOR_MAP).find(
      key => EVALUATOR_MAP[key] === evalFn
    );
    return name || `evaluator_${idx}`;
  });

  try {
    // 方法1: 优先使用从包装的评价器中收集的结果（最可靠）
    logger.info(`\n📊 从包装的评价器中收集评价结果...`);
    Object.entries(evaluationResults).forEach(([evalName, values]) => {
      if (values.length > 0) {
        const avgValue = values.reduce((a, b) => a + b, 0) / values.length;
        evaluationMetrics[evalName] = avgValue;
        logger.info(`  ✅ ${evalName}: 平均值 ${avgValue.toFixed(4)} (${values.length} 个值)`);
      }
    });
    
    // 方法2: 如果从包装的评价器中没收集到数据，尝试从 result.itemResults 中获取
    if (Object.keys(evaluationMetrics).length === 0) {
      logger.warn(`⚠️  从包装的评价器中未收集到数据，尝试从 result 中提取...`);
      logger.info(`🔍 result 类型: ${typeof result}`);
      logger.info(`🔍 result 键: ${Object.keys(result || {}).join(", ")}`);
      
      let itemResults: any[] = [];
      
      // 尝试多种可能的字段名
      if ((result as any).itemResults && Array.isArray((result as any).itemResults)) {
        itemResults = (result as any).itemResults;
        logger.info(`✅ 从 result.itemResults 获取到 ${itemResults.length} 个 item`);
      } else if ((result as any).items && Array.isArray((result as any).items)) {
        itemResults = (result as any).items;
        logger.info(`✅ 从 result.items 获取到 ${itemResults.length} 个 item`);
      } else if ((result as any).data && Array.isArray((result as any).data)) {
        itemResults = (result as any).data;
        logger.info(`✅ 从 result.data 获取到 ${itemResults.length} 个 item`);
      } else {
        logger.warn(`⚠️  无法从 result 中直接提取 itemResults`);
        // 打印 result 的部分内容用于调试
        try {
          const resultStr = JSON.stringify(result, null, 2);
          logger.info(`🔍 Result 结构预览 (前1000字符):\n${resultStr.substring(0, 1000)}`);
        } catch (e) {
          logger.warn(`⚠️  无法序列化 result: ${e}`);
        }
      }

      if (itemResults.length > 0) {
        logger.info(`🔍 从 ${itemResults.length} 个 item 中提取评价结果...`);
        
        // 打印第一个 item 的结构用于调试
        if (itemResults[0]) {
          logger.info(`🔍 第一个 item 的键: ${Object.keys(itemResults[0] || {}).join(", ")}`);
        }

        evaluatorNames.forEach((evalName) => {
          const values: number[] = [];
          
          itemResults.forEach((item: any) => {
            // 尝试多种方式获取 evaluations
            let evaluations: any[] = [];
            
            if (item.evaluations && Array.isArray(item.evaluations)) {
              evaluations = item.evaluations;
            } else if (item.scores && Array.isArray(item.scores)) {
              evaluations = item.scores;
            } else if (item.evaluationResults && Array.isArray(item.evaluationResults)) {
              evaluations = item.evaluationResults;
            } else if (item.result && item.result.evaluations && Array.isArray(item.result.evaluations)) {
              evaluations = item.result.evaluations;
            }
            
            evaluations.forEach((evalResult: any) => {
              // 匹配评价器名称
              const resultName = evalResult.name || evalResult.evaluatorName || evalResult.evaluator;
              if (resultName === evalName && typeof evalResult.value === "number") {
                values.push(evalResult.value);
              }
            });
          });
          
          if (values.length > 0) {
            const avgValue = values.reduce((a, b) => a + b, 0) / values.length;
            evaluationMetrics[evalName] = avgValue;
            logger.info(`  ✅ ${evalName}: 平均值 ${avgValue.toFixed(4)} (${values.length} 个值)`);
          }
        });
      }
    }

    // 输出评价结果 JSON（供前端解析）
    if (Object.keys(evaluationMetrics).length > 0) {
      logger.info(`\n📊 评价结果汇总:`);
      Object.entries(evaluationMetrics).forEach(([name, value]) => {
        logger.info(`  ${name}: ${value.toFixed(4)}`);
      });
      
      // 输出 JSON 格式的评价结果（特殊标记，便于前端解析）
      console.log(`\n[METRICS_JSON_START]${JSON.stringify(evaluationMetrics)}[METRICS_JSON_END]\n`);
      
      // 保存到 experiments.jsonl 文件
      try {
        // 构建完整的 metrics 对象（包含所有评价器，未选择的标记为 -1）
        const allMetrics: Record<string, number | null> = {};
        Object.keys(EVALUATOR_MAP).forEach((evalId) => {
          if (evaluationMetrics[evalId] !== undefined) {
            allMetrics[evalId] = evaluationMetrics[evalId];
          } else {
            // 检查是否在 evaluators 列表中
            const isSelected = evaluators.some((evalFn) => {
              const name = Object.keys(EVALUATOR_MAP).find(
                key => EVALUATOR_MAP[key] === evalFn
              );
              return name === evalId;
            });
            allMetrics[evalId] = isSelected ? null : -1;
          }
        });

        const experimentData = {
          experimentId,
          timestamp,
          dataset: datasetName,
          environment: miraEnv,
          evaluators: evaluatorNames,
          maxConcurrency,
          metrics: allMetrics,
          datasetRunUrl: result.datasetRunUrl,
        };

        await saveExperimentMetrics(experimentData);
        logger.info(`✅ 实验数据已保存到 experiments.jsonl`);
      } catch (saveError) {
        logger.warn(`⚠️  保存实验数据失败: ${saveError instanceof Error ? saveError.message : String(saveError)}`);
      }
    }
  } catch (error) {
    logger.warn(`⚠️  收集评价结果时出错: ${error instanceof Error ? error.message : String(error)}`);
  }

  await langfuse.flush();
  await sdk.shutdown();
  await langfuse.shutdown();
  logger.info("✅ 数据已上传\n");
}

main().catch((err) => {
  logger.error(err);
  process.exit(1);
});
