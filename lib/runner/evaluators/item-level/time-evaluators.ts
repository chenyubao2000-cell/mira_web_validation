import { sessionTracesCache } from "../../utils/data-storage.js";
import { mergeTracesObservations } from "../../utils/trace-helpers.js";
import type { EvaluatorInput, EvaluatorResult } from "../../types.js";

// Item-Level Evaluator: 评估第一个 Token 生成时间
export const timeToFirstTokenEvaluator = async ({ output }: EvaluatorInput): Promise<EvaluatorResult> => {
  try {
    // 检查 output 是否为 {success: false, message: ...} 格式
    if (output && typeof output === "object" && "success" in output && output.success === false) {
      console.error(`  ❌ [timeToFirstTokenEvaluator] output success 为 false: ${(output as { message?: string }).message || "无消息"}`);
      return {
        name: "time_to_first_token",
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
      console.error(`  ❌ [timeToFirstTokenEvaluator] 未找到 session_id: output 格式不正确`);
      return {
        name: "time_to_first_token",
        value: 0,
        comment: "未找到 session_id",
      };
    }

    // 获取多个 traces 的详情（优先从缓存读取）
    const traceDetailsList = sessionId ? sessionTracesCache.get(sessionId) : undefined;
    if (!traceDetailsList || traceDetailsList.length === 0) {
      console.error(`  ❌ [timeToFirstTokenEvaluator] 未找到 Mira trace (sessionId: ${sessionId})`);
      return {
        name: "time_to_first_token",
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
      console.error(`  ❌ [timeToFirstTokenEvaluator] 未找到 LLM generation observations (sessionId: ${sessionId})`);
      return {
        name: "time_to_first_token",
        value: 0,
        comment: "未找到 LLM generation observations",
      };
    }

    // 提取所有有效的 timeToFirstToken 值，取最小值（最早的第一个token时间）
    const validObservations = llmObservations.filter(
      (obs) =>
        obs.timeToFirstToken !== null &&
        obs.timeToFirstToken !== undefined &&
        obs.timeToFirstToken > 0
    );

    if (validObservations.length === 0) {
      console.error(`  ❌ [timeToFirstTokenEvaluator] 未找到 timeToFirstToken 数据 (sessionId: ${sessionId})`);
      return {
        name: "time_to_first_token",
        value: 0,
        comment: "未找到 timeToFirstToken 数据",
      };
    }

    // 取最小值（最早的第一个token时间）
    const firstObservation = validObservations.reduce((min, obs) =>
      (obs.timeToFirstToken || 0) < (min.timeToFirstToken || 0) ? obs : min
    );

    // 使用最小的 timeToFirstToken 值
    const firstTokenTime = firstObservation.timeToFirstToken || 0;

    console.log(`  📊 [阶段5] timeToFirstTokenEvaluator: ${firstTokenTime.toFixed(3)}秒`);

    return {
      name: "time_to_first_token",
      value: parseFloat(firstTokenTime.toFixed(3)),
      comment:
        validObservations.length > 1
          ? `第一个Token:${firstTokenTime.toFixed(3)}秒 (共${validObservations.length}个，取最小值)`
          : `第一个Token:${firstTokenTime.toFixed(3)}秒`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ [timeToFirstTokenEvaluator] 评估失败: ${errorMessage}`);
    return {
      name: "time_to_first_token",
      value: 0,
      comment: `评估失败: ${errorMessage}`,
    };
  }
};

// Item-Level Evaluator: 评估最后一个 Token 生成时间
export const timeToLastTokenEvaluator = async ({ input, output }: EvaluatorInput): Promise<EvaluatorResult> => {
  try {
    // 检查 output 是否为 {success: false, message: ...} 格式
    if (output && typeof output === "object" && "success" in output && output.success === false) {
      console.error(`  ❌ [timeToLastTokenEvaluator] output success 为 false: ${(output as { message?: string }).message || "无消息"}`);
      return {
        name: "time_to_last_token",
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
      console.error(`  ❌ [timeToLastTokenEvaluator] 未找到 session_id: output 格式不正确`);
      return {
        name: "time_to_last_token",
        value: 0,
        comment: "未找到 session_id",
      };
    }

    // 获取多个 traces 的详情（优先从缓存读取）
    const traceDetailsList = sessionId ? sessionTracesCache.get(sessionId) : undefined;
    if (!traceDetailsList || traceDetailsList.length === 0) {
      console.error(`  ❌ [timeToLastTokenEvaluator] 未找到 Mira trace (sessionId: ${sessionId})`);
      return {
        name: "time_to_last_token",
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
      console.error(`  ❌ [timeToLastTokenEvaluator] 未找到 LLM generation observations (sessionId: ${sessionId})`);
      return {
        name: "time_to_last_token",
        value: 0,
        comment: "未找到 LLM generation observations",
      };
    }

    // 收集所有 observation 的时间信息
    const allStartTimes: Date[] = [];
    const allEndTimes: Date[] = [];
    let totalOutputTokens = 0;

    llmObservations.forEach((obs) => {
      const startTime = obs.startTime ? new Date(obs.startTime as string | number) : null;
      const endTime = obs.endTime ? new Date(obs.endTime as string | number) : null;
      const outputTokens = obs.usage?.output || 0;

      if (startTime) allStartTimes.push(startTime);
      if (endTime) allEndTimes.push(endTime);
      if (outputTokens) totalOutputTokens += outputTokens;
    });

    if (allStartTimes.length === 0 || allEndTimes.length === 0) {
      console.error(`  ❌ [timeToLastTokenEvaluator] 未找到有效的时间数据 (sessionId: ${sessionId})`);
      return {
        name: "time_to_last_token",
        value: 0,
        comment: "未找到有效的时间数据",
      };
    }

    // 计算 time to last token：最后一个 token 的结束时间减去最早开始时间
    const earliestStart = new Date(Math.min(...allStartTimes.map((d) => d.getTime())));
    const latestEnd = new Date(Math.max(...allEndTimes.map((d) => d.getTime())));
    const lastTokenTime = (latestEnd.getTime() - earliestStart.getTime()) / 1000;

    // 构建 comment
    const commentParts: string[] = [];
    commentParts.push(`最后一个Token:${lastTokenTime.toFixed(3)}秒`);

    // 计算总体时间线统计
    const totalDuration = (latestEnd.getTime() - earliestStart.getTime()) / 1000;
    const overallOutputTokensPerSec =
      totalDuration > 0 && totalOutputTokens > 0
        ? (totalOutputTokens / totalDuration).toFixed(2)
        : null;

    console.log(
      `  📊 [阶段5] timeToLastTokenEvaluator: ${lastTokenTime.toFixed(3)}秒 | 输出速度: ${overallOutputTokensPerSec || "N/A"} tokens/秒`
    );

    // 添加到 comment
    const summaryParts: string[] = [`[总计]`];
    summaryParts.push(`最早开始:${earliestStart.toISOString()}`);
    summaryParts.push(`最晚结束:${latestEnd.toISOString()}`);
    summaryParts.push(`总耗时:${totalDuration.toFixed(3)}s`);
    if (overallOutputTokensPerSec) {
      summaryParts.push(`输出速度:${overallOutputTokensPerSec}tokens/s`);
    }
    summaryParts.push(`最后一个Token:${lastTokenTime.toFixed(3)}s`);
    commentParts.push(summaryParts.join(" "));

    return {
      name: "time_to_last_token",
      value: parseFloat(lastTokenTime.toFixed(3)),
      comment: commentParts.join(" | "),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ [timeToLastTokenEvaluator] 评估失败: ${errorMessage}`);
    return {
      name: "time_to_last_token",
      value: 0,
      comment: `评估失败: ${errorMessage}`,
    };
  }
};

// Item-Level Evaluator: 评估输出 Tokens 速度
export const outputTokensPerSecEvaluator = async ({ output }: EvaluatorInput): Promise<EvaluatorResult> => {
  try {
    // 检查 output 是否为 {success: false, message: ...} 格式
    if (output && typeof output === "object" && "success" in output && output.success === false) {
      console.error(`  ❌ [outputTokensPerSecEvaluator] output success 为 false: ${(output as { message?: string }).message || "无消息"}`);
      return {
        name: "output_tokens_per_sec",
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
      console.error(`  ❌ [outputTokensPerSecEvaluator] 未找到 session_id: output 格式不正确`);
      return {
        name: "output_tokens_per_sec",
        value: 0,
        comment: "未找到 session_id",
      };
    }

    // 获取多个 traces 的详情（优先从缓存读取）
    const traceDetailsList = sessionId ? sessionTracesCache.get(sessionId) : undefined;
    if (!traceDetailsList || traceDetailsList.length === 0) {
      console.error(`  ❌ [outputTokensPerSecEvaluator] 未找到 Mira trace (sessionId: ${sessionId})`);
      return {
        name: "output_tokens_per_sec",
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
      console.error(`  ❌ [outputTokensPerSecEvaluator] 未找到 LLM generation observations (sessionId: ${sessionId})`);
      return {
        name: "output_tokens_per_sec",
        value: 0,
        comment: "未找到 LLM generation observations",
      };
    }

    // 收集所有 observation 的时间信息和 tokens
    const allStartTimes: Date[] = [];
    const allEndTimes: Date[] = [];
    let totalOutputTokens = 0;

    llmObservations.forEach((obs) => {
      const startTime = obs.startTime ? new Date(obs.startTime as string | number) : null;
      const endTime = obs.endTime ? new Date(obs.endTime as string | number) : null;
      const outputTokens = obs.usage?.output || 0;

      if (startTime) allStartTimes.push(startTime);
      if (endTime) allEndTimes.push(endTime);
      if (outputTokens) totalOutputTokens += outputTokens;
    });

    if (allStartTimes.length === 0 || allEndTimes.length === 0) {
      console.error(`  ❌ [outputTokensPerSecEvaluator] 未找到有效的时间数据 (sessionId: ${sessionId})`);
      return {
        name: "output_tokens_per_sec",
        value: 0,
        comment: "未找到有效的时间数据",
      };
    }

    // 计算总耗时和输出速度
    const earliestStart = new Date(Math.min(...allStartTimes.map((d) => d.getTime())));
    const latestEnd = new Date(Math.max(...allEndTimes.map((d) => d.getTime())));
    const totalDuration = (latestEnd.getTime() - earliestStart.getTime()) / 1000;

    if (totalDuration <= 0 || totalOutputTokens <= 0) {
      console.error(
        `  ❌ [outputTokensPerSecEvaluator] 无法计算速度: 总耗时=${totalDuration.toFixed(3)}s, 总tokens=${totalOutputTokens} (sessionId: ${sessionId})`
      );
      return {
        name: "output_tokens_per_sec",
        value: 0,
        comment: `无法计算速度 (总耗时: ${totalDuration.toFixed(3)}s, 总tokens: ${totalOutputTokens})`,
      };
    }

    // 计算输出速度：总输出 tokens / 总耗时
    const outputTokensPerSec = totalOutputTokens / totalDuration;

    // 构建 comment
    const commentParts: string[] = [];
    commentParts.push(`输出速度:${outputTokensPerSec.toFixed(2)}tokens/s`);
    commentParts.push(`总tokens:${totalOutputTokens}`);
    commentParts.push(`总耗时:${totalDuration.toFixed(3)}s`);

    console.log(`  📊 [阶段5] outputTokensPerSecEvaluator: ${outputTokensPerSec.toFixed(2)} tokens/秒`);

    return {
      name: "output_tokens_per_sec",
      value: parseFloat(outputTokensPerSec.toFixed(2)),
      comment: commentParts.join(" | "),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ [outputTokensPerSecEvaluator] 评估失败: ${errorMessage}`);
    return {
      name: "output_tokens_per_sec",
      value: 0,
      comment: `评估失败: ${errorMessage}`,
    };
  }
};

// Item-Level Evaluator: 评估会话总时长
export const sessionDurationEvaluator = async ({ output }: EvaluatorInput): Promise<EvaluatorResult> => {
  try {
    // 检查 output 是否为 {success: false, message: ...} 格式
    if (output && typeof output === "object" && "success" in output && output.success === false) {
      console.error(`  ❌ [sessionDurationEvaluator] output success 为 false: ${(output as { message?: string }).message || "无消息"}`);
      return {
        name: "session_duration",
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
      console.error(`  ❌ [sessionDurationEvaluator] 未找到 session_id: output 格式不正确`);
      return {
        name: "session_duration",
        value: 0,
        comment: "未找到 session_id",
      };
    }

    // 获取多个 traces 的详情（优先从缓存读取）
    const traceDetailsList = sessionId ? sessionTracesCache.get(sessionId) : undefined;
    if (!traceDetailsList || traceDetailsList.length === 0) {
      console.error(`  ❌ [sessionDurationEvaluator] 未找到 Mira trace (sessionId: ${sessionId})`);
      return {
        name: "session_duration",
        value: 0,
        comment: "未找到 Mira trace",
      };
    }

    // 收集所有 traces 的开始和结束时间
    const allStartTimes: Date[] = [];
    const allEndTimes: Date[] = [];

    traceDetailsList.forEach((trace) => {
      // 检查 trace 本身的开始和结束时间
      if (trace.startTime) {
        allStartTimes.push(new Date(trace.startTime as string | number));
      }
      if (trace.endTime) {
        allEndTimes.push(new Date(trace.endTime as string | number));
      }

      // 检查 observations 中的时间
      if (Array.isArray(trace.observations) && trace.observations.length > 0) {
        trace.observations.forEach((obs) => {
          if (obs.startTime) {
            allStartTimes.push(new Date(obs.startTime as string | number));
          }
          if (obs.endTime) {
            allEndTimes.push(new Date(obs.endTime as string | number));
          }
        });
      }
    });

    if (allStartTimes.length === 0 || allEndTimes.length === 0) {
      console.error(`  ❌ [sessionDurationEvaluator] 未找到有效的时间数据 (sessionId: ${sessionId})`);
      return {
        name: "session_duration",
        value: 0,
        comment: "未找到有效的时间数据",
      };
    }

    // 计算会话总时长：最早开始时间到最晚结束时间
    const earliestStart = new Date(Math.min(...allStartTimes.map((d) => d.getTime())));
    const latestEnd = new Date(Math.max(...allEndTimes.map((d) => d.getTime())));
    const sessionDuration = (latestEnd.getTime() - earliestStart.getTime()) / 1000;

    // 构建 comment
    const commentParts: string[] = [];
    commentParts.push(`会话时长:${sessionDuration.toFixed(3)}秒`);
    commentParts.push(`开始时间:${earliestStart.toISOString()}`);
    commentParts.push(`结束时间:${latestEnd.toISOString()}`);
    commentParts.push(`traces数量:${traceDetailsList.length}`);

    console.log(`  📊 [阶段5] sessionDurationEvaluator: ${sessionDuration.toFixed(3)}秒 | traces=${traceDetailsList.length}`);

    return {
      name: "session_duration",
      value: parseFloat(sessionDuration.toFixed(3)),
      comment: commentParts.join(" | "),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ [sessionDurationEvaluator] 评估失败: ${errorMessage}`);
    return {
      name: "session_duration",
      value: 0,
      comment: `评估失败: ${errorMessage}`,
    };
  }
};
