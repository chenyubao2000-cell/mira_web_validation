import { langfuse } from "../../config/index.js";
import type { RunLevelEvaluatorInput, EvaluatorResult } from "../../types.js";

export const sessionCostStatsEvaluator = async ({
  itemResults,
}: RunLevelEvaluatorInput): Promise<EvaluatorResult> => {
  const costs =
    itemResults
      ?.flatMap((r) => r.evaluations || [])
      ?.filter((e) => e.name === "session_cost" && typeof e.value === "number")
      ?.map((e) => e.value) ?? [];
  if (costs.length === 0) {
    return { name: "total_session_cost", value: 0, comment: "无数据" };
  }
  const totalCost = costs.reduce((a, b) => a + b, 0);
  const avgCost = totalCost / costs.length;
  const datasetRunId = itemResults[0]?.datasetRunId;
  if (datasetRunId) {
    await langfuse.score.create({
      datasetRunId,
      name: "total_session_cost",
      value: parseFloat(totalCost.toFixed(6)),
      comment: `Session 总消耗: $${totalCost.toFixed(6)} (${costs.length} 个 session)`,
    });
  }
  return {
    name: "total_session_cost",
    value: parseFloat(totalCost.toFixed(6)),
    comment: `总消耗: $${totalCost.toFixed(6)}, 平均: ${avgCost.toFixed(6)}`,
  };
};
