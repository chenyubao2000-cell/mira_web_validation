import { inputSessionMap, sessionTracesCache } from "../../utils/data-storage.js";
import { mergeTracesObservations } from "../../utils/trace-helpers.js";
import { deepseek, evaluatorPrompts, databaseClient } from "../../config/index.js";
import { generateText } from "ai";
import { cleanControlChars } from "../../utils/helpers.js";
import type { EvaluatorInput, EvaluatorResult } from "../../types.js";

// Item-Level Evaluator: 简单完成度评估（检查 session、trace endTime 和 output）
export const completedEvaluator = async ({ input, output }: EvaluatorInput): Promise<EvaluatorResult> => {
  try {
    // 检查 output 是否为 {success: false, message: ...} 格式
    if (output && typeof output === "object" && "success" in output && output.success === false) {
      return {
        name: "completed",
        value: 0,
        comment: (output as { message?: string }).message || "output success 为 false",
      };
    }
    // 如果 output 是 {success: true, message: finalOutput} 格式，提取 message
    let sessionId: string | null = null;
    let outputMessage: string | undefined;
    if (
      output &&
      typeof output === "object" &&
      "success" in output &&
      output.success === true &&
      "message" in output &&
      "sessionId" in output
    ) {
      sessionId = (output as { sessionId: string }).sessionId;
      outputMessage = (output as { message: string }).message;
    } else {
      console.error(`  ❌ [completedEvaluator] 未找到 session_id: output 格式不正确`);
      return {
        name: "completed",
        value: 0,
        comment: "未找到 session_id",
      };
    }

    if (!sessionId) {
      console.error(`  ❌ [completedEvaluator] sessionId 为空`);
      return {
        name: "completed",
        value: 0,
        comment: "未找到 session_id",
      };
    }

    // 获取多个 traces 的详情（优先从缓存读取，会自动等待完成）
    const traceDetailsList = sessionId ? sessionTracesCache.get(sessionId) : undefined;
    if (!traceDetailsList || traceDetailsList.length === 0) {
      console.error(`  ❌ [completedEvaluator] 未找到 trace (sessionId: ${sessionId})`);
      return {
        name: "completed",
        value: 0,
        comment: "未找到 trace",
      };
    }

    // 合并所有 traces 的 observations
    const allObservations = mergeTracesObservations(traceDetailsList);

    // 使用合并后的 observations
    const traceDetails = traceDetailsList[traceDetailsList.length - 1];
    if (traceDetails) {
      traceDetails.observations = allObservations;
    }

    // 检查 trace 是否有 endTime（检查 trace 本身的 endTime 或 observations 中 ai.streamText 节点的 endTime）
    const hasTraceEndTime = traceDetails?.endTime != null;
    const streamTextNodes =
      allObservations?.filter((obs) => obs.name === "ai.streamText") || [];
    const allStreamTextCompleted =
      streamTextNodes.length > 0 && streamTextNodes.every((obs) => obs.endTime != null);

    if (!hasTraceEndTime && !allStreamTextCompleted) {
      console.error(`  ❌ [completedEvaluator] trace 没有 endTime (sessionId: ${sessionId})`);
      return {
        name: "completed",
        value: 0,
        comment: "trace 没有 endTime",
      };
    }

    // 检查 trace 的 level 是否为 DEFAULT
    const traceLevel = traceDetails && "level" in traceDetails ? (traceDetails as { level?: string }).level : undefined;
    if (traceLevel && traceLevel !== "DEFAULT") {
      console.error(
        `  ❌ [completedEvaluator] trace level 不是 DEFAULT: ${traceLevel} (sessionId: ${sessionId})`
      );
      return {
        name: "completed",
        value: 0,
        comment: `trace level 不是 DEFAULT: ${traceLevel}`,
      };
    }

    // 优先使用从 trace 中提取的 output，如果没有则使用传入的 output 参数
    const finalOutput = outputMessage || "";

    // 检查 output 是否存在
    if (!finalOutput || (typeof finalOutput === "string" && finalOutput.trim().length === 0)) {
      console.error(`  ❌ [completedEvaluator] output 为空 (sessionId: ${sessionId})`);
      return {
        name: "completed",
        value: 0,
        comment: "output 为空",
      };
    }

    console.log(`  📊 [阶段5] completedEvaluator: 得分 1/1 | 完成: session存在, trace有endTime, output存在`);

    return {
      name: "completed",
      value: 1,
      comment: `完成: session存在, trace有endTime, output存在`,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ [completedEvaluator] 评估失败: ${errorMessage}`);
    return {
      name: "completed",
      value: 0,
      comment: `评估失败: ${errorMessage}`,
    };
  }
};

// Item-Level Evaluator: 综合评估输出质量和工具调用
export const gaiaEvaluator = async ({
  input,
  expectedOutput,
  metadata,
  output,
}: EvaluatorInput): Promise<EvaluatorResult> => {
  try {
    // 检查 output 是否为 {success: false, message: ...} 格式
    if (output && typeof output === "object" && "success" in output && output.success === false) {
      return {
        name: "comprehensive_score",
        value: 0,
        comment: (output as { message?: string }).message || "output success 为 false",
      };
    }
    // 如果 output 是 {success: true, message: finalOutput} 格式，提取 message
    let sessionId: string | null = null;
    let outputMessage: string | undefined;
    if (
      output &&
      typeof output === "object" &&
      "success" in output &&
      output.success === true &&
      "message" in output &&
      "sessionId" in output
    ) {
      sessionId = (output as { sessionId: string }).sessionId;
      outputMessage = (output as { message: string }).message;
    } else {
      return {
        name: "comprehensive_score",
        value: 0,
        comment: "未找到 session_id",
      };
    }

    let parsedInput = input;
    if (typeof input === "string") {
      try {
        parsedInput = JSON.parse(input);
      } catch (e) {
        const errorMessage = e instanceof Error ? e.message : String(e);
        throw new Error(`  ⚠️  解析 input 失败: ${errorMessage}`);
      }
    }

    // 提取 question（用于评估提示语）
    const question =
      (parsedInput as { question?: string; text?: string })?.question ||
      (parsedInput as { question?: string; text?: string })?.text ||
      (typeof parsedInput === "string" ? parsedInput : "");

    // ========== 提取期望输出 ==========
    const answer = expectedOutput;
    // 确保 answer 是字符串类型
    const answerStr = typeof answer === "string" ? answer : JSON.stringify(answer);
    const expectedMetadata = metadata || "";

    // 检查 DeepSeek 是否已配置
    if (!deepseek) {
      console.error(`  ❌ [gaiaEvaluator] DeepSeek API Key 未配置`);
      return {
        name: "comprehensive_score",
        value: 0,
        comment: "DeepSeek API Key 未配置",
      };
    }

    // 获取多个 traces 的详情（优先从缓存读取）
    const traceDetailsList = sessionId ? sessionTracesCache.get(sessionId) : undefined;
    if (!traceDetailsList || traceDetailsList.length === 0) {
      console.error(`  ❌ [gaiaEvaluator] 未找到 Mira trace (sessionId: ${sessionId})`);
      return {
        name: "comprehensive_score",
        value: 0,
        comment: "未找到 Mira trace",
      };
    }
    // 按照开始时间对 traceDetailsList 排序，取最后一个 trace（最新的 trace）
    const sortedTraceDetailsList = traceDetailsList.slice().sort((a, b) => {
      const aTime = new Date((a.startTime || a.createdAt || 0) as string | number).getTime();
      const bTime = new Date((b.startTime || b.createdAt || 0) as string | number).getTime();
      return aTime - bTime;
    });
    const lastTrace = sortedTraceDetailsList[sortedTraceDetailsList.length - 1];

    // 检查 doStream 是否存在且有 endTime，如果没有则退出
    if (lastTrace.observations && Array.isArray(lastTrace.observations)) {
      const doStreamObs = lastTrace.observations.find((obs) => obs.name === "ai.streamText");

      if (!doStreamObs || !doStreamObs.endTime) {
        console.error(`  ❌ [gaiaEvaluator] doStream 尚未完成或未检测到 (sessionId: ${sessionId})`);
        return {
          name: "comprehensive_score",
          value: 0,
          comment: "doStream 尚未完成或未检测到",
        };
      }
    }

    // 合并所有 traces 的 observations
    const allObservations = mergeTracesObservations(traceDetailsList);

    // 使用合并后的 observations
    const traceDetails = traceDetailsList[traceDetailsList.length - 1];
    if (traceDetails) {
      traceDetails.observations = allObservations;
    }

    // ========== 提取实际输出（只从合并后的 traceDetails 中提取）==========
    const modelOutput = outputMessage || "无实际输出";

    // ========== 提取实际补充验证 ==========
    const actualMetadata: Array<{ role: string; content: string }> = [];

    if (Array.isArray(allObservations) && allObservations.length > 0) {
      const doStreamNodes = allObservations.filter(
        (obs) => obs.name === "ai.streamText.doStream" || obs.name === "doStream"
      );

      if (doStreamNodes.length > 0) {
        const doStreamObsList = doStreamNodes.sort(
          (a, b) =>
            new Date(a.startTime as string | number).getTime() -
            new Date(b.startTime as string | number).getTime()
        );
        const doStreamObs = doStreamObsList[doStreamObsList.length - 1];

        try {
          if (doStreamObs.input) {
            const inputObj =
              typeof doStreamObs.input === "string" ? JSON.parse(doStreamObs.input) : doStreamObs.input;

            let messages: Array<{ role?: string; content?: unknown }> = [];
            if (Array.isArray(inputObj)) {
              messages = inputObj;
            } else if (inputObj.messages && Array.isArray(inputObj.messages)) {
              messages = inputObj.messages;
            }

            // 按顺序提取所有消息内容（role != 'system' && role != 'function'）
            for (const message of messages) {
              // 提取补充验证（role != 'system' && role != 'function'）
              if (message.role && message.role !== "system" && message.role !== "function") {
                let content = "";
                if (typeof message.content === "string") {
                  content = message.content;
                } else if (Array.isArray(message.content)) {
                  // 处理多部分内容
                  content = message.content
                    .map((part) => {
                      if (typeof part === "string") {
                        return part;
                      } else if (part && typeof part === "object" && "text" in part) {
                        return (part as { text: string }).text;
                      } else if (part && typeof part === "object" && "content" in part) {
                        return (part as { content: string }).content;
                      }
                      return JSON.stringify(part);
                    })
                    .join("\n");
                } else if (message.content && typeof message.content === "object") {
                  content = JSON.stringify(message.content);
                } else {
                  content = String(message.content || "");
                }

                if (content.trim()) {
                  actualMetadata.push({
                    role: message.role,
                    content: cleanControlChars(content),
                  });
                }
              }
            }
          }
        } catch (e) {
          const errorMessage = e instanceof Error ? e.message : String(e);
          console.error(`  ❌ [gaiaEvaluator] 解析补充验证失败: ${errorMessage}`);
        }
      }
    }

    // ========== 计算总耗时和时间信息 ==========
    let totalDuration = 0;
    let timeToLastTokenInfo = "";
    if (Array.isArray(allObservations) && allObservations.length > 0) {
      // 查找 LLM generation 类型的 observation
      const llmObservations = allObservations.filter(
        (obs) =>
          obs.type === "GENERATION" ||
          obs.name === "ai.streamText.doStream" ||
          obs.name === "ai.streamText" ||
          obs.name?.includes("streamText")
      );

      if (llmObservations.length > 0) {
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

        if (allStartTimes.length > 0 && allEndTimes.length > 0) {
          // 计算总体时间线统计
          const earliestStart = new Date(Math.min(...allStartTimes.map((d) => d.getTime())));
          const latestEnd = new Date(Math.max(...allEndTimes.map((d) => d.getTime())));
          totalDuration = (latestEnd.getTime() - earliestStart.getTime()) / 1000;

          // 计算 time to last token：最后一个 token 的结束时间减去最早开始时间
          const timeToLastToken = totalDuration;
          const overallOutputTokensPerSec =
            totalDuration > 0 && totalOutputTokens > 0
              ? (totalOutputTokens / totalDuration).toFixed(2)
              : null;

          // 构建时间信息字符串
          const infoParts: string[] = [];
          infoParts.push(`Time to Last Token: ${timeToLastToken.toFixed(3)}s`);
          infoParts.push(`Total Duration: ${totalDuration.toFixed(3)}s`);
          if (overallOutputTokensPerSec) {
            infoParts.push(`Output Speed: ${overallOutputTokensPerSec} tokens/s`);
          }
          if (totalOutputTokens > 0) {
            infoParts.push(`Total Output Tokens: ${totalOutputTokens}`);
          }
          timeToLastTokenInfo = infoParts.join(" | ");
        }
      }
    }

    // ========== 准备评估提示语 ==========
    // 根据是否有期望输出和期望元数据选择不同的评估器配置
    // 注意：answer 为 null/undefined 时，answerStr 会是 "null"，需要特殊处理
    const hasExpectedOutput =
      answer != null && answerStr !== "" && answerStr !== "null" && answerStr !== "无期望输出";
    const hasExpectedMetadata = expectedMetadata !== "" && expectedMetadata != null;
    const useNoExpectedOutputEvaluator = !hasExpectedOutput && !hasExpectedMetadata;

    const promptConfig = useNoExpectedOutputEvaluator
      ? evaluatorPrompts.check_all_no_expected_output_evaluator
      : evaluatorPrompts.comprehensive_evaluator;

    if (!promptConfig) {
      console.error(`  ❌ [gaiaEvaluator] 未找到综合评估器提示语配置`);
      return {
        name: useNoExpectedOutputEvaluator ? "check_all_no_expected_output_evaluator" : "comprehensive_score",
        value: 0,
        comment: "未找到综合评估器提示语配置",
      };
    }

    // 处理提示语文本
    const promptText = Array.isArray(promptConfig.prompt)
      ? promptConfig.prompt.join("\n")
      : promptConfig.prompt;

    // 准备占位符替换值
    const actualMetadataStr =
      actualMetadata.length > 0 ? JSON.stringify(actualMetadata, null, 2) : "无实际补充验证";
    const expectedMetadataStr = hasExpectedMetadata
      ? typeof expectedMetadata === "string"
        ? expectedMetadata
        : JSON.stringify(expectedMetadata, null, 2)
      : "无期望补充验证";
    const totalDurationStr = totalDuration > 0 ? totalDuration.toFixed(3) + "秒" : "无时间数据";

    // 替换提示语中的占位符（两个评估器都需要的公共占位符）
    let prompt = promptText
      .replace("{{question}}", question)
      .replace("{{output}}", modelOutput)
      .replace("{{actualMetadata}}", actualMetadataStr);

    // 仅在 comprehensive_evaluator 中替换额外的占位符
    if (!useNoExpectedOutputEvaluator) {
      prompt = prompt
        .replace("{{answer}}", answerStr)
        .replace("{{expectedMetadata}}", expectedMetadataStr)
        .replace("{{totalDuration}}", totalDurationStr);
    }

    try {
      // 调用 DeepSeek API
      const result = await generateText({
        model: deepseek("deepseek-chat"),
        prompt: prompt,
        temperature: 0.3,
      });

      // 解析 JSON 响应
      let evaluationResult: { score?: number; reason?: string };
      try {
        const text = result.text.trim();
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
          evaluationResult = JSON.parse(jsonMatch[0]);
        } else {
          evaluationResult = JSON.parse(text);
        }
      } catch (parseError) {
        const errorMessage = parseError instanceof Error ? parseError.message : String(parseError);
        console.error(`  ❌ [gaiaEvaluator] 解析评估结果失败: ${errorMessage}`);
        return {
          name: "comprehensive_score",
          value: 0,
          comment: `解析评估结果失败: ${errorMessage}`,
        };
      }

      const score = evaluationResult?.score ?? 0;
      const reason = evaluationResult?.reason ?? "无说明";
      console.log(
        `  📊 [阶段5] gaiaEvaluator: 得分 ${score}/100 | ${reason.substring(0, 100)}${reason.length > 100 ? "..." : ""}`
      );

      // 构建完整的 comment，包含评估原因和时间信息
      let fullComment = reason;
      if (timeToLastTokenInfo) {
        fullComment = `${reason} | [Time Info] ${timeToLastTokenInfo}`;
      }

      return {
        name: "comprehensive_score",
        value: score,
        comment: fullComment,
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ [gaiaEvaluator] DeepSeek 评估失败: ${errorMessage}`);
      return {
        name: "comprehensive_score",
        value: 0,
        comment: `评估失败: ${errorMessage}`,
      };
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ [gaiaEvaluator] 评估失败: ${errorMessage}`);
    return {
      name: "comprehensive_score",
      value: 0,
      comment: `评估失败: ${errorMessage}`,
    };
  }
};

// Item-Level Evaluator: 计算单个 Session 的消耗金额
export const sessionCostEvaluator = async ({ input, output }: EvaluatorInput): Promise<EvaluatorResult> => {
  try {
    // 检查 output 是否为 {success: false, message: ...} 格式
    if (output && typeof output === "object" && "success" in output && output.success === false) {
      console.error(`  ❌ [sessionCostEvaluator] output success 为 false: ${(output as { message?: string }).message || "无消息"}`);
      return {
        name: "session_cost",
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
      console.error(`  ❌ [sessionCostEvaluator] 未找到 session_id: output 格式不正确`);
      return {
        name: "session_cost",
        value: 0,
        comment: "未找到 session_id",
      };
    }

    // 获取多个 traces 的详情（优先从缓存读取）
    const traceDetailsList = sessionId ? sessionTracesCache.get(sessionId) : undefined;
    if (!traceDetailsList || traceDetailsList.length === 0) {
      console.error(`  ❌ [sessionCostEvaluator] 未找到 Mira trace (sessionId: ${sessionId})`);
      return {
        name: "session_cost",
        value: 0,
        comment: "未找到 Mira trace",
      };
    }

    // 合并所有 traces 的 cost（累加）
    let itemCost = 0;

    for (const traceDetails of traceDetailsList) {
      // 优先级1: trace.totalCost
      if (typeof traceDetails.totalCost === "number" && traceDetails.totalCost > 0) {
        itemCost += traceDetails.totalCost;
      }
      // 优先级2: trace.calculatedTotalCost
      else if (typeof traceDetails.calculatedTotalCost === "number" && traceDetails.calculatedTotalCost > 0) {
        itemCost += traceDetails.calculatedTotalCost;
      }
      // 优先级3: trace.cost
      else if (typeof traceDetails.cost === "number" && traceDetails.cost > 0) {
        itemCost += traceDetails.cost;
      }
      // 优先级4: 累加 observations 的 cost
      else if (Array.isArray(traceDetails.observations)) {
        for (const obs of traceDetails.observations) {
          if (typeof obs.calculatedTotalCost === "number") {
            itemCost += obs.calculatedTotalCost;
          } else if (typeof obs.cost === "number") {
            itemCost += obs.cost;
          }
        }
      }
    }

    console.log(`  📊 [阶段5] sessionCostEvaluator: $${itemCost.toFixed(6)} | traces=${traceDetailsList.length}`);

    return {
      name: "session_cost",
      value: parseFloat(itemCost.toFixed(6)),
      comment:
        itemCost > 0
          ? `Session 消耗: $${itemCost.toFixed(6)} (${traceDetailsList.length} traces)`
          : "无 cost 数据",
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ [sessionCostEvaluator] 评估失败: ${errorMessage}`);
    return {
      name: "session_cost",
      value: 0,
      comment: `评估失败: ${errorMessage}`,
    };
  }
};

