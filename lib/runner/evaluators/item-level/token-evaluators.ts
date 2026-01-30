import { sessionTracesCache } from "../../utils/data-storage.js";
import { mergeTracesObservations } from "../../utils/trace-helpers.js";
import type { EvaluatorInput, EvaluatorResult } from "../../types.js";

// Item-Level Evaluator: 评估总 Tokens 数量
export const tokensEvaluator = async ({ input, output }: EvaluatorInput): Promise<EvaluatorResult> => {
  try {
    // 检查 output 是否为 {success: false, message: ...} 格式
    if (output && typeof output === "object" && "success" in output && output.success === false) {
      console.error(`  ❌ [tokensEvaluator] output success 为 false: ${(output as { message?: string }).message || "无消息"}`);
      return {
        name: "tokens",
        value: 0,
        comment: (output as { message?: string }).message || "output success 为 false，跳过评估",
      };
    }

    // 如果 output 是 {success: true, message: finalOutput} 格式，提取 message
    let sessionId: string | null = null;
    if (
      output &&
      typeof output === "object" &&
      "success" in output &&
      output.success === true &&
      "message" in output &&
      "sessionId" in output
    ) {
      sessionId = (output as { sessionId: string }).sessionId;
    } else {
      console.error(`  ❌ [tokensEvaluator] 未找到 session_id: output 格式不正确`);
      return {
        name: "tokens",
        value: 0,
        comment: "未找到 session_id",
      };
    }

    // 获取多个 traces 的详情（优先从缓存读取）
    const traceDetailsList = sessionId ? sessionTracesCache.get(sessionId) : undefined;
    if (!traceDetailsList || traceDetailsList.length === 0) {
      console.error(`  ❌ [tokensEvaluator] 未找到 Mira trace (sessionId: ${sessionId})`);
      return {
        name: "tokens",
        value: 0,
        comment: "未找到 Mira trace",
      };
    }

    // 合并所有 traces 的 observations
    const allObservations = mergeTracesObservations(traceDetailsList);

    // 查找 LLM generation 类型的 observation
    const llmObservations =
      allObservations?.filter(
        (obs) =>
          obs.type === "GENERATION" ||
          obs.name === "ai.streamText.doStream" ||
          obs.name?.includes("streamText")
      ) || [];

    if (llmObservations.length === 0) {
      console.error(`  ❌ [tokensEvaluator] 未找到 LLM generation observations (sessionId: ${sessionId})`);
      return {
        name: "tokens",
        value: 0,
        comment: "未找到 LLM generation observations",
      };
    }

    // 统计所有 tokens
    let totalInputTokens = 0;
    let totalOutputTokens = 0;
    let totalTokens = 0;

    llmObservations.forEach((obs) => {
      const inputTokens = obs.usage?.input || 0;
      const outputTokens = obs.usage?.output || 0;

      totalInputTokens += inputTokens;
      totalOutputTokens += outputTokens;
    });

    totalTokens = totalInputTokens + totalOutputTokens;

    // 构建 comment
    const commentParts: string[] = [];
    commentParts.push(`traces数量:${traceDetailsList.length}`);
    commentParts.push(`总tokens:${totalTokens}`);
    commentParts.push(`输入tokens:${totalInputTokens}`);
    commentParts.push(`输出tokens:${totalOutputTokens}`);

    console.log(`  📊 [阶段5] tokensEvaluator: ${totalTokens} tokens | 输入:${totalInputTokens} 输出:${totalOutputTokens}`);

    return {
      name: "tokens",
      value: totalTokens,
      comment: commentParts.join(" | "),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ [tokensEvaluator] 评估失败: ${errorMessage}`);
    return {
      name: "tokens",
      value: 0,
      comment: `评估失败: ${errorMessage}`,
    };
  }
};