// Item-Level Evaluator: 数据库数据状态评估
export const databaseStatusEvaluator = async ({ input, output }: EvaluatorInput): Promise<EvaluatorResult> => {
  try {
    // 检查 output 是否为 {success: false, message: ...} 格式
    if (output && typeof output === "object" && "success" in output && output.success === false) {
      console.error(`  ❌ [databaseStatusEvaluator] output success 为 false: ${(output as { message?: string }).message || "无消息"}`);
      return {
        name: "database_status",
        value: 0,
        comment: JSON.stringify({ error: (output as { message?: string }).message || "output success 为 false，跳过评估" }),
      };
    }

    // 如果 output 是 {success: true, message: finalOutput} 格式，提取 message 和 sessionId
    let sessionId: string | null = null;
    if (output && typeof output === "object" && "sessionId" in output) {
      sessionId = (output as { sessionId?: string }).sessionId || null;
    }

    if (!sessionId) {
      console.error(`  ❌ [databaseStatusEvaluator] 未找到 session_id`);
      return {
        name: "database_status",
        value: 0,
        comment: JSON.stringify({ error: "未找到 session_id" }),
      };
    }

    // 1. 从数据库获取对话轮数和消息配对信息
    let userMessageCount = 0;
    let pairCount = 0;
    let isPaired = true;

    try {
      // 查询所有 user 和 assistant 消息（按 sequence_num 排序）
      const sqlQuery = `
        SELECT role, sequence_num 
        FROM mira_messages 
        WHERE chat_id = $1 AND (role = 'user' OR role = 'assistant')
        ORDER BY sequence_num ASC
      `;
      const rows = (await databaseClient.executeQuery(sqlQuery, [sessionId])) as Array<{
        role: string;
        sequence_num?: number;
      }>;

      if (!rows || rows.length === 0) {
        console.error(`  ❌ [databaseStatusEvaluator] 数据库中未找到 user 或 assistant 消息 (chat_id: ${sessionId})`);
        return {
          name: "database_status",
          value: 0,
          comment: JSON.stringify({ error: `数据库中未找到 user 或 assistant 消息` }),
        };
      }

      // 统计 user 消息数量
      userMessageCount = rows.filter((row) => row.role === "user").length;

      // 如果轮数 = 0，使用 traceDetailsList.length 作为后备
      if (userMessageCount === 0) {
        const traceDetailsList = sessionId ? sessionTracesCache.get(sessionId) : undefined;
        if (traceDetailsList && traceDetailsList.length > 0) {
          userMessageCount = traceDetailsList.length;
        }
      }

      // 2. 检查 user 和 assistant 是否成对（按时间顺序）
      let pendingUser = false; // 标记是否有一个待配对的 user 消息

      for (const row of rows) {
        if (row.role === "user") {
          if (pendingUser) {
            // 如果已经有一个待配对的 user，说明前一个 user 没有对应的 assistant，不成对
            isPaired = false;
            break;
          }
          pendingUser = true; // 标记有一个待配对的 user
        } else if (row.role === "assistant") {
          if (pendingUser) {
            // 如果有一个待配对的 user，现在遇到 assistant，配对成功
            pairCount++;
            pendingUser = false;
          } else {
            // 如果 assistant 前面没有 user，不成对（除非是第一条消息）
            if (pairCount === 0 && rows.indexOf(row) === 0) {
              // 第一条消息是 assistant，这是不正常的
              isPaired = false;
              break;
            }
          }
        }
      }

      // 如果最后还有待配对的 user，说明没有对应的 assistant，不成对
      if (pendingUser) {
        isPaired = false;
      }

      // 如果对话轮数 > 0，检查轮数是否等于对话对数
      if (userMessageCount > 0 && pairCount !== userMessageCount) {
        isPaired = false;
      }
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ [databaseStatusEvaluator] 数据库查询消息失败: ${errorMessage}`);
      return {
        name: "database_status",
        value: 0,
        comment: JSON.stringify({ error: `数据库查询消息失败: ${errorMessage}` }),
      };
    }

    if (!isPaired) {
      console.error(`  ❌ [databaseStatusEvaluator] user 和 assistant 消息不成对 (轮数: ${userMessageCount}, 对数: ${pairCount})`);
      return {
        name: "database_status",
        value: 0,
        comment: JSON.stringify({ error: `user 和 assistant 消息不成对`, turns: userMessageCount, pairs: pairCount }),
      };
    }

    // 3. 检查所有 assistant 消息的 metadata 和 parts
    // 从数据库查询所有 assistant 消息
    try {
      // 查询所有 assistant 消息（按 sequence_num 排序）
      const sqlQuery = `
        SELECT parts, metadata, sequence_num 
        FROM mira_messages 
        WHERE chat_id = $1 AND role = 'assistant' 
        ORDER BY sequence_num ASC
      `;
      const rows = (await databaseClient.executeQuery(sqlQuery, [sessionId])) as Array<{
        parts?: unknown;
        metadata?: unknown;
        sequence_num?: number;
      }>;

      if (!rows || rows.length === 0) {
        console.error(`  ❌ [databaseStatusEvaluator] 数据库中未找到 assistant 消息 (chat_id: ${sessionId})`);
        return {
          name: "database_status",
          value: 0,
          comment: JSON.stringify({ error: `数据库中未找到 assistant 消息` }),
        };
      }

      // 检查每个 assistant 消息
      for (let i = 0; i < rows.length; i++) {
        const assistantMessage = rows[i];
        const sequenceNum = assistantMessage.sequence_num || i + 1;

        // 解析 metadata（可能是字符串或对象）
        let metadata: { aborted?: boolean } = {};
        if (assistantMessage.metadata) {
          if (typeof assistantMessage.metadata === "string") {
            try {
              metadata = JSON.parse(assistantMessage.metadata);
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : String(e);
              console.error(`  ❌ [databaseStatusEvaluator] 第 ${sequenceNum} 条 assistant 消息解析 metadata 失败: ${errorMessage}`);
              return {
                name: "database_status",
                value: 0,
                comment: JSON.stringify({
                  error: `第 ${sequenceNum} 条 assistant 消息解析 metadata 失败`,
                  sequenceNum: sequenceNum,
                  errorMessage: errorMessage,
                }),
              };
            }
          } else {
            metadata = assistantMessage.metadata as { aborted?: boolean };
          }
        }

        // 检查 metadata["aborted"]
        const aborted = metadata.aborted === true;

        if (aborted) {
          // 如果 aborted = true，肯定是正确的，继续检查下一条
          continue;
        }

        // 如果 aborted = false，检查 parts 的最后一项
        // 解析 parts（可能是字符串或数组）
        let parts: Array<{ type?: string; state?: string; output?: { success?: boolean } }> = [];
        if (assistantMessage.parts) {
          if (typeof assistantMessage.parts === "string") {
            try {
              parts = JSON.parse(assistantMessage.parts);
            } catch (e) {
              const errorMessage = e instanceof Error ? e.message : String(e);
              console.error(`  ❌ [databaseStatusEvaluator] 第 ${sequenceNum} 条 assistant 消息解析 parts 失败: ${errorMessage}`);
              return {
                name: "database_status",
                value: 0,
                comment: JSON.stringify({
                  error: `第 ${sequenceNum} 条 assistant 消息解析 parts 失败`,
                  sequenceNum: sequenceNum,
                  errorMessage: errorMessage,
                }),
              };
            }
          } else {
            parts = assistantMessage.parts as Array<{ type?: string; state?: string; output?: { success?: boolean } }>;
          }
        }

        if (Array.isArray(parts) && parts.length > 0) {
          const lastPart = parts[parts.length - 1];

          // 检查这几种情况是正确的：
          // 1. part[-1]['type']=="tool-complete" and part[-1]['output']['success']
          // 2. parts[-1]['type']=="text" and part[-1]['state']=='done'
          // 3. parts[-1]['type']=="tool-clarifyQuestion"
          // 4. parts[-1]['type']=="tool-confirm"
          const isValidPart =
            (lastPart.type === "tool-complete" &&
              lastPart.output &&
              lastPart.output.success === true) ||
            (lastPart.type === "text" && lastPart.state === "done") ||
            lastPart.type === "tool-clarifyQuestion" ||
            lastPart.type === "tool-confirm";

          if (!isValidPart) {
            console.error(
              `  ❌ [databaseStatusEvaluator] 第 ${sequenceNum} 条 assistant 消息的 parts 最后一项不符合要求 (type: ${lastPart.type}, state: ${lastPart.state})`
            );
            return {
              name: "database_status",
              value: 0,
              comment: JSON.stringify({
                error: `第 ${sequenceNum} 条 assistant 消息的 parts 最后一项不符合要求`,
                sequenceNum: sequenceNum,
                lastPartType: lastPart.type,
                lastPartState: lastPart.state,
                aborted: aborted,
              }),
            };
          }
        } else {
          console.error(`  ❌ [databaseStatusEvaluator] 第 ${sequenceNum} 条 assistant 消息没有 parts 或 parts 为空`);
          return {
            name: "database_status",
            value: 0,
            comment: JSON.stringify({
              error: `第 ${sequenceNum} 条 assistant 消息没有 parts 或 parts 为空`,
              sequenceNum: sequenceNum,
              aborted: aborted,
            }),
          };
        }
      }

      // 所有 assistant 消息检查通过
      console.log(`  ✅ [databaseStatusEvaluator] 所有 ${rows.length} 条 assistant 消息验证通过`);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`  ❌ [databaseStatusEvaluator] 数据库查询 assistant 消息失败: ${errorMessage}`);
      return {
        name: "database_status",
        value: 0,
        comment: JSON.stringify({ error: `数据库查询 assistant 消息失败: ${errorMessage}` }),
      };
    }

    // 所有检查通过，返回成功
    console.log(`  📊 [阶段5] databaseStatusEvaluator: 得分 1/1 | 轮数=${userMessageCount}, 对数=${pairCount}, 验证通过`);

    return {
      name: "database_status",
      value: 1,
      comment: JSON.stringify({
        sessionId: sessionId,
        turns: userMessageCount,
        pairs: pairCount,
        status: "验证通过",
      }),
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ [databaseStatusEvaluator] 评估失败: ${errorMessage}`);
    return {
      name: "database_status",
      value: 0,
      comment: JSON.stringify({ error: `评估失败: ${errorMessage}` }),
    };
  }
};
